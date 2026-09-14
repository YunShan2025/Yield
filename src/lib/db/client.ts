import Database from "@tauri-apps/plugin-sql";
import type { Task } from "@/types";
import { DB_URL, nowIso } from "@/lib/dates";

let dbPromise: Promise<Database> | null = null;
export const TASK_SELECT = `SELECT tasks.*,
  task_planning_metadata.reminder_minutes_json AS reminder_minutes_json,
  task_planning_metadata.estimated_minutes AS estimated_minutes
  FROM tasks LEFT JOIN task_planning_metadata
    ON task_planning_metadata.task_id = tasks.id`;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then(async (db) => {
      try {
        await db.execute("PRAGMA foreign_keys = ON");
      } catch {
        /* ignore */
      }
      try {
        await db.execute("PRAGMA journal_mode = WAL");
        await db.execute("PRAGMA synchronous = NORMAL");
      } catch {
        /* another window may already be changing journal mode */
      }
      try {
        await db.execute("PRAGMA busy_timeout = 5000");
      } catch {
        /* ignore */
      }
      return db;
    });
  }
  return dbPromise;
}

let txQueue: Promise<unknown> = Promise.resolve();
let txDepth = 0;

/**
 * Serialize writes on the JS side.
 * Do not issue BEGIN/COMMIT through tauri-plugin-sql: it uses a sqlx pool, so
 * those statements can land on different connections and fail with
 * "cannot start a transaction within a transaction".
 * Nested calls run immediately on the same queue turn (no deadlock).
 */
export function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txDepth > 0) return fn();
  const run = txQueue.then(async () => {
    const execute = async () => {
      txDepth += 1;
      try { return await fn(); }
      finally { txDepth -= 1; }
    };
    // Web Locks are shared by every WebView of this app origin. They close the
    // gap left by each window having its own module-level queue.
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request("youqiu:database-write", execute);
    }
    return execute();
  });
  txQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function mapTask(row: Task): Task {
  const raw = (row as Task & { reminder_minutes_json?: string | null })
    .reminder_minutes_json;
  let reminders: number[] = Array.isArray(row.reminder_minutes)
    ? row.reminder_minutes
    : [];
  try {
    if (raw) reminders = JSON.parse(raw);
  } catch {
    reminders = [];
  }
  return {
    ...row,
    parent_id: row.parent_id ?? null,
    repeat_rule: row.repeat_rule ?? null,
    end_time: row.end_time ?? null,
    reminder_minutes: reminders,
    estimated_minutes: row.estimated_minutes ?? null,
    project_id: row.project_id ?? null,
    blocked_by_id: row.blocked_by_id ?? null,
    completion_criteria: row.completion_criteria ?? "",
    energy_level: row.energy_level ?? "medium",
    flexible: row.flexible ?? 1,
    schedule_locked: row.schedule_locked ?? 0,
    actual_minutes: row.actual_minutes ?? 0,
    goal_id: row.goal_id ?? null,
    goal_contribution: row.goal_contribution ?? 1,
    generated_from_id: row.generated_from_id ?? null,
  };
}

export async function saveTaskPlanningMetadata(task: Task): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_planning_metadata
     (task_id, reminder_minutes_json, estimated_minutes, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(task_id) DO UPDATE SET
       reminder_minutes_json=excluded.reminder_minutes_json,
       estimated_minutes=excluded.estimated_minutes,
       updated_at=excluded.updated_at`,
    [
      task.id,
      JSON.stringify(task.reminder_minutes ?? []),
      task.estimated_minutes ?? null,
      task.updated_at || nowIso(),
    ],
  );
}

