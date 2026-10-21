/**
 * 目标的生命周期回归：放弃 / 归档可撤回，删除进回收站、可恢复、可永久删除。
 */
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

let db: DatabaseSync;

vi.mock("./client", () => {
  const toQ = (sql: string) => sql.replace(/\$\d+/g, "?");
  return {
    getDb: async () => ({
      async select<T>(sql: string, params?: unknown[]): Promise<T> {
        return db.prepare(toQ(sql)).all(...((params ?? []) as SQLInputValue[])) as T;
      },
      async execute(sql: string, params?: unknown[]) {
        return db.prepare(toQ(sql)).run(...((params ?? []) as SQLInputValue[]));
      },
    }),
  };
});

const {
  createGoal,
  fetchAllGoals,
  fetchDeletedGoals,
  fetchGoals,
  purgeGoal,
  restoreGoal,
  softDeleteGoal,
  updateGoal,
} = await import("@/lib/db/growth");

const rustSource = readFileSync("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
const schemaSql = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
]
  .map((version) => {
    const at = rustSource.indexOf(`version: ${version},`);
    const start = rustSource.indexOf('sql: r#"', at) + 8;
    const end = rustSource.indexOf('"#,', at);
    const raw = rustSource.slice(start, end);
    return raw.startsWith("\n") ? raw.slice(1) : raw;
  })
  .join("\n");

type Row = Record<string, unknown>;
const goalRow = (id: string): Row =>
  db.prepare("SELECT * FROM goals WHERE id=?").all(id)[0] as Row;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
});

async function seedGoal() {
  return createGoal({
    title: "读完 21 本书",
    goal_type: "milestone",
    unit: "次",
    target_value: 21,
  });
}

describe("目标的状态只有四个", () => {
  it("历史 archived 目标并入已完成", async () => {
    const goal = await seedGoal();
    // 模拟 migration v25 之前的老数据
    db.prepare("UPDATE goals SET status='archived' WHERE id=?").run(goal.id);
    expect(goalRow(goal.id).status).toBe("archived");
    db.prepare("UPDATE goals SET status='completed' WHERE status='archived'").run();
    expect(goalRow(goal.id).status).toBe("completed");
  });

  it("默认只列出还在进行的目标，已完成的另算", async () => {
    const active = await seedGoal();
    const done = await seedGoal();
    await updateGoal(done.id, { status: "completed" });
    const listed = await fetchGoals();
    expect(listed.map((g) => g.id)).toContain(active.id);
    expect(listed.map((g) => g.id)).not.toContain(done.id);
    // 传 true 时给全部未删除的
    const all = await fetchGoals(true);
    expect(all.map((g) => g.id)).toContain(done.id);
  });
});

describe("目标可撤回", () => {
  it("放弃后能改回进行中", async () => {
    const goal = await seedGoal();
    await updateGoal(goal.id, { status: "abandoned" });
    // 放弃的目标不在主列表里（收进"已放弃"区），要带 includeFinished 才看得到
    expect((await fetchGoals(true)).find((g) => g.id === goal.id)?.status).toBe("abandoned");
    expect((await fetchGoals()).map((g) => g.id)).not.toContain(goal.id);
    await updateGoal(goal.id, { status: "active" });
    expect((await fetchGoals()).find((g) => g.id === goal.id)?.status).toBe("active");
  });

  it("删除进回收站，恢复后回到列表", async () => {
    const goal = await seedGoal();
    await softDeleteGoal(goal.id);
    // 回收站里能看到，常规列表里看不到
    expect((await fetchDeletedGoals()).map((g) => g.id)).toContain(goal.id);
    expect((await fetchGoals()).map((g) => g.id)).not.toContain(goal.id);
    // 数据本身没被删
    expect(goalRow(goal.id).id).toBe(goal.id);

    await restoreGoal(goal.id);
    expect((await fetchDeletedGoals()).map((g) => g.id)).not.toContain(goal.id);
    expect((await fetchGoals()).map((g) => g.id)).toContain(goal.id);
  });

  it("永久删除连同记录、阶段与成就一起清掉，不留孤儿", async () => {
    const goal = await seedGoal();
    await softDeleteGoal(goal.id);
    db.prepare(
      "INSERT INTO goal_entries (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("e1", goal.id, "2026-10-20", 1, "manual", null, "", "2026-10-20", "2026-10-20");
    db.prepare(
      "INSERT INTO goal_milestones (id,goal_id,title,target_value,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run("m1", goal.id, "阶段一", 0, 0, "2026-10-20", "2026-10-20");
    db.prepare(
      "INSERT INTO achievements (id,goal_id,title,description,achieved_at,source_type,source_id,pinned,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("a1", goal.id, "成就", "", "2026-10-20", "goal", goal.id, 0, "2026-10-20");

    await purgeGoal(goal.id);
    expect(goalRow(goal.id)).toBeUndefined();
    const countOf = (table: string) => {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE goal_id=?`).get(goal.id) as Row;
      return Number(row.c);
    };
    expect(countOf("goal_entries")).toBe(0);
    expect(countOf("goal_milestones")).toBe(0);
    expect(countOf("achievements")).toBe(0);
  });

  it("备份导出连回收站里的目标一起带走", async () => {
    const goal = await seedGoal();
    await softDeleteGoal(goal.id);
    expect((await fetchAllGoals()).map((g) => g.id)).toContain(goal.id);
  });
});