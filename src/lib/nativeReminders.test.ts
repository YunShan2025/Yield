import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import {
  applyPrivacyToReminderPlans,
  buildNativeReminderPlans,
  OS_REMINDER_LIMIT,
  selectOsReminderWindow,
} from "./nativeReminders";

const task = (patch: Partial<Task>): Task =>
  ({
    id: "task-1",
    title: "发布版本",
    status: "pending",
    due_date: "2026-07-30",
    due_time: "10:00",
    parent_id: null,
    deleted_at: null,
    reminder_minutes: [60, 30],
    ...patch,
  }) as Task;

const now = new Date("2026-07-29T09:00:00").getTime();

describe("native reminder lifecycle", () => {
  it("removes completed and deleted tasks from the desired queue", () => {
    expect(buildNativeReminderPlans([task({ status: "completed" })], 30, now))
      .toEqual([]);
    expect(
      buildNativeReminderPlans(
        [task({ deleted_at: "2026-07-29T09:10:00.000Z" })],
        30,
        now,
      ),
    ).toEqual([]);
  });

  it("removes every previously scheduled reminder after completion", () => {
    const before = buildNativeReminderPlans([task({})], 30, now);
    const after = buildNativeReminderPlans(
      [task({ status: "completed", completed_at: "2026-07-29T09:30:00.000Z" })],
      30,
      now,
    );
    expect(before.map((item) => item.reminderId)).toHaveLength(2);
    expect(after).toEqual([]);
  });

  it("replaces old reminder identities when date or time changes", () => {
    const before = buildNativeReminderPlans([task({})], 30, now);
    const after = buildNativeReminderPlans(
      [task({ due_date: "2026-07-31", due_time: "08:30" })],
      30,
      now,
    );
    const beforeIds = new Set(before.map((item) => item.reminderId));
    expect(after.every((item) => !beforeIds.has(item.reminderId))).toBe(true);
  });

  it("keeps all reminder offsets and changes identity after rescheduling", () => {
    const original = buildNativeReminderPlans([task({})], 30, now);
    const moved = buildNativeReminderPlans(
      [task({ due_time: "11:00" })],
      30,
      now,
    );
    expect(original).toHaveLength(2);
    expect(original.map((item) => item.reminderId)).not.toEqual(
      moved.map((item) => item.reminderId),
    );
  });

  it("masks reminder copy when privacy mode is on", () => {
    const raw = buildNativeReminderPlans([task({})], 30, now);
    const masked = applyPrivacyToReminderPlans(raw, true);
    expect(masked[0].title).toBe("有秋");
    expect(masked[0].body).toBe("你有一条提醒");
    expect(applyPrivacyToReminderPlans(raw, false)[0].body).toContain("发布版本");
  });

  it("keeps the nearest 48 reminders inside the 90-day OS window", () => {
    const now = new Date("2026-07-29T09:00:00").getTime();
    const many = Array.from({ length: 60 }, (_, index) =>
      task({
        id: `task-${index}`,
        due_date: "2026-08-10",
        due_time: "10:00",
        reminder_minutes: [60 - (index % 50)],
      }),
    );
    const far = task({
      id: "far",
      due_date: "2027-01-01",
      due_time: "10:00",
      reminder_minutes: [30],
    });
    const window = selectOsReminderWindow(
      buildNativeReminderPlans([...many, far], 30, now),
      now,
    );
    expect(window.windowed).toHaveLength(OS_REMINDER_LIMIT);
    expect(window.truncated).toBe(true);
    expect(window.overflow.some((item) => item.taskId === "far")).toBe(true);
  });
});
