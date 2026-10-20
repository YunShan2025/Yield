import { describe, expect, it } from "vitest";
import {
  aggregateReviewByGoal,
  aggregateReviewByProject,
  aggregateReviewByTag,
  computeWeekReviewMetrics,
} from "./review";
import { mondayWeekDates, shiftWeek } from "./weeklyChecklist";
import type { Goal, Project, Tag, Task } from "@/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "任务",
    description: "",
    notes: "",
    priority: 3,
    status: "pending",
    due_date: "2026-10-12",
    due_time: "09:00",
    end_time: "10:00",
    sort_order: 1,
    created_at: "2026-10-12T01:00:00.000Z",
    updated_at: "2026-10-12T01:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    parent_id: null,
    project_id: null,
    goal_id: null,
    goal_contribution: 0,
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    title: "写作",
    color: "#2F6FED",
    goal_type: "milestone",
    start_date: "2026-10-01",
    target_date: null,
    start_value: 0,
    target_value: 30,
    current_value: 0,
    unit: "篇",
    status: "active",
    motivation: "",
    manual_completion: 0,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "产品",
    color: "#E8A16C",
    due_date: null,
    archived: 0,
    deleted_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    tag_id: null,
    ...overrides,
  };
}

function tag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag1",
    name: "深度工作",
    color: "#7C5CFC",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeWeekReviewMetrics", () => {
  const weekDates = mondayWeekDates("2026-10-14");

  it("only counts tasks attributed to the selected week", () => {
    const tasks = [
      task({ id: "in-week-done", status: "completed", completed_at: "2026-10-13T02:00:00" }),
      task({ id: "in-week-open", due_date: "2026-10-15" }),
      task({ id: "last-week", status: "completed", due_date: "2026-10-05", completed_at: "2026-10-05T02:00:00" }),
      task({ id: "next-week", due_date: "2026-10-22" }),
    ];

    const metrics = computeWeekReviewMetrics(tasks, weekDates);
    expect(metrics.total).toBe(2);
    expect(metrics.done).toBe(1);
    expect(metrics.rate).toBe(50);
  });

  it("changes metrics when the week anchor moves", () => {
    const tasks = [
      task({ id: "this-week", status: "completed", due_date: "2026-10-13", completed_at: "2026-10-13T02:00:00" }),
      task({ id: "previous-week", status: "completed", due_date: "2026-10-06", completed_at: "2026-10-06T06:00:00" }),
    ];

    const current = computeWeekReviewMetrics(tasks, mondayWeekDates("2026-10-13"));
    const previous = computeWeekReviewMetrics(
      tasks,
      mondayWeekDates(shiftWeek("2026-10-13", -1)),
    );

    expect(current.rate).toBe(100);
    expect(previous.rate).toBe(100);
    expect(previous.peakHour).not.toBe(current.peakHour);
  });

  it("excludes subtasks, trashed tasks and cancelled tasks", () => {
    const tasks = [
      task({ id: "parent", status: "completed", due_date: "2026-10-13", completed_at: "2026-10-13T02:00:00" }),
      task({ id: "sub", parent_id: "parent", due_date: "2026-10-13" }),
      task({ id: "trashed", deleted_at: "2026-10-14T00:00:00.000Z", due_date: "2026-10-13" }),
      task({ id: "cancelled", status: "cancelled", due_date: "2026-10-13" }),
    ];

    const metrics = computeWeekReviewMetrics(tasks, weekDates);
    expect(metrics.total).toBe(1);
    expect(metrics.done).toBe(1);
    expect(metrics.rate).toBe(100);
  });

  it("returns neutral values for an empty week", () => {
    const metrics = computeWeekReviewMetrics(
      [task({ id: "other-week", due_date: "2026-09-01" })],
      weekDates,
    );
    expect(metrics).toMatchObject({
      total: 0,
      done: 0,
      rate: 0,
      peakHour: null,
    });
  });
});

describe("review aggregations", () => {
  const weekDates = mondayWeekDates("2026-10-14");

  it("aggregates the selected week by goal and keeps unlinked tasks visible", () => {
    const groups = aggregateReviewByGoal(
      [
        task({ id: "g1-done", goal_id: "g1", status: "completed", completed_at: "2026-10-13T02:00:00" }),
        task({ id: "g1-open", goal_id: "g1", due_date: "2026-10-15" }),
        task({
          id: "g2-late",
          goal_id: "g2",
          status: "completed",
          due_date: "2026-10-12",
          completed_at: "2026-10-14T02:00:00",
        }),
        task({ id: "none", due_date: "2026-10-14" }),
        task({ id: "missing-goal", goal_id: "missing", due_date: "2026-10-14" }),
        task({ id: "other-week", goal_id: "g1", due_date: "2026-10-05" }),
      ],
      weekDates,
      [goal({ id: "g1", title: "写作" }), goal({ id: "g2", title: "阅读" })],
    );

    expect(groups).toEqual([
      expect.objectContaining({ key: "g1", label: "写作", total: 2, done: 1, rate: 50 }),
      expect.objectContaining({ key: "g2", label: "阅读", total: 1, done: 1, rate: 100 }),
      expect.objectContaining({ key: "__uncategorized__", label: "未归类", total: 2, done: 0 }),
    ]);
  });

  it("aggregates the selected week by project", () => {
    const groups = aggregateReviewByProject(
      [
        task({ id: "p1", project_id: "p1", due_date: "2026-10-13" }),
        task({ id: "p1-done", project_id: "p1", status: "completed", completed_at: "2026-10-13T02:00:00" }),
        task({ id: "orphan", project_id: "missing", due_date: "2026-10-14" }),
      ],
      weekDates,
      [project({ id: "p1", name: "产品" })],
    );

    expect(groups).toEqual([
      expect.objectContaining({ key: "p1", label: "产品", total: 2, done: 1, rate: 50 }),
      expect.objectContaining({ key: "__uncategorized__", total: 1, done: 0 }),
    ]);
  });

  it("counts multi-tag tasks in every matching tag group", () => {
    const groups = aggregateReviewByTag(
      [
        task({ id: "both", due_date: "2026-10-13" }),
        task({ id: "tag1", due_date: "2026-10-14" }),
        task({ id: "none", due_date: "2026-10-14" }),
      ],
      weekDates,
      [tag({ id: "tag1", name: "深度工作" }), tag({ id: "tag2", name: "沟通" })],
      { both: ["tag1", "tag2"], tag1: ["tag1"], none: [] },
    );

    expect(groups).toEqual([
      expect.objectContaining({ key: "tag1", label: "深度工作", total: 2, done: 0 }),
      expect.objectContaining({ key: "tag2", label: "沟通", total: 1, done: 0 }),
      expect.objectContaining({ key: "__uncategorized__", label: "未归类", total: 1, done: 0 }),
    ]);
  });

  it("returns no groups for a week without tasks", () => {
    expect(aggregateReviewByGoal([task({ due_date: "2026-10-05" })], weekDates, [])).toEqual([]);
  });
});
