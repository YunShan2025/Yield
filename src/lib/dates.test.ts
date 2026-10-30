import { describe, expect, it } from "vitest";
import { formatDueDateBadge, formatIsoTime, formatDateBrief, formatStamp, formatStampBrief } from "@/lib/dates";

describe("formatIsoTime", () => {
  it("formats local HH:mm from an ISO timestamp", () => {
    // 先用本地时间构造 ISO,再格式化回本地时分,往返应一致(与时区无关)。
    const iso = new Date(2026, 8, 12, 14, 5).toISOString();
    expect(formatIsoTime(iso)).toBe("14:05");
  });

  it("returns empty for missing or invalid values", () => {
    expect(formatIsoTime(null)).toBe("");
    expect(formatIsoTime(undefined)).toBe("");
    expect(formatIsoTime("")).toBe("");
    expect(formatIsoTime("not-a-date")).toBe("");
  });
});

describe("formatStamp", () => {
  it("formats local date and HH:mm from an ISO timestamp", () => {
    // toISOString 往返不丢时区信息,断言可用本地字面量。
    const iso = new Date(2026, 8, 12, 14, 5).toISOString();
    expect(formatStamp(iso)).toBe("2026年9月12日 14:05");
  });

  it("returns empty for invalid values", () => {
    expect(formatStamp("")).toBe("");
    expect(formatStamp("not-a-date")).toBe("");
  });
});

describe("formatStampBrief / formatDateBrief", () => {
  it("当年省年份", () => {
    const y = new Date().getFullYear();
    expect(formatStampBrief(new Date(y, 9, 20, 1, 3).toISOString())).toBe("10月20日 01:03");
    expect(formatDateBrief(`${y}-10-20`)).toBe("10月20日");
  });

  it("跨年带年份，非法值给空串", () => {
    const last = new Date().getFullYear() - 1;
    expect(formatStampBrief(new Date(last, 9, 20, 1, 3).toISOString())).toBe(`${last}年10月20日 01:03`);
    expect(formatDateBrief(`${last}-10-20`)).toBe(`${last}年10月20日`);
    expect(formatStampBrief("not-a-date")).toBe("");
    expect(formatDateBrief("")).toBe("");
  });
});

describe("formatDueDateBadge", () => {
  // 2026-10-23 是周五。
  const today = "2026-10-23";

  it("labels undated and invalid tasks as unscheduled", () => {
    expect(formatDueDateBadge(null, today)).toEqual({
      label: "未安排",
      tone: "none",
      title: "无截止日期",
    });
    expect(formatDueDateBadge("2026-02-30", today)).toEqual({
      label: "未安排",
      tone: "none",
      title: "无截止日期",
    });
  });

  it("counts overdue days", () => {
    expect(formatDueDateBadge("2026-10-20", today)).toEqual({
      label: "逾期 3 天",
      tone: "overdue",
      title: "截止 2026年10月20日",
    });
  });

  it("uses relative labels for today, tomorrow and the day after", () => {
    expect(formatDueDateBadge("2026-10-23", today)).toMatchObject({
      label: "今天",
      tone: "today",
    });
    expect(formatDueDateBadge("2026-10-24", today)).toMatchObject({
      label: "明天",
      tone: "soon",
    });
    expect(formatDueDateBadge("2026-10-25", today)).toMatchObject({
      label: "后天",
      tone: "soon",
    });
  });

  it("uses weekday names within the next six days", () => {
    expect(formatDueDateBadge("2026-10-26", today)).toMatchObject({
      label: "周一",
      tone: "soon",
    });
    expect(formatDueDateBadge("2026-10-29", today)).toMatchObject({
      label: "周四",
      tone: "soon",
    });
  });

  it("keeps concrete dates beyond the week but folds them into the soon style", () => {
    // 用户定稿：统一的是样式不是文案——跨周仍显示具体日期,但并入当周蓝档。
    expect(formatDueDateBadge("2026-10-30", today)).toMatchObject({
      label: "10月30日",
      tone: "soon",
      title: "截止 2026年10月30日",
    });
    expect(formatDueDateBadge("2027-01-03", today)).toMatchObject({
      label: "2027年1月3日",
      tone: "soon",
    });
  });
});
