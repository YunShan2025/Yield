import type { Anniversary } from "@/types";
import { normalizeAnniversaryRow } from "@/lib/anniversaries";
import { createId, nowIso } from "@/lib/dates";
import { getDb } from "./client";

export async function fetchAnniversaries(): Promise<Anniversary[]> {
  const db = await getDb();
  const rows = await db.select<Anniversary[]>(
    "SELECT * FROM anniversaries ORDER BY event_date ASC",
  );
  return rows.map(normalizeAnniversaryRow);
}

export async function createAnniversary(input: {
  title: string;
  event_date: string;
  calendar?: "solar" | "lunar";
  lunar_month?: number | null;
  lunar_day?: number | null;
  lunar_leap?: number;
  recur_yearly?: number;
  note?: string;
}): Promise<Anniversary> {
  const db = await getDb();
  const timestamp = nowIso();
  const calendar = input.calendar === "lunar" ? "lunar" : "solar";
  const row: Anniversary = {
    id: createId(),
    title: input.title.trim(),
    event_date: input.event_date,
    calendar,
    lunar_month: calendar === "lunar" ? (input.lunar_month ?? null) : null,
    lunar_day: calendar === "lunar" ? (input.lunar_day ?? null) : null,
    lunar_leap: calendar === "lunar" && input.lunar_leap ? 1 : 0,
    recur_yearly: input.recur_yearly === 0 ? 0 : 1,
    note: input.note?.trim() ?? "",
    created_at: timestamp,
    updated_at: timestamp,
  };
  await db.execute(
    `INSERT INTO anniversaries
     (id,title,event_date,recur_yearly,note,calendar,lunar_month,lunar_day,lunar_leap,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id,
      row.title,
      row.event_date,
      row.recur_yearly,
      row.note,
      row.calendar,
      row.lunar_month,
      row.lunar_day,
      row.lunar_leap,
      row.created_at,
      row.updated_at,
    ],
  );
  return row;
}

export async function updateAnniversary(
  id: string,
  patch: Partial<
    Pick<
      Anniversary,
      | "title"
      | "event_date"
      | "recur_yearly"
      | "note"
      | "calendar"
      | "lunar_month"
      | "lunar_day"
      | "lunar_leap"
    >
  >,
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<Anniversary[]>(
    "SELECT * FROM anniversaries WHERE id=$1",
    [id],
  );
  const current = normalizeAnniversaryRow(rows[0] ?? ({} as Anniversary));
  if (!rows[0]) return;
  const calendar =
    patch.calendar === undefined
      ? current.calendar
      : patch.calendar === "lunar"
        ? "lunar"
        : "solar";
  const next = {
    title: patch.title?.trim() ?? current.title,
    event_date: patch.event_date ?? current.event_date,
    calendar,
    lunar_month:
      calendar === "lunar"
        ? (patch.lunar_month === undefined ? current.lunar_month : patch.lunar_month)
        : null,
    lunar_day:
      calendar === "lunar"
        ? (patch.lunar_day === undefined ? current.lunar_day : patch.lunar_day)
        : null,
    lunar_leap:
      calendar === "lunar"
        ? patch.lunar_leap === undefined
          ? current.lunar_leap
          : patch.lunar_leap
            ? 1
            : 0
        : 0,
    recur_yearly:
      patch.recur_yearly === undefined
        ? current.recur_yearly
        : patch.recur_yearly
          ? 1
          : 0,
    note: patch.note === undefined ? current.note : patch.note.trim(),
    updated_at: nowIso(),
  };
  await db.execute(
    `UPDATE anniversaries
     SET title=$1,event_date=$2,recur_yearly=$3,note=$4,calendar=$5,
         lunar_month=$6,lunar_day=$7,lunar_leap=$8,updated_at=$9
     WHERE id=$10`,
    [
      next.title,
      next.event_date,
      next.recur_yearly,
      next.note,
      next.calendar,
      next.lunar_month,
      next.lunar_day,
      next.lunar_leap,
      next.updated_at,
      id,
    ],
  );
}

export async function deleteAnniversary(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM anniversaries WHERE id=$1", [id]);
}
