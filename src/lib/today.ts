import type { Task } from "@/types";
import { parseTimeToMinutes } from "@/lib/dates";
import { isActiveTask } from "@/lib/tasks";

const ORDER_STORAGE_KEY = "minimal.todayOrder";

type TodayOrderRecord = { date: string; ids: string[] };

/**
 * Manual agenda order is per-day UI state (localStorage), not sort_order:
 * dragging one view must not disturb inbox/project ordering elsewhere.
 */
export function loadTodayOrder(cursor: string): string[] | null {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TodayOrderRecord | null;
    if (!parsed || parsed.date !== cursor || !Array.isArray(parsed.ids)) {
      return null;
    }
    return parsed.ids;
  } catch {
    return null;
  }
}

export function saveTodayOrder(cursor: string, ids: string[]): void {
  try {
    localStorage.setItem(
      ORDER_STORAGE_KEY,
      JSON.stringify({ date: cursor, ids } satisfies TodayOrderRecord),
    );
  } catch {
    /* ignore quota/private-mode failures */
  }
}

/**
 * Today board shows one flat "what to do today" list. A saved manual order
 * wins, then earliest due date first (待办箱跨多天：逾期 < 未来 < 未安排；
 * 今日/日视图同一天,该层恒等不落刀), then timed tasks before untimed ones
 * (by start time), then priority, then sort_order. Completed tasks always
 * sink below the active run — 除非 opts.sinkCompleted=false（今日/当日视图
 * 新口径：完成不改位,只由按钮与完成时间徽章表示）。
 */
export function orderTodayTasks(
  tasks: Task[],
  order: string[] | null = null,
  opts: { sinkCompleted?: boolean } = {},
): Task[] {
  const rank = new Map((order ?? []).map((id, index) => [id, index]));
  const UNRANKED = Number.MAX_SAFE_INTEGER;
  const compare = (a: Task, b: Task): number => {
    const ra = rank.get(a.id) ?? UNRANKED;
    const rb = rank.get(b.id) ?? UNRANKED;
    if (ra !== rb) return ra - rb;
    // 日期先于时间：待办箱是跨天的平铺列表,只按时间段排会把「逾期 1 天」
    // 排进下周任务之后。未安排（无日期）沉到已排期之后,与移动待办箱的
    // 逾期/已排期/未安排分区同序。
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    const ta = parseTimeToMinutes(a.due_time);
    const tb = parseTimeToMinutes(b.due_time);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sort_order - b.sort_order;
  };
  if (opts.sinkCompleted === false) return [...tasks].sort(compare);
  const active = tasks.filter(isActiveTask).sort(compare);
  const completed = tasks
    .filter((task) => task.status === "completed")
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at).localeCompare(
        a.completed_at ?? a.updated_at,
      ),
    );
  return [...active, ...completed];
}
