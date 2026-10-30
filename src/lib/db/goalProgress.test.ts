/**
 * 目标进度复算的落库回归（migration v29 起的唯一口径）。
 *
 * current_value 恒等于「任务完成 + 习惯打卡」的计量事件之和：
 * 手动记录已下线，旧端混窗期同步来的 manual 行不进账；completed 是终点态，
 * 进度回落不再把目标翻回进行中。这里跑真实 schema（migration v1 到最新）
 * 与真实 SQL，把这三条口径钉死。
 */
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayDateString } from "@/lib/dates";

let db: DatabaseSync;

vi.mock("./client", () => {
  // node:sqlite 不认 sqlx 的 $n 占位符，按顺序翻译成 ?。
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
  addGoalEntry,
  createGoal,
  refreshGoalProgress,
  updateGoal,
} = await import("@/lib/db/growth");

const rustSource = readFileSync("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
const schemaSql = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
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
const entryRows = (id: string): Row[] =>
  db.prepare("SELECT * FROM goal_entries WHERE goal_id=? ORDER BY created_at").all(id) as Row[];

/** 新建一个已累计 5 次的目标：3 次来自任务、2 次来自习惯。 */
async function seededGoal() {
  const goal = await createGoal({
    title: "读完 21 本书",
    unit: "次",
    target_value: 21,
  });
  await addGoalEntry({
    goal_id: goal.id, entry_date: todayDateString(), value: 3,
    source_type: "task", source_id: "task-1",
  });
  await addGoalEntry({
    goal_id: goal.id, entry_date: todayDateString(), value: 2,
    source_type: "habit", source_id: "habit-1",
  });
  return goal;
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
});

describe("进度只来自计量事件", () => {
  it("种子目标按记录复算为 5", async () => {
    const goal = await seededGoal();
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(5);
  });

  it("求和只认 task/habit：混窗期同步来的 manual 行不进账", async () => {
    const goal = await seededGoal();
    // 模拟混窗期旧端「当前值校准」同步来的 manual 行：复算求和必须跳过它。
    db.prepare(
      `INSERT INTO goal_entries
       (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at)
       VALUES ('ghost',?,'2026-10-20',100,'manual',NULL,'手动校准','2026-10-20','2026-10-20')`,
    ).run(goal.id);
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(5);
  });

  it("addGoalEntry 只收任务与打卡，其它来源一律拒写", async () => {
    const goal = await seededGoal();
    const before = entryRows(goal.id).length;
    // 类型上 manual 已不存在；按旧调用方的形状硬塞进来也要被拒。
    const accepted = await addGoalEntry({
      goal_id: goal.id, entry_date: todayDateString(), value: 4,
      source_type: "manual" as "task",
    });
    expect(accepted).toBe(false);
    expect(entryRows(goal.id)).toHaveLength(before);
  });

  it("暂停与已完成的目标不收新记录", async () => {
    const goal = await seededGoal();
    await updateGoal(goal.id, { status: "paused" });
    expect(
      await addGoalEntry({
        goal_id: goal.id, entry_date: todayDateString(), value: 1,
        source_type: "task", source_id: "task-2",
      }),
    ).toBe(false);
  });

  it("达成自动进已完成，进度回落不再翻回进行中", async () => {
    const goal = await createGoal({ title: "读完 3 本书", unit: "次", target_value: 3 });
    await addGoalEntry({
      goal_id: goal.id, entry_date: todayDateString(), value: 3,
      source_type: "task", source_id: "task-1",
    });
    expect(goalRow(goal.id).status).toBe("completed");

    // 完成是终点态：撤掉记录，数值跟着回落，状态不再回翻。
    db.prepare("DELETE FROM goal_entries WHERE goal_id=?").run(goal.id);
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(0);
    expect(goalRow(goal.id).status).toBe("completed");
  });

  it("来源任务在回收站时事件不进账，恢复后自动回算", async () => {
    const goal = await seededGoal(); // 任务 3 次 + 习惯 2 次
    // 「推进」清单会过滤回收站行；事件若照常进账就成了看不见来源的幽灵进度。
    db.prepare(
      `INSERT INTO tasks (id,title,created_at,updated_at,deleted_at)
       VALUES ('task-1','进回收站的任务','2026-10-01','2026-10-01','2026-10-20')`,
    ).run();
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(2);

    // 台账一行不动，恢复 = deleted_at 归位，进度跟着回来。
    db.prepare("UPDATE tasks SET deleted_at=NULL WHERE id='task-1'").run();
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(5);
  });

  it("回收站里的习惯同样停表，恢复打卡重新进账", async () => {
    const goal = await createGoal({ title: "读完 21 本书", unit: "次", target_value: 21 });
    db.prepare(
      `INSERT INTO habits (id,title,created_at,deleted_at)
       VALUES ('h1','回收站习惯','2026-10-01','2026-10-21')`,
    ).run();
    db.prepare(
      "INSERT INTO habit_checks (id,habit_id,check_date) VALUES ('c1','h1','2026-10-20')",
    ).run();
    await addGoalEntry({
      goal_id: goal.id, entry_date: "2026-10-20", value: 1,
      source_type: "habit", source_id: "h1:2026-10-20",
    });
    expect(Number(goalRow(goal.id).current_value)).toBe(0);

    db.prepare("UPDATE habits SET deleted_at=NULL WHERE id='h1'").run();
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(1);
  });
});
