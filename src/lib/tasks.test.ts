import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { computeNavCounts } from "./tasks";

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "任务",
    description: "",
    notes: "",
    priority: 3,
    status: "pending",
    due_date: null,
    due_time: null,
    end_time: null,
    sort_order: 0,
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-03T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    parent_id: null,
    repeat_rule: null,
    reminder_minutes: [],
    project_id: null,
    blocked_by_id: null,
    completion_criteria: "",
    energy_level: "medium",
    flexible: 1,
    schedule_locked: 0,
    actual_minutes: 0,
    goal_id: null,
    goal_contribution: 1,
    generated_from_id: null,
    ...overrides,
  };
}

describe("computeNavCounts", () => {
  const today = "2026-09-14";

  it("counts root tasks due today as 今日", () => {
    const counts = computeNavCounts(
      [
        task({ id: "a", due_date: "2026-09-14" }),
        task({ id: "b", due_date: "2026-09-14", status: "completed" }),
        task({ id: "c", due_date: "2026-09-15" }),
      ],
      today,
    );
    expect(counts.today).toBe(1);
  });

  it("counts non-today active root tasks as 待办箱", () => {
    const counts = computeNavCounts(
      [
        task({ id: "someday", due_date: null }),
        task({ id: "later", due_date: "2026-09-20" }),
        task({ id: "overdue", due_date: "2026-09-10" }),
        task({ id: "today-task", due_date: "2026-09-14" }),
      ],
      today,
    );
    expect(counts.inbox).toBe(3);
  });

  it("ignores subtasks and deleted tasks", () => {
    const counts = computeNavCounts(
      [
        task({ id: "root", due_date: "2026-09-14" }),
        task({ id: "sub", parent_id: "root", due_date: "2026-09-14" }),
        task({ id: "deleted", due_date: "2026-09-14", deleted_at: "2026-09-14T01:00:00.000Z" }),
      ],
      today,
    );
    expect(counts).toEqual({ today: 1, inbox: 0 });
  });

  it("completed tasks never count as inbox even when due earlier", () => {
    const counts = computeNavCounts(
      [task({ id: "done", due_date: "2026-09-10", status: "completed" })],
      today,
    );
    expect(counts.inbox).toBe(0);
  });
});
