import type { Task } from "@/types";
import { isOverdue, todayDateString } from "@/lib/dates";

export function isActiveTask(task: Task): boolean {
  return task.status !== "completed" && task.status !== "cancelled";
}

/** 待办箱收纳非今日的任务：没有截止日期、或截止日期不在今天。 */
export function isInboxTask(task: Task, today: string): boolean {
  return (
    isActiveTask(task) &&
    (!task.due_date || task.due_date !== today)
  );
}

/** 导航入口的徽标计数:今日(截止在今天)与待办箱(非今日的活跃任务),只统计根任务。 */
export function computeNavCounts(
  tasks: Task[],
  today: string,
): { today: number; inbox: number } {
  const roots = tasks.filter((task) => !task.parent_id && !task.deleted_at);
  return {
    today: roots.filter((task) => isActiveTask(task) && task.due_date === today)
      .length,
    inbox: roots.filter((task) => isInboxTask(task, today)).length,
  };
}

/** Project progress is made of finite deliverables, not recurring routines. */
export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks.filter(
    (task) =>
      task.project_id === projectId &&
      !task.deleted_at &&
      !task.parent_id &&
      !task.repeat_rule,
  );
}

export function filterTasksByView(
  tasks: Task[],
  view: string,
  tagMap: Record<string, string[]> = {},
  activeTagId: string | null = null,
): Task[] {
  const roots = tasks.filter((t) => !t.parent_id);
  let list = roots;

  const today = todayDateString();

  switch (view) {
    case "today":
    case "myday":
      list = list.filter(
        (t) => isActiveTask(t) && t.due_date === today,
      );
      break;
    case "inbox":
      list = list.filter((t) => isInboxTask(t, today));
      break;
    case "board":
    case "calendar":
    case "week":
      break;
    case "tags":
      if (activeTagId) {
        list = list.filter((t) => tagMap[t.id]?.includes(activeTagId));
      }
      break;
    default:
      break;
  }

  return sortTasks(list);
}

export function sortTasks(tasks: Task[]): Task[] {
  const pending = tasks
    .filter(isActiveTask)
    .sort((a, b) => a.sort_order - b.sort_order);
  const completed = tasks
    .filter((t) => t.status === "completed")
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at).localeCompare(
        a.completed_at ?? a.updated_at,
      ),
    );
  return [...pending, ...completed];
}

export function getSubtasks(tasks: Task[], parentId: string): Task[] {
  return tasks
    .filter((t) => t.parent_id === parentId && !t.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function subtaskProgress(tasks: Task[], parentId: string): number {
  const subs = getSubtasks(tasks, parentId);
  if (!subs.length) return 0;
  return subs.filter((t) => t.status === "completed").length / subs.length;
}

export function getEmptyMessage(view: string): string {
  switch (view) {
    case "today":
    case "myday":
      return "今天还没有截止的任务。新建任务并设置今天的截止日期即可。";
    case "inbox":
      return "待办箱是空的。";
    case "completed":
      return "还没有完成的任务。";
    case "habits":
      return "创建第一个习惯开始追踪。";
    case "reminders":
      return "还没有提醒，创建一个循环倒计时吧。";
    case "week":
      return "本周还没有安排任务。";
    case "trash":
      return "回收站是空的。";
    default:
      return "还没有任务，点击新建开始。";
  }
}

export function getViewTitle(view: string): string {
  const map: Record<string, string> = {
    today: "今日",
    myday: "今日",
    inbox: "待办箱",
    week: "周清单",
    board: "看板",
    calendar: "日历",
    tags: "标签",
    habits: "习惯",
    reminders: "提醒",
    memos: "备忘录",
    review: "复盘",
    growth: "成长",
    anniversaries: "纪念日",
    projects: "项目",
    trash: "回收站",
    settings: "设置",
  };
  return map[view] ?? "有秋";
}

export function taskRowClassName(task: Task, selected: boolean): string {
  const classes = ["task-row"];
  if (selected) classes.push("is-selected");
  if (task.status === "completed") classes.push("is-completed");
  if (isOverdue(task)) classes.push("is-overdue");
  return classes.join(" ");
}

export function boardColumns(tasks: Task[]) {
  const roots = sortTasks(tasks.filter((t) => !t.parent_id));
  return {
    pending: roots.filter((t) => isActiveTask(t) && !isOverdue(t)),
    overdue: roots.filter((t) => isOverdue(t)),
    completed: roots.filter((t) => t.status === "completed"),
  };
}
