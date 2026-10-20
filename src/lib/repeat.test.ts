import { describe, expect, it } from "vitest";
import {
  WEEKDAY_OPTIONS,
  describeHabitSchedule,
  matchesRepeatRule,
  parseRepeatRule,
  stringifyRepeatRule,
  toggleWeekday,
  weekdayFromDate,
  weeklyTargetFromRule,
} from "./repeat";
import type { RepeatRule } from "@/types";

describe("repeat rules", () => {
  it("round trips a rule", () => {
    const rule = { frequency: "daily" as const, interval: 2 };
    expect(parseRepeatRule(stringifyRepeatRule(rule))).toEqual(rule);
  });

  it("parses invalid payloads as no rule", () => {
    expect(parseRepeatRule(null)).toBeNull();
    expect(parseRepeatRule("{oops")).toBeNull();
  });

  it("normalises weekday selection to Monday first", () => {
    expect(toggleWeekday([1, 3], 0)).toEqual([1, 3, 0]);
    expect(toggleWeekday([1, 3], 3)).toEqual([1]);
    // 最后一个不能取消：至少留一天。
    expect(toggleWeekday([3], 3)).toEqual([3]);
    expect(toggleWeekday([0, 6], 5)).toEqual([5, 6, 0]);
  });

  it("maps a date to its weekday", () => {
    expect(weekdayFromDate("2026-07-27")).toBe(1);
    expect(weekdayFromDate("2026-08-02")).toBe(0);
    expect(WEEKDAY_OPTIONS.map((day) => day.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("habit schedules", () => {
  it("treats an empty rule as the flexible weekly mode", () => {
    // 浮动次数模式：每天都出现在今日清单，但"今天做不做都行"。
    expect(matchesRepeatRule("2026-07-27", null)).toBe(true);
    expect(describeHabitSchedule(null)).toBe("每周若干次");
    expect(weeklyTargetFromRule(null)).toBeNull();
  });

  it("shows a daily habit every day", () => {
    const rule: RepeatRule = { frequency: "daily", interval: 1 };
    expect(matchesRepeatRule("2026-07-27", rule)).toBe(true);
    expect(matchesRepeatRule("2026-08-02", rule)).toBe(true);
    expect(describeHabitSchedule(rule)).toBe("每天");
    expect(weeklyTargetFromRule(rule)).toBe(7);
  });

  it("only shows a weekday habit on its own days", () => {
    const rule: RepeatRule = { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] };
    expect(matchesRepeatRule("2026-07-27", rule)).toBe(true); // 周一
    expect(matchesRepeatRule("2026-07-28", rule)).toBe(false); // 周二
    expect(matchesRepeatRule("2026-07-29", rule)).toBe(true); // 周三
    expect(describeHabitSchedule(rule)).toBe("每周一三五");
    expect(weeklyTargetFromRule(rule)).toBe(3);
  });
});