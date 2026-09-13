import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("database migration declarations", () => {
  it("keeps a single clean v1 baseline with the current workflow tables", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const versions = [...source.matchAll(/version:\s*(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(versions).toEqual([1]);
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
    const baseline = source.slice(
      source.indexOf('description: "youqiu_baseline"'),
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
    // 全量建表基线：不允许再出现增量补列。
    expect(source).not.toContain("ALTER TABLE");
    expect(source).not.toContain("INSERT OR REPLACE INTO task_planning_metadata");
    expect(baseline).toContain("schedule_locked INTEGER NOT NULL DEFAULT 0");
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
