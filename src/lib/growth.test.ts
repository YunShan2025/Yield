import { describe, expect, it } from "vitest";
import type { Goal } from "@/types";
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

const goal = (current: number, target: number) =>
  ({ current_value: current, target_value: target }) as Goal;

const fullGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "g1",
  title: "阅读",
  color: "#2F6FED",
  start_date: "2026-10-01",
  target_date: null,
  target_value: 10,
  current_value: 0,
  unit: "本",
  status: "active",
  motivation: "",
  deleted_at: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("growth metrics", () => {
  it("calculates goal progress from zero as current / target", () => {
    expect(calculateGoalProgress(goal(6, 24))).toBe(25);
    expect(calculateGoalProgress(goal(4, 4))).toBe(100);
    // 超出目标值封顶 100，负数与坏分母落到 0。
    expect(calculateGoalProgress(goal(8, 4))).toBe(100);
    expect(calculateGoalProgress(goal(-1, 4))).toBe(0);
    expect(calculateGoalProgress(goal(3, 0))).toBe(0);
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

  it("accepts progress only from task and habit events", () => {
    const active = fullGoal();
    // 进度只来自事件：进行中的目标接受任务完成与习惯打卡。
    expect(goalAcceptsSource(active, "task")).toBe(true);
    expect(goalAcceptsSource(active, "habit")).toBe(true);
    // 暂停 / 已完成不收新记录。
    expect(goalAcceptsSource(fullGoal({ status: "paused" }), "task")).toBe(false);
    expect(goalAcceptsSource(fullGoal({ status: "completed" }), "habit")).toBe(false);
  });

  it("calculates the local Monday without UTC conversion", () => {
    expect(localWeekStartKey(new Date("2026-08-05T00:30:00+08:00"))).toBe("2026-08-03");
  });

  it("uses one denominator for every goal", () => {
    expect(resolveGoalTarget(fullGoal()).value).toBe(10);
    expect(calculateGoalProgress(fullGoal({ current_value: 5 }))).toBe(50);
  });

  it("flags deadline pace only when progress is clearly behind", () => {
    const dated = (current: number) =>
      fullGoal({
        start_date: "2026-10-01",
        target_date: "2026-10-31",
        target_value: 30,
        current_value: current,
      });
    expect(goalDeadlineInfo(dated(5), "2026-10-21")).toEqual({ daysLeft: 10, behind: true });
    expect(goalDeadlineInfo(dated(20), "2026-10-21")?.behind).toBe(false);
    expect(goalDeadlineInfo(fullGoal({ target_date: null }), "2026-10-16")).toBeNull();
  });
});
