/**
 * 同步范围注册表：参与同步的表、外键依赖序（父表先于子表应用）、settings 白名单。
 * 顺序约定：projects/goals/tags/habits/anniversaries 等父表在前，
 * tasks 再到其关联表；ledger 分类/账户先于交易。
 * 追加型表（task_events / habit_checks / achievements）
 * 只会有插入与（habit_checks 的）删除，无更新语义。
 * focus_sessions 已随专注功能下线移出同步范围（migration v7 删表），
 * 旧日志中的同名条目经 isSyncTable 过滤自然跳过。
 */

export type SyncTableName =
  | "projects"
  | "goals"
  | "tags"
  | "habits"
  | "anniversaries"
  | "tasks"
  | "task_tags"
  | "task_planning_metadata"
  | "goal_entries"
  | "goal_milestones"
  | "habit_checks"
  | "achievements"
  | "memos"
  | "timers"
  | "ledger_categories"
  | "ledger_accounts"
  | "ledger_transactions"
  | "ledger_budgets"
  | "settings";

/** 应用合并顺序：外键依赖序，孤儿行由界面层过滤容忍。 */
export const SYNC_TABLES: readonly SyncTableName[] = [
  "projects",
  "goals",
  "tags",
  "habits",
  "anniversaries",
  "tasks",
  "task_tags",
  "task_planning_metadata",
  "goal_entries",
  "goal_milestones",
  "habit_checks",
  "achievements",
  "memos",
  "timers",
  "ledger_categories",
  "ledger_accounts",
  "ledger_transactions",
  "ledger_budgets",
  "settings",
];

/** settings 里参与同步的白名单键（键级 LWW）。设备相关键一律排除。 */
export const SYNC_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "theme",
  "notify_ahead",
  "privacy_mode",
  "auto_backup",
  "onboarding_complete",
  "ledger_default_budget_cents",
  "ledger_default_expense_category_id",
  "ledger_default_income_category_id",
  "ledger_default_account_id",
  "ledger_hide_amount",
]);

/** 当前数据库 schema 版本（与 src-tauri migration 版本保持一致），写入每条日志。 */
export const SYNC_SCHEMA_VERSION = 2;

export function isSyncTable(name: string): name is SyncTableName {
  return (SYNC_TABLES as readonly string[]).includes(name);
}
