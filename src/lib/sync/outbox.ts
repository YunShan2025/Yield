/**
 * outbox 排水与真实 SQLite 合并后端。
 *
 * 数据通路：业务写 → (migration v3 触发器) → sync_outbox → drain 转成日志条目
 * 追加进本设备日志文件；反向：远端日志 → mergeEntries（LWW）→ 落库，
 * 落库前登记 sync_merge_seen 抑制触发器回声（同键同时间戳不重复入箱）。
 *
 * 所有语句都经 tauri-plugin-sql 的连接池执行，事务串行由 client.ts 的
 * withTransaction（JS 队列 + Web Locks）保证，不依赖连接级 BEGIN/COMMIT。
 */

import type { Hlc } from "./hlc";
import type { MergeBackend } from "./merge";
import { splitTaskTagRowId, taskTagRowId, TABLE_SPECS } from "./columns";
import { isSyncTable, SYNC_SCHEMA_VERSION, SYNC_SETTINGS_KEYS, type SyncTableName } from "./tables";

/** tauri-plugin-sql 与测试替身共用的最小 SQL 接口。 */
export interface SqlClient {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

/** 把 settings 白名单键的写入捕获进 outbox（settings 无触发器，走显式捕获）。 */
export async function captureSettingWrite(db: SqlClient, key: string): Promise<void> {
  if (!SYNC_SETTINGS_KEYS.has(key)) return;
  await db.execute(
    "INSERT INTO sync_outbox (table_name, row_id, op, ts_ms) VALUES ('settings', $1, 'upsert', $2)",
    [key, Date.now()],
  );
}

export interface DrainResult {
  /** 序列化好的日志行（不含 header），调用方负责追加进本地日志文件。 */
  lines: string[];
  drained: number;
}

/**
 * 排水：读出 outbox、按键去重（保留最后一次操作的语义）、取当前行数据
 * 生成日志条目行文本，最后清掉已排水的 outbox 行。
 * outbox 里的 upsert 但行已不在（极端竞态）按墓碑处理，永不复活。
 */
export async function drainOutbox(
  db: SqlClient,
  tick: (tsMs?: number) => Hlc,
): Promise<DrainResult> {
  const rows = await db.select<
    { seq: number; table_name: string; row_id: string; op: "upsert" | "delete"; ts_ms: number }[]
  >("SELECT seq, table_name, row_id, op, ts_ms FROM sync_outbox ORDER BY seq");
  if (rows.length === 0) return { lines: [], drained: 0 };

  // 每键保留最大 seq 的操作：LWW 只关心最新状态，早前条目被最新状态覆盖。
  const lastByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    lastByKey.set(`${row.table_name}\u0000${row.row_id}`, row);
  }
  const kept = [...lastByKey.values()].sort((a, b) => a.seq - b.seq);

  const lines: string[] = [];
  const drainedSeqs: number[] = [];
  for (const row of kept) {
    const table = row.table_name;
    if (!isSyncTable(table)) {
      // 未知表（未来 schema 的表先到）：直接丢弃排水，不进日志。
      drainedSeqs.push(row.seq);
      continue;
    }
    const hlc = tick(row.ts_ms);
    // 本地写入同样登记为该行当前 HLC：合并远端条目时以此为 LWW 比较基准。
    // 若只登记远端应用，拉到的旧条目会盖掉本地新值（两端互留对方旧值）。
    await db.execute(
      `INSERT INTO sync_state (table_name, row_id, hlc_p, hlc_l, hlc_d)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(table_name, row_id) DO UPDATE SET
         hlc_p = excluded.hlc_p, hlc_l = excluded.hlc_l, hlc_d = excluded.hlc_d
       WHERE (hlc_p, hlc_l, hlc_d) < (excluded.hlc_p, excluded.hlc_l, excluded.hlc_d)`,
      [table, row.row_id, hlc.p, hlc.l, hlc.d],
    );
    let data: Record<string, unknown> | null = null;
    if (row.op === "upsert") {
      data = await readRowForLog(db, table, row.row_id);
    }
    const op = row.op === "upsert" && data ? "upsert" : "delete";
    const entry: Record<string, unknown> = {
      hlc,
      schema_v: SYNC_SCHEMA_VERSION,
      op,
      table,
      row_id: row.row_id,
    };
    if (op === "upsert") entry.data = data;
    lines.push(JSON.stringify(entry));
    drainedSeqs.push(row.seq);
  }
  if (drainedSeqs.length > 0) {
    const placeholders = drainedSeqs.map((_, i) => `$${i + 1}`).join(",");
    await db.execute(`DELETE FROM sync_outbox WHERE seq IN (${placeholders})`, drainedSeqs);
  }
  return { lines, drained: drainedSeqs.length };
}

/** 读取一行并投影为日志 data（供排水构建全行条目）。 */
async function readRowForLog(
  db: SqlClient,
  table: SyncTableName,
  rowId: string,
): Promise<Record<string, unknown> | null> {
  if (table === "settings") {
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = $1 LIMIT 1",
      [rowId],
    );
    return rows[0] ? { key: rowId, value: rows[0].value } : null;
  }
  if (table === "task_tags") {
    const { task_id, tag_id } = splitTaskTagRowId(rowId);
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM task_tags WHERE task_id = $1 AND tag_id = $2 LIMIT 1",
      [task_id, tag_id],
    );
    return rows[0] ?? null;
  }
  const spec = TABLE_SPECS[table as Exclude<SyncTableName, "settings">];
  const idValue = spec.integerId ? Number(rowId) : rowId;
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM ${table} WHERE ${spec.idColumns[0]} = $1 LIMIT 1`,
    [idValue],
  );
  return rows[0] ?? null;
}

const TS_MS_SQL =
  "COALESCE(CAST(ROUND((julianday(NULLIF(updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0)";

/**
 * 首次全量基线：把所有同步表现存行写入 outbox（含 settings 白名单键），
 * 由 drainOutbox 统一转成日志条目。幂等：INSERT OR IGNORE，重复执行不翻倍。
 */
export async function backfillOutbox(db: SqlClient): Promise<number> {
  let total = 0;
  const updatable = [
    "projects", "goals", "tags", "habits", "anniversaries", "tasks",
    "goal_entries", "goal_milestones",
    "memos", "timers", "ledger_categories", "ledger_accounts",
    "ledger_transactions", "ledger_budgets",
  ];
  for (const table of updatable) {
    total += rowsAffected(
      await db.execute(
        `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
         SELECT '${table}', CAST(id AS TEXT), 'upsert', ${TS_MS_SQL} FROM ${table}`,
      ),
    );
  }
  // task_planning_metadata 主键是 task_id（无 id 列）。
  total += rowsAffected(
    await db.execute(
      `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'task_planning_metadata', task_id, 'upsert', ${TS_MS_SQL} FROM task_planning_metadata`,
    ),
  );
  total += rowsAffected(
    await db.execute(
      `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'task_tags', task_id || ':' || tag_id, 'upsert', ${TS_MS_SQL} FROM task_tags`,
    ),
  );
  // achievements 为追加型表：按 created_at 派生 ts_ms。
  {
    const createdMs =
      "COALESCE(CAST(ROUND((julianday(NULLIF(created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0)";
    total += rowsAffected(
      await db.execute(
        `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
         SELECT 'achievements', CAST(id AS TEXT), 'upsert', ${createdMs} FROM achievements`,
      ),
    );
  }
  // habit_checks 无任何时间戳列：与 v5 触发器一致，ts_ms 取常量 0。
  total += rowsAffected(
    await db.execute(
      `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'habit_checks', id, 'upsert', 0 FROM habit_checks`,
    ),
  );
  const keys = [...SYNC_SETTINGS_KEYS];
  total += rowsAffected(
    await db.execute(
      `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'settings', key, 'upsert', $${keys.length + 1}
       FROM settings WHERE key IN (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      [...keys, Date.now()],
    ),
  );
  return total;
}

function rowsAffected(res: unknown): number {
  if (res && typeof res === "object") {
    // tauri-plugin-sql 返回 rowsAffected；node:sqlite 测试替身返回 changes。
    const r = res as { rowsAffected?: unknown; changes?: unknown };
    return Number(r.rowsAffected ?? r.changes ?? 0) || 0;
  }
  return 0;
}

/** 一次性修复的登记键（settings，设备本地）：做过就不再重复。 */
export const REPAIR_KEY_PROJECT_TAGS = "project_tags_v3";

/**
 * 一次性修复：把带标签的项目重新压入 outbox（与 migration v11 同款 SQL）。
 * migration 11 只帮到"尚未升到 v10"的设备；已在 v1.1.0/v1.1.1 上用旧
 * 列白名单消费过补发条目的对端（水位已推进）仍拿不到标签。升级到本版
 * 后每个设备再重推一次，对端拉到新 HLC 条目即收敛。幂等性由调用方的
 * settings 登记键保证，LWW 让重复推送无害。
 */
export async function requeueTaggedProjects(db: SqlClient): Promise<number> {
  return rowsAffected(
    await db.execute(
      `INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'projects', CAST(id AS TEXT), 'upsert', ${TS_MS_SQL}
       FROM projects WHERE tag_id IS NOT NULL`,
    ),
  );
}

/** 一次性修复的登记键：收养别名改写 projects.tag_id（v1.1.2 存量悬空引用）。 */
export const REPAIR_KEY_TAG_ALIAS_REMAP = "tag_alias_remap_v1";

/**
 * 一次性修复：v1.1.2 的合并后端只改写 task_tags 的 tag_id，projects 条目
 * 落库时保留了对端标签 id——本端 tags 表里没有该 id，项目徽标查不到名字。
 * 此处按 sync_tag_alias 把悬空的 projects.tag_id 改写成本地收养 id。
 * 收养模型下各端各自保留自己的标签 id、到货引用各自改写，改写无需广播：
 * projects 更新触发器带 updated_at 守卫，本修复也不动 updated_at，改动
 * 只落本机。只动「引用不存在且已有收养映射」的行，真实孤儿引用不误清。
 */
export async function remapDanglingProjectTags(db: SqlClient): Promise<number> {
  return rowsAffected(
    await db.execute(
      `UPDATE projects SET tag_id = (SELECT local_id FROM sync_tag_alias WHERE remote_row_id = projects.tag_id)
       WHERE tag_id IS NOT NULL
         AND tag_id NOT IN (SELECT id FROM tags)
         AND tag_id IN (SELECT remote_row_id FROM sync_tag_alias)`,
    ),
  );
}

/**
 * 真实 SQLite 的合并后端。upsert 前登记 sync_merge_seen 抑制触发器回声；
 * 已应用 HLC 写入 sync_state。cleanupSeen 在合并完成后清掉登记
 * （登记只在合并期间有效，残留行因时间戳匹配而天然无害，仍定期清理）。
 *
 * tags 同名词收养：tags.name 有 UNIQUE 约束，双端各自种出的同名标签（随机
 * id 不同）合并时必撞键。策略是零本地删除——保留本地同名词行，把对端 id
 * 收养为该行（映射存 sync_tag_alias，跨轮持久化），后续引用对端 id 的条目
 * （task_tags、projects.tag_id）经映射改写成本地 id。绝不 DELETE 本地行：
 * tags/task_tags 的删除触发器无 WHEN 守卫且 ts 取当前时间，收养路径的任何
 * 删除都会产生回声墓碑，误删对端的真实数据。两端按相同规则各自保留自己的
 * id，名称/颜色/关联自然收敛。
 */
export function createSqliteMergeBackend(db: SqlClient): {
  backend: MergeBackend;
  cleanupSeen(): Promise<void>;
} {
  // 本进程内的别名缓存；权威数据在 sync_tag_alias 表（跨同步轮有效）。
  const tagAliases = new Map<string, string>();
  const loadTagAlias = async (remoteRowId: string): Promise<string | null> => {
    const rows = await db.select<{ local_id: string }[]>(
      "SELECT local_id FROM sync_tag_alias WHERE remote_row_id = $1 LIMIT 1",
      [remoteRowId],
    );
    const localId = rows[0]?.local_id ?? null;
    if (localId) tagAliases.set(remoteRowId, localId);
    return localId;
  };

  const backend: MergeBackend = {
    async getState(table, rowId) {
      const rows = await db.select<{ hlc_p: number; hlc_l: number; hlc_d: string }[]>(
        "SELECT hlc_p, hlc_l, hlc_d FROM sync_state WHERE table_name = $1 AND row_id = $2 LIMIT 1",
        [table, rowId],
      );
      const row = rows[0];
      return row ? { p: row.hlc_p, l: row.hlc_l, d: row.hlc_d } : null;
    },
    async upsert(table, rowId, data) {
      const tsMs = rowTsMs(data);
      if (table === "settings") {
        await db.execute(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [rowId, String(data.value ?? "")],
        );
        return;
      }
      if (table === "tags") {
        const alias = tagAliases.get(rowId) ?? (await loadTagAlias(rowId));
        if (alias) {
          // 该对端 id 之前已收养：条目只在较新时刷新本地行的内容。
          await adoptTagUpdate(db, alias, data, tsMs);
          return;
        }
        const name = typeof data.name === "string" ? data.name : "";
        const rows = await db.select<{ id: string }[]>(
          "SELECT id FROM tags WHERE name = $1 AND id <> $2 LIMIT 1",
          [name, rowId],
        );
        const localId = rows[0]?.id;
        if (name && localId) {
          tagAliases.set(rowId, localId);
          await db.execute(
            `INSERT INTO sync_tag_alias (remote_row_id, local_id, ts_ms) VALUES ($1, $2, $3)
             ON CONFLICT(remote_row_id) DO UPDATE SET local_id = excluded.local_id`,
            [rowId, localId, Date.now()],
          );
          await adoptTagUpdate(db, localId, data, tsMs);
          return;
        }
      }
      if (table === "projects") {
        // 项目条目里的 tag_id 可能是对端已被收养的标签 id：改写成本地 id
        // 再落库，否则项目徽标的 tag 查询悬空（与 task_tags 同一规则）。
        const ref = typeof data.tag_id === "string" ? data.tag_id : "";
        if (ref) {
          const localTagId = tagAliases.get(ref) ?? (await loadTagAlias(ref));
          if (localTagId) data = { ...data, tag_id: localTagId };
        }
      }
      if (table === "task_tags") {
        // 关联条目里的 tag_id 可能是对端已被收养的 id：改写成本地 id 再落库，
        // 触发器的 row_id（task_id || ':' || tag_id）随之对上回声抑制键。
        const { task_id, tag_id } = splitTaskTagRowId(rowId);
        const localTagId = tagAliases.get(tag_id) ?? (await loadTagAlias(tag_id));
        if (localTagId) rowId = taskTagRowId(task_id, localTagId);
      }
      await buildUpsert(db, table, rowId, data, tsMs);
    },
    async remove(table, rowId) {
      if (table === "settings") {
        await db.execute("DELETE FROM settings WHERE key = $1", [rowId]);
        return;
      }
      if (table === "tags") {
        // 已收养的对端 id：本地行是同名词的独立行，对端删除不波及本地
        //（否则删除回声会清掉对端自己那份数据）。墓碑仍记入 sync_state。
        const alias = tagAliases.get(rowId) ?? (await loadTagAlias(rowId));
        if (alias) return;
        await db.execute("DELETE FROM tags WHERE id = $1", [rowId]);
        return;
      }
      if (table === "task_tags") {
        const { task_id, tag_id } = splitTaskTagRowId(rowId);
        const localTagId = tagAliases.get(tag_id) ?? (await loadTagAlias(tag_id));
        await db.execute("DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2", [
          task_id,
          localTagId ?? tag_id,
        ]);
        return;
      }
      const spec = TABLE_SPECS[table as Exclude<SyncTableName, "settings">];
      const idValue = spec.integerId ? Number(rowId) : rowId;
      await db.execute(`DELETE FROM ${table} WHERE ${spec.idColumns[0]} = $1`, [idValue]);
    },
    async setState(table, rowId, hlc) {
      await db.execute(
        `INSERT INTO sync_state (table_name, row_id, hlc_p, hlc_l, hlc_d)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(table_name, row_id) DO UPDATE SET
           hlc_p = excluded.hlc_p, hlc_l = excluded.hlc_l, hlc_d = excluded.hlc_d`,
        [table, rowId, hlc.p, hlc.l, hlc.d],
      );
    },
  };
  return {
    backend,
    async cleanupSeen() {
      await db.execute("DELETE FROM sync_merge_seen");
    },
  };
}

/** 远端行时间戳 → ms（与触发器内 julianday 表达式语义一致，非法值取 0）。 */
function rowTsMs(data: Record<string, unknown>): number {
  const raw = (data.updated_at ?? data.created_at) as string | undefined;
  if (typeof raw === "string" && raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

/**
 * 收养后的内容跟随：对端条目较新时把名称/颜色刷进本地同名词行。
 * updated_at 一并写成对端值——触发器按行内 updated_at 派生 ts 与
 * sync_merge_seen 比对，写入值与登记值必须同源。对端较旧或无时间戳
 * （ts 0）时保留本地内容，只维持 id 映射。
 */
async function adoptTagUpdate(
  db: SqlClient,
  localId: string,
  data: Record<string, unknown>,
  tsMs: number,
): Promise<void> {
  const rows = await db.select<{ updated_at: string; name: string }[]>(
    "SELECT updated_at, name FROM tags WHERE id = $1 LIMIT 1",
    [localId],
  );
  const local = rows[0];
  if (!local || tsMs === 0 || tsMs <= rowTsMs(local)) return;
  const nextUpdatedAt =
    typeof data.updated_at === "string" && data.updated_at
      ? data.updated_at
      : typeof data.created_at === "string" && data.created_at
        ? data.created_at
        : local.updated_at;
  await db.execute(
    `INSERT INTO sync_merge_seen (table_name, row_id, ts_ms) VALUES ('tags', $1, $2)
     ON CONFLICT(table_name, row_id) DO UPDATE SET ts_ms = excluded.ts_ms`,
    [localId, tsMs],
  );
  await db.execute(
    "UPDATE tags SET name = $1, color = COALESCE($2, color), updated_at = $3 WHERE id = $4",
    [
      typeof data.name === "string" && data.name ? data.name : local.name,
      data.color ?? null,
      nextUpdatedAt,
      localId,
    ],
  );
}

/** 列白名单过滤：远端日志里的未知键丢弃，id 一律以 row_id 为准。 */
export function projectRowData(
  table: SyncTableName,
  rowId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (table === "settings") {
    return { key: rowId, value: data.value };
  }
  const spec = TABLE_SPECS[table as Exclude<SyncTableName, "settings">];
  if (table === "task_tags") {
    const { task_id, tag_id } = splitTaskTagRowId(rowId);
    const out: Record<string, unknown> = { task_id, tag_id };
    for (const col of spec.columns) if (col in data) out[col] = data[col];
    return out;
  }
  const out: Record<string, unknown> = {
    [spec.idColumns[0]]: spec.integerId ? Number(rowId) : rowId,
  };
  for (const col of spec.columns) {
    if (col in data) out[col] = data[col];
  }
  return out;
}

async function buildUpsert(
  db: SqlClient,
  table: SyncTableName,
  rowId: string,
  data: Record<string, unknown>,
  tsMs: number,
): Promise<void> {
  const projected = projectRowData(table, rowId, data);
  const cols = Object.keys(projected);
  if (cols.length === 0) return;
  const spec = TABLE_SPECS[table as Exclude<SyncTableName, "settings">];
  // 先登记回声抑制，再触发真正的 INSERT（触发器在语句内同步检查登记表）。
  await db.execute(
    `INSERT INTO sync_merge_seen (table_name, row_id, ts_ms) VALUES ($1, $2, $3)
     ON CONFLICT(table_name, row_id) DO UPDATE SET ts_ms = excluded.ts_ms`,
    [table, rowId, tsMs],
  );
  const conflict =
    table === "task_tags" ? "task_id, tag_id" : spec.idColumns[0];
  const updates = cols
    .filter(
      (c) =>
        !(table === "task_tags" && (c === "task_id" || c === "tag_id")) &&
        !(conflict === spec.idColumns[0] && c === spec.idColumns[0]),
    )
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  await db.execute(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})
     ON CONFLICT(${conflict}) DO UPDATE SET ${updates}`,
    Object.values(projected),
  );
}

