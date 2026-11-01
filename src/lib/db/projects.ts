import type { Project } from "@/types";
import { createId, nowIso } from "@/lib/dates";
import { getDb, withTransaction } from "./client";

/* Projects */
export async function fetchProjects(): Promise<Project[]> {  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE archived = 0 AND deleted_at IS NULL ORDER BY created_at DESC",
  );
}

export async function fetchArchivedProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE archived = 1 AND deleted_at IS NULL ORDER BY updated_at DESC",
  );
}

/** 回收站里的项目：软删除后保留，可恢复或永久删除。 */
export async function fetchDeletedProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
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
    deleted_at: null,
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
    "UPDATE projects SET archived = 1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL",
    [nowIso(), id],
  );
}

export async function restoreProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET archived = 0, updated_at = $1 WHERE id = $2",
    [nowIso(), id],
  );
}

/** 项目移入回收站：打 deleted_at 并随 updated_at 入同步箱。 */
export async function softDeleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL",
    [nowIso(), id],
  );
}

/** 从回收站恢复项目。 */
export async function restoreDeletedProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET deleted_at = NULL, updated_at = $1 WHERE id = $2 AND deleted_at IS NOT NULL",
    [nowIso(), id],
  );
}

/**
 * 永久删除项目：行删除后由 trg_projects_del 向对端发 delete 操作。
 * 任务与「项目自动计算」目标失去归属（project_id 置空），不连带删除。
 */
export async function purgeProject(id: string): Promise<void> {
  await withTransaction(async () => {
    const db = await getDb();
    const stamp = nowIso();
    await db.execute(
      "UPDATE tasks SET project_id = NULL, updated_at = $1 WHERE project_id = $2 AND deleted_at IS NULL",
      [stamp, id],
    );
    await db.execute(
      "UPDATE goals SET project_id = NULL, updated_at = $1 WHERE project_id = $2",
      [stamp, id],
    );
    await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  });
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

