/**
 * 目标进度复算的落库回归。
 *
 * 累计型目标的 current_value 是「基线 + 记录之和」的派生值，每次复算都会覆盖：
 * 编辑框里的「当前值」只有按同一口径补一笔校准记录才留得住。这里跑真实
 * schema（migration v1 到最新）与真实 SQL，锁住「改小会被弹回」这个旧 bug，
 * 以及「关联不等于计量」「阶段由勾选推进」这两条新口径。
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
  createGoalMilestone,
  fetchGoalMilestones,
  refreshGoalProgress,
  setGoalCurrentProgress,
  setGoalMilestoneCompleted,
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
const entryRows = (id: string): Row[] =>
  db.prepare("SELECT * FROM goal_entries WHERE goal_id=? ORDER BY created_at").all(id) as Row[];

/** 新建一个已累计 5 次的目标：3 次来自任务、2 次来自习惯。 */
async function seededGoal() {
  const goal = await createGoal({
    title: "读完 21 本书",
    goal_type: "milestone",
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

describe("编辑累计型目标的当前值", () => {
  it("种子目标按记录复算为 5", async () => {
    const goal = await seededGoal();
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(5);
  });

  it("改小当前值不会被复算弹回", async () => {
    const goal = await seededGoal();
    await updateGoal(goal.id, { title: "读完 21 本书", color: "#3E9B78" });
    expect(await setGoalCurrentProgress(goal.id, 3)).toBe(true);

    const row = goalRow(goal.id);
    expect(Number(row.current_value)).toBe(3);
    expect(row.title).toBe("读完 21 本书");

    // 差额应落成一条手动校准记录，之后任何一次复算都不许改动它。
    const calibration = entryRows(goal.id).filter((entry) => entry.source_type === "manual");
    expect(calibration).toHaveLength(1);
    expect(Number(calibration[0].value)).toBe(-2);
    await refreshGoalProgress(goal.id);
    expect(Number(goalRow(goal.id).current_value)).toBe(3);
  });

  it("改大当前值累计到目标即完成，并生成成就", async () => {
    const goal = await seededGoal();
    expect(await setGoalCurrentProgress(goal.id, 21)).toBe(true);

    const row = goalRow(goal.id);
    expect(Number(row.current_value)).toBe(21);
    expect(row.status).toBe("completed");
    const achievements = db
      .prepare("SELECT source_type FROM achievements WHERE goal_id=?")
      .all(goal.id) as Row[];
    expect(achievements.map((item) => item.source_type)).toContain("goal");
  });

  it("值没变时不补记录", async () => {
    const goal = await seededGoal();
    const before = entryRows(goal.id).length;
    expect(await setGoalCurrentProgress(goal.id, 5)).toBe(false);
    expect(entryRows(goal.id)).toHaveLength(before);
    expect(Number(goalRow(goal.id).current_value)).toBe(5);
  });
});

describe("阶段型目标", () => {
  it("进度由阶段勾选推进，完成全部阶段即达成", async () => {
    const goal = await createGoal({
      title: "读完 21 本书",
      goal_type: "staged",
      unit: "个阶段",
      target_value: 2,
    });
    await createGoalMilestone(goal.id, "读完前 5 本", 0, null);
    await createGoalMilestone(goal.id, "全部读完", 0, null);
    await refreshGoalProgress(goal.id);

    let row = goalRow(goal.id);
    expect(Number(row.current_value)).toBe(0);
    expect(Number(row.target_value)).toBe(2);
    expect(row.status).toBe("active");

    const milestones = await fetchGoalMilestones(goal.id);
    await setGoalMilestoneCompleted(milestones[0].id, true);
    await refreshGoalProgress(goal.id);
    row = goalRow(goal.id);
    expect(Number(row.current_value)).toBe(1);
    expect(row.status).toBe("active");

    await setGoalMilestoneCompleted(milestones[1].id, true);
    await refreshGoalProgress(goal.id);
    row = goalRow(goal.id);
    expect(Number(row.current_value)).toBe(2);
    expect(row.status).toBe("completed");
  });

  it("阶段型目标不接受任何进度记录", async () => {
    const goal = await createGoal({
      title: "毕业设计",
      goal_type: "staged",
      unit: "个阶段",
      target_value: 1,
    });
    const added = await addGoalEntry({
      goal_id: goal.id, entry_date: todayDateString(), value: 1,
      source_type: "task", source_id: "task-1",
    });
    expect(added).toBe(false);
  });
});