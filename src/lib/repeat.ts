import type { RepeatRule } from "@/types";

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
] as const;

export function parseRepeatRule(raw: string | null): RepeatRule | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepeatRule;
  } catch {
    return null;
  }
}

export function stringifyRepeatRule(rule: RepeatRule | null): string | null {
  return rule ? JSON.stringify(rule) : null;
}

export function weekdayFromDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

export function toggleWeekday(weekdays: number[], day: number): number[] {
  const set = new Set(weekdays);
  if (set.has(day)) {
    if (set.size <= 1) return weekdays;
    set.delete(day);
  } else {
    set.add(day);
  }
  return [...set].sort((a, b) => {
    // 周一排头，周日排尾
    const rank = (n: number) => (n === 0 ? 7 : n);
    return rank(a) - rank(b);
  });
}

export function describeRepeatRule(rule: RepeatRule | null): string {
  if (!rule) return "不重复";
  if (rule.frequency === "daily") return "每天";
  if (rule.frequency === "weekly") {
    if (rule.weekdays?.length) {
      const labels = WEEKDAY_OPTIONS.filter((d) =>
        rule.weekdays!.includes(d.value),
      ).map((d) => d.label);
      return labels.length ? `每周${labels.join("")}` : "每周";
    }
    return "每周";
  }
  if (rule.frequency === "monthly") return "每月";
  if (rule.frequency === "custom") return "每月最后周五";
  return "不重复";
}

/** 习惯的排期说明：空规则 = 浮动次数模式（每周 N 次，不指定日子）。 */
export function describeHabitSchedule(rule: RepeatRule | null): string {
  if (!rule) return "每周若干次";
  if (rule.frequency === "daily") return "每天";
  if (rule.frequency === "weekly") {
    if (rule.weekdays?.length) {
      const labels = WEEKDAY_OPTIONS.filter((d) =>
        rule.weekdays!.includes(d.value),
      ).map((d) => d.label);
      return labels.length ? `每周${labels.join("")}` : "每周";
    }
    return "每周";
  }
  if (rule.frequency === "monthly") return "每月";
  if (rule.frequency === "custom") return "每月指定某天";
  return "每周若干次";
}

/**
 * 这一天该不该做这个习惯。
 *
 * 任务侧不再有重复规则后，"今天该做什么"由习惯的排期回答：
 * - 空规则（浮动次数模式）：每天都出现，但"今天做不做都行"；
 * - daily：每天都做；
 * - weekly + weekdays：只在选中的星期几做。
 */
export function matchesRepeatRule(dateStr: string, rule: RepeatRule | null): boolean {
  if (!rule) return true;
  if (rule.frequency === "daily") return true;
  if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays ?? [];
    if (!weekdays.length) return true;
    return weekdays.includes(weekdayFromDate(dateStr));
  }
  return true;
}

/** 规则里选中的星期数 = 每周几次（"每周几"模式下是派生值）。 */
export function weeklyTargetFromRule(rule: RepeatRule | null): number | null {
  if (!rule) return null;
  if (rule.frequency === "daily") return 7;
  if (rule.frequency === "weekly" && rule.weekdays?.length) {
    return rule.weekdays.length;
  }
  return null;
}