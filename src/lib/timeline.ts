import type { Task } from "@/types";
import { parseTimeToMinutes } from "@/lib/dates";

export type TimelineTaskInput = Pick<
  Task,
  | "id"
  | "title"
  | "status"
  | "priority"
  | "due_time"
  | "end_time"
>;

export type TimelineTimedBlock = {
  task: TimelineTaskInput;
  /** Minutes from midnight, clamped into the same day. */
  start: number;
  end: number;
  lane: number;
};

export type TimelineLayout = {
  /** First hour label shown on the axis. */
  startHour: number;
  /** Exclusive end hour; the axis pixel range ends at endHour * 60. */
  endHour: number;
  timed: TimelineTimedBlock[];
  allDay: TimelineTaskInput[];
};

/**
 * Interval-graph coloring: sweep blocks by start time and drop each into the
 * lowest lane whose last block already ended, so overlapping tasks share one
 * visual row instead of stacking one lane per task.
 */
export function packLanes(
  blocks: { start: number; end: number }[],
): number[] {
  const laneEnds: number[] = [];
  const lanes = new Array<number>(blocks.length).fill(0);
  const order = blocks
    .map((_, index) => index)
    .sort(
      (a, b) => blocks[a].start - blocks[b].start || blocks[a].end - blocks[b].end,
    );
  for (const index of order) {
    const block = blocks[index];
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    lanes[index] = lane;
  }
  return lanes;
}

const clampToDay = (minutes: number) =>
  Math.max(0, Math.min(24 * 60, minutes));

/**
 * Split tasks into timed blocks (packed into lanes) and an all-day list.
 * Untimed tasks no longer pretend to occupy 8:00–9:00.
 */
export function layoutTimeline(
  tasks: TimelineTaskInput[],
): TimelineLayout {
  const allDay: TimelineTaskInput[] = [];
  const raw: { task: TimelineTaskInput; start: number; end: number }[] = [];
  for (const task of tasks) {
    const start = parseTimeToMinutes(task.due_time);
    if (start === null) {
      allDay.push(task);
      continue;
    }
    let end = parseTimeToMinutes(task.end_time) ?? start + 60;
    if (end <= start) end = start + 24 * 60; // crosses midnight
    raw.push({
      task,
      start: clampToDay(start),
      end: clampToDay(end),
    });
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const lanes = packLanes(raw);
  const timed: TimelineTimedBlock[] = raw.map((block, index) => ({
    ...block,
    lane: lanes[index],
  }));

  return { startHour: 0, endHour: 24, timed, allDay };
}
