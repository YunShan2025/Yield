import { describe, expect, it } from "vitest";
import {
  findFirstAvailableTimeSlot,
  buildTaskDeferredUpdate,
  findTimeConflictIds,
} from "./planning";
import type { Task } from "@/types";

const task = (patch: Partial<Task>): Task =>
  ({
    id: crypto.randomUUID(),
    status: "pending",
    due_time: null,
    end_time: null,
    ...patch,
  }) as Task;

describe("planning helpers", () => {
  it("chooses the first gap between existing tasks", () => {
    const slot = findFirstAvailableTimeSlot(
      [
        task({ due_date: "2026-08-05", due_time: "09:00", end_time: "10:00" }),
        task({ due_date: "2026-08-05", due_time: "11:00", end_time: "12:00" }),
      ],
      "2026-08-05",
      60,
      9 * 60,
    );
    expect(slot).toEqual({ start: "10:00", end: "11:00" });
  });

  it("ignores completed tasks when choosing a free time", () => {
    const slot = findFirstAvailableTimeSlot(
      [task({ status: "completed", due_date: "2026-08-05", due_time: "09:00", end_time: "10:00" })],
      "2026-08-05",
      60,
      9 * 60,
    );
    expect(slot).toEqual({ start: "09:00", end: "10:00" });
  });

  it("defers a day-board task by moving its due date", () => {
    expect(buildTaskDeferredUpdate("2026-08-06")).toEqual({
      due_date: "2026-08-06",
    });
  });

  it("finds overlapping tasks but not adjacent tasks", () => {
    const first = task({ id: "a", due_time: "09:00", end_time: "10:00" });
    const overlap = task({ id: "b", due_time: "09:30", end_time: "10:30" });
    const adjacent = task({ id: "c", due_time: "10:30", end_time: "11:00" });
    expect([...findTimeConflictIds([first, overlap, adjacent])].sort()).toEqual([
      "a",
      "b",
    ]);
  });
});
