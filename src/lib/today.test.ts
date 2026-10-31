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
    project_id: null,
    goal_id: null,
    goal_contribution: 0,
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

  it("keeps completed tasks in place with sinkCompleted disabled (今日页新口径)", () => {
    const done = makeTask({ id: "done", status: "completed", due_time: "08:00" });
    const open = makeTask({ id: "open", due_time: "10:00" });
    expect(
      orderTodayTasks([done, open], null, { sinkCompleted: false }).map((t) => t.id),
    ).toEqual(["done", "open"]);
  });

  it("sorts by due date before time for multi-day lists (待办箱)", () => {
    // 回归：待办箱曾只按时间段排,「逾期 1 天 12:00」被排到「明天 09:00」之后。
    const overdue = makeTask({ id: "overdue", due_date: "2026-10-20", due_time: "12:00" });
    const tomorrowEarly = makeTask({ id: "tomorrow-early", due_date: "2026-10-22", due_time: "09:00" });
    const tomorrowLate = makeTask({ id: "tomorrow-late", due_date: "2026-10-22", due_time: "14:00" });
    const nextWeek = makeTask({ id: "next-week", due_date: "2026-10-27", due_time: "01:00" });
    const unscheduled = makeTask({ id: "unscheduled", due_time: "08:00" });
    expect(
      orderTodayTasks([tomorrowLate, nextWeek, unscheduled, overdue, tomorrowEarly]).map(
        (t) => t.id,
      ),
    ).toEqual([
      "overdue",
      "tomorrow-early",
      "tomorrow-late",
      "next-week",
      "unscheduled",
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
