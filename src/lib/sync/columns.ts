/**
 * 每张同步表的列白名单与主键信息，供真实 SQLite 合并后端安全地拼
 * INSERT ... ON CONFLICT DO UPDATE。列名以 src-tauri/src/lib.rs 的
 * migration v1/v2 为准；远端日志里出现白名单之外的键一律丢弃（不报错，
 * 兼容未来版本新增列时的前向容忍）。
 */

import type { SyncTableName } from "./tables";

export interface TableSpec {
  /** 主键列；复合主键用数组（如 task_tags）。 */
  idColumns: string[];
  /** 主键是否 INTEGER（ledger 系列）；缺省为 TEXT（uuid）。 */
  integerId?: boolean;
  /** 全部可同步列（白名单，不含主键也须列出以便覆盖）。 */
  columns: string[];
  /** 删除语句的 WHERE 列（默认 = idColumns）。 */
  deleteWhere?: string[];
}

const TASK_COLUMNS = [
  "title", "description", "notes", "priority", "status", "due_date", "due_time",
  "end_time", "sort_order", "created_at", "updated_at", "completed_at", "deleted_at",
  "parent_id", "repeat_rule", "project_id", "blocked_by_id", "completion_criteria",
  "energy_level", "flexible", "schedule_locked", "actual_minutes", "goal_id",
  "goal_contribution", "generated_from_id",
];

export const TABLE_SPECS: Record<Exclude<SyncTableName, "settings">, TableSpec> = {
  projects: {
    idColumns: ["id"],
    columns: ["name", "color", "due_date", "archived", "goal", "success_criteria", "created_at", "updated_at"],
  },
  goals: {
    idColumns: ["id"],
    columns: [
      "title", "description", "icon", "color", "goal_type", "start_date", "target_date",
      "start_value", "target_value", "current_value", "unit", "status", "motivation",
      "project_id", "weekly_target", "manual_completion", "created_at", "updated_at",
    ],
  },
  tags: {
    idColumns: ["id"],
    columns: ["name", "color", "created_at", "updated_at"],
  },
  habits: {
    idColumns: ["id"],
    columns: ["title", "target_per_week", "goal_id", "goal_contribution", "created_at", "updated_at"],
  },
  anniversaries: {
    idColumns: ["id"],
    columns: [
      "title", "event_date", "calendar", "lunar_month", "lunar_day", "lunar_leap",
      "recur_yearly", "note", "created_at", "updated_at",
    ],
  },
  tasks: {
    idColumns: ["id"],
    columns: TASK_COLUMNS,
  },
  task_tags: {
    idColumns: ["task_id", "tag_id"],
    deleteWhere: ["task_id", "tag_id"],
    columns: ["updated_at"],
  },
  task_planning_metadata: {
    idColumns: ["task_id"],
    columns: ["reminder_minutes_json", "updated_at"],
  },
  milestones: {
    idColumns: ["id"],
    columns: ["project_id", "title", "due_date", "completed", "created_at", "updated_at"],
  },
  goal_entries: {
    idColumns: ["id"],
    columns: ["goal_id", "entry_date", "value", "source_type", "source_id", "note", "created_at", "updated_at"],
  },
  goal_milestones: {
    idColumns: ["id"],
    columns: ["goal_id", "title", "target_value", "target_date", "completed_at", "sort_order", "created_at", "updated_at"],
  },
  habit_checks: {
    idColumns: ["id"],
    columns: ["habit_id", "check_date"],
  },
  achievements: {
    idColumns: ["id"],
    columns: ["goal_id", "title", "description", "achieved_at", "image_path", "source_type", "source_id", "pinned", "created_at"],
  },
  memos: {
    idColumns: ["id"],
    columns: ["content", "pinned", "title", "archived", "format", "created_at", "updated_at"],
  },
  timers: {
    idColumns: ["id"],
    columns: [
      "kind", "title", "interval_sec", "remaining_sec", "running", "enabled",
      "task_id", "ends_at", "last_fired_at", "created_at", "updated_at",
    ],
  },
  ledger_categories: {
    idColumns: ["id"],
    integerId: true,
    deleteWhere: ["id"],
    columns: ["kind", "name", "icon", "color", "sort_order", "is_builtin", "is_enabled", "created_at", "updated_at"],
  },
  ledger_accounts: {
    idColumns: ["id"],
    integerId: true,
    columns: ["name", "kind", "color", "sort_order", "is_enabled", "created_at", "updated_at"],
  },
  ledger_transactions: {
    idColumns: ["id"],
    integerId: true,
    deleteWhere: ["id"],
    columns: [
      "type", "amount_cents", "date", "category_id", "account_id", "note",
      "is_deleted", "version", "created_at", "updated_at", "deleted_at",
    ],
  },
  ledger_budgets: {
    idColumns: ["id"],
    integerId: true,
    columns: ["month", "amount_cents", "created_at", "updated_at"],
  },
};

/** settings 特例：键值表，键级 LWW。 */
export const SETTINGS_SPEC = { keyColumn: "key", valueColumn: "value" };

/**
 * task_tags 的复合 row_id 分隔符。task/tag id 都是 UUID（hex 与连字符），
 * 不会包含冒号，可安全拼接。
 */
export function taskTagRowId(taskId: string, tagId: string): string {
  return `${taskId}:${tagId}`;
}

export function splitTaskTagRowId(rowId: string): { task_id: string; tag_id: string } {
  const i = rowId.indexOf(":");
  if (i <= 0 || i === rowId.length - 1) throw new Error(`task_tags row_id 非法：${rowId}`);
  return { task_id: rowId.slice(0, i), tag_id: rowId.slice(i + 1) };
}
