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
    expect(versions).toEqual([1, 2]);
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
});
