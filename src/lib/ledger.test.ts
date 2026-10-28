import { describe, expect, it } from "vitest";
import { monthRange, parseAmountToCents, pickTrendWindow } from "@/lib/db/ledger";
import { readFileSync } from "node:fs";

describe("ledger amount", () => {
  it("converts decimal text without floating point rounding", () => {
    expect(parseAmountToCents("12.3")).toBe(1230);
    expect(parseAmountToCents("0.01")).toBe(1);
    expect(parseAmountToCents("99999999.99")).toBe(9_999_999_999);
  });

  it("rejects zero, negatives, scientific notation and excessive digits", () => {
    for (const value of ["0", "-1", "1e3", "1.234", "100000000", ".5", "01"]) {
      expect(parseAmountToCents(value)).toBeNull();
    }
  });
});

describe("ledger month range", () => {
  it("crosses year boundaries", () => {
    expect(monthRange("2026-12")).toEqual(["2026-12-01", "2027-01-01"]);
  });
  it("allows future dates and validates category kind on both write paths", () => {
    const source = readFileSync("src/lib/db/ledger.ts", "utf8");
    expect(source.match(/记账日期不能晚于今天/g)?.length ?? 0).toBe(0);
    expect(source.match(/记账日期格式无效/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/category\[0\]\.kind !== draft\.kind/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("pickTrendWindow", () => {
  const active = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

  it("浏览窗中段月份时窗不动:6 个有账月一个不少,浏览月不被钉在最右", () => {
    // 浏览 6 月:近 6 月(01–06)只剩 2 个有账月;摆成 05–10 则有 6 个,且仍含 6 月。
    expect(pickTrendWindow(active, "2026-06")).toBe("2026-10");
    expect(pickTrendWindow(active, "2026-08")).toBe("2026-10");
  });

  it("浏览最新月即旧的近 6 月窗", () => {
    expect(pickTrendWindow(active, "2026-10")).toBe("2026-10");
  });

  it("切到窗外的更早月份,窗整体平移把有账月拉满", () => {
    expect(pickTrendWindow(active, "2026-03")).toBe("2026-08"); // 03–08 含 4 个有账月
    expect(pickTrendWindow(active, "2026-01")).toBe("2026-06"); // 01–06 含 2 个
  });

  it("平局退回浏览月靠右(旧的截至浏览月口径)", () => {
    expect(pickTrendWindow(["2026-01", "2026-08"], "2026-08")).toBe("2026-08");
    expect(pickTrendWindow([], "2026-05")).toBe("2026-05");
  });

  it("跨年平移", () => {
    expect(pickTrendWindow(["2025-11", "2025-12", "2026-01"], "2025-12")).toBe("2026-01");
  });
});
