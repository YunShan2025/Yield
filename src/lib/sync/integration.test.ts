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
import { captureSettingWrite, backfillOutbox, type SqlClient } from "./outbox";
import { HlcClock } from "./hlc";
import { MemoryTransport } from "./transport";
import type { LogReadState } from "./log";

let schemaSql = "";
beforeAll(() => {
  const src = rf("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
  schemaSql = [1, 2, 3, 4, 5]
    .map((v) => {
      const i = src.indexOf(`version: ${v},`);
      const a = src.indexOf('sql: r#"', i) + 8;
      const b = src.indexOf('"#,', i);
      return src.slice(src.indexOf("\n", a) + 1, b);
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
    get lastSync() {
      return lastSync;
    },
  };
}

describe("双端同步集成（真实 SQLite 触发器 + 内存传输）", () => {
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
