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

/**
 * 同步日志格式版本。v3（v1.1.2）：新增字段的闸门——projects.tag_id 等
 * 新列进入日志后，旧版本（schema_v 2）的列白名单会把它静默丢弃且照常
 * 推进水位，数据从此缺失。升版后旧端在 header 闸门被整体拒收并明确
 * 提示升级，不再静默丢字段；本版本解析时接受 ≤ 自身版本的条目（旧格式
 * 是新格式的列子集，白名单会滤掉已删列），保证升级顺序无关的收敛。
 */
export const SYNC_SCHEMA_VERSION = 3;

export function isSyncTable(name: string): name is SyncTableName {
  return (SYNC_TABLES as readonly string[]).includes(name);
}
