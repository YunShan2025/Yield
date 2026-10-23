import type { Goal, GoalEntry } from "@/types";

/**
 * 这个目标接不接受某种来源的进度记录。
 *
 * 判定口径只有一条：**这条记录能不能代表目标的进度单位**。
 * - 阶段型目标：进度只由阶段勾选推进，任何记录都不接受（否则阶段与计数
 *   两套进度会互相打架）。
 * - 数值变化型目标：只认手动测量。"读完一本书"推不动"体重从 80 到 75"。
 * - 数值·次数型目标：任务完成与习惯打卡都可以，但必须是**显式声明的计量关联**
 *   （goal_contribution > 0）。
 */
export function goalAcceptsSource(
  goal: Goal,
  source: GoalEntry["source_type"],
): boolean {
  if (goal.status !== "active") return false;
  if (goal.goal_type === "staged") return false;
  if (source === "manual") return true;
  if (goal.goal_type === "measure") return false;
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
 * 分母就是目标的 target_value。
 * - 数值·次数型：target_value = 目标次数（"读完 21 本"）；
 * - 数值变化型：target_value = 目标测量值（"体重 75kg"）；
 * - 阶段型：target_value = 总阶段数（起点恒为 0）。
 */
export function resolveGoalTarget(goal: Goal): GoalTarget {
  return { value: Number(goal.target_value), unit: goal.unit };
}

/**
 * 目标进度（0–100）。分母一律走 resolveGoalTarget，不再各界面各取一套。
 * 阶段型目标的起点是 0、当前值是已完成阶段数，天然落在同一套公式里。
 */
export function calculateGoalProgress(goal: Goal): number {
  const ascending = Number(goal.target_value) >= Number(goal.start_value);
  const span = Math.max(0.0001, Math.abs(Number(goal.target_value) - Number(goal.start_value)));
  const moved = ascending
    ? Number(goal.current_value) - Number(goal.start_value)
    : Number(goal.start_value) - Number(goal.current_value);
  return Math.max(0, Math.min(100, (moved / span) * 100));
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
