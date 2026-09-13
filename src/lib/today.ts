import type { Task } from "@/types";
import { parseTimeToMinutes } from "@/lib/dates";
import { isActiveTask } from "@/lib/tasks";

const ORDER_STORAGE_KEY = "minimal.todayOrder";

export type TodayOrderRecord = { date: string; ids: string[] };

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
 * wins, then timed tasks before untimed ones (by start time), then priority,
 * then sort_order. Completed tasks always sink below the active run.
 */
export function orderTodayTasks(
  tasks: Task[],
  order: string[] | null = null,
): Task[] {
  const rank = new Map((order ?? []).map((id, index) => [id, index]));
  const UNRANKED = Number.MAX_SAFE_INTEGER;
  const compare = (a: Task, b: Task): number => {
    const ra = rank.get(a.id) ?? UNRANKED;
    const rb = rank.get(b.id) ?? UNRANKED;
    if (ra !== rb) return ra - rb;
    const ta = parseTimeToMinutes(a.due_time);
    const tb = parseTimeToMinutes(b.due_time);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sort_order - b.sort_order;
  };
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
