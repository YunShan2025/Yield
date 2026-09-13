import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS_SECONDS,
  focusEndsAtFromRemaining,
  plannedFocusSeconds,
  remainingFocusSeconds,
} from "./focusTimer";
import { parseDate, todayDateString } from "./dates";

describe("focusTimer absolute time", () => {
  it("derives remaining seconds from endsAt", () => {
    const now = 1_000_000;
    expect(remainingFocusSeconds(now + 90_500, now)).toBe(91);
    expect(remainingFocusSeconds(now - 1, now)).toBe(0);
    expect(remainingFocusSeconds(null, now)).toBe(0);
  });

  it("builds endsAt from remaining seconds", () => {
    const now = 5_000_000;
    expect(focusEndsAtFromRemaining(25 * 60, now)).toBe(now + 1_500_000);
    expect(focusEndsAtFromRemaining(-3, now)).toBe(now);
  });

  it("accounts for sleep gaps without ticking once per second", () => {
    const now = 10_000_000;
    const endsAt = focusEndsAtFromRemaining(25 * 60, now);
    // Wake 20 minutes later — remaining should drop by ~1200s, not by 1.
    expect(remainingFocusSeconds(endsAt, now + 20 * 60 * 1000)).toBe(5 * 60);
  });
});

describe("plannedFocusSeconds", () => {
  // Local-midnight anchor keeps expectations timezone-independent.
  const dayStart = parseDate("2026-09-11").getTime();
  const at = (minutes: number, extraMs = 0) =>
    dayStart + minutes * 60_000 + extraMs;
  type FocusWindow = Parameters<typeof plannedFocusSeconds>[0];
  const window = (overrides: Partial<NonNullable<FocusWindow>> = {}) => ({
    due_date: "2026-09-11" as string | null,
    due_time: "10:00" as string | null,
    end_time: "11:00" as string | null,
    ...overrides,
  });

  it("starting before the window counts the full planned span", () => {
    // 10:00–11:00 task started at 09:00 → one hour.
    expect(plannedFocusSeconds(window() as never, at(9 * 60))).toBe(3600);
  });

  it("starting inside the window counts only to the end", () => {
    expect(plannedFocusSeconds(window() as never, at(630))).toBe(1800);
  });

  it("fractional seconds round up to the exact end", () => {
    expect(plannedFocusSeconds(window() as never, at(630, 500))).toBe(1800);
  });

  it("falls back to the default once the window has passed", () => {
    expect(plannedFocusSeconds(window() as never, at(660))).toBe(
      DEFAULT_FOCUS_SECONDS,
    );
    expect(plannedFocusSeconds(window() as never, at(661))).toBe(
      DEFAULT_FOCUS_SECONDS,
    );
  });

  it("falls back to the default without an end time", () => {
    expect(
      plannedFocusSeconds(window({ end_time: null }) as never, at(630)),
    ).toBe(DEFAULT_FOCUS_SECONDS);
    expect(plannedFocusSeconds(null)).toBe(DEFAULT_FOCUS_SECONDS);
  });

  it("end-only tasks count from now", () => {
    const endOnly = window({ due_time: null });
    expect(plannedFocusSeconds(endOnly as never, at(630))).toBe(1800);
    expect(plannedFocusSeconds(endOnly as never, at(661))).toBe(
      DEFAULT_FOCUS_SECONDS,
    );
  });

  it("anchors to today when no date is set", () => {
    const todayStart = parseDate(todayDateString()).getTime();
    const now = todayStart + 630 * 60_000;
    expect(
      plannedFocusSeconds(
        { due_date: null, due_time: "10:00", end_time: "11:00" },
        now,
      ),
    ).toBe(1800);
  });

  it("wraps past-midnight ends to the following day", () => {
    const task = window({ due_time: "23:30", end_time: "00:30" });
    expect(plannedFocusSeconds(task as never, at(23 * 60 + 30))).toBe(3600);
  });
});
