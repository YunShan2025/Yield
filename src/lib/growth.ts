import type { Goal, GoalEntry } from "@/types";

/**
 * 这个目标接不接受某种来源的进度记录。
 *
 * 判定口径只有一条（migration v29 起）：**进度只能来自事件**。
 * - 进行中的目标接受任务完成与习惯打卡的计量记录（显式声明的
 *   goal_contribution > 0 由写入方把关）；
 * - 手动记录已下线，任何情况下都不接受；暂停 / 已完成的目标不收新记录。
 */
export function goalAcceptsSource(
  goal: Goal,
  source: GoalEntry["source_type"],
): boolean {
  if (goal.status !== "active") return false;
  return source === "task" || source === "habit";
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localWeekStartKey(date = new Date()): string {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return localDateKey(start);
}

export interface GoalTarget {
  /** 分母值。 */
  value: number;
  /** 分母单位。 */
  unit: string;
}

/**
 * 目标分母的唯一真源。
 *
 * 过去每个界面各自取分母（target_value / effectiveWeeklyTarget / weekly_target），
 * 于是同一个目标在今日条和目标卡上出现两个分母。现在只有一个来源：
 * 分母就是目标的 target_value（目标次数，"读完 21 本"）。
 */
export function resolveGoalTarget(goal: Goal): GoalTarget {
  return { value: Number(goal.target_value), unit: goal.unit };
}

/**
 * 目标进度（0–100）。分子是当前累计、分母一律走 resolveGoalTarget——
 * 没有基线（migration v29 起 start_value 已下线），current 从 0 起算。
 */
export function calculateGoalProgress(goal: Goal): number {
  const target = Number(goal.target_value);
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(goal.current_value) / target) * 100));
}

interface GoalDeadlineInfo {
  /** 距目标日期的自然日数；0 表示今天到期。 */
  daysLeft: number;
  /** 按剩余时间与目标跨度的比例判断进度是否落后。 */
  behind: boolean;
}

export function goalDeadlineInfo(
  goal: Goal,
  todayKey: string,
): GoalDeadlineInfo | null {
  if (!goal.target_date) return null;
  const start = new Date(`${goal.start_date}T00:00:00`);
  const target = new Date(`${goal.target_date}T00:00:00`);
  const today = new Date(`${todayKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return null;
  const spanDays = Math.round((target.getTime() - start.getTime()) / 86400000);
  if (spanDays <= 0) return null;
  const elapsed = Math.round((today.getTime() - start.getTime()) / 86400000);
  const daysLeft = Math.max(0, Math.min(spanDays, spanDays - elapsed));
  // 时间过半而进度明显不足时才提示，避免开局就报警。
  const expected = (Math.min(Math.max(elapsed, 0), spanDays) / spanDays) * 100;
  return {
    daysLeft,
    behind: elapsed > 0 && calculateGoalProgress(goal) < expected - 15,
  };
}

export function activityLevelFromValue(value: number): 0 | 1 | 2 | 3 | 4 {
  // 五档对应 0、1、2、3、≥4：投入每多一个，颜色加深一档。
  if (value <= 0) return 0;
  if (value < 2) return 1;
  if (value < 3) return 2;
  if (value < 4) return 3;
  return 4;
}

export function longestDateStreak(dateKeys: string[]): number {
  const unique = [...new Set(dateKeys)].sort();
  let longest = 0;
  let current = 0;
  let previous: Date | null = null;
  for (const key of unique) {
    const date = new Date(`${key}T00:00:00`);
    current =
      previous && (date.getTime() - previous.getTime()) / 86400000 === 1
        ? current + 1
        : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

export function currentDateStreak(
  dateKeys: string[],
  todayKey: string,
): number {
  const dates = new Set(dateKeys);
  const cursor = new Date(`${todayKey}T12:00:00`);
  if (!dates.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
