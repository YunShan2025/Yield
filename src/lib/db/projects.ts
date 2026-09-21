import type {
  AppNotification,
  Project,
} from "@/types";
import { createId, nowIso } from "@/lib/dates";
import { getDb } from "./client";

/* Projects */
export async function fetchProjects(): Promise<Project[]> {  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC",
  );
}

export async function createProject(
  name: string,
  color = "#7D9BE8",
  tagId: string | null = null,
): Promise<Project> {
  const db = await getDb();
  const timestamp = nowIso();
  const project: Project = {
    id: createId(),
    name: name.trim(),
    color,
    due_date: null,
    archived: 0,
    created_at: timestamp,
    updated_at: timestamp,
    tag_id: tagId,
  };
  await db.execute(
    `INSERT INTO projects
      (id, name, color, due_date, archived, created_at, updated_at, tag_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      project.id,
      project.name,
      project.color,
      project.due_date,
      project.archived,
      project.created_at,
      project.updated_at,
      project.tag_id,
    ],
  );
  return project;
}

export async function archiveProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET archived = 1, updated_at = $1 WHERE id = $2",
    [nowIso(), id],
  );
}

export async function updateProject(
  id: string,
  updates: Partial<
    Pick<Project, "name" | "color" | "due_date" | "tag_id">
  >,
): Promise<void> {
  const db = await getDb();
  const current = (
    await db.select<Project[]>(
      "SELECT * FROM projects WHERE id = $1 LIMIT 1",
      [id],
    )
  )[0];
  if (!current) return;
  const next = { ...current, ...updates, updated_at: nowIso() };
  await db.execute(
    `UPDATE projects SET name=$1, color=$2,
     due_date=$3, tag_id=$4, updated_at=$5 WHERE id=$6`,
    [
      next.name,
      next.color,
      next.due_date,
      next.tag_id ?? null,
      next.updated_at,
      id,
    ],
  );
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const db = await getDb();
  return db.select<AppNotification[]>(
    `SELECT * FROM app_notifications
     WHERE status != 'dismissed'
     ORDER BY created_at DESC LIMIT 100`,
  );
}

export async function createNotificationRecord(input: {
  taskId?: string | null;
  kind?: AppNotification["kind"];
  title: string;
  body?: string;
  scheduledAt?: string | null;
  status?: AppNotification["status"];
}): Promise<AppNotification> {
  const db = await getDb();
  const notification: AppNotification = {
    id: createId(),
    task_id: input.taskId ?? null,
    kind: input.kind ?? "reminder",
    title: input.title,
    body: input.body ?? "",
    scheduled_at: input.scheduledAt ?? null,
    status: input.status ?? "delivered",
    snoozed_until: null,
    created_at: nowIso(),
  };
  await db.execute(
    `INSERT INTO app_notifications
      (id, task_id, kind, title, body, scheduled_at, status, snoozed_until, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      notification.id,
      notification.task_id,
      notification.kind,
      notification.title,
      notification.body,
      notification.scheduled_at,
      notification.status,
      notification.snoozed_until,
      notification.created_at,
    ],
  );
  return notification;
}

export async function ensureReminderRecord(input: {
  taskId: string;
  title: string;
  body: string;
  scheduledAt: string;
}): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT OR IGNORE INTO app_notifications
      (id, task_id, kind, title, body, scheduled_at, status, snoozed_until, created_at)
     SELECT $1, task.id, 'reminder', $2, $3, $4, 'delivered', NULL, $5
     FROM tasks AS task
     WHERE task.id = $6
       AND task.status NOT IN ('completed', 'cancelled')
       AND task.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM app_notifications
         WHERE task_id = $6 AND kind = 'reminder' AND scheduled_at = $4
       )`,
    [createId(), input.title, input.body, input.scheduledAt, nowIso(), input.taskId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function setNotificationStatus(
  id: string,
  status: AppNotification["status"],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE app_notifications SET status = $1 WHERE id = $2",
    [status, id],
  );
}

export async function setTaskNotificationsStatus(
  taskId: string,
  status: AppNotification["status"],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE app_notifications
     SET status = $1
     WHERE task_id = $2 AND status IN ('pending', 'delivered')`,
    [status, taskId],
  );
}

export async function snoozeNotification(
  id: string,
  minutes: number,
): Promise<void> {
  const db = await getDb();
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await db.execute(
    `UPDATE app_notifications
     SET status = 'pending', snoozed_until = $1 WHERE id = $2`,
    [until, id],
  );
}

export async function fetchDueNotifications(): Promise<AppNotification[]> {
  const db = await getDb();
  return db.select<AppNotification[]>(
    `SELECT * FROM app_notifications
     WHERE status = 'pending'
       AND snoozed_until IS NOT NULL
       AND snoozed_until <= $1`,
    [nowIso()],
  );
}

/**
 * 「错过的提醒/错过的任务」自动通知功能已下线：不再生成新的 missed 行，
 * 历史遗留的 missed 通知在启动时统一置为已读，不再出现在通知卡片里。
 */
export async function dismissMissedNotifications(): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE app_notifications SET status = 'read' WHERE kind = 'missed' AND status IN ('pending', 'delivered')",
  );
}
