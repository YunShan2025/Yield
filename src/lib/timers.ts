import type { Timer } from "@/types";

export function formatCountdown(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Remaining seconds from ends_at (or stored remaining_sec if paused). */
export function liveRemaining(timer: Timer, nowMs = Date.now()): number {
  if (timer.running && timer.ends_at) {
    const end = Date.parse(timer.ends_at);
    if (!Number.isNaN(end)) {
      return Math.max(0, Math.ceil((end - nowMs) / 1000));
    }
  }
  return Math.max(0, timer.remaining_sec);
}

/** Earliest due time among running timers, or null if none are counting down. */
export function nextRunningTimerDueAt(
  timers: readonly Timer[],
  nowMs = Date.now(),
): number | null {
  let next: number | null = null;
  for (const timer of timers) {
    if (!timer.running || !timer.enabled || !timer.ends_at) continue;
    const end = Date.parse(timer.ends_at);
    if (Number.isNaN(end)) continue;
    if (next == null || end < next) next = end;
  }
  if (next == null) return null;
  return Math.max(nowMs, next) === next ? next : nowMs;
}

export function intervalLabel(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec % 3600 === 0) return `${sec / 3600} 小时`;
  if (sec % 60 === 0) return `${sec / 60} 分钟`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} 分 ${s} 秒`;
}
