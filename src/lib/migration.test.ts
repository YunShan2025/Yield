import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("database migration declarations", () => {
  it("keeps a clean v1 baseline with the current workflow tables", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const versions = [...source.matchAll(/version:\s*(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(source).toContain("schema_contract");
    expect(source).toContain("ledger_transactions");
    expect(source).toContain("generated_from_id");
    expect(source).toContain("uq_tasks_repeat_occurrence");
    expect(source).toContain("uq_app_notification_delivery");
    expect(source).toContain("anniversaries");
    // 历史遗留（已下线功能）不得回流进基线。
    for (const legacy of [
      "smart_lists",
      "task_templates",
      "day_snapshots",
      "daily_reflections",
      "inspirations",
      "future_letters",
      "karma_ledger",
      "my_day_date",
      "remind_minutes",
      "float_visible",
      "desktop_widget_mode",
      "desktop_widget_layer",
      "hotkey.ledger.quick_add",
      "ai_api_key",
    ]) {
      expect(source).not.toContain(legacy);
    }
    const baselineEnd = source.indexOf("version: 2");
    const baseline = source.slice(
      source.indexOf('description: "youqiu_baseline"'),
      baselineEnd === -1 ? undefined : baselineEnd,
    );
    for (const table of [
      "tasks",
      "settings",
      "tags",
      "task_tags",
      "attachments",
      "habits",
      "habit_checks",
      "memos",
      "timers",
      "projects",
      "app_notifications",
      "task_events",
      "focus_sessions",
      "milestones",
      "goals",
      "goal_entries",
      "goal_milestones",
      "achievements",
      "task_planning_metadata",
      "anniversaries",
      "ledger_categories",
      "ledger_accounts",
      "ledger_transactions",
      "ledger_budgets",
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    // v1 基线保持全量建表；增量补列只允许出现在后续 migration（v2+）。
    expect(baseline).not.toContain("ALTER TABLE");
    expect(source).not.toContain("INSERT OR REPLACE INTO task_planning_metadata");
    expect(baseline).toContain("schedule_locked INTEGER NOT NULL DEFAULT 0");
  });

  it("drops focus_sessions with its leftovers via migration v7", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /version:\s*7,\s*description:\s*"drop_focus_sessions",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(match).not.toBeNull();
    const sql = match?.[1] ?? "";
    // 专注功能下线：删表删历史数据，并清掉可能滞留的同步簿记与心跳设置键。
    expect(sql).toContain("DROP TABLE IF EXISTS focus_sessions");
    expect(sql).toContain("DELETE FROM sync_outbox WHERE table_name = 'focus_sessions'");
    expect(sql).toContain("DELETE FROM sync_state WHERE table_name = 'focus_sessions'");
    expect(sql).toContain("DELETE FROM settings WHERE key = 'active_focus'");
  });

  it("adds sync metadata via migration v2", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /version:\s*2,\s*description:\s*"sync_metadata_updated_at",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(match).not.toBeNull();
    // 9 张同步缺口表全部补列。
    for (const table of [
      "habits",
      "tags",
      "task_tags",
      "task_planning_metadata",
      "milestones",
      "goal_entries",
      "goal_milestones",
      "ledger_categories",
      "ledger_accounts",
    ]) {
      expect(match?.[1]).toContain(
        `ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';`,
      );
    }
    // 旧行按来源回填，不留空串时间戳。
    for (const table of [
      "habits",
      "tags",
      "milestones",
      "goal_entries",
      "goal_milestones",
      "ledger_categories",
      "ledger_accounts",
    ]) {
      expect(match?.[1]).toContain(
        `UPDATE ${table} SET updated_at = created_at WHERE updated_at = '';`,
      );
    }
    expect(match?.[1]).toContain("WHERE tasks.id = task_planning_metadata.task_id");
  });

  it("keeps the v1 baseline schema canonical", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /description:\s*"youqiu_baseline",\s*sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(match?.[1]).toContain(`CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT,
  due_time TEXT,
  end_time TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT,
  parent_id TEXT,
  repeat_rule TEXT,
  project_id TEXT,
  blocked_by_id TEXT,
  completion_criteria TEXT NOT NULL DEFAULT '',
  energy_level TEXT NOT NULL DEFAULT 'medium',
  flexible INTEGER NOT NULL DEFAULT 1,
  schedule_locked INTEGER NOT NULL DEFAULT 0,
  actual_minutes INTEGER NOT NULL DEFAULT 0,
  goal_id TEXT,
  goal_contribution REAL NOT NULL DEFAULT 1,
  generated_from_id TEXT
);`);
    // 提醒时间的唯一权威存储是 task_planning_metadata。
    expect(match?.[1]).toContain(
      "CREATE TABLE IF NOT EXISTS task_planning_metadata",
    );
    expect(match?.[1]).toContain("reminder_minutes_json TEXT NOT NULL DEFAULT '[]'");
  });

  it("keeps no legacy compatibility shims in the client", () => {
    const compatibility = readFileSync("src/lib/db/client.ts", "utf8");
    expect(compatibility).not.toContain("ALTER TABLE");
    expect(compatibility).not.toContain("my_day_date");
    expect(compatibility).not.toContain("remind_minutes");
  });

  it("installs sync outbox infrastructure via migration v3", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /version:\s*3,\s*description:\s*"sync_outbox_triggers",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(match).not.toBeNull();
    const sql = match?.[1] ?? "";
    // 三张同步元表。
    for (const table of ["sync_outbox", "sync_state", "sync_merge_seen"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    // 20 张同步表（settings 走白名单键捕获，不建触发器）：
    // 16 张 updatable 表 × 3 + task_tags/habit_checks/focus_sessions/achievements 各 2。
    expect((sql.match(/CREATE TRIGGER IF NOT EXISTS/g) ?? []).length).toBe(56);
    // 墓碑、回声抑制、整数 id 与复合主键的关键形态。
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS trg_tasks_upd AFTER UPDATE ON tasks");
    expect(sql).toContain("trg_task_tags_del AFTER DELETE ON task_tags");
    expect(sql).toContain("NEW.task_id || ':' || NEW.tag_id");
    expect(sql).toContain("trg_ledger_transactions_upd");
    expect(sql).not.toContain("ON settings"); // settings 不建触发器
    // 触发器写入 outbox 的 op 合法值约束。
    expect(sql).toContain("op TEXT NOT NULL CHECK (op IN ('upsert','delete'))");
  });

  it("rebuilds task_planning_metadata triggers on task_id via migration v4", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    // tauri-plugin-sql 校验已应用 migration 的 checksum：v3 一经发布不可再改
    //（改了会报 "migration 3 was previously applied but has been modified"）。
    // 它的 planning 触发器带着历史错误的 NEW.id，由 v4 DROP 重建修正。
    const v3 = source.match(
      /version:\s*3,\s*description:\s*"sync_outbox_triggers",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    )?.[1] ?? "";
    expect(v3).toContain("('task_planning_metadata', NEW.id, 'upsert'");
    const v4 = source.match(
      /version:\s*4,\s*description:\s*"sync_fix_task_planning_triggers",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(v4).not.toBeNull();
    const sql = v4?.[1] ?? "";
    // 修复已应用过坏 v3 的既有库：DROP 三个坏触发器后重建
    for (const name of ["ins", "upd", "del"]) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS trg_task_planning_metadata_${name}`);
      expect(sql).toContain(`CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_${name}`);
    }
    expect((sql.match(/NEW\.id|OLD\.id/g) ?? [])).toHaveLength(0);
    expect(sql).toContain("NEW.task_id");
    expect(sql).toContain("OLD.task_id");
  });

  it("rebuilds habit_checks insert trigger without created_at via migration v5", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    // 同 v4 的理由：v3 不可改，它历史性地引用了 habit_checks 不存在的
    // created_at 列（该表只有 id/habit_id/check_date），由 v5 DROP 重建。
    const v3 = source.match(
      /version:\s*3,\s*description:\s*"sync_outbox_triggers",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    )?.[1] ?? "";
    expect(v3).toContain("('habit_checks', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))");
    const v5 = source.match(
      /version:\s*5,\s*description:\s*"sync_fix_habit_checks_trigger",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(v5).not.toBeNull();
    const sql = v5?.[1] ?? "";
    // 表内无时间戳列：row_id 用 NEW.id，ts_ms 取常量 0（与 rowTsMs 的 0 约定一致）。
    expect(sql).toContain("VALUES ('habit_checks', NEW.id, 'upsert', 0)");
    expect(sql).toContain("row_id = NEW.id AND ts_ms = 0");
    expect(sql).not.toContain("created_at");
  });

  it("installs tag alias bookkeeping via migration v6", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /version:\s*6,\s*description:\s*"sync_tag_alias",[\s\S]*?sql:\s*r#"\n([\s\S]*?)"#,/,
    );
    expect(match).not.toBeNull();
    const sql = match?.[1] ?? "";
    // tags.name 的 UNIQUE 冲突由 TS 合并后端按"收养"解决（保留本地同名词行，
    // 对端 id → 本地 id 的映射），映射跨同步轮持久化在这张设备本地簿记表。
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS sync_tag_alias");
    expect(sql).toContain("remote_row_id TEXT PRIMARY KEY");
    expect(sql).toContain("local_id TEXT NOT NULL");
  });
});
