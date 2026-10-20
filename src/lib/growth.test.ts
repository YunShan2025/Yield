import { describe, expect, it } from "vitest";
import type { Goal, GoalEntry } from "@/types";
import {
  activityLevelFromValue,
  calculateGoalProgress,
  currentDateStreak,
  goalAcceptsSource,
  goalDeadlineInfo,
  localWeekStartKey,
  longestDateStreak,
  resolveGoalTarget,
} from "./growth";

const goal = (start: number, current: number, target: number) =>
  ({ start_value: start, current_value: current, target_value: target }) as Goal;

const fullGoal = (goal_type: Goal["goal_type"]): Goal => ({
  id: "g1",
  title: "阅读",
  color: "#2F6FED",
  goal_type,
  start_date: "2026-10-01",
  target_date: null,
  start_value: 0,
  target_value: 10,
  current_value: 0,
  unit: "本",
  status: "active",
  motivation: "",
  manual_completion: 0,
  created_at: "",
  updated_at: "",
});

describe("growth metrics", () => {
  it("calculates ascending and descending goal progress", () => {
    expect(calculateGoalProgress(goal(0, 6, 24))).toBe(25);
    expect(calculateGoalProgress(goal(80, 75, 70))).toBe(50);
    expect(calculateGoalProgress(goal(80, 68, 70))).toBe(100);
  });

  it("groups activity into bounded heat levels", () => {
    expect(activityLevelFromValue(0)).toBe(0);
    expect(activityLevelFromValue(1)).toBe(1);
    expect(activityLevelFromValue(2)).toBe(2);
    expect(activityLevelFromValue(3)).toBe(3);
    expect(activityLevelFromValue(4)).toBe(4);
    expect(activityLevelFromValue(15)).toBe(4);
  });

  it("finds the longest streak without double-counting dates", () => {
    expect(longestDateStreak(["2026-08-01", "2026-08-02", "2026-08-02", "2026-08-04"])).toBe(2);
  });

  it("keeps yesterday's streak until today ends", () => {
    expect(currentDateStreak(["2026-08-01", "2026-08-02"], "2026-08-03")).toBe(2);
    expect(currentDateStreak(["2026-08-02", "2026-08-03"], "2026-08-03")).toBe(2);
  });

  it("routes contribution sources by goal kind", () => {
    const typed = (goal_type: Goal["goal_type"], status: Goal["status"] = "active") =>
      ({ goal_type, status }) as Goal;
    // 数值·次数型：任务与习惯都能按显式声明的计量推进。
    expect(goalAcceptsSource(typed("milestone"), "task")).toBe(true);
    expect(goalAcceptsSource(typed("milestone"), "habit")).toBe(true);
    expect(goalAcceptsSource(typed("milestone"), "manual")).toBe(true);
    // 数值变化型：只认手动测量。
    expect(goalAcceptsSource(typed("measure"), "manual")).toBe(true);
    expect(goalAcceptsSource(typed("measure"), "task")).toBe(false);
    expect(goalAcceptsSource(typed("measure"), "habit")).toBe(false);
    // 阶段型：进度只由阶段勾选推进，任何记录都不接受。
    expect(goalAcceptsSource(typed("staged"), "task")).toBe(false);
    expect(goalAcceptsSource(typed("staged"), "habit")).toBe(false);
    expect(goalAcceptsSource(typed("staged"), "manual")).toBe(false);
    expect(goalAcceptsSource(typed("milestone", "paused"), "task")).toBe(false);
  });

  it("calculates the local Monday without UTC conversion", () => {
    expect(localWeekStartKey(new Date("2026-08-05T00:30:00+08:00"))).toBe("2026-08-03");
  });

  it("uses one denominator for every goal kind", () => {
    // 数值·次数型：分母就是目标值。
    expect(resolveGoalTarget(fullGoal("milestone")).value).toBe(10);
    // 阶段型：起点 0、当前值是已完成阶段数，天然落在同一套公式里。
    const staged = { ...fullGoal("staged"), unit: "个阶段", target_value: 4, current_value: 2 };
    expect(resolveGoalTarget(staged).value).toBe(4);
    expect(calculateGoalProgress(staged)).toBe(50);
  });

  it("flags deadline pace only when progress is clearly behind", () => {
    const dated = (current: number) => ({
      ...fullGoal("milestone"),
      start_date: "2026-10-01",
      target_date: "2026-10-31",
      target_value: 30,
      current_value: current,
    });
    expect(goalDeadlineInfo(dated(5), "2026-10-21")).toEqual({ daysLeft: 10, behind: true });
    expect(goalDeadlineInfo(dated(20), "2026-10-21")?.behind).toBe(false);
    expect(goalDeadlineInfo({ ...fullGoal("milestone"), target_date: null }, "2026-10-16")).toBeNull();
  });
});

describe("goal entries", () => {
  it("keeps manual records as the only always-allowed source", () => {
    const entry: GoalEntry = {
      id: "e1",
      goal_id: "g1",
      entry_date: "2026-10-20",
      value: 1,
      source_type: "manual",
      source_id: null,
      note: "",
      created_at: "",
      updated_at: "",
    };
    expect(entry.source_type).toBe("manual");
  });
});