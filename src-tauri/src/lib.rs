use tauri::{AppHandle, Emitter, Manager, WindowEvent};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
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
    // Android 系统文件选择器返回 content:// URI，std::fs 无法读取，
    // 需经 ContentResolver 打开输入流（Kotlin 助手 BackupContentReader）。
    #[cfg(target_os = "android")]
    if path.starts_with("content:") {
        return read_android_content_uri(&path);
    }
    std::fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
fn read_android_content_uri(uri: &str) -> Result<String, String> {
    use std::sync::mpsc;

    let uri = uri.to_string();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    // Tauri 命令线程没有已初始化的 android JNI 上下文（ndk-context 未初始化），
    // 必须经 wry 的调度在主 looper 线程执行 JNI。
    wry::prelude::dispatch(move |env, activity, _webview| {
        let _ = tx.send(read_content_uri_with_jni(env, activity, &uri));
    });
    rx.recv()
        .map_err(|_| "JNI 通道不可用".to_string())?
}

#[cfg(target_os = "android")]
fn read_content_uri_with_jni(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject<'_>,
    uri: &str,
) -> Result<String, String> {
    use jni::objects::JValue;

    let class = wry::prelude::find_class(
        env,
        activity,
        "com.yunshan.youqiu.BackupContentReader".to_string(),
    )
    .map_err(|error| error.to_string())?;
    let juri = env.new_string(uri).map_err(|error| error.to_string())?;
    let result = env
        .call_static_method(
            &class,
            "read",
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(activity), JValue::Object(&juri)],
        )
        .map_err(|error| error.to_string())?;
    let jstring = result.l().map_err(|error| error.to_string())?;
    if jstring.is_null() {
        return Err("无法读取所选文件（content://），请改用应用内导出的备份文件".into());
    }
    let jstr = jni::objects::JString::from(jstring);
    let text = env
        .get_string(&jstr)
        .map_err(|error| error.to_string())?;
    Ok(text.to_string_lossy().into_owned())
}

/// 状态栏带与在应用主题同源：原生 DayNight 资源只认系统深浅色，应用内主题是
/// 独立选择的——系统深色 + 应用清昼时，状态栏一带露出深色窗口底色，与浅色应用
/// 割裂成一条黑带（真机反馈）。前端把解析后的 --surface-base 与明暗档传来，
/// Kotlin 助手（WindowAppearance）贴窗口背景并翻系统栏图标色。
#[tauri::command]
fn set_window_appearance(color: String, light_background: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        wry::prelude::dispatch(move |env, activity, _webview| {
            let _ = tx.send(apply_window_appearance(env, activity, &color, light_background));
        });
        return rx.recv().map_err(|_| "JNI 通道不可用".to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (color, light_background);
        Ok(())
    }
}

#[cfg(target_os = "android")]
fn apply_window_appearance(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject<'_>,
    color: &str,
    light_background: bool,
) -> Result<(), String> {
    use jni::objects::JValue;

    let class = wry::prelude::find_class(
        env,
        activity,
        "com.yunshan.youqiu.WindowAppearance".to_string(),
    )
    .map_err(|error| error.to_string())?;
    let jcolor = env.new_string(color).map_err(|error| error.to_string())?;
    env.call_static_method(
        &class,
        "apply",
        "(Landroid/app/Activity;Ljava/lang/String;Z)V",
        &[
            JValue::Object(activity),
            JValue::Object(&jcolor),
            JValue::Bool(light_background as u8),
        ],
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
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
        Migration {
            version: 3,
            description: "sync_outbox_triggers",
            // M4 数据同步：outbox 触发器把业务表写入捕获为待上传日志条目；
            // sync_state 记录每键已应用的 HLC（LWW 比较依据）；sync_merge_seen
            // 抑制合并远端数据时的回声（同键同时间戳的写入不重复入箱）。
            sql: r#"

-- ===== 同步基础设施（M4）：outbox 捕获、合并状态、回声抑制 =====
CREATE TABLE IF NOT EXISTS sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  ts_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_seq ON sync_outbox(seq);
CREATE TABLE IF NOT EXISTS sync_state (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  hlc_p INTEGER NOT NULL,
  hlc_l INTEGER NOT NULL,
  hlc_d TEXT NOT NULL,
  PRIMARY KEY (table_name, row_id)
);
-- merge 应用远端条目前的登记：命中登记且时间戳一致的本地触发不再写 outbox。
CREATE TABLE IF NOT EXISTS sync_merge_seen (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

CREATE TRIGGER IF NOT EXISTS trg_projects_ins AFTER INSERT ON projects
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'projects' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('projects', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_upd AFTER UPDATE ON projects
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'projects' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('projects', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_del AFTER DELETE ON projects
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('projects', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_goals_ins AFTER INSERT ON goals
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goals' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goals', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goals_upd AFTER UPDATE ON goals
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goals' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goals', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goals_del AFTER DELETE ON goals
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goals', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_ins AFTER INSERT ON tags
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'tags' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tags', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_upd AFTER UPDATE ON tags
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'tags' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tags', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_del AFTER DELETE ON tags
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tags', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_habits_ins AFTER INSERT ON habits
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'habits' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habits', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_habits_upd AFTER UPDATE ON habits
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'habits' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habits', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_habits_del AFTER DELETE ON habits
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habits', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_anniversaries_ins AFTER INSERT ON anniversaries
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'anniversaries' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('anniversaries', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_anniversaries_upd AFTER UPDATE ON anniversaries
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'anniversaries' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('anniversaries', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_anniversaries_del AFTER DELETE ON anniversaries
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('anniversaries', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_ins AFTER INSERT ON tasks
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'tasks' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tasks', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_upd AFTER UPDATE ON tasks
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'tasks' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tasks', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_del AFTER DELETE ON tasks
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('tasks', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_ins AFTER INSERT ON task_planning_metadata
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'task_planning_metadata' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_upd AFTER UPDATE ON task_planning_metadata
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'task_planning_metadata' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_del AFTER DELETE ON task_planning_metadata
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_milestones_ins AFTER INSERT ON milestones
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'milestones' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('milestones', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_milestones_upd AFTER UPDATE ON milestones
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'milestones' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('milestones', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_milestones_del AFTER DELETE ON milestones
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('milestones', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_entries_ins AFTER INSERT ON goal_entries
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goal_entries' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_entries', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_entries_upd AFTER UPDATE ON goal_entries
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goal_entries' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_entries', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_entries_del AFTER DELETE ON goal_entries
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_entries', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_milestones_ins AFTER INSERT ON goal_milestones
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goal_milestones' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_milestones', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_milestones_upd AFTER UPDATE ON goal_milestones
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'goal_milestones' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_milestones', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_goal_milestones_del AFTER DELETE ON goal_milestones
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('goal_milestones', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_memos_ins AFTER INSERT ON memos
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'memos' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('memos', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_memos_upd AFTER UPDATE ON memos
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'memos' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('memos', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_memos_del AFTER DELETE ON memos
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('memos', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_timers_ins AFTER INSERT ON timers
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'timers' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('timers', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_timers_upd AFTER UPDATE ON timers
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'timers' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('timers', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_timers_del AFTER DELETE ON timers
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('timers', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_categories_ins AFTER INSERT ON ledger_categories
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_categories' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_categories', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_categories_upd AFTER UPDATE ON ledger_categories
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_categories' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_categories', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_categories_del AFTER DELETE ON ledger_categories
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_categories', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_accounts_ins AFTER INSERT ON ledger_accounts
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_accounts' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_accounts', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_accounts_upd AFTER UPDATE ON ledger_accounts
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_accounts' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_accounts', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_accounts_del AFTER DELETE ON ledger_accounts
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_accounts', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_transactions_ins AFTER INSERT ON ledger_transactions
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_transactions' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_transactions', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_transactions_upd AFTER UPDATE ON ledger_transactions
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_transactions' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_transactions', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_transactions_del AFTER DELETE ON ledger_transactions
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_transactions', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_budgets_ins AFTER INSERT ON ledger_budgets
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_budgets' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_budgets', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_budgets_upd AFTER UPDATE ON ledger_budgets
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'ledger_budgets' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_budgets', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_budgets_del AFTER DELETE ON ledger_budgets
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('ledger_budgets', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_tags_ins AFTER INSERT ON task_tags
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'task_tags' AND row_id = NEW.task_id || ':' || NEW.tag_id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_tags', NEW.task_id || ':' || NEW.tag_id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_tags_del AFTER DELETE ON task_tags
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_tags', OLD.task_id || ':' || OLD.tag_id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_habit_checks_ins AFTER INSERT ON habit_checks
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'habit_checks' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habit_checks', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_habit_checks_del AFTER DELETE ON habit_checks
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habit_checks', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_focus_sessions_ins AFTER INSERT ON focus_sessions
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'focus_sessions' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('focus_sessions', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_focus_sessions_del AFTER DELETE ON focus_sessions
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('focus_sessions', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS trg_achievements_ins AFTER INSERT ON achievements
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'achievements' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('achievements', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_achievements_del AFTER DELETE ON achievements
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('achievements', OLD.id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "sync_fix_task_planning_triggers",
            // v3 生成 task_planning_metadata 触发器时误用了不存在的 id 列
            //（该表主键是 task_id；SQLite 建触发器不校验列名，触发时才报错）。
            // v3 原地已改对，此处 DROP 重建覆盖已应用过旧 v3 的库。
            sql: r#"
DROP TRIGGER IF EXISTS trg_task_planning_metadata_ins;
DROP TRIGGER IF EXISTS trg_task_planning_metadata_upd;
DROP TRIGGER IF EXISTS trg_task_planning_metadata_del;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_ins AFTER INSERT ON task_planning_metadata
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'task_planning_metadata' AND row_id = NEW.task_id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', NEW.task_id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_upd AFTER UPDATE ON task_planning_metadata
WHEN NEW.updated_at IS NOT OLD.updated_at
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'task_planning_metadata' AND row_id = NEW.task_id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', NEW.task_id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;

CREATE TRIGGER IF NOT EXISTS trg_task_planning_metadata_del AFTER DELETE ON task_planning_metadata
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('task_planning_metadata', OLD.task_id, 'delete', CAST(ROUND((julianday('now')-2440587.5)*86400000.0) AS INTEGER));
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "sync_fix_habit_checks_trigger",
            // v3 给 habit_checks 的 ins 触发器引用了不存在的 created_at 列
            //（该表只有 id/habit_id/check_date，无任何时间戳列），打卡写入即报
            // no such column。表内无时间戳可用，ts_ms 取常量 0，与 TS 侧
            // rowTsMs() 对无时间戳表返回 0 的约定一致，合并回声抑制可对上。
            sql: r#"
DROP TRIGGER IF EXISTS trg_habit_checks_ins;

CREATE TRIGGER IF NOT EXISTS trg_habit_checks_ins AFTER INSERT ON habit_checks
WHEN NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'habit_checks' AND row_id = NEW.id AND ts_ms = 0)
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('habit_checks', NEW.id, 'upsert', 0);
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "sync_tag_alias",
            // tags.name 有 UNIQUE 约束：双端各自种出同名标签（随机 id）时，
            // 合并对端条目会撞键。TS 侧合并后端按"收养"解决——保留本地同名词行，
            // 把对端 id 映射到本地 id，后续 task_tags 条目经映射改写 tag_id。
            // 映射必须跨同步轮持久化（拉取按水位增量，关联条目可能晚于标签
            // 若干轮才到），故落一张设备本地簿记表。
            sql: r#"
CREATE TABLE IF NOT EXISTS sync_tag_alias (
  remote_row_id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  ts_ms INTEGER NOT NULL
);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "drop_focus_sessions",
            // 专注（番茄钟）功能永久下线：删表并清掉历史数据与残留簿记——
            // 同步 outbox/state 里可能滞留的 focus_sessions 行、心跳设置键。
            // TS 侧已同步移除该表的同步注册与备份读写；旧日志里的同名条目
            // 经 isSyncTable 过滤自然跳过。
            sql: r#"
DROP INDEX IF EXISTS idx_focus_sessions_task;
DROP TABLE IF EXISTS focus_sessions;
DELETE FROM sync_outbox WHERE table_name = 'focus_sessions';
DELETE FROM sync_state WHERE table_name = 'focus_sessions';
DELETE FROM settings WHERE key = 'active_focus';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "drop_estimated_minutes",
            // 预计时长概念下线：编辑/新建表单与 UI 均不再展示，
            // TS 侧读写与同步注册已同步移除该列，这里从库里删掉。
            sql: r#"ALTER TABLE task_planning_metadata DROP COLUMN estimated_minutes;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "projects_tag_id",
            // 标签系统重构：项目可携带一个标签，新建项目界面选择；
            // 选择该项目的任务默认继承这个标签。列为可空，旧项目无标签。
            sql: r#"ALTER TABLE projects ADD COLUMN tag_id TEXT;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "drop_project_goal_criteria_milestones",
            // 项目成果 / 成功标准 / 项目里程碑功能永久下线：UI 与 TS 读写
            // 已移除，这里删表删列，并清理同步簿记。projects_tag_backup 是
            // 评审期手工备份的项目标签值（正式版不带该表，IF NOT EXISTS
            // 兜底为空表），回填进 tag_id 后删除。goal_milestones 是成长
            // 目标的里程碑，另一套功能，保留。
            sql: r#"
CREATE TABLE IF NOT EXISTS projects_tag_backup (project_id TEXT PRIMARY KEY, tag_id TEXT);
UPDATE projects SET tag_id = (
  SELECT b.tag_id FROM projects_tag_backup AS b WHERE b.project_id = projects.id
)
WHERE EXISTS (SELECT 1 FROM projects_tag_backup AS b WHERE b.project_id = projects.id);
DROP TABLE projects_tag_backup;
DELETE FROM sync_outbox WHERE table_name = 'milestones';
DELETE FROM sync_state WHERE table_name = 'milestones';
DELETE FROM sync_merge_seen WHERE table_name = 'milestones';
DROP TABLE IF EXISTS milestones;
ALTER TABLE projects DROP COLUMN goal;
ALTER TABLE projects DROP COLUMN success_criteria;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "resync_project_tags",
            // 项目标签回填修复：v10 的回填 UPDATE 不改 updated_at，而项目
            // 同步触发器（trg_projects_upd）只在 updated_at 变化时入箱，
            // 回填进来的 tag_id 从未进入同步日志；对端若已在旧版本下消费过
            // 更早的条目（水位推进），标签就永远同步不过去。这里把带标签的
            // 项目重新压入 outbox，下一轮排水以新 HLC 全行重发，LWW 收敛。
            // 只挑 tag_id 非空的行：无标签的旧条目不重发，避免旧空值盖新值。
            sql: r#"
INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
SELECT 'projects', CAST(id AS TEXT), 'upsert',
  COALESCE(CAST(ROUND((julianday(NULLIF(updated_at,''))-2440587.5)*86400000.0) AS INTEGER), 0)
FROM projects WHERE tag_id IS NOT NULL;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "projects_soft_delete",
            // 项目进回收站：deleted_at 置时间戳即视为已删除，行保留可恢复；
            // 软删走 updated_at 变化经 trg_projects_upd 入箱，对端按行 LWW
            // 收敛；永久删除走 trg_projects_del 的 delete 操作。
            sql: r#"ALTER TABLE projects ADD COLUMN deleted_at TEXT;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "drop_dead_columns",
            // 三个零值/恒空冗余列下线：tasks.actual_minutes（「实际用时」
            // 从未落地，恒 0）、timers.task_id（任务关联提醒未落地，
            // 恒 NULL）、achievements.image_path（成就配图未落地，恒 NULL）。
            // 同步列白名单同步收窄，SYNC_SCHEMA_VERSION 升至 5：旧端条目
            // 带这些键时经 projectRowData 白名单投影自然丢弃；新端条目在
            // 旧端被 schema 闸门整体拒收并提示升级，不存在静默丢列。
            sql: r#"
ALTER TABLE tasks DROP COLUMN actual_minutes;
ALTER TABLE timers DROP COLUMN task_id;
ALTER TABLE achievements DROP COLUMN image_path;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "habit_target_days",
            // 习惯从每周次数改为可跟踪的累计目标天数；null 表示无限期，
            // 旧习惯迁移后保持无限期，不猜测目标。
            sql: r#"ALTER TABLE habits ADD COLUMN target_days INTEGER;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "habit_archive_and_trash",
            // 习惯与项目对齐：可归档；删除走回收站，行保留可恢复。
            sql: r#"
ALTER TABLE habits ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE habits ADD COLUMN deleted_at TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "drop_dead_task_planning_fields",
            // 任务"无入口字段"永久下线（评审 P0-2 选②：删文档描述并清理死字段）：
            // - tasks.blocked_by_id（前置依赖）、completion_criteria（完成标准）、
            //   energy_level（精力要求）、flexible / schedule_locked（灵活排程）
            //   已在早期版本从编辑表单移除，仅剩透传，真实数据恒为空/默认值；
            // - task_planning_metadata 只存任务级 reminder_minutes_json（多次提醒），
            //   UI 无入口且全库为空，提醒统一走 settings 的全局提前量；
            // - 同步范围同步收窄（列白名单 + 表注册 + outbox 基线），
            //   SYNC_SCHEMA_VERSION 升至 8。
            // drop 列前先删依赖索引；SQLite 的 DROP COLUMN 不允许列被索引引用。
            // 数据库只向前升级：这些列/表无真实数据，删除不损失用户内容。
            sql: r#"
DROP INDEX IF EXISTS idx_tasks_schedule_locked;
ALTER TABLE tasks DROP COLUMN blocked_by_id;
ALTER TABLE tasks DROP COLUMN completion_criteria;
ALTER TABLE tasks DROP COLUMN energy_level;
ALTER TABLE tasks DROP COLUMN flexible;
ALTER TABLE tasks DROP COLUMN schedule_locked;
DROP TRIGGER IF EXISTS trg_task_planning_metadata_ins;
DROP TRIGGER IF EXISTS trg_task_planning_metadata_upd;
DROP TRIGGER IF EXISTS trg_task_planning_metadata_del;
DROP TABLE IF EXISTS task_planning_metadata;
DELETE FROM sync_outbox WHERE table_name = 'task_planning_metadata';
DELETE FROM sync_state WHERE table_name = 'task_planning_metadata';
DELETE FROM sync_merge_seen WHERE table_name = 'task_planning_metadata';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "task_delay_reason",
            // 复盘 P1-2：延期完成的任务可标注原因，复盘页按周展示归因。
            // 列为可空文本，旧任务保持 NULL（显示「未标注原因」）；该列进入
            // 同步列白名单，SYNC_SCHEMA_VERSION 升至 9。
            sql: r#"ALTER TABLE tasks ADD COLUMN delay_reason TEXT;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "habit_target_per_week_default",
            // 复盘 P1-2：习惯的「每周目标次数」此前落库恒为 0（UI 无入口），
            // 统一回填为默认 3 次/周；越界值一并归一，之后由新建/编辑表单维护。
            // 不触碰 updated_at，避免把本地回填误当成用户编辑推给其他设备。
            sql: r#"
UPDATE habits SET target_per_week = 3
WHERE target_per_week IS NULL OR target_per_week < 1 OR target_per_week > 7;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "drop_task_delay_reason",
            // 复盘 P1-2 下线：延期完成判定与归因从产品中移除。
            // delay_reason 自 v17 起只承载复盘页的备注展示，UI 删除后真实
            // 数据无需保留；同步日志里的同名键由列白名单投影自然丢弃。
            // 数据库只向前升级：删列不损失用户内容。
            sql: r#"ALTER TABLE tasks DROP COLUMN delay_reason;"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "slim_goal_fields_and_types",
            // 成长目标模块收敛：time 型没有自动数据来源（focus 记录从未落库）、
            // custom 与 quantity 的手动记录完全重合，统一转为 quantity；
            // icon 全程无 UI 入口，description 从未被表单写入（语义由
            // motivation 承担），一并删列。只向前升级，不触碰 updated_at。
            sql: r#"
UPDATE goals SET goal_type = 'quantity'
WHERE goal_type IN ('time', 'custom');
ALTER TABLE goals DROP COLUMN icon;
ALTER TABLE goals DROP COLUMN description;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "sync_fix_achievements_update_trigger",
            // achievements 是追加型表：v3 只给了 ins/del 两个触发器，而它唯一
            // 的可更新列 pinned（成就置顶）在同步白名单里——改了永远不入箱，
            // 置顶状态因此在设备间各说各话。守卫只能盯 pinned 本身：该表没有
            // updated_at，created_at 恒定不变。ts 仍取 created_at，与合并落库
            // 时登记的 sync_merge_seen 同源，对端应用不会反弹回声；排水时
            // HLC 的 p 由本端时钟单调推进（tick 取 max），不会被排到旧位置。
            // 日志格式未变（pinned 一直都在），SYNC_SCHEMA_VERSION 不升版。
            sql: r#"
CREATE TRIGGER IF NOT EXISTS trg_achievements_upd AFTER UPDATE ON achievements
WHEN NEW.pinned IS NOT OLD.pinned
  AND NOT EXISTS (SELECT 1 FROM sync_merge_seen WHERE table_name = 'achievements' AND row_id = NEW.id AND ts_ms = COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0))
BEGIN
  INSERT INTO sync_outbox(table_name, row_id, op, ts_ms)
  VALUES ('achievements', NEW.id, 'upsert', COALESCE(CAST(ROUND((julianday(NULLIF(NEW.created_at,''))-2440587.5)*86400000.0) AS INTEGER), 0));
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "goal_habit_task_linkage_v2",
            // 目标 / 习惯 / 任务三者的关系模型收口（v1.4.0）：
            //
            // 1. 习惯接管重复能力：新增 habits.repeat_rule（JSON 排期规则；
            //    空 = 浮动次数模式，与旧行为一致）。
            // 2. 任务不再重复：删除 tasks.repeat_rule。带重复规则的任务先转成
            //    对应习惯，原任务软删除进回收站——不丢用户数据，可恢复。
            // 3. 周口径归习惯：删除 goals.weekly_target。目标不再承载任何
            //    周期口径，「每周 N 次」是习惯的事。
            // 4. 目标类型归并：quantity/custom/frequency/time → milestone，
            //    change → measure；项目型目标退役——完成率先固化成一条记录，
            //    再转成 0→100% 的数值目标（项目本身与任务不受影响，进度仍在
            //    项目页可见）。
            // 5. 关联默认不计量：tasks/habits.goal_contribution 置 0
            //    （0 = 只关联、不计数；>0 = 计量 N 个单位）。
            // 6. 历史贡献合并：goal_entries 里 task/habit/focus 来源的记录按目标
            //    合并成一条 manual 记录，进度数值不变，但之后不再被动变化。
            sql: r#"
ALTER TABLE habits ADD COLUMN repeat_rule TEXT;

INSERT INTO habits (id, title, target_per_week, goal_id, goal_contribution, repeat_rule, created_at, updated_at)
SELECT 'h_' || id, title, 3, goal_id, 0, repeat_rule, created_at, updated_at
FROM tasks
WHERE repeat_rule IS NOT NULL AND deleted_at IS NULL;

UPDATE tasks SET deleted_at = updated_at, repeat_rule = NULL
WHERE repeat_rule IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE tasks DROP COLUMN repeat_rule;
ALTER TABLE goals DROP COLUMN weekly_target;
ALTER TABLE goals DROP COLUMN project_id;

INSERT INTO goal_entries (id, goal_id, entry_date, value, source_type, source_id, note, created_at, updated_at)
SELECT 'gp_' || id, id, COALESCE(date(updated_at), date('now')), current_value, 'manual', NULL, '原项目完成率', updated_at, updated_at
FROM goals
WHERE goal_type = 'project' AND current_value != 0;

UPDATE goals SET start_value = 0, target_value = 100, unit = '%', goal_type = 'milestone'
WHERE goal_type = 'project';

UPDATE goals SET goal_type = 'milestone' WHERE goal_type IN ('quantity', 'custom', 'frequency', 'time');
UPDATE goals SET goal_type = 'measure' WHERE goal_type = 'change';

UPDATE tasks SET goal_contribution = 0;
UPDATE habits SET goal_contribution = 0;

INSERT INTO goal_entries (id, goal_id, entry_date, value, source_type, source_id, note, created_at, updated_at)
SELECT 'gm_' || goal_id || '_' || COUNT(*), goal_id, MAX(entry_date), SUM(value), 'manual', NULL, '历史贡献合并', MAX(updated_at), MAX(updated_at)
FROM goal_entries
WHERE source_type IN ('task', 'habit', 'focus')
GROUP BY goal_id
HAVING SUM(value) != 0;

DELETE FROM goal_entries WHERE source_type IN ('task', 'habit', 'focus');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "drop_task_generated_from_id",
            // 重复任务下线后，tasks.generated_from_id 与它带的两个索引都成了死结构。
            // 拆成独立的 v23，而不是塞进 v22：v22 可能已经被部分机器应用过，
            // 改动已发布 migration 的 SQL 会让 sqlx 的校验和对不上，迁移直接失败
            // （应用起不来）。v22 保留该列，v23 无条件删除——所有到达 v23 的库
            // 都有这一列，两条路径（新装 / 升级）最终结构完全一致。
            sql: r#"
DROP INDEX IF EXISTS uq_tasks_repeat_occurrence;
DROP INDEX IF EXISTS idx_tasks_generated_from;
ALTER TABLE tasks DROP COLUMN generated_from_id;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "goal_soft_delete",
            // 目标也要能撤回：放弃与归档本来就可恢复，但"删除"此前只能硬删或
            // 根本没有。加一列 deleted_at，目标进回收站、可恢复、可永久删除，
            // 与任务 / 习惯 / 项目 / 账目的处理方式一致。
            sql: r#"
ALTER TABLE goals ADD COLUMN deleted_at TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "goal_merge_archived_into_completed",
            // 目标的状态从五个收敛到四个：active / paused / completed / abandoned。
            // 原来的 archived 与 completed 语义重叠（两个都在说"结束了"），而项目、
            // 习惯、备忘录里"归档"是唯一表达"收起来了"的动作——按同一套约定，
            // 目标上的"归档"就等于"已完成"。历史 archived 目标并入 completed。
            sql: r#"
UPDATE goals SET status = 'completed' WHERE status = 'archived';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "drop_attachments",
            // 附件功能下线：任务详情里的拖拽上传与附件列表整体移除，附件表随之
            // 删除。表无外键引用、也不参与同步，直接 DROP。
            sql: r#"
DROP TABLE IF EXISTS attachments;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "drop_goal_milestones_achievements",
            // 阶段目标与成就功能下线：阶段清单（goal_milestones）会劫持进度——给
            // 一个累计型目标加第一个阶段就把 goal_type 翻成 staged、单位换成「个
            // 阶段」、分母换成阶段数，之前累计的投入进度被覆盖。连同成就墙一起删，
            // 进度只留一个口径：投入 / 目标值。先把历史 staged 目标改回累计计数型
            // （单位「个阶段」归成「次」），再删两张表。两表带的同步触发器随表消失。
            sql: r#"
UPDATE goals
SET goal_type = 'milestone',
    unit = CASE WHEN unit = '个阶段' THEN '次' ELSE unit END
WHERE goal_type = 'staged';
DROP TABLE IF EXISTS goal_milestones;
DROP TABLE IF EXISTS achievements;
DELETE FROM sync_outbox WHERE table_name IN ('goal_milestones', 'achievements');
DELETE FROM sync_state WHERE table_name IN ('goal_milestones', 'achievements');
DELETE FROM sync_merge_seen WHERE table_name IN ('goal_milestones', 'achievements');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "goal_abandoned_to_paused",
            // 「放弃」功能整体下线：动作行的放弃钮、恢复钮与「已放弃」分区全部
            // 移除，GoalStatus 收敛为 active / paused / completed。历史 abandoned
            // 目标归为暂停——不进进行中的流程感、但可继续可完成，用户回来自己能
            // 定夺。同步层 SYNC_SCHEMA_VERSION 升至 12：旧端发来的 abandoned 在
            // 投影落库前同样归一为 paused。
            sql: r#"
UPDATE goals SET status = 'paused' WHERE status = 'abandoned';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "goal_progress_events_only",
            // 目标进度只剩一个来源：任务完成与习惯打卡的计量事件。
            // - goal_type 下线：measure（只认手动测量）随手动记录一起退役，
            //   所有目标统一为「基线 0 + 事件累计」的计数口径；
            // - start_value 下线：没有数值输入后它恒为 0，进度公式退化为
            //   current / target；
            // - manual_completion 下线：completed 改终点语义（达成或手点完成
            //   即定，永不自动回退），这列的回退保护分支整个删除；
            // - 手动记录（manual 及历史残留 focus/milestone 来源）删除：
            //   测试期数据，不做语义并入基线的换算。
            // 同步层 SYNC_SCHEMA_VERSION 升至 13：旧端多余列经列白名单投影
            // 丢弃，旧端 manual 记录由本端复算口径天然忽略。
            sql: r#"
DELETE FROM goal_entries WHERE source_type NOT IN ('task','habit');
ALTER TABLE goals DROP COLUMN goal_type;
ALTER TABLE goals DROP COLUMN start_value;
ALTER TABLE goals DROP COLUMN manual_completion;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "goal_entries_ledger_only",
            // 本周页「当周目标推进」下线（2026-10-30），手动记录的最后出口随之
            // 关闭：v29 清过一次的非事件行（manual 及历史 focus/milestone），
            // 混窗期仍可能从旧端同步进来，发布时点再清一遍，把账本收口为纯
            // 计量事件行。进度口径不变（只认 task/habit），旧端再送来的行依旧
            // 由复算口径天然忽略。
            sql: r#"
DELETE FROM goal_entries WHERE source_type NOT IN ('task','habit');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "retire_reminders",
            // 提醒功能下线（页面改版为番茄钟「专注」）：通知中心表整表删除；
            // notify_ahead 设置项随系统提醒一起退役；既有循环提醒（interval）
            // 计时行清空。timers 表保留，复用为专注会话记录。
            sql: r#"
DROP TABLE IF EXISTS app_notifications;
DELETE FROM settings WHERE key = 'notify_ahead';
DELETE FROM timers WHERE kind = 'interval';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "focus_task_link",
            // 专注与任务的三档关联落库：task_mode（none/existing/new）、
            // task_ref_id（existing 档指向的已有任务）、task_draft（new 档
            // 预填的任务信息 JSON）。历史行一律按「不关联」回填，与旧行为一致。
            sql: r#"
ALTER TABLE timers ADD COLUMN task_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE timers ADD COLUMN task_ref_id TEXT;
ALTER TABLE timers ADD COLUMN task_draft TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "focus_logs",
            // 专注完成流水：点「完成」落账时一行一段（三档关联都记），支撑
            // 「今日已专注 x 次」。本机统计用，暂不进同步与备份（本地流水，
            // 无跨端合并语义；同步层未注册该表，旧日志也无同名条目）。
            sql: r#"
CREATE TABLE IF NOT EXISTS focus_logs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  task_id TEXT,
  ended_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_logs_ended_at ON focus_logs (ended_at);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "rename_accounts_campus_bank",
            // 内置账户更名：储蓄卡→校园卡、信用卡→银行卡。按稳定 kind 定位，且仅在
            // 仍是历史默认名时才改（用户若已自行改名则不动，UNIQUE(kind,name) 也保证
            // 同名至多一条）。明细按 account_id JOIN 取 account_name，账户更名后历史
            // 明细的账户显示自动跟随，无需另迁 ledger_transactions。kind/icon 不动。
            sql: r#"
UPDATE ledger_accounts SET name = '校园卡' WHERE kind = 'card' AND name = '储蓄卡';
UPDATE ledger_accounts SET name = '银行卡' WHERE kind = 'credit' AND name = '信用卡';
"#,
            kind: MigrationKind::Up,
        },
    ]
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
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
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
            database_health,
            list_database_backups,
            create_database_backup,
            schedule_database_restore,
            cancel_database_restore,
            write_backup_file,
            read_backup_file,
            open_data_directory,
            set_window_appearance,
            restart_app
        ])
        .setup(|app| {
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
