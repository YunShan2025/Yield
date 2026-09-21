import type {
  Task,
  TaskDraft,
  TaskUpdate,
} from "@/types";
import {
  addMinutesToTime,
  createId,
  ensureEndAfterStart,
  nowIso,
  nowTimeString,
  todayDateString,
} from "@/lib/dates";
import { localDateKey } from "@/lib/growth";
import { getDb, mapTask, saveTaskPlanningMetadata, TASK_SELECT, withTransaction } from "./client";
import { linkTag } from "./taxonomy";
import { addGoalEntry, refreshGoalProgress, refreshProjectGoals, removeGoalEntryBySource } from "./growth";
import { getSetting, setSetting } from "./settings";
import { isRecyclableGeneratedTask, nextOccurrence, nextRepeatTaskDraft } from "@/lib/repeat";
import { expandIdsWithChildren, selectRestoreIds } from "@/lib/taskTree";

export async function fetchTasks(includeDeleted = false): Promise<Task[]> {
  const db = await getDb();
  const query = includeDeleted
    ? `${TASK_SELECT} ORDER BY tasks.sort_order ASC, tasks.created_at DESC`
    : `${TASK_SELECT} WHERE tasks.deleted_at IS NULL ORDER BY tasks.sort_order ASC, tasks.created_at DESC`;
  const rows = await db.select<Task[]>(query);
  return rows.map(mapTask);
}

export async function fetchTrashTasks(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.select<Task[]>(
    `${TASK_SELECT} WHERE tasks.deleted_at IS NOT NULL ORDER BY tasks.deleted_at DESC`,
  );
  return rows.map(mapTask);
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  return withTransaction(() => createTaskWithinTransaction(draft));
}

async function createTaskWithinTransaction(draft: TaskDraft): Promise<Task> {
  const db = await getDb();
  const timestamp = nowIso();
  const isSubtask = Boolean(draft.parent_id);
  let start: string | null;
  let end: string | null;
  if (isSubtask) {
    start = draft.due_time ?? null;
    end = draft.end_time ?? null;
  } else if (!draft.due_date) {
    // 无截止日期的任务(如从待办箱新建)处于未安排状态,不自动排时间。
    start = draft.due_time ?? null;
    end = draft.end_time ?? null;
  } else {
    start =
      draft.due_time === undefined || draft.due_time === null || draft.due_time === ""
        ? nowTimeString()
        : draft.due_time;
    end =
      draft.end_time === undefined || draft.end_time === null || draft.end_time === ""
        ? addMinutesToTime(start, 60)
        : ensureEndAfterStart(start, draft.end_time);
  }

  const task: Task = {
    id: createId(),
    title: draft.title.trim(),
    description: draft.description?.trim() ?? "",
    notes: draft.notes?.trim() ?? "",
    priority: draft.priority ?? 3,
    status: "pending",
    due_date: draft.due_date === undefined ? todayDateString() : draft.due_date,
    due_time: start,
    end_time: end,
    sort_order: Date.now(),
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
    deleted_at: null,
    parent_id: draft.parent_id ?? null,
    repeat_rule: draft.repeat_rule ?? null,
    reminder_minutes: draft.reminder_minutes ?? [],
    project_id: draft.project_id ?? null,
    blocked_by_id: draft.blocked_by_id ?? null,
    completion_criteria: draft.completion_criteria ?? "",
    energy_level: draft.energy_level ?? "medium",
    flexible: draft.flexible ?? 1,
    schedule_locked: draft.schedule_locked ?? 0,
    actual_minutes: 0,
    goal_id: draft.goal_id ?? null,
    goal_contribution: draft.goal_contribution ?? 1,
    generated_from_id: draft.generated_from_id ?? null,
  };

  await db.execute(
    `INSERT INTO tasks (
      id, title, description, notes, priority, status,
      due_date, due_time, end_time, sort_order, created_at, updated_at,
      completed_at, deleted_at, parent_id, repeat_rule,
      project_id,
      blocked_by_id, completion_criteria, energy_level, flexible, schedule_locked,
      actual_minutes, goal_id, goal_contribution, generated_from_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [
      task.id,
      task.title,
      task.description,
      task.notes,
      task.priority,
      task.status,
      task.due_date,
      task.due_time,
      task.end_time,
      task.sort_order,
      task.created_at,
      task.updated_at,
      task.completed_at,
      task.deleted_at,
      task.parent_id,
      task.repeat_rule,
      task.project_id,
      task.blocked_by_id,
      task.completion_criteria,
      task.energy_level,
      task.flexible,
      task.schedule_locked,
      task.actual_minutes,
      task.goal_id,
      task.goal_contribution,
      task.generated_from_id,
    ],
  );
  await saveTaskPlanningMetadata(task);
  await recordTaskEvent(task.id, "created", null, task);

  if (draft.tagIds?.length) {
    for (const tagId of draft.tagIds) {
      await linkTag(task.id, tagId);
    }
  }

  return task;
}

export async function updateTask(
  id: string,
  updates: TaskUpdate,
): Promise<Task | null> {
  return withTransaction(async () => {
    const { task } = await updateTaskWithinTransaction(id, updates);
    return task;
  });
}

/**
 * Apply many independent updates inside one serialized batch so callers (day
 * close, batch defer) pay one data-change emit instead of one per task.
 * Reuses updateTaskWithinTransaction so events, repeat spawning and goal
 * bookkeeping keep working; sqlx pooling prevents a real SQL transaction.
 */
export async function applyTaskUpdatesBatch(
  items: { id: string; updates: TaskUpdate }[],
): Promise<Task[]> {
  return withTransaction(async () => {
    const updated: Task[] = [];
    for (const item of items) {
      const { task } = await updateTaskWithinTransaction(item.id, item.updates);
      if (task) updated.push(task);
    }
    return updated;
  });
}

async function updateTaskWithinTransaction(
  id: string,
  updates: TaskUpdate,
): Promise<{ task: Task | null; spawned: Task | null }> {
  const db = await getDb();
  const existing = await db.select<Task[]>(
    `${TASK_SELECT} WHERE tasks.id = $1 LIMIT 1`,
    [id],
  );
  if (existing.length === 0) return { task: null, spawned: null };

  const current = mapTask(existing[0]);
  if (updates.status === "completed" && current.status !== "completed") {
    if (current.blocked_by_id) {
      const blocker = await db.select<{ status: string; deleted_at: string | null }[]>(
        "SELECT status, deleted_at FROM tasks WHERE id=$1 LIMIT 1",
        [current.blocked_by_id],
      );
      if (blocker[0] && !blocker[0].deleted_at && blocker[0].status !== "completed") {
        throw new Error("前置任务尚未完成，暂时不能完成此任务");
      }
    }
    const openChildren = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) count FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')",
      [id],
    );
    if ((openChildren[0]?.count ?? 0) > 0) {
      throw new Error("请先完成或取消全部子任务");
    }
  }
  const next: Task = {
    ...current,
    ...updates,
    updated_at: nowIso(),
  };

  if (updates.status === "completed" && current.status !== "completed") {
    next.completed_at = nowIso();
  }
  if (current.status === "completed" && next.status !== "completed") {
    next.completed_at = null;
  }
  // 显式修改完成时间（任务保持 completed）：只允许改时刻，不改状态。
  if (
    updates.completed_at !== undefined &&
    current.status === "completed" &&
    next.status === "completed"
  ) {
    next.completed_at = updates.completed_at;
  }

  await db.execute(
    `UPDATE tasks SET
      title=$1, description=$2, notes=$3, priority=$4, status=$5,
      due_date=$6, due_time=$7, end_time=$8, updated_at=$9, completed_at=$10,
      parent_id=$11, repeat_rule=$12, sort_order=$13,
      project_id=$14, blocked_by_id=$15,
      completion_criteria=$16, energy_level=$17, flexible=$18,
      schedule_locked=$19, actual_minutes=$20, goal_id=$21, goal_contribution=$22
    WHERE id=$23`,
    [
      next.title,
      next.description,
      next.notes,
      next.priority,
      next.status,
      next.due_date,
      next.due_time,
      next.end_time,
      next.updated_at,
      next.completed_at,
      next.parent_id,
      next.repeat_rule,
      next.sort_order,
      next.project_id,
      next.blocked_by_id,
      next.completion_criteria,
      next.energy_level,
      next.flexible,
      next.schedule_locked,
      next.actual_minutes,
      next.goal_id,
      next.goal_contribution,
      id,
    ],
  );
  await saveTaskPlanningMetadata(next);
  await recordTaskEvent(id, "updated", current, next);
  const goalLinkChanged =
    current.goal_id !== next.goal_id ||
    current.goal_contribution !== next.goal_contribution;
  if (current.status === "completed" && goalLinkChanged && current.goal_id) {
    await removeGoalEntryBySource(current.goal_id, "task", current.id);
  }
  if (
    next.goal_id &&
    next.status === "completed" &&
    (current.status !== "completed" || goalLinkChanged)
  ) {
    await addGoalEntry({
      goal_id: next.goal_id,
      entry_date: localDateKey(new Date(next.completed_at ?? nowIso())),
      value: next.goal_contribution || 1,
      source_type: "task",
      source_id: next.id,
      note: next.title,
    });
  } else if (current.goal_id && current.status === "completed" && next.status !== "completed") {
    await removeGoalEntryBySource(current.goal_id, "task", current.id);
  } else if (
    next.goal_id &&
    next.status === "completed" &&
    updates.completed_at !== undefined &&
    updates.completed_at !== current.completed_at
  ) {
    // 完成时间被修改：把目标贡献记录挪到新的完成日期。
    await removeGoalEntryBySource(next.goal_id, "task", next.id);
    await addGoalEntry({
      goal_id: next.goal_id,
      entry_date: localDateKey(new Date(next.completed_at ?? nowIso())),
      value: next.goal_contribution || 1,
      source_id: next.id,
      source_type: "task",
      note: next.title,
    });
  }
  const affectedProjectIds = new Set(
    [current.project_id, next.project_id].filter((value): value is string => Boolean(value)),
  );
  for (const projectId of affectedProjectIds) {
    await refreshProjectGoals(projectId);
  }

  let spawned: Task | null = null;
  if (current.status === "completed" && next.status !== "completed") {
    await recycleGeneratedOccurrences(current);
  } else if (current.status !== "completed" && next.status === "completed") {
    spawned = await spawnRepeatOccurrence(current);
  }

  if (next.parent_id && current.status !== next.status) {
    const parents = await db.select<Task[]>(`${TASK_SELECT} WHERE tasks.id=$1 LIMIT 1`, [next.parent_id]);
    const parent = parents[0] ? mapTask(parents[0]) : null;
    if (parent) {
      if (next.status === "completed" && parent.status !== "completed") {
        const remaining = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) count FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')",
          [parent.id],
        );
        if ((remaining[0]?.count ?? 0) === 0) await updateTaskWithinTransaction(parent.id, { status: "completed" });
      } else if (current.status === "completed" && next.status !== "completed" && parent.status === "completed") {
        await updateTaskWithinTransaction(parent.id, { status: "pending" });
      }
    }
  }

  return { task: next, spawned };
}

export async function recordTaskEvent(
  taskId: string,
  eventType: string,
  before: unknown,
  after: unknown,
  note = "",
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_events
      (id, task_id, event_type, before_json, after_json, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      createId(),
      taskId,
      eventType,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      note,
      nowIso(),
    ],
  );
}

export async function reorderTasks(
  orderedIds: string[],
): Promise<void> {
  const db = await getDb();
  const base = Date.now();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute("UPDATE tasks SET sort_order=$1, updated_at=$2 WHERE id=$3", [
      base + i,
      nowIso(),
      orderedIds[i],
    ]);
  }
}

export async function batchSetTaskStatus(
  ids: string[],
  status: Task["status"],
): Promise<void> {
  if (!ids.length) return;
  if (status === "completed" || status === "pending") {
    await withTransaction(async () => {
      const db = await getDb();
      for (const id of ids) {
      const existing = await db.select<Task[]>(
        `${TASK_SELECT} WHERE tasks.id = $1 LIMIT 1`,
        [id],
      );
      if (!existing.length) continue;
      const current = mapTask(existing[0]);
      if (status === "completed" && current.status !== "completed") {
        await toggleTaskCompleteWithinTransaction(id);
      } else if (status === "pending" && current.status === "completed") {
        await toggleTaskCompleteWithinTransaction(id);
      } else if (current.status !== status) {
        await updateTaskWithinTransaction(id, { status });
      }
      }
    });
    return;
  }
  const db = await getDb();
  const stamp = nowIso();
  await withTransaction(async () => {
    for (const id of ids) {
      await db.execute(
        `UPDATE tasks SET status=$1, updated_at=$2,
         completed_at=CASE WHEN $1='completed' THEN $2 ELSE NULL END
         WHERE id=$3`,
        [status, stamp, id],
      );
    }
  });
  for (const id of ids) {
    await recordTaskEvent(id, "batch_status", null, { status });
  }
}

async function loadTaskFamily(ids: string[]): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; parent_id: string | null }[]>(
    "SELECT id, parent_id FROM tasks",
  );
  return expandIdsWithChildren(ids, rows);
}

export async function batchSoftDeleteTasks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const targetIds = await loadTaskFamily(ids);
  const db = await getDb();
  const stamp = nowIso();
  await withTransaction(async () => {
    for (const id of targetIds) {
      await db.execute(
        "UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE id=$2 AND deleted_at IS NULL",
        [stamp, id],
      );
    }
    for (const id of targetIds) {
      await recordTaskEvent(id, "deleted", null, null);
    }
  });
}

export async function batchRestoreTasks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
  const roots = await db.select<{ id: string; deleted_at: string | null }[]>(
    `SELECT id, deleted_at FROM tasks WHERE id IN (${placeholders})`,
    ids,
  );
  if (!roots.some((row) => row.deleted_at)) return;
  const familyIds = await loadTaskFamily(ids);
  const familyPlaceholders = familyIds.map((_, index) => `$${index + 1}`).join(",");
  const family = await db.select<{ id: string; deleted_at: string | null }[]>(
    `SELECT id, deleted_at FROM tasks WHERE id IN (${familyPlaceholders})`,
    familyIds,
  );
  const targetIds = selectRestoreIds(roots, family);
  await withTransaction(async () => {
    for (const id of targetIds) {
      await db.execute(
        "UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE id=$2",
        [nowIso(), id],
      );
    }
  });
}

export async function toggleTaskComplete(
  id: string,
): Promise<{ task: Task | null; spawned: Task | null }> {
  return withTransaction(() => toggleTaskCompleteWithinTransaction(id));
}

async function toggleTaskCompleteWithinTransaction(
  id: string,
): Promise<{ task: Task | null; spawned: Task | null }> {
  const db = await getDb();
  const existing = await db.select<Task[]>(
    `${TASK_SELECT} WHERE tasks.id = $1 LIMIT 1`,
    [id],
  );
  if (existing.length === 0) return { task: null, spawned: null };
  const current = mapTask(existing[0]);
  return updateTaskWithinTransaction(id, {
    status: current.status === "completed" ? "pending" : "completed",
  });
}

async function spawnRepeatOccurrence(source: Task): Promise<Task | null> {
  if (!source.repeat_rule || source.parent_id !== null) return null;
  const draft = nextRepeatTaskDraft(source, new Date());
  if (!draft) return null;
  const db = await getDb();
  const tags = await db.select<{ tag_id: string }[]>(
    "SELECT tag_id FROM task_tags WHERE task_id = $1",
    [source.id],
  );
  const existing = await db.select<Task[]>(
    `${TASK_SELECT} WHERE tasks.generated_from_id=$1 AND tasks.due_date=$2 AND tasks.deleted_at IS NULL LIMIT 1`,
    [source.id, draft.due_date],
  );
  if (existing[0]) return mapTask(existing[0]);
  try {
    return await createTaskWithinTransaction({
      ...draft,
      generated_from_id: source.id,
      tagIds: tags.map((row) => row.tag_id),
    });
  } catch (error) {
    const raced = await db.select<Task[]>(
      `${TASK_SELECT} WHERE tasks.generated_from_id=$1 AND tasks.due_date=$2 AND tasks.deleted_at IS NULL LIMIT 1`,
      [source.id, draft.due_date],
    );
    if (raced[0]) return mapTask(raced[0]);
    throw error;
  }
}

async function recycleGeneratedOccurrences(source: Task): Promise<void> {
  const reference = new Date(source.completed_at ?? nowIso());
  const draft = nextRepeatTaskDraft(source, reference);
  if (!draft?.due_date) return;
  const expected = { due_date: draft.due_date, due_time: draft.due_time ?? null };
  const db = await getDb();
  const linked = await db.select<Task[]>(
    `${TASK_SELECT} WHERE tasks.generated_from_id = $1 AND tasks.deleted_at IS NULL`,
    [source.id],
  );
  for (const item of linked.map(mapTask)) {
    if (!isRecyclableGeneratedTask(item, source, expected)) continue;
    await db.execute("DELETE FROM task_tags WHERE task_id=$1", [item.id]);
    await db.execute("DELETE FROM task_planning_metadata WHERE task_id=$1", [item.id]);
    await db.execute("DELETE FROM attachments WHERE task_id=$1", [item.id]);
    await db.execute("DELETE FROM tasks WHERE id=$1", [item.id]);
  }
}

export async function softDeleteTask(id: string): Promise<void> {
  await batchSoftDeleteTasks([id]);
}

export async function restoreTask(id: string): Promise<void> {
  await batchRestoreTasks([id]);
}

export async function purgeTrash(): Promise<number> {
  return withTransaction(async () => {
    const db = await getDb();
    const before = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) as count FROM tasks WHERE deleted_at IS NOT NULL",
    );
    const trash = "SELECT id FROM tasks WHERE deleted_at IS NOT NULL";
    const affectedGoals = await db.select<{ goal_id: string }[]>(
      `SELECT DISTINCT goal_id FROM goal_entries
       WHERE source_type='task' AND source_id IN (${trash})`,
    );
    const affectedProjects = await db.select<{ project_id: string }[]>(
      `SELECT DISTINCT project_id FROM tasks
       WHERE deleted_at IS NOT NULL AND project_id IS NOT NULL`,
    );
    await db.execute(
      `DELETE FROM attachments WHERE task_id IN (${trash})`,
    );
    await db.execute(
      `DELETE FROM task_tags WHERE task_id IN (${trash})`,
    );
    await db.execute(
      `DELETE FROM task_planning_metadata WHERE task_id IN (${trash})`,
    );
    await db.execute(
      `DELETE FROM task_events WHERE task_id IN (${trash})`,
    );
    await db.execute(
      `DELETE FROM goal_entries WHERE source_type = 'task' AND source_id IN (${trash})`,
    );
    await db.execute(
      `UPDATE app_notifications SET task_id = NULL WHERE task_id IN (${trash})`,
    );
    await db.execute(
      `UPDATE tasks SET blocked_by_id=NULL
       WHERE deleted_at IS NULL AND blocked_by_id IN (${trash})`,
    );
    await db.execute(
      `UPDATE tasks SET generated_from_id=NULL
       WHERE deleted_at IS NULL AND generated_from_id IN (${trash})`,
    );
    await db.execute("DELETE FROM tasks WHERE deleted_at IS NOT NULL");
    for (const row of affectedGoals) await refreshGoalProgress(row.goal_id);
    for (const row of affectedProjects) await refreshProjectGoals(row.project_id);
    return before[0]?.count ?? 0;
  });
}

/** 永久删除回收站中的单个任务（连同其已删除的子任务）。仅作用于 deleted_at 非空的行。 */
export async function purgeTask(id: string): Promise<void> {
  await withTransaction(async () => {
    const db = await getDb();
    const targets = await db.select<{ id: string }[]>(
      "SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND (id=$1 OR parent_id=$1)",
      [id],
    );
    if (!targets.length) return;
    const ids = targets.map((row) => row.id);
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
    const affectedGoals = await db.select<{ goal_id: string }[]>(
      `SELECT DISTINCT goal_id FROM goal_entries
       WHERE source_type='task' AND source_id IN (${placeholders})`,
      ids,
    );
    const affectedProjects = await db.select<{ project_id: string }[]>(
      `SELECT DISTINCT project_id FROM tasks
       WHERE deleted_at IS NOT NULL AND project_id IS NOT NULL AND id IN (${placeholders})`,
      ids,
    );
    await db.execute(`DELETE FROM attachments WHERE task_id IN (${placeholders})`, ids);
    await db.execute(`DELETE FROM task_tags WHERE task_id IN (${placeholders})`, ids);
    await db.execute(
      `DELETE FROM task_planning_metadata WHERE task_id IN (${placeholders})`,
      ids,
    );
    await db.execute(`DELETE FROM task_events WHERE task_id IN (${placeholders})`, ids);
    await db.execute(
      `DELETE FROM goal_entries WHERE source_type = 'task' AND source_id IN (${placeholders})`,
      ids,
    );
    await db.execute(
      `UPDATE app_notifications SET task_id = NULL WHERE task_id IN (${placeholders})`,
      ids,
    );
    await db.execute(
      `UPDATE tasks SET blocked_by_id=NULL
       WHERE deleted_at IS NULL AND blocked_by_id IN (${placeholders})`,
      ids,
    );
    await db.execute(
      `UPDATE tasks SET generated_from_id=NULL
       WHERE deleted_at IS NULL AND generated_from_id IN (${placeholders})`,
      ids,
    );
    await db.execute(
      `DELETE FROM tasks WHERE deleted_at IS NOT NULL AND id IN (${placeholders})`,
      ids,
    );
    for (const row of affectedGoals) await refreshGoalProgress(row.goal_id);
    for (const row of affectedProjects) {
      if (row.project_id) await refreshProjectGoals(row.project_id);
    }
  });
}

const GENERATED_FROM_BACKFILL_KEY = "generated_from_backfill_v1";

export async function backfillGeneratedFromIds(): Promise<number> {
  if ((await getSetting(GENERATED_FROM_BACKFILL_KEY)) === "1") return 0;
  const tasks = await fetchTasks(true);
  const db = await getDb();
  let updated = 0;
  const completedRepeats = tasks.filter(
    (item) =>
      item.status === "completed" &&
      item.repeat_rule &&
      !item.parent_id &&
      !item.deleted_at,
  );
  await withTransaction(async () => {
    for (const source of completedRepeats) {
      const expected = nextOccurrence(source);
      if (!expected) continue;
      const matches = tasks.filter(
        (item) =>
          !item.generated_from_id &&
          item.id !== source.id &&
          !item.parent_id &&
          !item.deleted_at &&
          item.status !== "completed" &&
          item.title === source.title &&
          item.due_date === expected.due_date &&
          (item.due_time ?? null) === (expected.due_time ?? null) &&
          item.repeat_rule === source.repeat_rule,
      );
      if (matches.length !== 1) continue;
      await db.execute(
        "UPDATE tasks SET generated_from_id = $1 WHERE id = $2 AND generated_from_id IS NULL",
        [source.id, matches[0].id],
      );
      updated += 1;
    }
    await setSetting(GENERATED_FROM_BACKFILL_KEY, "1");
  });
  return updated;
}
