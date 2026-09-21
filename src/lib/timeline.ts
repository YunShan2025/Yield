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
  /** Pixels per minute on the horizontal axis (>= BASE_PX_PER_MIN). */
  pxPerMin: number;
  timed: TimelineTimedBlock[];
  allDay: TimelineTaskInput[];
};

/** 事件块最小渲染宽度（px）与块间最小间隙（px）。 */
export const TIMELINE_MIN_EVENT_W = 168;
const TIMELINE_EVENT_GAP = 8;
export const BASE_PX_PER_MIN = 96 / 60; // 每小时 96px
/** 拥挤时最多放大到每小时 240px，再挤就靠纵向分行兜底。 */
const MAX_PX_PER_MIN = 240 / 60;

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
 *
 * 视觉重叠治理：事件块有最小渲染宽度（TIMELINE_MIN_EVENT_W），短任务按
 * 真实时间占比画会盖住同泳道里紧随其后的块。先按起始时间的相邻间隔算出
 * 需要的横向密度（有上限），再把每个块的「渲染末端」（start + 渲染宽度）
 * 作为占位去分配泳道——仍放不下的块落到下一行，绝不再互相压盖。
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

  // 依相邻块的间隔计算需要的横向密度：紧挨着的块必须各自有最小渲染宽度。
  let pxPerMin = BASE_PX_PER_MIN;
  for (let i = 1; i < raw.length; i += 1) {
    const gap = raw[i].start - raw[i - 1].start;
    if (gap <= 0) continue;
    pxPerMin = Math.max(
      pxPerMin,
      Math.min(MAX_PX_PER_MIN, (TIMELINE_MIN_EVENT_W + TIMELINE_EVENT_GAP) / gap),
    );
  }
  const renderMinutes = (TIMELINE_MIN_EVENT_W + TIMELINE_EVENT_GAP) / pxPerMin;
  const lanes = packLanes(
    raw.map((block) => ({
      start: block.start,
      end: Math.max(block.end, block.start + renderMinutes),
    })),
  );
  const timed: TimelineTimedBlock[] = raw.map((block, index) => ({
    ...block,
    lane: lanes[index],
  }));

  return { startHour: 0, endHour: 24, pxPerMin, timed, allDay };
}
