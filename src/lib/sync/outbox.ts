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
import { splitTaskTagRowId, TABLE_SPECS } from "./columns";
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
    "task_planning_metadata", "milestones", "goal_entries", "goal_milestones",
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
  total += rowsAffected(
    await db.execute(
      `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
       SELECT 'task_tags', task_id || ':' || tag_id, 'upsert', ${TS_MS_SQL} FROM task_tags`,
    ),
  );
  for (const table of ["habit_checks", "focus_sessions", "achievements"]) {
    const createdMs =
      "COALESCE(CAST(ROUND((julianday(NULLIF(created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0)";
    total += rowsAffected(
      await db.execute(
        `INSERT OR IGNORE INTO sync_outbox(table_name, row_id, op, ts_ms)
         SELECT '${table}', CAST(id AS TEXT), 'upsert', ${createdMs} FROM ${table}`,
      ),
    );
  }
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
  if (res && typeof res === "object" && "rowsAffected" in res) {
    return Number((res as { rowsAffected: unknown }).rowsAffected) || 0;
  }
  return 0;
}

/**
 * 真实 SQLite 的合并后端。upsert 前登记 sync_merge_seen 抑制触发器回声；
 * 已应用 HLC 写入 sync_state。cleanupSeen 在合并完成后清掉登记
 * （登记只在合并期间有效，残留行因时间戳匹配而天然无害，仍定期清理）。
 */
export function createSqliteMergeBackend(db: SqlClient): {
  backend: MergeBackend;
  cleanupSeen(): Promise<void>;
} {
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
      await buildUpsert(db, table, rowId, data, tsMs);
    },
    async remove(table, rowId) {
      if (table === "settings") {
        await db.execute("DELETE FROM settings WHERE key = $1", [rowId]);
        return;
      }
      if (table === "task_tags") {
        const { task_id, tag_id } = splitTaskTagRowId(rowId);
        await db.execute("DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2", [
          task_id,
          tag_id,
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

