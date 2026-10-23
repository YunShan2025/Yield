import { describe, expect, it } from "vitest";
import type { Project, Tag, Task } from "@/types";
import { getMobileTaskPills } from "./MobileTaskPills";

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
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    parent_id: null,
    project_id: null,
    goal_id: null,
    goal_contribution: 1,
    ...overrides,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    name,
    color: "#4f7df9",
    due_date: null,
    archived: 0,
    deleted_at: null,
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    tag_id: null,
  };
}

function tag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: "#f0a92e",
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
  };
}

describe("getMobileTaskPills", () => {
  it("项目在前、标签在后", () => {
    const pills = getMobileTaskPills(
      task({ id: "task-1", project_id: "project-1" }),
      [project("project-1", "项目")],
      [tag("tag-1", "标签")],
      { "task-1": ["tag-1"] },
    );

    expect(pills.map((pill) => pill.name)).toEqual(["项目", "标签"]);
    expect(pills.map((pill) => pill.color)).toEqual(["#4f7df9", "#f0a92e"]);
  });

  it("项目名与标签名相同时仍保留独立 key", () => {
    const pills = getMobileTaskPills(
      task({ id: "task-1", project_id: "project-1" }),
      [project("project-1", "健身")],
      [tag("tag-1", "健身")],
      { "task-1": ["tag-1"] },
    );

    expect(new Set(pills.map((pill) => pill.key)).size).toBe(2);
  });

  it("缺少项目或标签时只返回可用胶囊", () => {
    expect(getMobileTaskPills(task({ id: "task-1" }), [], [], {})).toEqual([]);
  });
});
