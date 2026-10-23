import { isTaskInWeek } from "@/lib/weeklyChecklist";
import type { Goal, Project, Tag, Task } from "@/types";

type WeekReviewMetrics = {
  /** 本周归属根任务总数（含已取消之外的全部状态）。 */
  total: number;
  /** 本周归属根任务中已完成的数量。 */
  done: number;
  rate: number;
  /** 本周完成任务的完成时刻（0–23）；无完成记录时为 null。 */
  peakHour: number | null;
};

export type ReviewDimension = "goal" | "project" | "tag";

type ReviewGroup = {
  key: string;
  label: string;
  color: string | null;
  total: number;
  done: number;
  rate: number;
};

const UNCATEGORIZED_KEY = "__uncategorized__";

function weekRootTasks(tasks: Task[], weekDates: string[]): Task[] {
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];
  return tasks.filter((task) => isTaskInWeek(task, weekStart, weekEnd));
}

function summarizeGroup(
  key: string,
  label: string,
  color: string | null,
  tasks: Task[],
): ReviewGroup {
  const done = tasks.filter((task) => task.status === "completed").length;
  const total = tasks.length;
  return {
    key,
    label,
    color,
    total,
    done,
    rate: total ? Math.round((done / total) * 100) : 0,
  };
}

function sortGroups(groups: ReviewGroup[]): ReviewGroup[] {
  return groups.sort((a, b) => {
    if (a.key === UNCATEGORIZED_KEY) return 1;
    if (b.key === UNCATEGORIZED_KEY) return -1;
    return b.total - a.total || b.done - a.done || a.label.localeCompare(b.label, "zh-CN");
  });
}

/**
 * 当周任务按成长目标聚合。没有关联目标或目标已不存在时归入"未归类"；
 * 空目标不占位，避免复盘页被零使用目标刷屏。
 */
export function aggregateReviewByGoal(
  tasks: Task[],
  weekDates: string[],
  goals: Goal[],
): ReviewGroup[] {
  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  const buckets = new Map<string, Task[]>();
  for (const task of weekRootTasks(tasks, weekDates)) {
    const key = task.goal_id && goalMap.has(task.goal_id) ? task.goal_id : UNCATEGORIZED_KEY;
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  const groups = [...buckets.entries()].map(([key, list]) => {
    if (key === UNCATEGORIZED_KEY) return summarizeGroup(key, "未归类", null, list);
    const goal = goalMap.get(key)!;
    return summarizeGroup(key, goal.title, goal.color, list);
  });
  return sortGroups(groups);
}

/** 当周任务按所属项目聚合；无项目任务归入"未归类"。 */
export function aggregateReviewByProject(
  tasks: Task[],
  weekDates: string[],
  projects: Project[],
): ReviewGroup[] {
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const buckets = new Map<string, Task[]>();
  for (const task of weekRootTasks(tasks, weekDates)) {
    const key =
      task.project_id && projectMap.has(task.project_id) ? task.project_id : UNCATEGORIZED_KEY;
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  const groups = [...buckets.entries()].map(([key, list]) => {
    if (key === UNCATEGORIZED_KEY) return summarizeGroup(key, "未归类", null, list);
    const project = projectMap.get(key)!;
    return summarizeGroup(key, project.name, project.color, list);
  });
  return sortGroups(groups);
}

/**
 * 当周任务按标签聚合。多标签任务会同时计入多个标签组；无标签任务归入
 * "未归类"。
 */
export function aggregateReviewByTag(
  tasks: Task[],
  weekDates: string[],
  tags: Tag[],
  tagMap: Record<string, string[]>,
): ReviewGroup[] {
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const buckets = new Map<string, Task[]>();
  for (const task of weekRootTasks(tasks, weekDates)) {
    const ids = (tagMap[task.id] ?? []).filter((id) => tagById.has(id));
    if (!ids.length) {
      buckets.set(UNCATEGORIZED_KEY, [...(buckets.get(UNCATEGORIZED_KEY) ?? []), task]);
      continue;
    }
    for (const id of ids) {
      buckets.set(id, [...(buckets.get(id) ?? []), task]);
    }
  }
  const groups = [...buckets.entries()].map(([key, list]) => {
    if (key === UNCATEGORIZED_KEY) return summarizeGroup(key, "未归类", null, list);
    const tag = tagById.get(key)!;
    return summarizeGroup(key, tag.name, tag.color, list);
  });
  return sortGroups(groups);
}

/**
 * 复盘页"整体完成率 / 高效时段"的当周口径。
 *
 * 归属沿用周清单的 isTaskInWeek：优先 due_date，其次 completed_at；子任务、
 * 回收站任务与已取消任务不计入。切周时只需换 weekDates，三项指标随之变化。
 */
export function computeWeekReviewMetrics(
  tasks: Task[],
  weekDates: string[],
): WeekReviewMetrics {
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];
  const weekTasks = tasks.filter((task) => isTaskInWeek(task, weekStart, weekEnd));

  const done = weekTasks.filter((task) => task.status === "completed").length;
  const total = weekTasks.length;
  const rate = total ? Math.round((done / total) * 100) : 0;

  const hours = Array.from({ length: 24 }, () => 0);
  for (const task of weekTasks) {
    if (!task.completed_at) continue;
    const stamp = Date.parse(task.completed_at);
    if (Number.isNaN(stamp)) continue;
    hours[new Date(stamp).getHours()] += 1;
  }
  const peakCount = Math.max(...hours);
  const peakHour = peakCount > 0 ? hours.indexOf(peakCount) : null;

  return { total, done, rate, peakHour };
}
