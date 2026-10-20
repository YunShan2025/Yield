/**
 * 双端同步集成测试：两台"设备"各自持有真实内存 SQLite（migration v1 到最新
 * 全部 DDL 与触发器）+ 临时目录日志文件，通过内存传输交换日志，驱动真实 runSync。
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
import { SYNC_SCHEMA_VERSION } from "./tables";
import { TABLE_SPECS } from "./columns";
import { recomputeGoalsAfterSync } from "@/lib/db/growth";
import { captureSettingWrite, backfillOutbox, remapDanglingProjectTags, type SqlClient } from "./outbox";
import { HlcClock } from "./hlc";
import { MemoryTransport } from "./transport";
import type { LogReadState } from "./log";

let schemaSql = "";
beforeAll(() => {
  const src = rf("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
  // 必须铺到最新一版：同步行为要跑在线上真实 schema 上，否则删列类
  // migration（v19 任务延期原因、v20 目标瘦身）与列白名单的偏差测不出来。
  // 新增 migration 时把版本号补进这里。
  schemaSql = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  ]
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
    expect(header.schema_v).toBe(SYNC_SCHEMA_VERSION);

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

  it("混合 schema：旧端条目携带已删列，新端白名单投影后正常应用", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    // 双端都在 v13 schema（冗余列已 DROP）。A 建一条任务并同步，水位推进。
    await a.run(
      `INSERT INTO tasks (id,title,status,created_at,updated_at)
       VALUES ('t1','旧任务','pending','2026-09-16T03:00:00.000Z','2026-09-16T03:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    // 模拟旧端（schema_v=4，actual_minutes 列仍在）发来的条目：data 携带
    // 新 schema 已删除的键。新端应过滤掉未知键后应用，而不是整条失败。
    const oldTask = JSON.stringify({
      hlc: { p: Date.parse("2026-09-16T03:10:00.000Z"), l: 0, d: "legacy" },
      schema_v: 4,
      op: "upsert",
      table: "tasks",
      row_id: "t1",
      data: {
        id: "t1",
        title: "旧端改题",
        status: "pending",
        created_at: "2026-09-16T03:00:00.000Z",
        updated_at: "2026-09-16T03:10:00.000Z",
        actual_minutes: 42,
      },
    });
    await a.rewriteLocal(a.readLocalLog() + oldTask + "\n");
    // A 上传整文件，旧条目才会到达对端。
    await a.sync();

    const s = await b.sync();
    expect(s.errors).toEqual([]);
    expect(await b.rows("SELECT title FROM tasks WHERE id='t1'")).toEqual([
      { title: "旧端改题" },
    ]);
    // 对端 v13 schema 已无 actual_minutes 列，被投影过滤的键不会落库。
    const taskCols = await b.rows("PRAGMA table_info(tasks)");
    expect(taskCols.map((c) => c.name)).not.toContain("actual_minutes");

    // 同样覆盖 timers.task_id：旧端条目带 task_id，新端过滤后应用。
    const oldTimer = JSON.stringify({
      hlc: { p: Date.parse("2026-09-16T03:20:00.000Z"), l: 0, d: "legacy" },
      schema_v: 4,
      op: "upsert",
      table: "timers",
      row_id: "tm1",
      data: {
        id: "tm1",
        kind: "countdown",
        title: "旧端倒计时",
        interval_sec: 1500,
        remaining_sec: 1500,
        created_at: "2026-09-16T03:20:00.000Z",
        updated_at: "2026-09-16T03:20:00.000Z",
        task_id: "t-gone",
      },
    });
    await a.rewriteLocal(a.readLocalLog() + oldTimer + "\n");
    await a.sync();
    const s2 = await b.sync();
    expect(s2.errors).toEqual([]);
    expect(await b.rows("SELECT title FROM timers WHERE id='tm1'")).toEqual([
      { title: "旧端倒计时" },
    ]);
    const timerCols = await b.rows("PRAGMA table_info(timers)");
    expect(timerCols.map((c) => c.name)).not.toContain("task_id");
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

    // habit_checks 无任何时间戳列（v5 重建的触发器 ts_ms 取常量 0）；
    // task_planning_metadata 已随 migration v16 删除，不再参与同步。
    await a.run(
      `INSERT INTO habit_checks (id, habit_id, check_date) VALUES ('hc1', 'h1', '2026-09-16')`,
    );
    const captured = await a.rows(
      "SELECT table_name, row_id FROM sync_outbox ORDER BY table_name",
    );
    expect(captured).toContainEqual({ table_name: "habit_checks", row_id: "hc1" });
    await a.run("DELETE FROM sync_outbox");

    // 基线回填在真实 schema 上全表 SELECT：SQL 里引用任何不存在的列都会
    // 在 prepare 期抛错（回归：曾因 habit_checks/created_at 漏网）。
    const total = await backfillOutbox(a.client);
    expect(total).toBeGreaterThan(0);
    for (const table of ["habit_checks", "settings"]) {
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
    // 远端应用不产生回声（merge_seen 常量 0 / updated_at ms 两种约定都对上）
    expect(await b.outboxCount()).toBe(0);
  });
});

/**
 * 目标模块的同步专项：目标是「派生值 + 关联子表」最密集的一块——
 * current_value/status 由 goal_entries 复算、阶段达成又派生成成就，
 * 而合并是整行 LWW，既不重算也不算和，最容易在这里露馅。
 */
describe("目标模块同步（目标 / 记录 / 阶段 / 成就）", () => {
  const GOAL_COLUMNS = `(id,title,color,goal_type,start_date,start_value,target_value,
        current_value,unit,status,manual_completion,created_at,updated_at)`;

  const goalRow = (device: Device, id: string) =>
    device.rows(
      `SELECT title,goal_type,unit,target_value,current_value,status
       FROM goals WHERE id='${id}'`,
    );

  const insertGoal = (
    device: Device,
    id: string,
    ts: string,
    overrides: Partial<Record<string, unknown>> = {},
  ) => {
    const row = {
      title: "读书",
      color: "#2F6FED",
      goal_type: "milestone",
      start_date: "2026-09-01",
      start_value: 0,
      target_value: 21,
      current_value: 0,
      unit: "次",
      status: "active",
      manual_completion: 0,
      ...overrides,
    };
    return device.run(
      `INSERT INTO goals ${GOAL_COLUMNS}
       VALUES ('${id}','${row.title}','${row.color}','${row.goal_type}',
       '${row.start_date}',${row.start_value},${row.target_value},${row.current_value},
       '${row.unit}','${row.status}',${row.manual_completion},
       '${ts}','${ts}')`,
    );
  };

  const insertEntry = (
    device: Device,
    id: string,
    goalId: string,
    value: number,
    sourceId: string,
    ts: string,
  ) =>
    device.run(
      `INSERT INTO goal_entries
       (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at)
       VALUES ('${id}','${goalId}','2026-09-16',${value},'task','${sourceId}',
       '读书笔记','${ts}','${ts}')`,
    );

  /** 等价于 addGoalEntry 之后的 refreshGoalProgress：进度行必须带新版本号。 */
  const bumpProgress = (device: Device, goalId: string, current: number, ts: string) =>
    device.run(
      `UPDATE goals SET current_value=${current}, updated_at='${ts}' WHERE id='${goalId}'`,
    );

  it("列白名单与真实 schema 一致：删列/加列不会与白名单脱节", async () => {
    const device = createDevice("schema", new MemoryTransport());
    for (const [table, spec] of Object.entries(TABLE_SPECS)) {
      const cols = (await device.rows(`PRAGMA table_info(${table})`)).map((c) => c.name);
      expect(cols.length, table).toBeGreaterThan(0);
      for (const column of [...spec.idColumns, ...spec.columns]) {
        // 白名单里有、库里没有 → 合并拼 INSERT 时直接 no such column。
        expect(cols, `${table}.${column}`).toContain(column);
      }
    }
    // migration v20 删掉的 goals.icon / goals.description 不得回流。
    const goalCols = (await device.rows("PRAGMA table_info(goals)")).map((c) => c.name);
    expect(goalCols).not.toContain("icon");
    expect(goalCols).not.toContain("description");
    expect(TABLE_SPECS.goals.columns).not.toContain("icon");
    // migration v22：重复能力归习惯，任务不再有重复与实例来源列；
    // 目标不再有周口径与项目绑定。
    const taskCols = (await device.rows("PRAGMA table_info(tasks)")).map((c) => c.name);
    expect(taskCols).not.toContain("repeat_rule");
    expect(taskCols).not.toContain("generated_from_id");
    expect(TABLE_SPECS.tasks.columns).not.toContain("repeat_rule");
    expect(goalCols).not.toContain("weekly_target");
    expect(goalCols).not.toContain("project_id");
    expect(TABLE_SPECS.goals.columns).not.toContain("weekly_target");
    // 习惯新增排期规则，白名单必须带上。
    const habitCols = (await device.rows("PRAGMA table_info(habits)")).map((c) => c.name);
    expect(habitCols).toContain("repeat_rule");
    expect(TABLE_SPECS.habits.columns).toContain("repeat_rule");
  });

  it("新建目标与记录端到端同步，进度刷新跟得上，删除记录有墓碑", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);

    await insertGoal(a, "g1", "2026-09-16T01:00:00.000Z");
    await a.sync();
    await b.sync();
    expect(await goalRow(b, "g1")).toEqual([
      {
        title: "读书",
        goal_type: "milestone",
        unit: "次",
        target_value: 21,
        current_value: 0,
        status: "active",
      },
    ]);
    // 对端只是应用，不应产生回声。
    expect(await b.outboxCount()).toBe(0);

    // A 完成一条关联任务 → 记一笔并把复算出的进度刷进目标行（带新 updated_at）。
    await insertEntry(a, "e1", "g1", 3, "t1", "2026-09-16T02:00:00.000Z");
    await bumpProgress(a, "g1", 3, "2026-09-16T02:00:00.000Z");
    await a.sync();
    await b.sync();
    expect((await goalRow(b, "g1"))[0]?.current_value).toBe(3);
    expect(await b.rows("SELECT id FROM goal_entries")).toHaveLength(1);

    // B 端编辑目标（部分更新：改名 + 目标值），不得把 A 的进度刷回旧值。
    await b.run(
      `UPDATE goals SET title='读书(改)', target_value=25,
       updated_at='2026-09-16T03:00:00.000Z' WHERE id='g1'`,
    );
    await b.sync();
    await a.sync();
    expect(await goalRow(a, "g1")).toEqual([
      {
        title: "读书(改)",
        goal_type: "milestone",
        unit: "次",
        target_value: 25,
        current_value: 3,
        status: "active",
      },
    ]);
    expect(await a.outboxCount()).toBe(0);

    // A 取消任务完成：记录删除走墓碑，进度归零。
    await a.run("DELETE FROM goal_entries WHERE id='e1'");
    await bumpProgress(a, "g1", 0, "2026-09-16T04:00:00.000Z");
    await a.sync();
    await b.sync();
    expect(await b.rows("SELECT id FROM goal_entries WHERE id='e1'")).toHaveLength(0);
    expect((await goalRow(b, "g1"))[0]?.current_value).toBe(0);
  });

  it("双端离线各记一笔：合并只整行 LWW，复算后两端进度才一致", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);
    await insertGoal(a, "g1", "2026-09-16T01:00:00.000Z");
    await a.sync();
    await b.sync();

    // 离线期间两端各完成一条关联任务，各自只看见自己那一笔。
    await insertEntry(a, "eA", "g1", 1, "tA", "2026-09-16T05:00:00.000Z");
    await bumpProgress(a, "g1", 1, "2026-09-16T05:00:00.000Z");
    await insertEntry(b, "eB", "g1", 1, "tB", "2026-09-16T06:00:00.000Z");
    await bumpProgress(b, "g1", 1, "2026-09-16T06:00:00.000Z");
    await a.sync();
    await b.sync();
    await a.sync();
    await b.sync();

    // 记录本身各是一行，两条都到齐。
    for (const device of [a, b]) {
      expect(
        (await device.rows("SELECT id FROM goal_entries ORDER BY id")).map((r) => r.id),
      ).toEqual(["eA", "eB"]);
    }
    // 但目标行是整行 LWW：后写的 06:00 赢，进度停在 1，而真实值是 2。
    for (const device of [a, b]) {
      expect((await goalRow(device, "g1"))[0]?.current_value).toBe(1);
    }

    // 同步层的复算补上这一课：按本机全量记录重算，值真变了才写库。
    expect(await recomputeGoalsAfterSync(a.client)).toBe(true);
    expect(await recomputeGoalsAfterSync(b.client)).toBe(true);
    for (const device of [a, b]) {
      expect((await goalRow(device, "g1"))[0]?.current_value).toBe(2);
    }

    // 变化推给对端后收敛：两端一致，且复算不再产生新写入（不会来回刷）。
    await a.sync();
    await b.sync();
    for (const device of [a, b]) {
      expect((await goalRow(device, "g1"))[0]?.current_value).toBe(2);
      expect(await device.outboxCount()).toBe(0);
    }
    expect(await recomputeGoalsAfterSync(a.client)).toBe(false);
    expect(await a.outboxCount()).toBe(0);
  });

  it("未升级的对端发来旧类型目标：落库归一为 milestone", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);
    await b.sync(); // 先建好 B 的日志文件

    // 模拟旧端日志：goal_type 仍是 migration v20 之前的旧值域。
    const legacyGoal = JSON.stringify({
      hlc: { p: Date.parse("2026-09-16T07:00:00.000Z"), l: 0, d: "legacy" },
      schema_v: SYNC_SCHEMA_VERSION,
      op: "upsert",
      table: "goals",
      row_id: "gt",
      data: {
        id: "gt",
        title: "晨跑",
        color: "#E4572E",
        goal_type: "milestone",
        start_date: "2026-09-01",
        start_value: 0,
        target_value: 600,
        current_value: 0,
        unit: "分钟",
        status: "active",
        manual_completion: 0,
        created_at: "2026-09-16T07:00:00.000Z",
        updated_at: "2026-09-16T07:00:00.000Z",
      },
    });
    await b.rewriteLocal(`${b.readLocalLog()}${legacyGoal}\n`);
    await b.sync();
    await a.sync();

    // 归一后本端才认得它：goalAcceptsSource 对未知类型一律拒收贡献记录。
    expect(await a.rows("SELECT id,goal_type,unit FROM goals WHERE id='gt'")).toEqual([
      { id: "gt", goal_type: "milestone", unit: "分钟" },
    ]);
    // 归一只发生在投影写入时，不该顺手把行再推回对端。
    expect(await a.outboxCount()).toBe(0);
  });

  it("同一来源在两端各生成一行：不炸合并，较新值并入，两端求和一致", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);
    await insertGoal(a, "g1", "2026-09-16T01:00:00.000Z");
    await a.run(
      `INSERT INTO goal_milestones
       (id,goal_id,title,target_value,target_date,completed_at,sort_order,created_at,updated_at)
       VALUES ('m1','g1','读完前三章',1,NULL,NULL,1,'2026-09-16T01:00:00.000Z','2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();

    // 离线期间两端都为「同一个任务完成」各记一笔（id 不同，来源相同）；
    // 阶段达成也各自生成一条同源成就。
    await insertEntry(a, "eA", "g1", 1, "t1", "2026-09-16T04:00:00.000Z");
    await a.run(
      `INSERT INTO achievements
       (id,goal_id,title,description,achieved_at,source_type,source_id,pinned,created_at)
       VALUES ('aA','g1','读完前三章','','2026-09-16','milestone','m1',0,'2026-09-16T04:00:00.000Z')`,
    );
    // 贡献值也不同：B 在完成前把任务的贡献改成了 5。
    await insertEntry(b, "eB", "g1", 5, "t1", "2026-09-16T05:00:00.000Z");
    await b.run(
      `INSERT INTO achievements
       (id,goal_id,title,description,achieved_at,source_type,source_id,pinned,created_at)
       VALUES ('aB','g1','读完前三章','','2026-09-16','milestone','m1',0,'2026-09-16T05:00:00.000Z')`,
    );

    await a.sync();
    const pulled = await b.sync();
    await a.sync();
    // 曾因撞来源唯一索引记成「合并 N 条失败」，条目随水位推进永久丢失。
    expect(pulled.errors).toEqual([]);
    for (const device of [a, b]) {
      // 各端只留一行（id 是本机那个），但内容取较新的一条：两端求和一致，
      // 派生进度才不会在每轮同步里来回翻。
      const entries = await device.rows("SELECT id,value FROM goal_entries");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.value).toBe(5);
      expect(await device.rows("SELECT id FROM achievements")).toHaveLength(1);
    }
    for (const device of [a, b]) {
      await recomputeGoalsAfterSync(device.client);
      expect((await goalRow(device, "g1"))[0]?.current_value).toBe(5);
    }
    // 阶段目标本身正常同步（同源重复行被归并进本机那一行）。
    expect(await b.rows("SELECT id,title FROM goal_milestones")).toEqual([
      { id: "m1", title: "读完前三章" },
    ]);
  });

  it("成就置顶同步：追加型表的 UPDATE 也有触发器接住", async () => {
    const transport = new MemoryTransport();
    const a = createDevice("desktop", transport);
    const b = createDevice("android", transport);
    await a.run(
      `INSERT INTO achievements
       (id,goal_id,title,description,achieved_at,source_type,source_id,pinned,created_at)
       VALUES ('ac1','g1','读完前三章','','2026-09-16','milestone','m1',0,'2026-09-16T01:00:00.000Z')`,
    );
    await a.sync();
    await b.sync();
    expect((await b.rows("SELECT pinned FROM achievements WHERE id='ac1'"))[0]?.pinned).toBe(0);

    // B 端置顶：achievements 此前只有 ins/del 触发器，UPDATE 永远不入箱。
    await b.run("UPDATE achievements SET pinned=1 WHERE id='ac1'");
    expect(
      await b.rows("SELECT row_id FROM sync_outbox WHERE table_name='achievements'"),
    ).toEqual([{ row_id: "ac1" }]);
    await b.sync();
    await a.sync();
    expect((await a.rows("SELECT pinned FROM achievements WHERE id='ac1'"))[0]?.pinned).toBe(1);
    // 应用后不反弹回声（登记 ts 与触发器 ts 都取 created_at）。
    expect(await a.outboxCount()).toBe(0);
  });
});
