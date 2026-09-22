/**
 * 双端同步集成测试：两台"设备"各自持有真实内存 SQLite（含 migration v1–v3
 * 全部触发器）+ 临时目录日志文件，通过内存传输交换日志，驱动真实 runSync。
 * 覆盖：对账闭环（建/改/删）、离线交错与同键并发收敛、回声抑制、
 * settings 白名单、水位增量、基线回填。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSync, type SyncSummary } from "./engine";
import { captureSettingWrite, backfillOutbox, remapDanglingProjectTags, type SqlClient } from "./outbox";
import { HlcClock } from "./hlc";
import { MemoryTransport } from "./transport";
import type { LogReadState } from "./log";

let schemaSql = "";
beforeAll(() => {
  const src = rf("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
  schemaSql = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    .map((v) => {
      const i = src.indexOf(`version: ${v},`);
      const a = src.indexOf('sql: r#"', i) + 8;
      const b = src.indexOf('"#,', i);
      // 单行 sql（如 v9 的 ALTER TABLE）没有换行起点，去掉开头换行即可
      const raw = src.slice(a, b);
      return raw.startsWith("\n") ? raw.slice(1) : raw;
    })
    .join("\n");
});

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

interface Device {
  name: string;
  client: SqlClient;
  sync(): Promise<SyncSummary>;
  rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
  outboxCount(): Promise<number>;
  readLocalLog(): string;
  rewriteLocal(text: string): Promise<void>;
  get lastSync(): SyncSummary | null;
}

function createDevice(name: string, transport: MemoryTransport): Device {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  // node:sqlite 不支持 $n 占位符数组绑定（sqlx 支持），适配层翻译为 ?。
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, "?");
  const client: SqlClient = {
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      return db.prepare(toQ(sql)).all(...((params ?? []) as SQLInputValue[])) as T;
    },
    async execute(sql: string, params?: unknown[]): Promise<unknown> {
      return db.prepare(toQ(sql)).run(...((params ?? []) as SQLInputValue[]));
    },
  };
  const dir = mkdtempSync(join(tmpdir(), `youqiu-sync-${name}-`));
  tmpDirs.push(dir);
  const logPath = join(dir, `${name}.jsonl`);
  // 时钟起点压到测试用时间戳之下：tick 会采纳行内 updated_at 作为 HLC 的 p，
  // 使 LWW 胜负由测试时间戳决定，而非真实墙钟与执行顺序。
  const fakeNow = Date.parse("2026-09-16T00:00:00.000Z") - 1;
  const clock = new HlcClock(name, null, () => fakeNow);
  const remoteStates = new Map<string, LogReadState>();
  let lastSync: SyncSummary | null = null;

  const readLog = (): string => {
    try {
      return readFileSync(logPath, "utf8");
    } catch {
      return "";
    }
  };

  const store = {
    async readLocal(): Promise<string | null> {
      const text = readLog();
      return text ? text : null;
    },
    async appendLocal(lines: string[]): Promise<void> {
      const prev = readLog();
      writeFileSync(logPath, prev + lines.join("\n") + "\n");
    },
    async rewriteLocal(text: string): Promise<void> {
      writeFileSync(logPath, text);
    },
  };
  const hooks = {
    async persistClock() {},
    async persistRemoteState(file: string, state: LogReadState) {
      remoteStates.set(file, state);
    },
    async loadRemoteState(file: string): Promise<LogReadState | null> {
      return remoteStates.get(file) ?? null;
    },
    async persistLastSync(summary: SyncSummary) {
      lastSync = summary;
    },
  };

  return {
    name,
    client,
    async sync() {
      const summary = await runSync({
        db: client,
        clock,
        ownFileName: `${name}.jsonl`,
        store,
        transport,
        hooks,
        trigger: "manual",
      });
      lastSync = summary;
      return summary;
    },
    async rows(sql: string, params?: unknown[]) {
      return (await client.select<Record<string, unknown>[]>(sql, params)) ?? [];
    },
    run: (sql, params) => client.execute(sql, params),
    async outboxCount() {
      const rows = await client.select<{ c: number }[]>(
        "SELECT count(*) AS c FROM sync_outbox",
      );
      return rows[0]?.c ?? 0;
    },
    readLocalLog: readLog,
    rewriteLocal: store.rewriteLocal,
    get lastSync() {
      return lastSync;
    },
  };
}

describe("双端同步集成（真实 SQLite 触发器 + 内存传输）", () => {
  it("升版重排：旧 header 本地日志补新 header 上传，对端清水位重读收敛", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    // A 在"旧版本"下建数据并同步（对端已消费，水位推进）。
    await a.run(
      `INSERT INTO tasks (id,title,status,created_at,updated_at)
       VALUES ('t1','写周报','pending','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();
    expect(await b.rows("SELECT title FROM tasks WHERE id='t1'")).toEqual([
      { title: "写周报" },
    ]);

    // 模拟 A 的日志 header 停留在旧 schema_v（升版前写的）：下一轮同步
    // 应重排 header 并落回本地文件。
    const before = a.readLocalLog();
    const oldHeader = JSON.parse(before.split("\n", 1)[0]);
    oldHeader.schema_v = 1;
    const downgraded = [JSON.stringify(oldHeader), ...before.split("\n").slice(1)].join("\n");
    await a.rewriteLocal(downgraded);

    const s = await a.sync();
    expect(s.errors).toEqual([]);
    const header = JSON.parse(a.readLocalLog().split("\n", 1)[0]);
    expect(header.schema_v).toBe(3);

    // 新对端从头消费：数据全量到达。
    const c = createDevice("third", transport);
    const s3 = await c.sync();
    expect(s3.pulled).toBeGreaterThan(0);
    expect(await c.rows("SELECT title FROM tasks WHERE id='t1'")).toEqual([
      { title: "写周报" },
    ]);
    // 旧格式条目（schema_v ≤ 本端）也能解析，本地日志不再反复重排。
    const pending = await a.rows("SELECT count(*) AS c FROM sync_outbox");
    expect(pending[0]?.c ?? 0).toBe(0);
  });

  it("项目标签回填后经 migration v11 重推，同步到对端", async () => {
    const src = rf("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
    const i = src.indexOf("version: 11,");
    const v11 = src.slice(
      src.indexOf("\n", src.indexOf('sql: r#"', i)) + 1,
      src.indexOf('"#,', i),
    );

    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    // 双端在旧版本（无 tag_id 列）下建项目并同步一轮，双方水位推进。
    await a.run(
      `INSERT INTO projects (id, name, created_at, updated_at)
       VALUES ('p1','小论文','2026-09-15T00:00:00.000Z','2026-09-15T00:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    // 双端已在含 v9 的完整 schema 上（tag_id 列已存在）。A 端回填标签——
    // 模拟 v10 的回填 UPDATE，不改 updated_at。
    await a.run("UPDATE projects SET tag_id = 'tagX' WHERE id = 'p1'");
    // 回归点：更新时间未变，触发器（WHEN updated_at 变化）不入箱——
    // 这正是 v1.1.0 标签同步丢失的根因。
    expect(await a.outboxCount()).toBe(0);

    // v11 把带标签的项目重新压回 outbox，下一轮排水以新 HLC 全行重发。
    await a.run(v11);
    expect(
      await a.rows("SELECT row_id FROM sync_outbox WHERE table_name='projects'"),
    ).toEqual([{ row_id: "p1" }]);
    const pushed = await a.sync();
    expect(pushed.pushed).toBeGreaterThan(0);
    const pulled = await b.sync();
    expect(pulled.pulled).toBeGreaterThan(0);
    expect(await b.rows("SELECT tag_id FROM projects WHERE id='p1'")).toEqual([
      { tag_id: "tagX" },
    ]);
    // 对端应用无回声。
    expect(await b.outboxCount()).toBe(0);
  });

  it("A 建任务 → 同步 → B 可见 → B 改标题 → 同步 → A 跟随", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tasks (id,title,status,created_at,updated_at)
       VALUES ('t1','写周报','pending','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    let rows = await b.rows("SELECT title FROM tasks WHERE id='t1'");
    expect(rows[0]?.title).toBe("写周报");
    // 回声抑制：B 合并 A 的条目后，自己的 outbox 不应出现 t1 的回声。
    expect(await b.outboxCount()).toBe(0);

    await b.run(
      `UPDATE tasks SET title='写周报(改)', updated_at='2026-09-16T05:00:00.000Z' WHERE id='t1'`,
    );
    await b.sync();
    await a.sync();
    rows = await a.rows("SELECT title FROM tasks WHERE id='t1'");
    expect(rows[0]?.title).toBe("写周报(改)");
  });

  it("双端离线各写各的，再同时上线：数据全到齐", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('a1','A的任务','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await b.run(
      `INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('b1','B的任务','2026-09-16T02:00:00.000Z','2026-09-16T02:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();
    await a.sync(); // A 收到 B 的日志
    await b.sync();

    expect((await a.rows("SELECT id FROM tasks")).map((r) => r.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
    expect((await b.rows("SELECT id FROM tasks")).map((r) => r.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("同键并发修改按 HLC 稳定收敛，两端一致", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('c1','初始','2026-09-16T00:00:00.000Z','2026-09-16T02:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    // 双端离线各改同一行：A 在 03:00，B 在 04:00（B 较新应胜出）
    await a.run(
      `UPDATE tasks SET title='A改', updated_at='2026-09-16T03:00:00.000Z' WHERE id='c1'`,
    );
    await b.run(
      `UPDATE tasks SET title='B改', updated_at='2026-09-16T04:00:00.000Z' WHERE id='c1'`,
    );
    const [ra, rb] = await Promise.all([a.sync(), b.sync()]);
    await a.sync();
    await b.sync();

    const titleA = (await a.rows("SELECT title FROM tasks WHERE id='c1'"))[0]?.title;
    const titleB = (await b.rows("SELECT title FROM tasks WHERE id='c1'"))[0]?.title;
    expect(titleA).toBe(titleB);
    expect(titleA).toBe("B改");
    expect(ra.ok && rb.ok).toBe(true);
  });

  it("删除作为墓碑同步，旧 upsert 不复活", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tags (id,name,created_at,updated_at) VALUES ('g1','工作','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    await b.run("DELETE FROM tags WHERE id='g1'");
    await b.sync();
    await a.sync();
    expect(await a.rows("SELECT id FROM tags WHERE id='g1'")).toHaveLength(0);
    // B 端同步后再拉：墓碑不产生复活
    await b.sync();
    expect(await b.rows("SELECT id FROM tags WHERE id='g1'")).toHaveLength(0);
  });

  it("settings 白名单键同步，设备键排除", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);
    await b.sync(); // B 先建日志文件，A 才有对端可传

    await a.run("INSERT INTO settings (key,value) VALUES ('theme','dark') ON CONFLICT(key) DO UPDATE SET value='dark'");
    await captureSettingWrite(a.client, "theme");
    await captureSettingWrite(a.client, "autostart"); // 非白名单：捕获为空操作
    await a.run(
      "INSERT INTO settings (key,value) VALUES ('autostart','true') ON CONFLICT(key) DO UPDATE SET value='true'",
    );

    await a.sync();
    await b.sync();
    const theme = await b.rows("SELECT value FROM settings WHERE key='theme'");
    expect(theme[0]?.value).toBe("dark");
    // 设备键不同步：B 的 autostart 保持本机种子值
    const autostart = await b.rows("SELECT value FROM settings WHERE key='autostart'");
    expect(autostart[0]?.value).toBe("false");
  });

  it("水位增量：重复同步不重复应用，本地日志只追加", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('w1','增量','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    const first = await a.sync();
    expect(first.pushed).toBe(1);
    // 已排水，重复同步不再推送新条目
    const again = await a.sync();
    expect(again.pushed).toBe(0);
    // B 首次拉到 1 条，重复同步不再拉到
    const s1 = await b.sync();
    expect(s1.pulled).toBe(1);
    const s2 = await b.sync();
    expect(s2.pulled).toBe(0);
    // 本地日志只追加不重写
    const lenBefore = a.readLocalLog().length;
    await a.sync();
    expect(a.readLocalLog().length).toBe(lenBefore);
  });

  it("双端各自种下同名标签：收养收敛，关联改写，无失败无回声", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    // 真实事故场景：两端独立建同名标签（随机 id），合并撞 tags.name 的
    // UNIQUE 约束。修复前 B 合并报 UNIQUE constraint failed: tags.name。
    await a.run(
      `INSERT INTO tags (id,name,color,created_at,updated_at)
       VALUES ('tagA','工作','#f00','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await b.run(
      `INSERT INTO tags (id,name,color,created_at,updated_at)
       VALUES ('tagB','工作','#00f','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.run(
      `INSERT INTO tasks (id,title,created_at,updated_at)
       VALUES ('ta','A任务','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.run(
      `INSERT INTO task_tags (task_id,tag_id,updated_at) VALUES ('ta','tagA','2026-09-16T01:00:00.000Z')`,
    );

    await a.sync();
    const sb = await b.sync();
    expect(sb.ok).toBe(true);
    expect(sb.errors).toEqual([]);
    // B 保留自己的行（id 不变），没有引入对端行，也没有删除本地行
    let tags = await b.rows("SELECT id, name FROM tags");
    expect(tags).toEqual([{ id: "tagB", name: "工作" }]);
    // A 的关联条目改写到 B 的本地 id
    let assoc = await b.rows("SELECT task_id, tag_id FROM task_tags");
    expect(assoc).toEqual([{ task_id: "ta", tag_id: "tagB" }]);
    expect(await b.outboxCount()).toBe(0);

    // A 收养 B 的标签（对称），双端各留自己的 id、关联齐全
    await b.run(
      `INSERT INTO task_tags (task_id,tag_id,updated_at) VALUES ('tb','tagB','2026-09-16T01:30:00.000Z')`,
    );
    await b.run(
      `INSERT INTO tasks (id,title,created_at,updated_at)
       VALUES ('tb','B任务','2026-09-16T01:30:00.000Z','2026-09-16T01:30:00.000Z')`,
    );
    await b.sync();
    const sa = await a.sync();
    expect(sa.ok).toBe(true);
    expect(await a.rows("SELECT id, name FROM tags")).toEqual([
      { id: "tagA", name: "工作" },
    ]);
    expect((await a.rows("SELECT task_id FROM task_tags")).map((r) => r.task_id).sort()).toEqual([
      "ta",
      "tb",
    ]);

    // 跨轮持久化：下一轮（新合并后端实例）A 的新关联仍要改写。
    // B 的水位只前进不回头，别名必须落库而不是只活在单次合并里。
    await a.run(
      `INSERT INTO tasks (id,title,created_at,updated_at)
       VALUES ('ta2','A任务2','2026-09-16T02:00:00.000Z','2026-09-16T02:00:00.000Z')`,
    );
    await a.run(
      `INSERT INTO task_tags (task_id,tag_id,updated_at) VALUES ('ta2','tagA','2026-09-16T02:00:00.000Z')`,
    );
    await a.sync();
    const sb2 = await b.sync();
    expect(sb2.ok).toBe(true);
    assoc = await b.rows("SELECT task_id, tag_id FROM task_tags ORDER BY task_id");
    expect(assoc).toEqual([
      { task_id: "ta", tag_id: "tagB" },
      { task_id: "ta2", tag_id: "tagB" },
      { task_id: "tb", tag_id: "tagB" },
    ]);

    // 项目徽标同路改写：projects.tag_id 引用对端 id 时也要落到本地收养 id，
    // 否则项目卡片查不到标签名（v1.1.2 事故：徽标一直显示「标签」兜底）。
    await a.run(
      `INSERT INTO projects (id,name,color,tag_id,created_at,updated_at)
       VALUES ('pa','A项目','#f00','tagA','2026-09-16T02:30:00.000Z','2026-09-16T02:30:00.000Z')`,
    );
    await a.sync();
    const sb3 = await b.sync();
    expect(sb3.ok).toBe(true);
    expect(await b.rows("SELECT id, tag_id FROM projects")).toEqual([
      { id: "pa", tag_id: "tagB" },
    ]);
    // 对称：B 的项目带自己的标签 id，A 收养后落到 tagA
    await b.run(
      `INSERT INTO projects (id,name,color,tag_id,created_at,updated_at)
       VALUES ('pb','B项目','#00f','tagB','2026-09-16T02:30:00.000Z','2026-09-16T02:30:00.000Z')`,
    );
    await b.sync();
    await a.sync();
    expect(await a.rows("SELECT id, tag_id FROM projects")).toEqual([
      { id: "pa", tag_id: "tagA" },
      { id: "pb", tag_id: "tagA" },
    ]);
  });

  it("对端较新的同名标签内容经收养刷新本地行，且不产生回声", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await a.run(
      `INSERT INTO tags (id,name,color,created_at,updated_at)
       VALUES ('tagA','工作','#ff0000','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await b.run(
      `INSERT INTO tags (id,name,color,created_at,updated_at)
       VALUES ('tagB','工作','#00ff00','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    // A 更新了标签颜色（对端较新）：B 收养后内容跟随，仍保留自己的 id
    await a.run(
      `UPDATE tags SET color='#ff8800', updated_at='2026-09-16T06:00:00.000Z' WHERE id='tagA'`,
    );
    await a.sync();
    const sb = await b.sync();
    expect(sb.ok).toBe(true);
    expect(await b.rows("SELECT id, name, color FROM tags")).toEqual([
      { id: "tagB", name: "工作", color: "#ff8800" },
    ]);
    // 收养刷新走 merge_seen 抑制，不产生回声
    expect(await b.outboxCount()).toBe(0);

    // 对端删除已收养的 id：本地行保留（零删除收养），墓碑不误伤
    await a.run("DELETE FROM tags WHERE id='tagA'");
    await a.sync();
    await b.sync();
    expect(await b.rows("SELECT id FROM tags WHERE id='tagB'")).toHaveLength(1);
    expect(await b.outboxCount()).toBe(0);
  });

  it("存量修复：悬空的 projects.tag_id 按收养映射改写并入 outbox", async () => {
    const transport = new MemoryTransport();
    const b = createDevice("android", transport);

    // 模拟 v1.1.2 设备的存量状态：本地同名词标签 + 收养映射已建，
    // 但项目 tag_id 还是对端 id（旧合并后端未改写），引用悬空。
    await b.run(
      `INSERT INTO tags (id,name,color,created_at,updated_at)
       VALUES ('tagB','工作','#00f','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await b.run(
      `INSERT INTO projects (id,name,color,tag_id,created_at,updated_at)
       VALUES ('pa','悬空项目','#f00','tagA','2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await b.run(
      `INSERT INTO sync_tag_alias (remote_row_id, local_id, ts_ms) VALUES ('tagA','tagB',0)`,
    );

    const changed = await remapDanglingProjectTags(b.client);
    expect(changed).toBe(1);
    expect(await b.rows("SELECT id, tag_id FROM projects")).toEqual([
      { id: "pa", tag_id: "tagB" },
    ]);
    // 收养模型下改写是设备本地修复：projects 更新触发器带 updated_at 守卫，
    // 不入箱广播；对端在引用条目到货时按自己的映射改写（见上一用例）。

    // 无收养映射的真实孤儿引用不误动
    await b.run("UPDATE projects SET tag_id = 'ghost' WHERE id = 'pa'");
    expect(await remapDanglingProjectTags(b.client)).toBe(0);
  });

  it("特殊表触发器与全表基线回填在真实 schema 上跑通", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    // task_planning_metadata 主键是 task_id（v4 重建的触发器按 task_id 捕获）；
    // habit_checks 无任何时间戳列（v5 重建的触发器 ts_ms 取常量 0）。
    await a.run(
      `INSERT INTO task_planning_metadata (task_id, reminder_minutes_json, updated_at)
       VALUES ('pt1', '[10]', '2026-09-16T02:00:00.000Z')`,
    );
    await a.run(
      `INSERT INTO habit_checks (id, habit_id, check_date) VALUES ('hc1', 'h1', '2026-09-16')`,
    );
    const captured = await a.rows(
      "SELECT table_name, row_id FROM sync_outbox ORDER BY table_name",
    );
    expect(captured).toContainEqual({ table_name: "habit_checks", row_id: "hc1" });
    expect(captured).toContainEqual({
      table_name: "task_planning_metadata",
      row_id: "pt1",
    });
    await a.run("DELETE FROM sync_outbox");

    // 基线回填在真实 schema 上全表 SELECT：SQL 里引用任何不存在的列都会
    // 在 prepare 期抛错（回归：曾因 habit_checks/created_at、
    // task_planning_metadata/id 漏网）。
    const total = await backfillOutbox(a.client);
    expect(total).toBeGreaterThan(0);
    for (const table of ["habit_checks", "task_planning_metadata", "settings"]) {
      const c = await a.rows(
        "SELECT count(*) AS c FROM sync_outbox WHERE table_name = $1",
        [table],
      );
      expect(c[0]?.c ?? 0).toBeGreaterThan(0);
    }

    // 全链路：推送 → 对端应用（含无时间戳表的 tick(0) 与回声抑制）
    await a.sync();
    const s = await b.sync();
    expect(s.pulled).toBeGreaterThan(0);
    const hc = await b.rows(
      "SELECT habit_id, check_date FROM habit_checks WHERE id = 'hc1'",
    );
    expect(hc).toEqual([{ habit_id: "h1", check_date: "2026-09-16" }]);
    const pm = await b.rows(
      "SELECT reminder_minutes_json FROM task_planning_metadata WHERE task_id = 'pt1'",
    );
    expect(pm).toEqual([{ reminder_minutes_json: "[10]" }]);
    // 远端应用不产生回声（merge_seen 常量 0 / updated_at ms 两种约定都对上）
    expect(await b.outboxCount()).toBe(0);
  });
});
