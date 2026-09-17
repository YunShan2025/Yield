import type { Task, TaskUpdate } from "@/types";
import { parseTimeToMinutes } from "@/lib/dates";

/** Defer a task shown on a day board to another date. Day boards list tasks
 *  by due date, so deferring always moves the due date itself. */
export function buildTaskDeferredUpdate(date: string): TaskUpdate {
  return { due_date: date };
}

export function findTimeConflictIds(tasks: Task[]): Set<string> {
  const planned = tasks
    .filter(
      (task) =>
        task.status !== "completed" &&
        task.status !== "cancelled" &&
        task.due_time,
    )
    .map((task) => {
      const start = parseTimeToMinutes(task.due_time) ?? 0;
      return {
        task,
        start,
        end:
          parseTimeToMinutes(task.end_time) ??
          start + (task.estimated_minutes ?? 60),
      };
    });
  const conflicts = new Set<string>();
  for (let i = 0; i < planned.length; i++) {
    for (let j = i + 1; j < planned.length; j++) {
      const a = planned[i];
      const b = planned[j];
      if (a.start < b.end && b.start < a.end) {
        conflicts.add(a.task.id);
        conflicts.add(b.task.id);
      }
    }
  }
  return conflicts;
}

function minutesToTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(
    bounded % 60,
  ).padStart(2, "0")}`;
}

export type AvailableTimeSlot = {
  start: string;
  end: string;
};

/** Find the first free block on a date, aligned to 15-minute boundaries. */
export function findFirstAvailableTimeSlot(
  tasks: Task[],
  date: string,
  duration = 60,
  notBefore = 9 * 60,
  dayEnd = 23 * 60 + 45,
): AvailableTimeSlot | null {
  const span = Math.max(15, Math.ceil(duration / 15) * 15);
  const occupied = tasks
    .filter(
      (task) =>
        task.due_date === date &&
        task.status !== "completed" &&
        task.status !== "cancelled" &&
        task.due_time,
    )
    .map((task) => {
      const start = parseTimeToMinutes(task.due_time) ?? 0;
      return {
        start,
        end: Math.max(
          start + 15,
          parseTimeToMinutes(task.end_time) ??
            start + (task.estimated_minutes ?? 60),
        ),
      };
    })
    .sort((a, b) => a.start - b.start);

  let cursor = Math.max(0, Math.ceil(notBefore / 15) * 15);
  for (const slot of occupied) {
    if (cursor + span <= slot.start) {
      return { start: minutesToTime(cursor), end: minutesToTime(cursor + span) };
    }
    if (cursor < slot.end) cursor = Math.ceil(slot.end / 15) * 15;
  }
  return cursor + span <= dayEnd
    ? { start: minutesToTime(cursor), end: minutesToTime(cursor + span) }
    : null;
}
