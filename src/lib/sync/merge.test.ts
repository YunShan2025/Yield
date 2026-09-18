import { describe, expect, it } from "vitest";
import type { Hlc } from "./hlc";
import { mergeEntries, SchemaGateError, type MergeBackend } from "./merge";
import type { SyncLogEntry } from "./log";
import { SYNC_TABLES } from "./tables";

/** 内存后端：行数据 + 已应用 HLC，模拟 sync_state 语义。 */
function memoryBackend() {
  const rows = new Map<string, Record<string, unknown>>();
  const states = new Map<string, Hlc>();
  const order: string[] = [];
  const backend: MergeBackend & {
    rows: Map<string, Record<string, unknown>>;
    states: Map<string, Hlc>;
    order: string[];
    failNext: Set<string>;
  } = {
    rows,
    states,
    order,
    failNext: new Set(),
    async getState(table, rowId) {
      return states.get(`${table}\u0000${rowId}`) ?? null;
    },
    async upsert(table, rowId, data) {
      const key = `${table}\u0000${rowId}`;
      if (backend.failNext.has(key)) throw new Error("模拟外键约束失败");
      rows.set(key, { ...data });
      order.push(table);
    },
    async remove(table, rowId) {
      const key = `${table}\u0000${rowId}`;
      if (backend.failNext.has(key)) throw new Error("模拟删除失败");
      rows.delete(key);
      order.push(table);
    },
    async setState(table, rowId, hlc) {
      states.set(`${table}\u0000${rowId}`, hlc);
    },
  };
  return backend;
}

const h = (p: number, l = 0, d = "a"): Hlc => ({ p, l, d });
const up = (
  table: SyncLogEntry["table"],
  rowId: string,
  data: Record<string, unknown>,
  clock: Hlc,
): SyncLogEntry => ({ hlc: clock, schema_v: 2, op: "upsert", table, row_id: rowId, data });
const del = (table: SyncLogEntry["table"], rowId: string, clock: Hlc): SyncLogEntry => ({
  hlc: clock,
  schema_v: 2,
  op: "delete",
  table,
  row_id: rowId,
});

describe("mergeEntries · LWW 基础", () => {
  it("空输入无操作", async () => {
    const r = await mergeEntries([], memoryBackend());
    expect(r).toEqual({ applied: 0, skipped: 0, failed: 0, failures: [] });
  });

  it("本地无记录时应用 upsert 并记录状态", async () => {
    const backend = memoryBackend();
    const r = await mergeEntries([up("tasks", "t1", { title: "A" }, h(100))], backend);
    expect(r.applied).toBe(1);
    expect(backend.rows.get("tasks\u0000t1")?.title).toBe("A");
    expect(backend.states.get("tasks\u0000t1")).toEqual(h(100));
  });

  it("远端条目较旧时跳过（新者胜）", async () => {
    const backend = memoryBackend();
    await backend.setState("tasks", "t1", h(200));
    const r = await mergeEntries(
      [
        up("tasks", "t1", { title: "旧" }, h(100)),
        up("tasks", "t1", { title: "新" }, h(300)),
      ],
      backend,
    );
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(backend.rows.get("tasks\u0000t1")?.title).toBe("新");
  });

  it("同 HLC 重复条目幂等（skip）", async () => {
    const backend = memoryBackend();
    await mergeEntries([up("tasks", "t1", { title: "A" }, h(100))], backend);
    const r = await mergeEntries([up("tasks", "t1", { title: "A" }, h(100))], backend);
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it("乱序输入收敛到同一状态", async () => {
    const entries = [
      up("tasks", "t1", { title: "v1" }, h(100)),
      up("tasks", "t1", { title: "v3" }, h(300, 0, "b")),
      up("tasks", "t1", { title: "v2" }, h(200)),
      up("tasks", "t1", { title: "v4" }, h(300, 1, "b")),
    ];
    const forward = memoryBackend();
    const backward = memoryBackend();
    await mergeEntries(entries, forward);
    await mergeEntries([...entries].reverse(), backward);
    expect(forward.rows.get("tasks\u0000t1")?.title).toBe("v4");
    expect(backward.rows.get("tasks\u0000t1")?.title).toBe("v4");
  });
});

describe("mergeEntries · 墓碑", () => {
  it("删除后旧 upsert 不能复活", async () => {
    const backend = memoryBackend();
    await mergeEntries([up("tasks", "t1", { title: "A" }, h(100))], backend);
    await mergeEntries([del("tasks", "t1", h(200))], backend);
    expect(backend.rows.has("tasks\u0000t1")).toBe(false);
    const r = await mergeEntries([up("tasks", "t1", { title: "旧端重放" }, h(150))], backend);
    expect(r.applied).toBe(0);
    expect(backend.rows.has("tasks\u0000t1")).toBe(false);
  });

  it("墓碑之后更新的 upsert 合法重建", async () => {
    const backend = memoryBackend();
    await mergeEntries([del("tags", "g1", h(200))], backend);
    await mergeEntries([up("tags", "g1", { name: "重建" }, h(300))], backend);
    expect(backend.rows.get("tags\u0000g1")?.name).toBe("重建");
  });

  it("删除不存在的行也记录墓碑状态", async () => {
    const backend = memoryBackend();
    const r = await mergeEntries([del("memos", "m1", h(50))], backend);
    expect(r.applied).toBe(1);
    expect(backend.states.get("memos\u0000m1")).toEqual(h(50));
    expect(backend.rows.size).toBe(0);
  });
});

describe("mergeEntries · schema 闸门", () => {
  it("远端版本更高时整批拒绝", async () => {
    const backend = memoryBackend();
    const entry: SyncLogEntry = {
      hlc: h(1),
      schema_v: 3,
      op: "upsert",
      table: "tasks",
      row_id: "x",
      data: {},
    };
    await expect(mergeEntries([entry], backend)).rejects.toBeInstanceOf(SchemaGateError);
    expect(backend.rows.size).toBe(0);
  });
});

describe("mergeEntries · 外键依赖序", () => {
  it("父表先于子表应用", async () => {
    const backend = memoryBackend();
    await mergeEntries(
      [
        up("tasks", "t1", { project_id: "p1" }, h(95)),
        up("projects", "p1", { name: "项目" }, h(90)),
        up("task_tags", "t1:tag1", {}, h(93)),
        up("tags", "tag1", { name: "标签" }, h(92)),
        up("ledger_transactions", "1", { category_id: 3 }, h(91)),
        up("ledger_categories", "3", { name: "餐饮" }, h(89)),
      ],
      backend,
    );
    const order = backend.order;
    expect(order.indexOf("projects")).toBeLessThan(order.indexOf("tasks"));
    expect(order.indexOf("tags")).toBeLessThan(order.indexOf("task_tags"));
    expect(order.indexOf("ledger_categories")).toBeLessThan(order.indexOf("ledger_transactions"));
  });

  it("单行失败不中断整批并计入 failures", async () => {
    const backend = memoryBackend();
    backend.failNext.add("tasks\u0000bad");
    const r = await mergeEntries(
      [
        up("tasks", "bad", {}, h(100)),
        up("tasks", "good", {}, h(101)),
        up("memos", "m1", {}, h(102)),
      ],
      backend,
    );
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.failures[0]).toContain("tasks/bad");
  });
});

describe("mergeEntries · settings 键级 LWW", () => {
  it("同 key 新 HLC 覆盖旧值", async () => {
    const backend = memoryBackend();
    await mergeEntries(
      [
        up("settings", "theme", { key: "theme", value: "dark" }, h(100)),
        up("settings", "theme", { key: "theme", value: "glass" }, h(200)),
      ],
      backend,
    );
    expect(backend.rows.get("settings\u0000theme")?.value).toBe("glass");
  });
});

describe("同步范围完整性", () => {
  it("SYNC_TABLES 共 20 表，依赖序与 settings 收尾正确", () => {
    expect(SYNC_TABLES).toHaveLength(20);
    expect(new Set(SYNC_TABLES).size).toBe(20);
    expect(SYNC_TABLES.indexOf("projects")).toBeLessThan(SYNC_TABLES.indexOf("tasks"));
    expect(SYNC_TABLES.indexOf("tags")).toBeLessThan(SYNC_TABLES.indexOf("task_tags"));
    expect(SYNC_TABLES.indexOf("goals")).toBeLessThan(SYNC_TABLES.indexOf("goal_entries"));
    expect(SYNC_TABLES.indexOf("habits")).toBeLessThan(SYNC_TABLES.indexOf("habit_checks"));
    expect(SYNC_TABLES.indexOf("ledger_categories")).toBeLessThan(
      SYNC_TABLES.indexOf("ledger_transactions"),
    );
    expect(SYNC_TABLES[SYNC_TABLES.length - 1]).toBe("settings");
  });
});
