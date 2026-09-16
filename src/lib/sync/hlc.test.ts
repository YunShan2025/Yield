import { describe, expect, it } from "vitest";
import {
  HlcClock,
  compareHlc,
  hlcFromString,
  hlcToString,
  parseHlc,
  type Hlc,
} from "./hlc";

describe("compareHlc", () => {
  it("按 p → l → d 全序比较", () => {
    const a: Hlc = { p: 100, l: 0, d: "a" };
    expect(compareHlc({ p: 200, l: 0, d: "a" }, a)).toBe(1);
    expect(compareHlc(a, { p: 100, l: 1, d: "a" })).toBeLessThan(0);
    // 同 p 同 l → 设备 id 字典序
    expect(compareHlc({ p: 100, l: 0, d: "b" }, { p: 100, l: 0, d: "a" })).toBe(1);
    expect(compareHlc(a, a)).toBe(0);
  });
});

describe("HlcClock.tick", () => {
  it("同毫秒内连续写入 l 递增，跨毫秒 l 归零", () => {
    const time = fake();
    const clock = new HlcClock("d1", null, time.read);
    const e1 = clock.tick(1000);
    const e2 = clock.tick(1000);
    const e3 = clock.tick(1005);
    expect(e1).toEqual({ p: 1000, l: 0, d: "d1" });
    expect(e2).toEqual({ p: 1000, l: 1, d: "d1" });
    expect(e3).toEqual({ p: 1005, l: 0, d: "d1" });
  });

  it("墙钟回拨时 p 不回退，l 递增保证单调", () => {
    const time = fake();
    const clock = new HlcClock("d1", null, time.read);
    clock.tick(2000);
    const rolled = clock.tick(1500); // 墙钟回拨到 1500
    expect(rolled.p).toBe(2000);
    expect(compareHlc(rolled, { p: 2000, l: 0, d: "d1" })).toBeGreaterThan(0);
    // 回拨期间继续写入仍然单调
    const next = clock.tick(1600);
    expect(compareHlc(next, rolled)).toBeGreaterThan(0);
  });

  it("恢复的 p 超前墙钟时保持超前（对端时钟更快的场景）", () => {
    const time = fake();
    const clock = new HlcClock("d1", { p: 9000, l: 3 }, time.read);
    const e = clock.tick(time.read());
    expect(e.p).toBe(9000);
    expect(e.l).toBe(4);
  });

  it("重启恢复后新条目不落后于已发出的条目", () => {
    const time = fake();
    const c1 = new HlcClock("d1", null, time.read);
    c1.tick(5000);
    // 模拟重启：墙钟回落到 4000
    time.set(4000);
    const c2 = new HlcClock("d1", c1.snapshot(), time.read);
    const next = c2.tick();
    expect(compareHlc(next, { p: 5000, l: 0, d: "d1" })).toBeGreaterThan(0);
  });
});

describe("HlcClock.update（收到远端条目）", () => {
  it("远端时间超前时跳到远端并 l = remote.l + 1", () => {
    const time = fake();
    const clock = new HlcClock("d1", { p: 1000, l: 5 }, time.read);
    const next = clock.update({ p: 9000, l: 2, d: "d2" });
    expect(next.p).toBe(9000);
    expect(next.l).toBe(3);
  });

  it("同毫秒两端并发写时取 max(l)+1", () => {
    const time = fake();
    const clock = new HlcClock("d1", { p: 1000, l: 4 }, time.read);
    const next = clock.update({ p: 1000, l: 7, d: "d2" });
    expect(next.p).toBe(1000);
    expect(next.l).toBe(8);
  });

  it("交错收发保持单调：A→B→A→B 全程递增", () => {
    const a = new HlcClock("a", null, () => 0);
    const b = new HlcClock("b", null, () => 0);
    const seq: Hlc[] = [];
    for (let i = 0; i < 20; i++) {
      seq.push(a.tick(1000 + i * 10));
      seq.push(b.update(seq[seq.length - 1]));
      seq.push(b.tick(1000 + i * 10));
      seq.push(a.update(seq[seq.length - 1]));
    }
    for (let i = 1; i < seq.length; i++) {
      expect(compareHlc(seq[i], seq[i - 1])).toBeGreaterThan(0);
    }
  });

  it("远端时钟大幅超前后本地回拨，时钟仍单调", () => {
    const time = fake();
    const a = new HlcClock("a", null, time.read);
    a.tick(1000);
    const received = a.update({ p: 999_000, l: 0, d: "b" });
    expect(received.p).toBe(999_000);
    // 之后墙钟回拨，新条目仍排在 received 之后
    const next = a.tick(1_000);
    expect(compareHlc(next, received)).toBeGreaterThan(0);
  });
});

describe("编码与解析", () => {
  it("hlcToString 字符串序与 compareHlc 一致", () => {
    const samples: Hlc[] = [
      { p: 999, l: 0, d: "a" },
      { p: 1000, l: 0, d: "b" },
      { p: 1000, l: 99, d: "a" },
      { p: 1000, l: 100, d: "a" },
      { p: 1_700_000_000_000, l: 42, d: "android-01" },
    ];
    const sorted = [...samples].sort(compareHlc);
    const byString = [...samples].map(hlcToString).sort();
    expect(byString).toEqual(sorted.map(hlcToString));
  });

  it("hlcFromString 往返无损", () => {
    const h: Hlc = { p: 1_757_820_000_000, l: 3, d: "desktop-a1b2" };
    expect(hlcFromString(hlcToString(h))).toEqual(h);
  });

  it("hlcFromString 拒绝坏格式", () => {
    expect(hlcFromString("nope")).toBeNull();
    expect(hlcFromString("1:2:3")).toBeNull();
  });

  it("parseHlc 校验远端字段结构", () => {
    expect(parseHlc({ p: 1, l: 0, d: "a" })).toEqual({ p: 1, l: 0, d: "a" });
    expect(parseHlc(null)).toBeNull();
    expect(parseHlc({ p: -1, l: 0, d: "a" })).toBeNull();
    expect(parseHlc({ p: 1.5, l: 0, d: "a" })).toBeNull();
    expect(parseHlc({ p: 1, l: 1.5, d: "a" })).toBeNull();
    expect(parseHlc({ p: 1, l: 0, d: "" })).toBeNull();
    expect(parseHlc({ p: 1, l: 0, d: 42 })).toBeNull();
  });
});

function fake() {
  let t = 0;
  return { read: () => t, set: (v: number) => (t = v) };
}
