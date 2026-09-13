# 有秋（Yield）架构与技术栈

本文描述「有秋（Yield）」的技术栈、模块结构与关键机制，供开发与维护时快速定位。产品语义与需求取舍见 `docs/PRODUCT_DECISIONS.md`，变更历史约定见 `docs/CHANGES.md`。

## 1. 项目定位

本地优先的个人成长与行动工具（Windows/macOS 桌面端）：任务、习惯、专注、目标、复盘、收支、备忘录一体化，数据全部存本地 SQLite，无账号、无云同步。

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│ WebView 前端（React 19 + TypeScript）                      │
│  src/components/*  界面组件（30 个 + today/ 子模块）        │
│  src/app/MainApp.tsx  页面壳 + 全局副作用中枢                │
│  src/store/app.ts   Zustand 全局状态（909 行，单 store）    │
│  src/lib/*          领域纯函数 + 业务规则（可单测）           │
│  src/lib/db/*       SQLite 访问层（按域拆分）               │
├──────────────────────────────────────────────────────────┤
│ Tauri 2 桥（invoke / event / navigator.locks）             │
├──────────────────────────────────────────────────────────┤
│ Rust 后端（src-tauri/src）                                 │
│  lib.rs   入口 run()、migrations()、11 个 command、托盘     │
│  os_reminders.rs  OS 级提醒调度（应用退出后仍生效）           │
├──────────────────────────────────────────────────────────┤
│ SQLite（%APPDATA%\com.yunshan.yield\app.db，WAL）          │
└──────────────────────────────────────────────────────────┘
```

数据流单向：组件 → store → lib/db → SQL；领域规则全部下沉在 `src/lib/` 纯函数层，组件不直接写 SQL，db 层不做业务判断。

## 3. 技术栈

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 桌面框架 | Tauri | 2 | 窗口/托盘/系统插件/打包 |
| 界面 | React + TypeScript | 19.1 / ~5.8 | 无 UI 框架库，纯手写组件 + CSS |
| 状态 | Zustand | 5.0 | 单一全局 store（`src/store/app.ts`） |
| 数据库 | SQLite（tauri-plugin-sql） | 2.4 | 本地持久化，前端直接发 SQL |
| 构建 | Vite | 6.3 | 开发服务器 + 前端产物 |
| 测试 | Vitest + happy-dom | 3.2 / 20 | 22 文件 / 118 用例 |
| 富文本 | react-markdown + remark-gfm | 10 | 备忘录 Markdown 渲染 |
| 拖拽/虚拟列表 | @dnd-kit、@tanstack/react-virtual | 6/10/3 | 任务排序、长列表 |
| 农历 | lunar-typescript | 1.8 | 纪念日农历换算 |
| Rust 侧 | tauri 2（tray-icon/protocol-asset）、serde、tauri-plugin-{sql,notification,autostart,dialog,fs,http,opener} | 2.x | 系统能力 |

## 4. 目录结构

```
src/
  main.tsx            入口；BootError 启动失败兜底屏
  app/MainApp.tsx     页面壳 + 全局副作用中枢（723 行）
  store/app.ts        Zustand store：全部状态与 action（909 行）
  components/         30 个界面组件；today/ 为今日页子组件四件
  lib/                领域纯函数（today/repeat/timeline/weeklyChecklist/…）
  lib/db/             SQLite 访问层，按域拆 11 个模块 + client.ts
  types/index.ts      全部 TS 类型（单一真源）
  styles/             index.css 级联入口 + parts/（22 个层叠文件）
scripts/              release-check.mjs、图标/安装包资产生成脚本
src-tauri/
  src/lib.rs          应用入口、migrations、commands、托盘（874 行）
  src/os_reminders.rs OS 级提醒调度（271 行）
  capabilities/permissions/  最小权限白名单
```

## 5. 前端架构

- **状态**：单 store 模式。所有视图从 `useAppStore` 取状态、调 action；action 内部调用 `lib/` 纯函数与 `lib/db/` 完成 IO。没有跨 store、没有 Context 分发。
- **副作用中枢**：`MainApp.tsx` 集中持有全局 effect——专注计时（1s `tickFocus`）、系统提醒同步（串行队列 `enqueueReminderPass`，全量/补发双定时器，补发周期 6h）、托盘事件（`tray:today`、`main:hidden-to-tray`）、自动备份（6h 周期 + `autoBackupRunningRef` 并发守卫）、toast 自毁计时。
- **数据库访问**：`src/lib/db/client.ts` 统一连接；写操作经 `withDatabaseWrite` 用 `navigator.locks`（锁名 `youqiu:database-write`）串行化，嵌套调用在同一队列回合执行避免死锁。连接后设置 `PRAGMA foreign_keys=ON / journal_mode=WAL / synchronous=NORMAL / busy_timeout=5000`。
- **样式**：`src/styles/index.css` 为级联入口，顺序刻意勿重排：`tokens` → `global-00…13`（按页面/功能域分文件）→ `polish-*`（后期覆盖层）。同特异性按加载顺序取胜，全局兜底必要时以 `!important` 对抗容器层 shorthand。
- **类型**：`src/types/index.ts` 是唯一类型真源，前后端数据经 `lib/db/*` 的 `mapXxx` 行映射函数对齐（DB 蛇形命名 → TS 驼峰）。

## 6. 后端（Rust）

- **入口**：`main.rs` 仅关闭 release 控制台窗口并调用 `youqiu_lib::run()`。`run()` 注册插件、执行 `setup`（托盘 `setup_tray`：显示/今日/退出三菜单，`tray:today` 事件回前端）、注册 `invoke_handler`。
- **启动失败兜底**：初始化异常时经 `YQ_STARTUP_ERROR` 环境变量调系统对话框展示（Windows 用 PowerShell MessageBox，macOS 用 osascript），随后可 `restart_app` 或打开数据目录。
- **11 个 `#[tauri::command]`**：`sync_native_notifications`（提醒全量同步到 OS）、`database_health`、`list/create_database_backup`、`schedule/cancel_database_restore`（延迟恢复，应用重启生效）、`write/read_backup_file`、`open_notification_settings`、`open_data_directory`、`restart_app`。
- **OS 提醒**（`os_reminders.rs`）：以应用标识 `com.yunshan.yield`（Windows AUMID / macOS 标签前缀）调度系统通知，上限 `MAX_OS_REMINDERS=48` 条、展望 `MAX_AHEAD_MS=90` 天；应用完全退出后提醒仍由系统弹出，溢出/错过部分由前端补发兜底。
- **权限**：`capabilities/main.json` + `permissions/main-app.toml` 白名单式声明，按需授权插件能力。

## 7. 数据层

- **存储位置**：`%APPDATA%\com.yunshan.yield\app.db`（SQLite 单库），WebView2 配置在 `%LOCALAPPDATA%\com.yunshan.yield`。
- **24 张表**，按域分组：
  - 任务域：`tasks`、`tags`、`task_tags`、`attachments`、`task_events`、`task_planning_metadata`（提醒时间唯一权威存储 `reminder_minutes_json`）、`projects`；
  - 目标与成长：`goals`、`goal_milestones`、`goal_entries`、`milestones`、`achievements`、`habit_checks`、`habits`、`focus_sessions`；
  - 收支（观流账本）：`ledger_accounts`、`ledger_categories`、`ledger_budgets`、`ledger_transactions`；
  - 回望：`memos`、`anniversaries`；
  - 提醒与通知：`app_notifications`；计时：`timers`；系统：`settings`（含 `schema_contract='1'` 契约种子）。
- **迁移契约**：`lib.rs::migrations()` 为单一 `youqiu_baseline` v1（`_sqlx_migrations` 驱动）；**只向前升级**——已发布迁移不可删改重排，只能追加更高版本。无存量历史库。
- **备份体系**（三层）：
  1. JSON 业务备份（`src/lib/backup.ts` + `lib/db/backup.ts`）：payload `version: 1`，导出/导入含任务、习惯、目标、纪念日、账本、设置，事务 + 回滚标记；仅接受版本 1；
  2. 自动 JSON 备份：6 小时一次，保留最近 10 份（`$APPDATA/backups/auto-backup-*.json`）；
  3. 启动时数据库**文件级**备份到 `database-backups/startup-<时间戳>/`，设置页可查看/恢复（`database_health`、`list/create_database_backup`、`schedule/cancel_database_restore`）。

## 8. 关键横切机制

| 机制 | 位置 | 说明 |
|---|---|---|
| 系统提醒同步 | `MainApp.tsx` + `lib/nativeReminders.ts` + `os_reminders.rs` | 全量/补发双定时器，串行队列防并发；OS 队列上限 48 条/90 天，超出部分应用运行时补发 |
| 软删除 | `tasks.status='trashed'` 等 | 回收站保留 30 天，恢复回原位 |
| 专注计时 | `lib/focusTimer.ts` + `PomodoroPanel` | 1s tick；异常退出经 `focusRecovery.ts` 恢复 |
| 主题 | `lib/themes.ts` + `tokens.css` | system/light/dark 三态 |
| 隐私模式 | `lib/privacy.ts` | 隐藏金额/敏感内容 |
| 检查更新 | `lib/versionUpdate.ts` + `VersionUpdateNotice` | 启动 2.5s 后静默查一次 GitHub `releases/latest`，语义化比较；手动查失败有 toast |
| 引导 | `OnboardingGuide` | 三步首启引导，`settings.onboarding_complete` 控制 |
| 托盘 | `lib.rs::setup_tray` | 显示/今日/退出；关闭到托盘，事件回传前端 |

## 9. 测试与质量门禁

- **单测**：`npx vitest run` — 22 文件 / 118 用例，覆盖全部 `lib/` 纯函数与关键契约（`migration.test.ts` 守护 v1 基线与「遗留不得回流」，`backup.test.ts` 守备份版本/表覆盖，`capabilities.test.ts` 守权限）。
- **门禁链**：`npx tsc -b`（noUnusedLocals，查未用变量）→ `npx vitest run` → `npx vite build` → `cargo check` → `npm run release:check`（静态断言 README/Cargo/Tauri 版本一致 + 迁移/备份覆盖 + 上述全部）。
- **实机验证**：`npm run tauri dev`；涉及删除/数据链路的改动需实机点通全链路。

## 10. 构建与发布

- **调试**：`npm run tauri dev`（vite:1420 + `cargo run`，产物 `target/debug/youqiu.exe`，不可分发）。
- **发布**：`npm run tauri build` → `target/release/youqiu.exe`（独立可执行，前端资源已内嵌）+ `bundle/nsis/Yield_1.0.0_x64-setup.exe`（NSIS 安装向导，推荐发布物）+ `bundle/msi/`。
- **版本号三处同步**：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`；发布前必跑 `npm run release:check`。
- **发布渠道**：GitHub 单仓库 `YunShan2025/Yield`。流程：版本记录按 `#### v{版本号}` 标题追加 → 打包 → 创建 Release（标签与版本一致）并上传安装包 → 应用内「检查更新」即开始工作。

## 11. 安全与数据边界

- **本地优先**：常规使用零联网；唯一网络请求是「检查更新」对 `api.github.com` 的匿名 GET（经 `plugin-http`）。
- **数据边界**：用户数据只在 `%APPDATA%\com.yunshan.yield`（数据库 + JSON 备份）与 `%LOCALAPPDATA%\com.yunshan.yield`（WebView2 缓存），卸载不自动清除。
- **无遥测、无账号、无云同步**；Windows 通知通道标识为 `com.yunshan.yield`。

## 12. 审查附注（复杂度热点，后续演进参考）

- `src/store/app.ts`（909 行）与 `src/lib/db/tasks.ts`（801 行）是最大的两个模块，继续加功能时优先考虑按域拆分而非追加；
- `src-tauri/src/lib.rs`（874 行）混合了入口、迁移、11 个 command 与托盘，若命令继续增多应拆出 `commands/` 模块；
- 样式层 22 个文件的级联顺序是隐性契约，新增覆盖一律走 `polish-*` 追加层，不重排 `global-*`；
- 备份/恢复是数据安全关键路径，改动必须同时更新 `migration.test.ts` 与 `backup.test.ts` 的契约断言。
