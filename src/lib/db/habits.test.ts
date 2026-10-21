/**
 * 习惯的排期与计量语义回归。
 *
 * 习惯接管了重复能力（migration v22），这里锁住三条容易悄悄坏掉的规则：
 * 1. 排期是习惯的一部分，只改标题不能把它抹掉；
 * 2. 默认"只关联不计数"——打卡不写目标的进度记录；
 * 3. 显式声明计量后，打卡才写记录，且撤掉关联时记录要跟着撤。
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

const { createHabit, toggleHabitCheck, updateHabit, updateHabitGoal } =
  await import("@/lib/db/taxonomy");
const { createGoal } = await import("@/lib/db/growth");

const rustSource = readFileSync("src-tauri/src/lib.rs", "utf8").replace(/\r\n/g, "\n");
const schemaSql = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
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
const habitRow = (id: string): Row =>
  db.prepare("SELECT * FROM habits WHERE id=?").all(id)[0] as Row;
const entryRows = (goalId: string): Row[] =>
  db.prepare("SELECT * FROM goal_entries WHERE goal_id=? ORDER BY created_at").all(goalId) as Row[];

const WEEKDAYS = JSON.stringify({ frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
});

describe("习惯排期", () => {
  it("新建后能读回排期规则", async () => {
    const habit = await createHabit({
      title: "跑步",
      target_per_week: 3,
      repeat_rule: WEEKDAYS,
    });
    expect(habit.repeat_rule).toBe(WEEKDAYS);
    expect(habitRow(habit.id).repeat_rule).toBe(WEEKDAYS);
  });

  it("只改标题时保留排期，不被清成 null", async () => {
    const habit = await createHabit({
      title: "跑步",
      target_per_week: 3,
      repeat_rule: WEEKDAYS,
    });
    await updateHabit(habit.id, { title: "晨跑" });
    expect(habitRow(habit.id).repeat_rule).toBe(WEEKDAYS);
    expect(habitRow(habit.id).title).toBe("晨跑");
  });
});

describe("习惯与目标的计量", () => {
  it("默认只关联不计数：打卡不写目标的进度记录", async () => {
    const goal = await createGoal({
      title: "读完 21 本书",
      goal_type: "milestone",
      unit: "次",
      target_value: 21,
    });
    const habit = await createHabit({
      title: "读书",
      target_per_week: 3,
      goal_id: goal.id,
    });
    await toggleHabitCheck(habit.id, "2026-10-20");
    expect(entryRows(goal.id)).toHaveLength(0);
  });

  it("显式声明计量后打卡才写记录，撤掉关联时记录跟着撤", async () => {
    const goal = await createGoal({
      title: "读完 21 本书",
      goal_type: "milestone",
      unit: "次",
      target_value: 21,
    });
    const habit = await createHabit({
      title: "读书",
      target_per_week: 3,
      goal_id: goal.id,
    });
    await updateHabitGoal(habit.id, goal.id, 2);
    await toggleHabitCheck(habit.id, "2026-10-20");
    const entries = entryRows(goal.id);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].value)).toBe(2);
    expect(entries[0].source_type).toBe("habit");

    await updateHabitGoal(habit.id, goal.id, 0);
    expect(entryRows(goal.id)).toHaveLength(0);
  });
});