/**
 * HLC（混合逻辑时钟）——同步日志条目的全序来源。
 *
 * 每个条目带 { p: 物理毫秒, l: 逻辑计数, d: 设备 id }，比较顺序 p → l → d。
 * 双端时钟偏差、同毫秒并发、时钟回拨都通过 max + 计数器保证单调：
 * 本地墙钟回拨不会缩小 p（p 只增不减），合并结果始终确定。
 */

export type Hlc = { p: number; l: number; d: string };

/** 全序比较：p → l → d（设备 id 字典序）。相同条目返回 0。 */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.p !== b.p) return a.p < b.p ? -1 : 1;
  if (a.l !== b.l) return a.l < b.l ? -1 : 1;
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return 0;
}

/** 校验远端日志里的 hlc 字段；结构不合法返回 null（调用方跳过该条）。 */
export function parseHlc(value: unknown): Hlc | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Hlc>;
  if (
    typeof v.p !== "number" || !Number.isFinite(v.p) || v.p < 0 || !Number.isInteger(v.p) ||
    typeof v.l !== "number" || !Number.isFinite(v.l) || v.l < 0 || !Number.isInteger(v.l) ||
    typeof v.d !== "string" || !v.d || v.d.length > 64
  ) {
    return null;
  }
  return { p: v.p, l: v.l, d: v.d };
}

/** 15 位零填充 p + 6 位零填充 l + 设备 id：纯字符串比较即 HLC 顺序。 */
export function hlcToString(h: Hlc): string {
  return `${String(h.p).padStart(15, "0")}:${String(h.l).padStart(6, "0")}:${h.d}`;
}

/** hlcToString 的逆运算；格式不合法返回 null。 */
export function hlcFromString(s: string): Hlc | null {
  const m = /^(\d{15}):(\d{6}):(.+)$/.exec(s);
  if (!m) return null;
  return { p: Number(m[1]), l: Number(m[2]), d: m[3] };
}

export type HlcState = { p: number; l: number };

/**
 * 单设备的 HLC 时钟。状态必须跨重启持久化（见 snapshot/restore），
 * 否则重启后 l 归零、p 回落到当前墙钟，会破坏单调性。
 */
export class HlcClock {
  readonly deviceId: string;
  private p: number;
  private l: number;
  private readonly now: () => number;

  constructor(
    deviceId: string,
    state?: { p: number; l: number } | null,
    now: () => number = Date.now,
  ) {
    if (!deviceId) throw new Error("HLC 需要 deviceId");
    this.deviceId = deviceId;
    this.now = now;
    // 恢复的 p 若超前于当前墙钟（另一端时钟更快或本端回拨），必须保留，
    // 保证新条目不会排在已发出条目之前。
    this.p = Math.max(state?.p ?? 0, now());
    this.l = state?.l ?? 0;
  }

  /** 本地写事件：取 max(自身 p, now)，同毫秒内 l 递增。 */
  tick(tsMs?: number): Hlc {
    const t = tsMs ?? this.now();
    if (t > this.p) {
      this.p = t;
      this.l = 0;
    } else {
      this.l += 1;
    }
    return { p: this.p, l: this.l, d: this.deviceId };
  }

  /** 收到远端条目后推进本地时钟（三值取 max + 计数器规则）。 */
  update(remote: Hlc): Hlc {
    const t = this.now();
    const prev = this.p;
    this.p = Math.max(prev, remote.p, t);
    if (prev === remote.p && this.p === prev) {
      this.l = Math.max(this.l, remote.l) + 1;
    } else if (prev === this.p) {
      this.l = this.l + 1;
    } else if (this.p === remote.p) {
      this.l = remote.l + 1;
    } else {
      this.l = 0;
    }
    return { p: this.p, l: this.l, d: this.deviceId };
  }

  /** 持久化前导出状态。 */
  snapshot(): { p: number; l: number } {
    return { p: this.p, l: this.l };
  }
}
