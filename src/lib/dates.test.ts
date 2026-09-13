import { describe, expect, it } from "vitest";
import { formatIsoTime, formatStamp } from "@/lib/dates";

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
