mod os_reminders;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_notification::NotificationExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        {Arc, Condvar, Mutex},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DB_URL: &str = "sqlite:app.db";
const DATABASE_BACKUP_DIR: &str = "database-backups";
const PENDING_RESTORE_FILE: &str = "pending-database-restore";

fn copy_database_files(source_dir: &Path, target_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target_dir)?;
    for name in ["app.db", "app.db-wal", "app.db-shm"] {
        let source = source_dir.join(name);
        if source.exists() {
            std::fs::copy(source, target_dir.join(name))?;
        }
    }
    Ok(())
}

fn create_startup_database_backup(app_data_dir: &Path) -> std::io::Result<()> {
    if !app_data_dir.join("app.db").exists() {
        return Ok(());
    }
    let root = app_data_dir.join(DATABASE_BACKUP_DIR);
    std::fs::create_dir_all(&root)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    copy_database_files(app_data_dir, &root.join(format!("startup-{stamp}")))?;
    let mut snapshots = std::fs::read_dir(&root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    for old in snapshots.into_iter().skip(10) {
        let _ = std::fs::remove_dir_all(old.path());
    }
    Ok(())
}

#[tauri::command]
fn create_database_backup(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    if !dir.join("app.db").exists() {
        return Err("数据库文件不存在".into());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let id = format!("startup-{stamp}");
    copy_database_files(&dir, &dir.join(DATABASE_BACKUP_DIR).join(&id))
        .map_err(|error| error.to_string())?;
    Ok(id)
}

fn apply_pending_database_restore(app_data_dir: &Path) -> std::io::Result<()> {
    let marker = app_data_dir.join(PENDING_RESTORE_FILE);
    if !marker.exists() {
        return Ok(());
    }
    let source = PathBuf::from(std::fs::read_to_string(&marker)?.trim());
    let backup_root = app_data_dir.join(DATABASE_BACKUP_DIR).canonicalize()?;
    let source = source.canonicalize()?;
    if !source.starts_with(&backup_root) || !source.join("app.db").exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid database restore source",
        ));
    }
    create_startup_database_backup(app_data_dir)?;
    for name in ["app.db", "app.db-wal", "app.db-shm"] {
        let target = app_data_dir.join(name);
        if target.exists() {
            std::fs::remove_file(&target)?;
        }
        let backup_file = source.join(name);
        if backup_file.exists() {
            std::fs::copy(backup_file, target)?;
        }
    }
    std::fs::remove_file(marker)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseBackupInfo {
    id: String,
    size: u64,
    created_at: u64,
}

#[tauri::command]
fn database_health(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let database = dir.join("app.db");
    let probe = dir.join(".write-probe");
    std::fs::write(&probe, b"ok").map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(probe);
    Ok(serde_json::json!({
        "healthy": database.exists(),
        "databaseExists": database.exists(),
        "databaseSize": database.metadata().map(|item| item.len()).unwrap_or(0),
        "dataDirectory": dir.to_string_lossy(),
        "writable": true
    }))
}

#[tauri::command]
fn list_database_backups(app: AppHandle) -> Result<Vec<DatabaseBackupInfo>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(DATABASE_BACKUP_DIR);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut backups = std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().to_string();
            let database = entry.path().join("app.db");
            let size = database.metadata().ok()?.len();
            let raw_stamp: u64 = id.rsplit('-').next()?.parse().ok()?;
            let created_at = if raw_stamp > 10_000_000_000 { raw_stamp / 1000 } else { raw_stamp };
            Some(DatabaseBackupInfo { id, size, created_at })
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|item| std::cmp::Reverse(item.created_at));
    Ok(backups)
}

#[tauri::command]
fn schedule_database_restore(app: AppHandle, backup_id: String) -> Result<(), String> {
    if !backup_id.starts_with("startup-")
        || backup_id.contains('/')
        || backup_id.contains('\\')
    {
        return Err("无效的备份编号".into());
    }
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let backup = dir.join(DATABASE_BACKUP_DIR).join(&backup_id);
    if !backup.join("app.db").exists() {
        return Err("备份文件不存在".into());
    }
    std::fs::write(dir.join(PENDING_RESTORE_FILE), backup.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_database_restore(app: AppHandle) -> Result<(), String> {
    let marker = app.path().app_data_dir().map_err(|error| error.to_string())?.join(PENDING_RESTORE_FILE);
    if marker.exists() {
        std::fs::remove_file(marker).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// JSON/CSV 导出:目标路径来自系统保存对话框,路径无法静态枚举,
/// fs 插件的路径 scope 覆盖不了,统一走 Rust 侧写文件。
#[tauri::command]
fn write_backup_file(path: String, contents: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("导出路径为空".into());
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_backup_file(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("导入路径为空".into());
    }
    std::fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_data_directory(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 从设置页直达系统通知权限页(通知被系统关闭时,提醒无法准点)。
#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("ms-settings:notifications")
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("当前平台不支持打开系统通知设置".into())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

fn show_startup_error(message: &str) {
    eprintln!("{message}");
    #[cfg(target_os = "windows")]
    {
        let script = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:YQ_STARTUP_ERROR, '有秋 启动失败', 'OK', 'Error') | Out-Null";
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("YQ_STARTUP_ERROR", message)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let script =
            "display dialog (system attribute \"YQ_STARTUP_ERROR\") with title \"有秋 启动失败\" buttons {\"好\"} default button \"好\" with icon stop";
        let _ = std::process::Command::new("osascript")
            .args(["-e", script])
            .env("YQ_STARTUP_ERROR", message)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("zenity")
            .args(["--error", "--title=有秋 启动失败", "--text", message])
            .spawn();
    }
}

fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    use tauri_plugin_sql::{Migration, MigrationKind};

    // v1.0.0 全新基线：应用标识更名后数据目录全新，旧的 23 级迁移历史
    // （已下线模块的表/列/设置）不再保留。自本版本起数据库仍只向前升级。
    vec![
        Migration {
            version: 1,
            description: "youqiu_baseline",
            sql: r#"
CREATE TABLE IF NOT EXISTS tasks (
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
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#5B8FF9',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_per_week INTEGER NOT NULL DEFAULT 3,
  goal_id TEXT,
  goal_contribution REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_checks (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL,
  check_date TEXT NOT NULL,
  UNIQUE(habit_id, check_date)
);

CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'markdown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  interval_sec INTEGER NOT NULL,
  remaining_sec INTEGER NOT NULL,
  running INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  task_id TEXT,
  ends_at TEXT,
  last_fired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7D9BE8',
  due_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  goal TEXT NOT NULL DEFAULT '',
  success_criteria TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  kind TEXT NOT NULL DEFAULT 'reminder',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  snoozed_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task
  ON task_events(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  interruption_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task
  ON focus_sessions(task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'target',
  color TEXT NOT NULL DEFAULT '#2F6FED',
  goal_type TEXT NOT NULL DEFAULT 'quantity',
  start_date TEXT NOT NULL,
  target_date TEXT,
  start_value REAL NOT NULL DEFAULT 0,
  target_value REAL NOT NULL DEFAULT 1,
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '次',
  status TEXT NOT NULL DEFAULT 'active',
  motivation TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  weekly_target REAL NOT NULL DEFAULT 0,
  manual_completion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_entries (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_entries_source
  ON goal_entries(goal_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goal_entries_date
  ON goal_entries(entry_date, goal_id);

CREATE TABLE IF NOT EXISTS goal_milestones (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target_value REAL NOT NULL DEFAULT 0,
  target_date TEXT,
  completed_at TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  goal_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  achieved_at TEXT NOT NULL,
  image_path TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_source
  ON achievements(source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_planning_metadata (
  task_id TEXT PRIMARY KEY,
  reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
  estimated_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS anniversaries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  calendar TEXT NOT NULL DEFAULT 'solar',
  lunar_month INTEGER,
  lunar_day INTEGER,
  lunar_leap INTEGER NOT NULL DEFAULT 0,
  recur_yearly INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anniversaries_event_date
  ON anniversaries(event_date);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status
  ON tasks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_status
  ON tasks(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule_locked
  ON tasks(schedule_locked, due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_generated_from
  ON tasks(generated_from_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_repeat_occurrence
  ON tasks(generated_from_id, due_date)
  WHERE generated_from_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_notification_delivery
  ON app_notifications(task_id, kind, scheduled_at)
  WHERE task_id IS NOT NULL AND scheduled_at IS NOT NULL;

PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ledger_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 12),
  icon TEXT NOT NULL DEFAULT 'dots',
  color TEXT NOT NULL DEFAULT '#8d99ab',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_builtin IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, kind), UNIQUE (kind, name)
);
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('cash','card','credit','alipay','wechat','custom')),
  color TEXT NOT NULL DEFAULT '#2f6fed',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 9999999999),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 60),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  FOREIGN KEY (category_id, type) REFERENCES ledger_categories(id, kind)
);
CREATE TABLE IF NOT EXISTS ledger_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_date ON ledger_transactions(date DESC,id DESC) WHERE is_deleted=0;
CREATE INDEX IF NOT EXISTS idx_ledger_tx_cat ON ledger_transactions(category_id,date DESC) WHERE is_deleted=0;
CREATE INDEX IF NOT EXISTS idx_ledger_tx_acct ON ledger_transactions(account_id,date DESC) WHERE is_deleted=0;
CREATE INDEX IF NOT EXISTS idx_ledger_tx_deleted ON ledger_transactions(deleted_at) WHERE is_deleted=1;
INSERT OR IGNORE INTO ledger_categories(id,kind,name,icon,color,sort_order,is_builtin) VALUES
(1,'expense','餐饮','food','#ef8b62',10,1),(2,'expense','交通','car','#5d83e8',20,1),(3,'expense','购物','bag','#a174e8',30,1),(4,'expense','居住','home','#42a39b',40,1),(5,'expense','娱乐','play','#df72aa',50,1),(6,'expense','医疗','medical','#df6670',60,1),(7,'expense','教育','book','#4c9fe8',70,1),(8,'expense','人情','gift','#c78a3a',80,1),(9,'expense','旅行','plane','#3a936d',90,1),(10,'expense','其他','dots','#8d99ab',100,1),
(11,'income','工资','salary','#2f8f68',10,1),(12,'income','奖金','star','#d5a32b',20,1),(13,'income','理财','trend','#4c9fe8',30,1),(14,'income','兼职','zap','#966be0',40,1),(15,'income','退款','back','#dc73a8',50,1);
INSERT OR IGNORE INTO ledger_accounts(id,name,kind,color,sort_order) VALUES
(1,'现金','cash','#8090a7',10),(2,'储蓄卡','card','#2f6fed',20),(3,'信用卡','credit','#9a6bdd',30),(4,'支付宝','alipay','#2786e8',40),(5,'微信','wechat','#2f9a62',50);

INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_ahead', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('autostart', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('privacy_mode', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_backup', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_complete', 'false');
INSERT OR IGNORE INTO settings(key,value) VALUES
('ledger_default_budget_cents','0'),('ledger_default_expense_category_id','1'),('ledger_default_income_category_id','11'),('ledger_default_account_id','2'),('ledger_hide_amount','false');
INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_contract', '1');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "sync_metadata_updated_at",
            // 为数据同步补齐 9 张可编辑小表的 updated_at。ALTER TABLE 只能带
            // 常量默认值，旧行时间戳随后按来源回填：有 created_at 的表取自身，
            // task_planning_metadata 取宿主任务的时间，纯关联表 task_tags 留空。
            sql: r#"
ALTER TABLE habits ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE habits SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE tags SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE task_tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

ALTER TABLE task_planning_metadata ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE task_planning_metadata SET updated_at =
  COALESCE((SELECT tasks.updated_at FROM tasks WHERE tasks.id = task_planning_metadata.task_id), '')
  WHERE updated_at = '';

ALTER TABLE milestones ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE milestones SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE goal_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE goal_entries SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE goal_milestones ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE goal_milestones SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE ledger_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE ledger_categories SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE ledger_accounts ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE ledger_accounts SET updated_at = created_at WHERE updated_at = '';
"#,
            kind: MigrationKind::Up,
        },
    ]
}


#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeReminder {
    reminder_id: String,
    task_id: String,
    title: String,
    body: String,
    fire_at_ms: u64,
}

#[derive(Default)]
struct ReminderScheduler {
    reminders: Mutex<HashMap<String, NativeReminder>>,
    changed: Condvar,
}

fn start_notification_scheduler(app: AppHandle, scheduler: Arc<ReminderScheduler>) {
    std::thread::spawn(move || {
        loop {
            let reminder = {
                let mut guard = scheduler.reminders.lock().unwrap_or_else(|e| e.into_inner());
                loop {
                    let next = guard
                        .values()
                        .min_by_key(|item| item.fire_at_ms)
                        .cloned();
                    let Some(next) = next else {
                        guard = scheduler
                            .changed
                            .wait(guard)
                            .unwrap_or_else(|e| e.into_inner());
                        continue;
                    };
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    if next.fire_at_ms > now_ms {
                        let wait = Duration::from_millis(next.fire_at_ms - now_ms);
                        let result = scheduler
                            .changed
                            .wait_timeout(guard, wait)
                            .unwrap_or_else(|e| e.into_inner());
                        guard = result.0;
                        continue;
                    }
                    guard.remove(&next.reminder_id);
                    break next;
                }
            };

        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        // After sleep, let the JS missed-reminder pass coalesce stale items
        // instead of showing every overdue in-process reminder at once.
        if now_ms.saturating_sub(reminder.fire_at_ms) > 2 * 60 * 1000 {
            continue;
        }
        let _ = app
            .notification()
            .builder()
            .title(&reminder.title)
            .body(&reminder.body)
            .show();
        let _ = app.emit(
            "native-reminder-fired",
            serde_json::json!({
                "id": reminder.reminder_id,
                "taskId": reminder.task_id,
                "title": reminder.title,
                "body": reminder.body,
                "firedAt": reminder.fire_at_ms
            }),
        );
        }
    });
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OsReminderSyncResult {
    ok: bool,
    scheduled_count: usize,
    overflow_count: usize,
    truncated: bool,
    error: Option<String>,
    hosted_ids: Vec<String>,
}

#[tauri::command]
fn sync_native_notifications(
    scheduled: tauri::State<'_, Arc<ReminderScheduler>>,
    reminders: Vec<NativeReminder>,
) -> Result<OsReminderSyncResult, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mapped: Vec<os_reminders::OsReminder> = reminders
        .iter()
        .map(|item| os_reminders::OsReminder {
            id: item.reminder_id.clone(),
            title: item.title.clone(),
            body: item.body.clone(),
            fire_at_ms: item.fire_at_ms,
        })
        .collect();
    let window = os_reminders::select_window(&mapped, now_ms);
    let os_error = os_reminders::sync(&window.windowed).err();
    let os_ok = os_error.is_none();
    let windowed_ids: std::collections::HashSet<String> =
        window.windowed.iter().map(|item| item.id.clone()).collect();

    let mut guard = scheduled.reminders.lock().map_err(|e| e.to_string())?;
    guard.clear();
    let in_process: Vec<NativeReminder> = if os_ok {
        reminders
            .into_iter()
            .filter(|item| item.fire_at_ms > now_ms && !windowed_ids.contains(&item.reminder_id))
            .collect()
    } else {
        reminders
            .into_iter()
            .filter(|item| item.fire_at_ms > now_ms)
            .collect()
    };
    guard.extend(
        in_process
            .into_iter()
            .map(|item| (item.reminder_id.clone(), item)),
    );
    drop(guard);
    scheduled.changed.notify_all();
    Ok(OsReminderSyncResult {
        ok: os_ok,
        scheduled_count: if os_ok { window.windowed.len() } else { 0 },
        overflow_count: if os_ok {
            window.overflow.len()
        } else {
            mapped.iter().filter(|item| item.fire_at_ms > now_ms).count()
        },
        truncated: os_ok && window.truncated,
        error: os_error,
        hosted_ids: if os_ok {
            window.windowed.iter().map(|item| item.id.clone()).collect()
        } else {
            Vec::new()
        },
    })
}

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "今日待办", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &today, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .menu_on_left_click(false)
        .tooltip("有秋 · Yield");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    } else {
        eprintln!("tray: missing default window icon; continuing without tray icon image");
    }
    let _tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "today" => {
                let _ = app.emit("tray:today", ());
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(Arc::new(ReminderScheduler::default()))
        .plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![]),
            ));
    }
    builder
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("app-data")
                .setup(|app, _api| {
                    let app_data_dir = app.path().app_data_dir()?;
                    std::fs::create_dir_all(&app_data_dir)?;
                    apply_pending_database_restore(&app_data_dir)?;
                    create_startup_database_backup(&app_data_dir)?;
                    Ok(())
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            sync_native_notifications,
            database_health,
            list_database_backups,
            create_database_backup,
            schedule_database_restore,
            cancel_database_restore,
            write_backup_file,
            read_backup_file,
            open_notification_settings,
            open_data_directory,
            restart_app
        ])
        .setup(|app| {
            let scheduler = Arc::clone(app.state::<Arc<ReminderScheduler>>().inner());
            start_notification_scheduler(app.handle().clone(), scheduler);
            #[cfg(desktop)]
            setup_tray(app.handle())?;
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_title("有秋 · Yield");
                let _ = main.set_focus();
                let app_handle = app.handle().clone();
                let closed_to_tray = Arc::new(AtomicBool::new(false));
                let closed_flag = Arc::clone(&closed_to_tray);
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        closed_flag.store(true, Ordering::Relaxed);
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                            let _ = app_handle.emit("main:hidden-to-tray", ());
                        }
                    }
                });
                // 前端未成功调起显示时的兜底；用户已主动关闭进托盘时不再唤起。
                let fallback_window = main.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    if !closed_to_tray.load(Ordering::Relaxed)
                        && matches!(fallback_window.is_visible(), Ok(false))
                    {
                        let _ = fallback_window.show();
                        let _ = fallback_window.set_focus();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            let message = format!(
                "有秋 无法启动。\n\n{}\n\n你的任务数据仍保存在本机，请不要删除应用数据目录。",
                error
            );
            show_startup_error(&message);
        });
}
