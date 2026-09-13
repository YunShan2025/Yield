/** Absolute-time focus countdown — survives sleep / long stalls. */

import type { Task } from "@/types";
import { parseDate, parseTimeToMinutes, todayDateString } from "@/lib/dates";

/** Countdown used when the task has no planned window to derive one from. */
export const DEFAULT_FOCUS_SECONDS = 25 * 60;

/**
 * Planned focus duration: from the later of (now, planned start) to the
 * planned end. Starting before the window yields the full planned span;
 * starting inside it yields only what remains. Tasks without a usable
 * window (no end time, or the window already passed) fall back to
 * DEFAULT_FOCUS_SECONDS.
 */
export function plannedFocusSeconds(
  task:
    | Pick<Task, "due_date" | "due_time" | "end_time">
    | null
    | undefined,
  nowMs = Date.now(),
): number {
  if (!task?.end_time) return DEFAULT_FOCUS_SECONDS;
  const endMin = parseTimeToMinutes(task.end_time);
  if (endMin === null) return DEFAULT_FOCUS_SECONDS;
  const dateStr = task.due_date ?? todayDateString();
  const dayStart = parseDate(dateStr).getTime();
  const startMin = parseTimeToMinutes(task.due_time);
  const startMs = startMin === null ? nowMs : dayStart + startMin * 60_000;
  // end_time is normally edited to be after due_time; a wrap past midnight
  // (e.g. 23:30–00:30) still means the following day's end.
  const endMs =
    dayStart + (endMin + (startMin !== null && endMin <= startMin ? 1440 : 0)) * 60_000;
  const seconds = Math.ceil((endMs - Math.max(nowMs, startMs)) / 1000);
  return seconds > 0 ? seconds : DEFAULT_FOCUS_SECONDS;
}

export function remainingFocusSeconds(
  endsAtMs: number | null,
  nowMs = Date.now(),
): number {
  if (endsAtMs === null) return 0;
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

export function focusEndsAtFromRemaining(
  remainingSec: number,
  nowMs = Date.now(),
): number {
  return nowMs + Math.max(0, remainingSec) * 1000;
}
