import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { computeNavCounts, groupInboxTasks } from "./tasks";

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
    project_id: null,
    goal_id: null,
    goal_contribution: 1,
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

describe("groupInboxTasks", () => {
  const today = "2026-09-14";

  it("groups overdue, scheduled and unscheduled tasks in triage order", () => {
    const groups = groupInboxTasks(
      [
        task({ id: "s-later", due_date: "2026-09-16", priority: 1 }),
        task({
          id: "u-low",
          priority: 3,
          created_at: "2026-09-10T00:00:00.000Z",
        }),
        task({ id: "o-new", due_date: "2026-09-12", priority: 1 }),
        task({
          id: "u-high",
          priority: 1,
          created_at: "2026-09-11T00:00:00.000Z",
        }),
        task({ id: "o-old", due_date: "2026-09-10", priority: 4 }),
        task({ id: "s-soon", due_date: "2026-09-15", priority: 3 }),
      ],
      today,
    );

    expect(groups.map((group) => group.id)).toEqual([
      "overdue",
      "scheduled",
      "unscheduled",
    ]);
    expect(groups[0].tasks.map((item) => item.id)).toEqual([
      "o-old",
      "o-new",
    ]);
    expect(groups[1].tasks.map((item) => item.id)).toEqual([
      "s-soon",
      "s-later",
    ]);
    expect(groups[2].tasks.map((item) => item.id)).toEqual([
      "u-high",
      "u-low",
    ]);
  });

  it("omits empty groups and puts tasks due today in scheduled", () => {
    const groups = groupInboxTasks(
      [task({ id: "today-task", due_date: today })],
      today,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "scheduled" });
    expect(groups[0].tasks.map((item) => item.id)).toEqual(["today-task"]);
  });

  it("keeps completed tasks in their original group for exit animation", () => {
    const groups = groupInboxTasks(
      [
        task({
          id: "done-overdue",
          due_date: "2026-09-10",
          status: "completed",
        }),
      ],
      today,
    );
    expect(groups[0].id).toBe("overdue");
    expect(groups[0].tasks[0].id).toBe("done-overdue");
  });
});
