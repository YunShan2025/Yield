import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { orderTodayTasks } from "./today";

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

describe("orderTodayTasks", () => {
  it("puts timed tasks before untimed ones and sorts timed by start", () => {
    const a = makeTask({ id: "a", due_time: "10:00" });
    const b = makeTask({ id: "b", due_time: "09:00" });
    const c = makeTask({ id: "c" });
    expect(orderTodayTasks([a, c, b]).map((t) => t.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("breaks time ties with priority then sort_order", () => {
    const low = makeTask({ id: "low", due_time: "09:00", priority: 4 });
    const high = makeTask({ id: "high", due_time: "09:00", priority: 1 });
    const later = makeTask({
      id: "later",
      due_time: "09:00",
      priority: 3,
      sort_order: 2,
    });
    const earlier = makeTask({
      id: "earlier",
      due_time: "09:00",
      priority: 3,
      sort_order: 1,
    });
    expect(
      orderTodayTasks([low, later, high, earlier]).map((t) => t.id),
    ).toEqual(["high", "earlier", "later", "low"]);
  });

  it("sinks completed tasks below the active run", () => {
    const done = makeTask({ id: "done", status: "completed", due_time: "08:00" });
    const open = makeTask({ id: "open", due_time: "10:00" });
    expect(orderTodayTasks([done, open]).map((t) => t.id)).toEqual([
      "open",
      "done",
    ]);
  });

  it("honors a saved manual order before the default rules", () => {
    const a = makeTask({ id: "a", due_time: "09:00" });
    const b = makeTask({ id: "b", due_time: "10:00" });
    const c = makeTask({ id: "c" });
    expect(
      orderTodayTasks([a, b, c], ["c", "b", "a"]).map((t) => t.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("appends tasks missing from the saved order after ranked ones", () => {
    const a = makeTask({ id: "a", due_time: "09:00" });
    const fresh = makeTask({ id: "fresh" });
    expect(orderTodayTasks([a, fresh], ["a"]).map((t) => t.id)).toEqual([
      "a",
      "fresh",
    ]);
  });
});
