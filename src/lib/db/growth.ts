import type { Goal, GoalEntry, GoalStatus } from "@/types";
import { createId, nowIso, todayDateString } from "@/lib/dates";
import { goalAcceptsSource } from "@/lib/growth";
import { getDb } from "./client";

/* Growth goals and contributions */
/**
 * 目标列表。默认只给"还在进行"的（进行中 + 暂停）——已完成的收进完成区，
 * 不在主列表里，与项目 / 习惯的"已归档"分区同一套做法。
 * includeFinished = true 时给全部未删除的目标。
 */
export async function fetchGoals(includeFinished = false): Promise<Goal[]> {
  const db = await getDb();
  return db.select<Goal[]>(
    `SELECT * FROM goals
     WHERE deleted_at IS NULL ${includeFinished ? "" : "AND status IN ('active','paused')"}
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
              updated_at DESC`,
  );
}

/** 备份用：连同归档与回收站里的目标一起导出，不丢用户数据。 */
export async function fetchAllGoals(): Promise<Goal[]> {
  const db = await getDb();
  return db.select<Goal[]>(
    "SELECT * FROM goals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC",
  );
}

/** 回收站里的目标。 */
export async function fetchDeletedGoals(): Promise<Goal[]> {
  const db = await getDb();
  return db.select<Goal[]>(
    "SELECT * FROM goals WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
  );
}

/** 删除目标 = 移入回收站，可恢复。 */
export async function softDeleteGoal(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE goals SET deleted_at=$1, updated_at=$2 WHERE id=$3 AND deleted_at IS NULL",
    [nowIso(), nowIso(), id],
  );
}

/** 从回收站恢复目标。 */
export async function restoreGoal(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE goals SET deleted_at=NULL, updated_at=$1 WHERE id=$2",
    [nowIso(), id],
  );
}

/**
 * 永久删除目标，连同它的记录一起清掉——不留孤儿数据。
 */
export async function purgeGoal(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM goal_entries WHERE goal_id=$1", [id]);
  await db.execute("DELETE FROM goals WHERE id=$1", [id]);
}

export async function createGoal(
  draft: Partial<Goal> & Pick<Goal, "title">,
): Promise<Goal> {
  const db = await getDb();
  const stamp = nowIso();
  const goal: Goal = {
    id: createId(),
    title: draft.title.trim(),
    color: draft.color ?? "#2F6FED",
    goal_type: draft.goal_type ?? "milestone",
    start_date: draft.start_date ?? todayDateString(),
    target_date: draft.target_date ?? null,
    start_value: Number(draft.start_value ?? 0),
    target_value: Math.max(1, Number(draft.target_value ?? 1)),
    current_value: Number(draft.current_value ?? draft.start_value ?? 0),
    unit: draft.unit?.trim() || "次",
    status: draft.status ?? "active",
    motivation: draft.motivation?.trim() ?? "",
    manual_completion: draft.status === "completed" ? 1 : 0,
    deleted_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
  await db.execute(
    `INSERT INTO goals
     (id,title,color,goal_type,start_date,target_date,start_value,
      target_value,current_value,unit,status,motivation,
      manual_completion,deleted_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      goal.id, goal.title, goal.color,
      goal.goal_type, goal.start_date, goal.target_date, goal.start_value,
      goal.target_value, goal.current_value, goal.unit, goal.status,
      goal.motivation, goal.manual_completion, goal.deleted_at ?? null,
      goal.created_at, goal.updated_at,
    ],
  );
  return goal;
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>,
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<Goal[]>("SELECT * FROM goals WHERE id=$1", [id]);
  if (!rows[0]) return;
  const next = {
    ...rows[0],
    ...updates,
    manual_completion: updates.status === "completed"
      ? 1
      : updates.status !== undefined
        ? 0
        : rows[0].manual_completion ?? 0,
    updated_at: nowIso(),
  };
  await db.execute(
    `UPDATE goals SET title=$1,color=$2,goal_type=$3,
     start_date=$4,target_date=$5,start_value=$6,target_value=$7,current_value=$8,
     unit=$9,status=$10,motivation=$11,
     manual_completion=$12,updated_at=$13 WHERE id=$14`,
    [
      next.title, next.color, next.goal_type,
      next.start_date, next.target_date, next.start_value, next.target_value,
      next.current_value, next.unit, next.status, next.motivation,
      next.manual_completion, next.updated_at, id,
    ],
  );
}

export async function fetchGoalEntries(goalId?: string): Promise<GoalEntry[]> {
  const db = await getDb();
  return goalId
    ? db.select<GoalEntry[]>(
        "SELECT * FROM goal_entries WHERE goal_id=$1 ORDER BY entry_date DESC, created_at DESC",
        [goalId],
      )
    : db.select<GoalEntry[]>(
        "SELECT * FROM goal_entries ORDER BY entry_date DESC, created_at DESC",
      );
}

/** 与 tauri 连接池结构一致的最小 SQL 接口：同步层用自己的连接复算进度。 */
export interface SqlDb {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

export async function refreshGoalProgress(goalId: string): Promise<void> {
  await refreshGoalProgressOn(await getDb(), goalId);
}

/**
 * 进度重算（可注入连接版）。
 * skipUnchanged：派生值没变就整行不写。同步合并后的复算必须开着它——
 * 否则每轮同步都给每个目标刷一次 updated_at，白更新的行会被推给对端，
 * 两端互相刷新、永远静不下来。
 * 返回是否真的改动了本机数据。
 */
export async function refreshGoalProgressOn(
  db: SqlDb,
  goalId: string,
  opts: { skipUnchanged?: boolean } = {},
): Promise<boolean> {
  const goalRows = await db.select<Goal[]>("SELECT * FROM goals WHERE id=$1", [goalId]);
  if (!goalRows[0]) return false;
  const goal = goalRows[0];
  let wrote = false;
  const target = Number(goal.target_value);
  let current: number;

  if (goal.goal_type === "measure") {
    // 数值变化型目标：以最近一次手动测量为当前值。
    const latest = await db.select<{ value: number }[]>(
      `SELECT value FROM goal_entries
       WHERE goal_id=$1 AND source_type='manual'
       ORDER BY entry_date DESC, created_at DESC LIMIT 1`,
      [goalId],
    );
    current = latest.length ? Number(latest[0].value) : Number(goal.start_value);
  } else {
    // 数值·次数型目标：起点 + 记录之和。
    const sums = await db.select<{ total: number | null }[]>(
      "SELECT SUM(value) AS total FROM goal_entries WHERE goal_id=$1",
      [goalId],
    );
    current = Number(goal.start_value) + Number(sums[0]?.total ?? 0);
  }

  const reached =
    target >= Number(goal.start_value) ? current >= target : current <= target;
  // 与原先的 CASE 等价：只在 active/completed 之间按达成情况切换，其余状态不动。
  const nextStatus: GoalStatus =
    reached && goal.status === "active"
      ? "completed"
      : !reached && goal.status === "completed" && !goal.manual_completion
        ? "active"
        : goal.status;
  if (
    !opts.skipUnchanged ||
    nextStatus !== goal.status ||
    Math.abs(Number(goal.current_value) - current) > 1e-9 ||
    Math.abs(Number(goal.target_value) - target) > 1e-9
  ) {
    await db.execute(
      "UPDATE goals SET current_value=$1, target_value=$2, status=$3, updated_at=$4 WHERE id=$5",
      [current, target, nextStatus, nowIso(), goalId],
    );
    wrote = true;
  }
  return wrote;
}
export async function recomputeGoalsAfterSync(db: SqlDb): Promise<boolean> {
  const goals = await db.select<{ id: string }[]>("SELECT id FROM goals");
  let changed = false;
  for (const goal of goals) {
    if (await refreshGoalProgressOn(db, goal.id, { skipUnchanged: true })) {
      changed = true;
    }
  }
  return changed;
}

export async function addGoalEntry(
  input: Pick<GoalEntry, "goal_id" | "entry_date" | "value" | "source_type"> &
    Partial<Pick<GoalEntry, "source_id" | "note">>,
): Promise<boolean> {
  const db = await getDb();
  const goals = await db.select<Goal[]>("SELECT * FROM goals WHERE id=$1 LIMIT 1", [input.goal_id]);
  const goal = goals[0];
  if (!goal || !goalAcceptsSource(goal, input.source_type)) return false;
  const result = await db.execute(
    `INSERT OR IGNORE INTO goal_entries
     (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      createId(), input.goal_id, input.entry_date, Number(input.value),
      input.source_type, input.source_id ?? null, input.note?.trim() ?? "", nowIso(), nowIso(),
    ],
  );
  await refreshGoalProgress(input.goal_id);
  return result.rowsAffected > 0;
}

export async function removeGoalEntryBySource(
  goalId: string,
  sourceType: GoalEntry["source_type"],
  sourceId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM goal_entries WHERE goal_id=$1 AND source_type=$2 AND source_id=$3",
    [goalId, sourceType, sourceId],
  );
  await refreshGoalProgress(goalId);
}

/**
 * 按用户输入校准累计型目标的「当前值」，返回是否补了记录。
 *
 * 累计型目标的进度是「基线 + 记录之和」，每次刷新都会按这个口径重算：
 * 直接写 current_value 会被下一次复算覆盖回去，把基线压成负数又会让进度条
 * 的起点跑到零以下。所以差额落成一条手动校准记录——数字改得准，历史上也
 * 留得下这笔账（改小改大都有效）。change / frequency 型不走这套口径，勿用。
 */
export async function setGoalCurrentProgress(
  goalId: string,
  desired: number,
): Promise<boolean> {
  const db = await getDb();
  const goals = await db.select<Goal[]>("SELECT * FROM goals WHERE id=$1 LIMIT 1", [goalId]);
  const goal = goals[0];
  if (!goal) return false;
  const sums = await db.select<{ total: number | null }[]>(
    "SELECT SUM(value) AS total FROM goal_entries WHERE goal_id=$1",
    [goalId],
  );
  const derived = Number(goal.start_value) + Number(sums[0]?.total ?? 0);
  const delta = Number(desired) - derived;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return false;
  const step = Math.round(delta * 100) / 100;
  await db.execute(
    `INSERT INTO goal_entries
     (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'manual',NULL,$5,$6,$7)`,
    [
      createId(), goalId, todayDateString(), step,
      `手动校准 ${step > 0 ? "+" : ""}${step}${goal.unit}`, nowIso(), nowIso(),
    ],
  );
  await refreshGoalProgress(goalId);
  return true;
}
