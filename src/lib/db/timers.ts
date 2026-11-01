import type {
  FocusTaskDraft,
  FocusTaskMode,
  Timer,
  TimerDraft,
} from "@/types";
import { createId, nowIso } from "@/lib/dates";
import { getDb } from "./client";

/* FocusLogs / 专注完成流水（本地表，不进同步与备份） */

/** 点「完成」落账后记一行流水；写失败只留控制台噪音，不打断专注收尾。 */
export async function logFocusSession(entry: {
  title: string;
  mode: FocusTaskMode;
  taskId: string | null;
  endedAt: string;
  durationSec: number;
}): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO focus_logs (id, title, mode, task_id, ended_at, duration_sec, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      createId(),
      entry.title,
      entry.mode,
      entry.taskId,
      entry.endedAt,
      Math.max(0, Math.floor(entry.durationSec)),
      now,
    ],
  );
}

/** 今日（本地日）完成的专注段数——ended_at 按本地零点到次日零点圈窗。 */
export async function countFocusToday(nowMs = Date.now()): Promise<number> {
  const db = await getDb();
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) count FROM focus_logs WHERE ended_at >= $1 AND ended_at < $2",
    [start.toISOString(), end.toISOString()],
  );
  return Number(rows[0]?.count ?? 0);
}

/* Timers / 专注计时 */
function mapTimer(row: Timer): Timer {
  return {
    ...row,
    kind: "task",
    ends_at: row.ends_at ?? null,
    last_fired_at: row.last_fired_at ?? null,
    task_mode: (row.task_mode as FocusTaskMode) ?? "none",
    task_ref_id: row.task_ref_id ?? null,
    task_draft: row.task_draft ?? null,
    running: Number(row.running) ? 1 : 0,
    enabled: Number(row.enabled) ? 1 : 0,
  };
}

export async function fetchTimers(): Promise<Timer[]> {
  const db = await getDb();
  const rows = await db.select<Timer[]>(
    "SELECT * FROM timers ORDER BY running DESC, updated_at DESC",
  );
  return rows.map(mapTimer);
}

export async function createTimer(draft: TimerDraft): Promise<Timer> {
  const db = await getDb();
  const now = nowIso();
  const start = Boolean(draft.start);
  const endsAt = start
    ? new Date(Date.now() + draft.interval_sec * 1000).toISOString()
    : null;
  const timer: Timer = {
    id: createId(),
    kind: draft.kind,
    title: draft.title.trim() || "专注",
    interval_sec: Math.max(5, Math.floor(draft.interval_sec)),
    remaining_sec: Math.max(5, Math.floor(draft.interval_sec)),
    running: start ? 1 : 0,
    enabled: 1,
    ends_at: endsAt,
    last_fired_at: null,
    task_mode: draft.taskMode ?? "none",
    task_ref_id: draft.taskMode === "existing" ? (draft.taskRefId ?? null) : null,
    task_draft:
      draft.taskMode === "new" && draft.taskDraft
        ? JSON.stringify(draft.taskDraft)
        : null,
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    `INSERT INTO timers (
      id, kind, title, interval_sec, remaining_sec, running, enabled,
      ends_at, last_fired_at, task_mode, task_ref_id, task_draft,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      timer.id,
      timer.kind,
      timer.title,
      timer.interval_sec,
      timer.remaining_sec,
      timer.running,
      timer.enabled,
      timer.ends_at,
      timer.last_fired_at,
      timer.task_mode,
      timer.task_ref_id,
      timer.task_draft,
      timer.created_at,
      timer.updated_at,
    ],
  );
  return timer;
}

export async function updateTimer(
  id: string,
  patch: Partial<
    Pick<
      Timer,
      | "title"
      | "interval_sec"
      | "remaining_sec"
      | "running"
      | "enabled"
      | "ends_at"
      | "last_fired_at"
      | "task_mode"
      | "task_ref_id"
      | "task_draft"
    >
  >,
): Promise<Timer | null> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const current = mapTimer(rows[0]);
  const next: Timer = {
    ...current,
    ...patch,
    updated_at: nowIso(),
  };
  if (patch.interval_sec != null) {
    next.interval_sec = Math.max(5, Math.floor(patch.interval_sec));
  }
  await db.execute(
    `UPDATE timers SET
      title=$1, interval_sec=$2, remaining_sec=$3, running=$4, enabled=$5,
      ends_at=$6, last_fired_at=$7, task_mode=$8, task_ref_id=$9, task_draft=$10,
      updated_at=$11
    WHERE id=$12`,
    [
      next.title,
      next.interval_sec,
      next.remaining_sec,
      next.running,
      next.enabled,
      next.ends_at,
      next.last_fired_at,
      next.task_mode,
      next.task_ref_id,
      next.task_draft,
      next.updated_at,
      id,
    ],
  );
  return next;
}

export async function deleteTimer(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM timers WHERE id=$1", [id]);
}

/** 倒计时互斥（真机第六轮反馈：同一时间只允许一个倒计时运作）。
 *  暂停 id 之外所有运行中的倒计时，remaining_sec 按各自 ends_at 结算，
 *  与手动暂停同语义；循环提醒（interval）不受限。返回被暂停的名称。 */
export async function pauseOtherRunningCountdowns(
  exceptId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<Timer[]>(
    "SELECT * FROM timers WHERE kind='task' AND running=1 AND id<>$1",
    [exceptId],
  );
  if (!rows.length) return [];
  const titles: string[] = [];
  for (const row of rows) {
    const paused = await pauseTimer(row.id);
    if (paused) titles.push(paused.title);
  }
  return titles;
}

export async function startTimer(
  id: string,
): Promise<{ timer: Timer | null; pausedTitles: string[] }> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return { timer: null, pausedTitles: [] };
  const current = mapTimer(rows[0]);
  // 倒计时（kind=task）启动前先暂停其余运行中的倒计时，保证单实例。
  const pausedTitles =
    current.kind === "task" ? await pauseOtherRunningCountdowns(id) : [];
  const remaining = Math.max(5, current.remaining_sec || current.interval_sec);
  const timer = await updateTimer(id, {
    running: 1,
    enabled: 1,
    remaining_sec: remaining,
    ends_at: new Date(Date.now() + remaining * 1000).toISOString(),
  });
  return { timer, pausedTitles };
}

export async function pauseTimer(id: string): Promise<Timer | null> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const current = mapTimer(rows[0]);
  let remaining = current.remaining_sec;
  if (current.running && current.ends_at) {
    const end = Date.parse(current.ends_at);
    if (!Number.isNaN(end)) {
      remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
  }
  return updateTimer(id, {
    running: 0,
    remaining_sec: remaining,
    ends_at: null,
  });
}

export async function resetTimer(id: string): Promise<Timer | null> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const current = mapTimer(rows[0]);
  return updateTimer(id, {
    running: 0,
    remaining_sec: current.interval_sec,
    ends_at: null,
  });
}

export async function extendTimer(
  id: string,
  additionalSec: number,
): Promise<Timer | null> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const current = mapTimer(rows[0]);
  const added = Math.max(5, Math.floor(additionalSec));
  const remaining = liveRemainingForUpdate(current) + added;
  return updateTimer(id, {
    remaining_sec: remaining,
    ends_at: current.running
      ? new Date(Date.now() + remaining * 1000).toISOString()
      : null,
  });
}

function liveRemainingForUpdate(timer: Timer): number {
  if (timer.running && timer.ends_at) {
    const end = Date.parse(timer.ends_at);
    if (!Number.isNaN(end)) {
      return Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
  }
  return Math.max(0, timer.remaining_sec);
}

/** 编辑一场专注：标题、关联与时长一起改。时长调整保留已专注的时长——
 *  剩余 = 现剩余 + (新时长 − 旧时长)，运行中的 ends_at 随之平移，剩余至少 1 分钟；
 *  已结束的段只改标题与时长记录，不复活倒计时。 */
export async function editFocus(
  id: string,
  patch: {
    title: string;
    interval_sec: number;
    task_mode: FocusTaskMode;
    task_ref_id: string | null;
    task_draft: FocusTaskDraft | null;
  },
): Promise<Timer | null> {
  const db = await getDb();
  const rows = await db.select<Timer[]>("SELECT * FROM timers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const current = mapTimer(rows[0]);
  const intervalSec = Math.max(60, Math.floor(patch.interval_sec));
  const live = liveRemainingForUpdate(current);
  const finished = !current.running && live === 0;
  // 已结束的段视作「补记」：只改标题与记录时长，不再复活剩余秒；
  // 进行/暂停中的段按差值平移，已专注的时长保持不变。
  const remaining = finished
    ? 0
    : Math.min(intervalSec, Math.max(60, live + intervalSec - current.interval_sec));
  return updateTimer(id, {
    title: patch.title.trim() || "专注",
    interval_sec: intervalSec,
    remaining_sec: remaining,
    ends_at: current.running
      ? new Date(Date.now() + remaining * 1000).toISOString()
      : null,
    task_mode: patch.task_mode,
    task_ref_id: patch.task_mode === "existing" ? patch.task_ref_id : null,
    task_draft: patch.task_mode === "new" && patch.task_draft
      ? JSON.stringify(patch.task_draft)
      : null,
  });
}

export type FiredTimer = {
  timer: Timer;
  /** 预留：历史上循环提醒会自动续期。专注任务只停机，恒为 false。 */
  looped: boolean;
};

/** 结算到点的专注任务：停止计时并落终态（remaining 0、记录完成时刻）。 */
export async function settleExpiredTimers(): Promise<FiredTimer[]> {
  const db = await getDb();
  const timers = (
    await db.select<Timer[]>(
      "SELECT * FROM timers WHERE running = 1 AND enabled = 1",
    )
  ).map(mapTimer);
  const now = Date.now();
  const fired: FiredTimer[] = [];

  for (const timer of timers) {
    if (!timer.running || !timer.enabled || !timer.ends_at) continue;
    const end = Date.parse(timer.ends_at);
    if (Number.isNaN(end) || end > now) continue;

    const stamp = nowIso();
    const next = await updateTimer(timer.id, {
      running: 0,
      remaining_sec: 0,
      ends_at: null,
      last_fired_at: stamp,
    });
    if (next) fired.push({ timer: next, looped: false });
  }

  return fired;
}
