import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { projectTasks } from "./tasks";

function task(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "任务",
    description: "",
    notes: "",
    priority: 3,
    status: "pending",
    due_date: null,
    due_time: null,
    end_time: null,
    sort_order: 0,
    created_at: "2026-09-03T00:00:00.000Z",
    updated_at: "2026-09-03T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    parent_id: null,
    project_id: "project-1",
    goal_id: null,
    goal_contribution: 0,
    ...overrides,
  };
}

describe("projectTasks", () => {
  it("keeps every project task — repetition now lives in habits", () => {
    const finite = task({ id: "finite" });
    const second = task({ id: "second" });
    expect(projectTasks([finite, second], "project-1")).toEqual([finite, second]);
  });

  it("excludes deleted tasks, subtasks, and tasks from other projects", () => {
    const visible = task({ id: "visible" });
    const deleted = task({ id: "deleted", deleted_at: "2026-09-03T01:00:00.000Z" });
    const child = task({ id: "child", parent_id: visible.id });
    const other = task({ id: "other", project_id: "project-2" });
    expect(projectTasks([visible, deleted, child, other], "project-1")).toEqual([visible]);
  });
});
