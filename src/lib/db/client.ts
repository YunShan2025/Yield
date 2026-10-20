import Database from "@tauri-apps/plugin-sql";
import type { Task } from "@/types";
import { DB_URL } from "@/lib/dates";

let dbPromise: Promise<Database> | null = null;
export const TASK_SELECT = "SELECT tasks.* FROM tasks";

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
  return {
    ...row,
    parent_id: row.parent_id ?? null,
    end_time: row.end_time ?? null,
    project_id: row.project_id ?? null,
    goal_id: row.goal_id ?? null,
    goal_contribution: row.goal_contribution ?? 1,
  };
}
