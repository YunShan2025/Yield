import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { layoutTimeline, packLanes } from "./timeline";

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return {
    title: patch.id,
    description: "",
    notes: "",
    priority: 3,
    status: "pending",
    due_date: null,
    due_time: null,
    end_time: null,
    sort_order: 0,
    created_at: "2026-09-11T00:00:00",
    updated_at: "2026-09-11T00:00:00",
    completed_at: null,
    deleted_at: null,
    parent_id: null,
    repeat_rule: null,
    reminder_minutes: [],
    estimated_minutes: null,
    project_id: null,
    blocked_by_id: null,
    completion_criteria: "",
    energy_level: "medium",
    flexible: 1,
    schedule_locked: 0,
    actual_minutes: 0,
    goal_id: null,
    goal_contribution: 0,
    generated_from_id: null,
    ...patch,
  };
}

describe("packLanes", () => {
  it("keeps non-overlapping blocks in lane 0", () => {
    expect(packLanes([{ start: 540, end: 600 }, { start: 600, end: 660 }])).toEqual([0, 0]);
  });

  it("gives overlapping blocks separate lanes", () => {
    const lanes = packLanes([
      { start: 540, end: 660 },
      { start: 600, end: 660 },
    ]);
    expect(lanes[0]).toBe(0);
    expect(lanes[1]).toBe(1);
  });

  it("reuses a lane once its block has ended", () => {
    // 09:00–10:00 and 09:30–10:30 overlap; 10:15–11:00 only collides with the second.
    const lanes = packLanes([
      { start: 540, end: 600 },
      { start: 570, end: 630 },
      { start: 615, end: 660 },
    ]);
    expect(lanes).toEqual([0, 1, 0]);
  });

  it("handles an empty list", () => {
    expect(packLanes([])).toEqual([]);
  });
});

describe("layoutTimeline", () => {
  it("routes untimed tasks to the all-day list instead of fake 8:00 blocks", () => {
    const layout = layoutTimeline([
      makeTask({ id: "untimed", due_time: null }),
      makeTask({ id: "timed", due_time: "10:00", end_time: "11:00" }),
    ]);
    expect(layout.allDay.map((t) => t.id)).toEqual(["untimed"]);
    expect(layout.timed).toHaveLength(1);
    expect(layout.timed[0]).toMatchObject({ start: 600, end: 660, lane: 0 });
  });

  it("derives the estimated end from estimated_minutes when end_time is missing", () => {
    const layout = layoutTimeline([
      makeTask({ id: "a", due_time: "09:00", estimated_minutes: 45 }),
    ]);
    expect(layout.timed[0]).toMatchObject({ start: 540, end: 585 });
  });

  it("wraps blocks that end at or before their start across midnight", () => {
    const layout = layoutTimeline([
      makeTask({ id: "late", due_time: "23:30", end_time: "00:30" }),
    ]);
    expect(layout.timed[0]).toMatchObject({ start: 1410, end: 1440 });
  });

  it("always lays out the full 24-hour axis regardless of data extent", () => {
    const layout = layoutTimeline([
      makeTask({ id: "early", due_time: "06:30", end_time: "07:10" }),
      makeTask({ id: "late", due_time: "22:00", end_time: "23:30" }),
    ]);
    expect(layout.startHour).toBe(0);
    expect(layout.endHour).toBe(24);
  });

  it("keeps the full 00:00–24:00 axis even when data sits mid-day", () => {
    const layout = layoutTimeline([
      makeTask({ id: "a", due_time: "09:00", end_time: "10:00" }),
    ]);
    expect(layout.startHour).toBe(0);
    expect(layout.endHour).toBe(24);
  });

  it("packs overlapping tasks into lanes instead of one lane per task", () => {
    const layout = layoutTimeline([
      makeTask({ id: "a", due_time: "09:00", end_time: "10:00" }),
      makeTask({ id: "b", due_time: "09:30", end_time: "10:30" }),
      makeTask({ id: "c", due_time: "11:00", end_time: "12:00" }),
    ]);
    expect(layout.timed.map((block) => block.lane)).toEqual([0, 1, 0]);
  });
});
