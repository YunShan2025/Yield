# 桌面端改动记录 · 移动端同步手册

> 撰写日期：2026-10-19
> 范围：桌面端工作区中**尚未提交**的改动，基线为 v1.2.0（commit `c9e9cec`）
> 需求来源：`docs/PRODUCT_REVIEW.md` 的 P0-1、P0-2、P1-1、P1-2，以及随后按验收反馈追加的 UI 收敛
> 相关文档：`docs/CHANGES.md`（版本记录，已按主题记录这批改动）、`docs/ARCHITECTURE.md`（表结构现状）、`docs/local/android-sync-plan.md`（移动端计划，本地文档）

## 0. 这份文档怎么用

移动端（Tauri 2 Android）与桌面端**共用同一套前端代码与同一个仓库**，绝大多数改动改完即双端生效；真正需要移动端单独动手的，是三类：

1. **移动壳没有的界面**：`src/app/MainApp.tsx` 的 `isMobileShell()` 分支不渲染标题栏与命令面板，桌面端把入口收进标题栏后，移动端等于没有入口，需要另外安排。
2. **触摸端的交互与布局**：无 hover、无右键、无物理键盘，长按操作面板、软键盘、安全区、触摸目标尺寸都要单独验证。
3. **发版顺序与数据契约**：migration v16–v19、同步 schema v9 属于双端硬契约，两端必须同批升级。

每个主题按「桌面端行为 → 关键实现 → 移动端动作 → 坑点」组织。代码引用使用仓库相对路径加符号名，便于直接搜索。文中出现的已下线功能词（如「多次提醒」「前置依赖」）是历史字段名，**不要**据此改回 UI。

---

## 1. 变更总览

| # | 主题 | 桌面端用户可见变化 | 数据 / 契约 | 移动端动作 |
|---|---|---|---|---|
| P0-1 | 复盘当周口径 | 完成率、高效时段随周切换；移除「延期完成」；新增「精力投向」聚合 | 无表结构变化 | 共用组件即可，核对移动断点样式 |
| P0-2 | 死字段清理 | 任务编辑/详情不再透传无入口字段；提醒统一走全局提前量 | migration v16，同步 schema v8 | 删除移动端残留的字段读写与 UI |
| 追加 | 延期功能下线 | 复盘延期完成/归因、任务详情延期原因全部移除 | migration v17 → v19，同步 schema v9 | 同上；注意「顺延/改期」不是延期，保留 |
| 追加 | 习惯每周目标口径 | 新建/编辑习惯可设每周目标次数 1–7，默认 3 | migration v18 回填历史值 | 表单与卡片进度条同步；写入层不许再写 0 |
| P1-1 | 命令面板 → 全局搜索 | 入口只剩标题栏中间一处；删快捷键、快速捕获、快速前往 | 新增 `FocusRequest` 跳转协议 | **移动壳需自建入口并挂载面板** |
| P1-2 | 闭环 | 任务可关联成长目标与贡献值；习惯有周目标；复盘可聚合 | 复用已有 `goal_id` / `goal_contribution` 列 | 表单入口与移动布局 |
| 反馈 | 今日事项合并任务与习惯 | 今日页无独立习惯区块；习惯进入今日事项；右侧「完成/打卡」按钮 + 金色动效 | 无表结构变化 | 共用组件即可；触摸端验证排序与动效 |
| 反馈 | 文案与交互收敛 | 新建统一命名、二级弹窗只留功能名、删除隐藏快捷键 | 无 | 文案逐条对齐；移动端天然无这些快捷键 |

---

## 2. P0-1：复盘页改为当周口径

### 2.1 桌面端行为

- 三张指标卡改为：**本周完成率**、**本周高效时段**、**满勤天数**。原来的「整体完成率（全部历史累计）」和「延期完成」都不再存在，指标从 4 张缩为 3 张。
- 完成率与高效时段只统计**当周归属**的根任务：归属判定沿用周清单的 `isTaskInWeek`，命中 `due_date` 或 `completed_at` 任一落在本周即计入；子任务、回收站任务、已取消任务不计入。
- 切换「上周 / 本周 / 下周」时三项数字随之变化（切周联动）。
- 本周没有任何完成记录时，高效时段显示 `—`，副标题为「本周还没有完成记录」，**不再回退到历史峰值**。
- 新增「精力投向」区块：可按**目标 / 项目 / 标签**三个维度聚合当周完成情况，每行显示名称、进度条、`done/total` 与百分比。无关联的归入「未归类」并排在最后；空目标不占位。多标签任务会同时计入多个标签组。
- 窄窗口适配：`≤1080px` 页头控件换行右对齐（修复「下周 ›」被裁切）；`≤900px` 两张主卡改单列；`≤760px` 指标卡两列、「精力投向」的进度条换到第二行。

### 2.2 关键实现

- `src/components/ReviewView.tsx`：新增 `dimension` 状态与 `review-dimension-tabs`；`fetchGoals(true)` 拉取**含归档**的目标，保证归档目标的当周任务也能归组。
- `src/lib/review.ts`（新增，配套 `src/lib/review.test.ts`）：
  - `computeWeekReviewMetrics(tasks, weekDates)` → `{ total, done, rate, peakHour }`，`peakHour` 无记录时为 `null`。
  - `aggregateReviewByGoal` / `aggregateReviewByProject` / `aggregateReviewByTag` → `ReviewGroup[]`，统一 `sortGroups` 排序（未归类沉底，其余按总量、完成量、名称排序）。
  - `ReviewDimension = "goal" | "project" | "tag"`，`UNCATEGORIZED_KEY` 为未归类哨兵。
- 样式：`src/styles/parts/global-06-growth.css` 的 `.review-metrics`（3 列）、`.review-dimension-tabs`、`.review-breakdown-*`、`.review-soft-empty`，以及 1080 / 900 / 760 三个断点。

### 2.3 移动端动作

- 移动端复用 `ReviewView`，逻辑与样式会自动生效。需要核对的是移动端在 `≤760px` 下的表现：指标卡是否两列、聚合行的进度条是否换行不溢出、三个维度 tab 是否撑满宽度可点。
- 如果后续为移动端另做复盘组件，**必须直接调用 `src/lib/review.ts` 的口径函数**，不要各自实现一套周归属算法，否则又会回到口径不一致。

### 2.4 坑点

- 不要用「全部历史」或「本周新增」替代当周归属口径；周归属只看 `due_date` / `completed_at`，不看 `created_at`。
- 归档目标要能出现在聚合里，取数必须带 includeArchived。

---

## 3. P0-2：死字段清理、延期功能下线与 README 一致性

按评审结论选择方案②：**删 README 描述 + 清理 UI 透传与同步/备份中的死字段**。

### 3.1 任务级死字段清理（migration v16，同步 schema v8）

删除内容：

| 字段 / 表 | 语义 |
|---|---|
| `tasks.blocked_by_id` | 前置依赖 |
| `tasks.completion_criteria` | 完成标准 |
| `tasks.energy_level` | 精力要求 |
| `tasks.flexible` / `tasks.schedule_locked` | 灵活排程 |
| 整表 `task_planning_metadata` | 任务级多次提醒（`reminder_minutes_json`） |

连带变化：

- 任务提醒统一使用设置页的**全局提前量**：`src/lib/nativeReminders.ts` 不再读取任务的提醒数组，只按 `defaultAhead` 生成一条提醒计划。
- 数据访问层收窄：`src/lib/db/client.ts` 的 `TASK_SELECT` 去掉 LEFT JOIN，`mapTask` 不再补默认值，`saveTaskPlanningMetadata` 整体删除；`src/lib/db/tasks.ts` 的 INSERT / UPDATE 列数与参数同步减少，`toggleComplete` 里的「前置任务未完成不能完成」校验删除。
- 同步：`src/lib/sync/columns.ts` 的 `TASK_COLUMNS` 与 `TABLE_SPECS` 删除上述字段与 `task_planning_metadata` 表；`src/lib/sync/tables.ts` 表注册同步删除；`src/lib/sync/outbox.ts` 去掉该表的基线回填。
- 备份：`src/lib/backup.ts` 不再校验/归一 `flexible`、`blocked_by_id`；`src/lib/db/backup.ts` 的 INSERT 从 25 列减到 20 列，并删除清表与恢复 `task_planning_metadata` 的调用。
- 重复任务：`src/lib/repeat.ts` 生成下一条任务时不再复制这些字段。
- 类型：`src/types/index.ts` 从 `Task`、`TaskDraft`、`TaskUpdate` 中移除对应字段。

### 3.2 延期功能下线（migration v17 → v19，同步 schema v9）

- 复盘页移除「延期完成」指标与延期归因区块（见第 2 节）。
- 任务详情移除延期原因编辑。
- migration v17 曾新增 `tasks.delay_reason`，功能下线后 migration v19 又删除该列；同步 schema v9 曾把该列纳入白名单，删除后日志不再携带，旧日志里的同名键由列白名单投影自然丢弃。
- **重要区分**：本次下线的是「延期完成判定 + 延期原因归因」。任务行上的**顺延到明天 / 改期到自定义日期 / 优先级调整**（`src/components/mobile/TaskActionSheet.tsx`、`src/lib/planning.ts` 的 `buildTaskDeferredUpdate`）是保留功能，移动端不要一起删。

### 3.3 习惯每周目标口径（migration v18）

- 新增 `DEFAULT_HABIT_TARGET_PER_WEEK = 3` 与 `normalizeTargetPerWeek(value)`（`src/lib/db/taxonomy.ts`）：合法值为 1–7 的整数，缺失或越界回落 3。
- `createHabit` 此前把 `target_per_week` 恒写 0（UI 无入口），现在写入归一后的草稿值；`updateHabit` 未显式传值时保留原值，避免其他调用点顺手重置。
- migration v18 把历史非法值（NULL / <1 / >7）回填为 3，且**不触碰 `updated_at`**，避免把回填误当成用户编辑推给对端。

### 3.4 同步与发布门禁

- `SYNC_SCHEMA_VERSION` 由 7 升到 9（v8：死字段与 `task_planning_metadata` 下线；v9：`delay_reason` 曾入列后删除）。
- 旧格式端拉到新格式日志：由 header 闸门**整体拒收**并提示升级，不做静默丢字段。
- README：删除预计时长 / 实际耗时、多次提醒、前置依赖、精力等级、灵活排程、专注会话与专注计时等已下线描述。
- `scripts/release-check.mjs` 新增 `retiredFeatureWords` 扫描（预计时长、预计耗时、实际耗时、多次提醒、前置依赖、精力等级、灵活排程、专注会话、专注时间、专注计时），README 命中即失败；「README 功能描述与代码一致」正式成为发布检查项。
- `docs/ARCHITECTURE.md` 的表数量由 24 张更正为 21 张。

### 3.5 移动端动作

- Rust migration 位于 `src-tauri/src/lib.rs`，双端共用，重新构建 Android 即会执行 v16–v19。**需要检查的是前端与 Android 侧有没有残留读写**：
  - 任何 `INSERT INTO task_planning_metadata` / `SELECT ... FROM task_planning_metadata` 都会在 v16 之后直接报错（表已不存在）。
  - 任何按 25 列插任务的代码路径都会报列数不匹配，需与 `src/lib/db/tasks.ts` 的 20 列对齐。
  - 移动端若有独立的备份导入分支，要同步删除这些字段，否则会写入不存在的列。
- 习惯写入层：移动端新建习惯如果还写 `target_per_week: 0`，会被 `normalizeTargetPerWeek` 归一为 3；表单应直接提供 1–7 输入。
- 移动端 UI 复核：任务详情/编辑、习惯表单里不得再出现前置依赖、完成标准、精力、灵活排程、多次提醒、延期原因；提醒设置只保留全局提前量。
- 已下线功能词若写进移动端 README 或界面文案，桌面端发布检查不会拦住（脚本只扫 README），需要人工核对。

---

## 4. P1-1：命令面板改造为全局搜索

### 4.1 桌面端行为

- **入口只保留一处**：标题栏正中的「搜索」按钮（`src/components/GlassTitlebar.tsx` 的 `.titlebar-command`，搜索图标 + 文案），点击调用 store 的 `openCommandPalette()`。侧栏入口已删除。
- **删除快捷键**：不再支持 `Ctrl/Cmd+K` 开关面板；面板内不再显示 `Esc` 键帽提示（Esc 仍可关闭）。
- **删除快速捕获**：输入非空但无结果时，回车不再「新建任务」。
- **删除快速前往**：空查询不再列出「打开今日 / 打开待办箱…」等页面跳转按钮；空查询时结果区为空。
- **搜索范围扩到 7 类**：任务、备忘、账本、目标、项目、标签、纪念日，分组展示，组头右侧提示「↑↓ 选择 · Enter 打开」，键盘上下键移动高亮，Enter 打开。
  - 任务：仅未删除任务，匹配标题/描述/备注，最多 5 条。
  - 备忘：`fetchMemos({ archived: "all" })`，含归档，摘要由 HTML 去标签后截断。
  - 目标：`fetchGoals(true)`，含归档，副标题显示类型与状态。
  - 项目：进行中 + 已归档项目都参与匹配。
  - 账本：走新增的 `searchLedgerTransactions(keyword, limit)`（`src/lib/db/ledger.ts`），跨月匹配备注 / 分类 / 账户，纯金额输入时同时匹配金额，LIKE 通配符已转义，输入 120ms 防抖，取 6 条。
  - 标签与纪念日：分别匹配名称、标题与备注。
- **选中后直达并定位**：任务直接开详情；标签切到标签页并选中；备忘、目标、项目、纪念日、账本通过新的 `FocusRequest` 协议跳转，账本额外带 `date` 以便先切到所在月份再打开抽屉。
- **搜索框圆角裁切修复**：`.command-search` 网格改为 `auto minmax(0, 1fr)`，输入框 `width: 100%; min-width: 0; border-radius: 0; box-shadow: none; line-height: 1.5`；`dawn` / `glass` 主题统一压平输入框的圆角与内阴影，避免文字被圆角切掉。
- 已删除的说明文字：输入框下方的「输入关键字搜索任务、备忘、账本、目标、项目、标签和纪念日」类提示不再出现（占位符仍保留同等信息）。

### 4.2 关键实现

- `src/components/CommandPalette.tsx` 基本重写：`sections` 分组 + `flatResults` 扁平索引（键盘导航用），`activeIndex` 随查询重置，打开时聚焦输入框、关闭时清空查询。
- `src/store/app.ts` 新增：`commandPaletteOpen`、`focusRequest`、`openCommandPalette`、`closeCommandPalette`、`requestFocus`、`clearFocus`。
- `src/types/index.ts` 新增 `FocusKind`（`memo | goal | project | anniversary | ledger`）与 `FocusRequest`（含可选 `date`）。
- 各视图消费 `focusRequest`：
  - `MemosView`：按 `archived` 切换列表模式并打开详情。
  - `GrowthView`：切到「目标」页签，合入归档目标后打开详情。
  - `ProjectsView`：支持定位已归档项目，用 `detailRef.scrollIntoView({ block: "center", behavior: "smooth" })` 滚到详情，`pendingDetailScrollRef` 避免手动点卡片时乱滚。
  - `AnniversariesView`：打开该纪念日详情。
  - `LedgerView`：目标月份与当前月不一致时先切月，数据加载完再打开抽屉。

### 4.3 移动端动作（本批最需要单独实现的一项）

现状：`src/app/MainApp.tsx` 的移动分支（`if (isMobileShell())`）只渲染 `MainWorkspace`、`DetailDrawer`、`MobileNav`、`MobileMoreSheet` 等，**不渲染 `GlassTitlebar`，也不渲染 `CommandPalette`**。所以桌面端「入口收进标题栏」这条在移动端等于零入口。移动端至少要做：

1. 在移动分支挂载 `<CommandPalette />`。
2. 选一个触摸可达的入口。可选项：
   - `src/components/mobile/MobileMoreSheet.tsx` 的「更多」网格首项加「搜索」；
   - 或在 `src/components/mobile/MobileNav.tsx` 增加一个搜索位（注意底部导航目前是「今日 / 待办箱 / 记账 / 更多」四个同级单选，加项要重新分配层级）。
3. 面板样式核对：`.command-backdrop` 有移动端 `inset` 垫片（`src/styles/parts/global-14-mobile.css` 顶部），但没有移动端专属的搜索面板高度 / 键盘规避规则。建议在移动端限制面板高度（如 `min(72dvh, ...)`）、结果行触摸目标 ≥ 44px，并处理软键盘弹起时的滚动。
4. 移动端不需要移植 `Ctrl/Cmd+K`；触摸端也没有 ↑↓ 键，结果行本身必须可点，且点击后要收起软键盘。Esc 关闭对移动端无意义，返回键收起面板的语义建议接入 `src/lib/mobileBack.ts` 的 `pushBackHandler`。

---

## 5. P1-2：闭环（任务 / 习惯 / 复盘）

### 5.1 任务关联成长目标

- 数据层原本就有 `tasks.goal_id` / `tasks.goal_contribution`，完成时写入 `goal_entries`（`source_type = 'task'`）的逻辑也已存在；本次补的是**UI 入口与校验**。
- `src/components/CreateTaskDialog.tsx`：
  - 新增「成长目标」下拉，选项只包含 `status === "active"` 且 `goal_type` 为 `quantity` / `frequency` 的目标，另有「不关联目标」。
  - 选中目标后出现「目标贡献」数字输入（`min=0.1 step=0.1`，默认 1），下方提示完成后的计入单位。
  - 提交校验：选了目标但贡献值非正数时 toast「目标贡献值需大于 0」并中止。
  - 保存时写 `goal_id` 与 `goal_contribution`（未选目标时贡献值回落 1）。
- `src/components/DetailDrawer.tsx`：
  - 只读态新增「成长目标」「目标贡献」两行。
  - 编辑态可改目标与贡献值，同样做正数校验；归档或不适用类型的目标如果是任务已绑定的，会以「（已归档/不适用）」后缀保留在选项里，避免保存时静默解绑。
  - 保存任务时的透传字段只剩 `notes` 与 `status`（其余无入口字段已删）。

### 5.2 习惯每周目标

- `src/components/HabitsView.tsx`：
  - 新建/编辑表单新增「每周目标次数」数字输入（`min=1 max=7 step=1`），非法时 toast「每周目标次数需为 1–7 的整数」并中止。
  - 习惯卡片新增周进度条 `.habit-week-progress`：`.habit-week-track > i` 宽度按本周打卡比例，文案「本周 x/y 次」，达标时容器加 `is-full`（文案转强调色加粗）。
  - 周范围用 `mondayWeekDates(today)` 计算，与今日事项口径一致。
- 样式位于 `src/styles/parts/global-06-growth.css`；`updateHabit` 会写 `target_per_week` 并刷新 `updated_at`。

### 5.3 复盘精力投向

见第 2 节，按目标 / 项目 / 标签聚合当周完成情况。

### 5.4 移动端动作

- 移动端复用同一批组件，逻辑自动生效；要验证的是移动端表单在小屏下的可读性：成长目标下拉与贡献值输入不要挤在一行、每周目标次数数字键盘能否调起。
- 若移动端有独立的「任务详情」实现（如触摸端专用抽屉），必须补上同样的目标关联入口与正数校验，否则会出现「桌面能关联、手机不能改」的数据不对称。
- 习惯卡片的周进度条在窄屏要与累计/连续天数换行而不是压缩。

---

## 6. 今日事项：任务与习惯合并

### 6.1 桌面端行为

- 今日页**不再有独立的「本周习惯」区块**；活跃习惯直接进入「今日事项」清单，事项 = 任务 + 习惯。
- 习惯只在**真正的今天**出现：`DayBoard` 仅在 `nav === "today" && cursor === 今天` 时把习惯传给 `TodayAgenda`，翻到昨天/明天的日期页只显示任务。原因是习惯模型只有每周次数目标，没有星期字段。
- 习惯行内容：名称、「本周 x/y 次」，达标时追加「本周目标已达成」。
- 打卡与完成都在**行右侧按钮**完成，左侧不再有 `○` 勾选圆钮：
  - 任务按钮文案「完成 / 已完成」，点击调用 `toggleComplete`。
  - 习惯按钮文案「打卡 / 已打卡」，点击调用 `toggleHabitDay(habit.id, 今天)`。
- 排列顺序固定为：**未打卡习惯 → 已打卡习惯 → 未完成任务 → 已完成任务**。任务内部保持原有的今日排序（手动拖动顺序），已完成任务沉底。
- 习惯页（`HabitsView`）删除了行内打卡按钮，打卡入口统一收口到今日事项；卡片仍保留当日已打卡的金色态、累计次数与连续天数。

### 6.2 关键实现

- `src/components/today/DayBoard.tsx`：`todayHabits` memo 控制习惯只在今天视图传入。
- `src/components/today/TodayAgenda.tsx`：
  - 新增 `habits?: Habit[]`（默认空数组）、`DayHabitRow` 组件。
  - `rows` 是**单一稳定数组**，按上述四段顺序拼装后一次渲染，保证打卡/完成时 React 复用同一行实例，动效不会被卸载打断。
  - `SortableContext.items` 仍然只包含活跃任务 id，习惯不参与拖拽排序（`TaskActionSheet` 也只挂在任务行上）。
  - `habitChecks` 按 `check_date === cursor` 求当日已打卡集合；按 `mondayWeekDates(cursor)` 求本周完成次数。
  - 新增 `useJustToggled(value, 620)`：只在布尔值由 false 变 true 的那一次返回 true，用于「刚完成」的一次性动效，页面初次进入不重播。
  - 空态文案由「这一天暂无任务」改为「这一天暂无事项」，空态判定改为 `!tasks.length && !habits.length`。
- `src/components/ExpandableTaskItem.tsx`：
  - 新增 `primaryAction?: ReactNode` 与 `checkable = true`。
  - `checkable === false` 时**完全不渲染** `.task-check`，行容器加 `no-check` 类。
  - 删除了 `reminder-chip`（多提醒角标）渲染。
- 样式：`src/styles/parts/global-05-airy-light.css` 的 `.expand-task-row.no-check { grid-template-columns: 1fr auto auto auto auto; }`（原默认是 `auto 1fr auto auto auto`，第一列是完成圆钮）。这就是「任务名右对齐」问题的根因修复：去掉圆钮列后内容列变成第 1 轨，名称恢复左对齐。

### 6.3 金色完成态与动效（含蓝边修复）

样式都在 `src/styles/parts/global-06-growth.css` 与 `global-05-airy-light.css`：

- 按钮基类 `.item-action-primary`：
  - `position: relative; isolation: isolate`，用 `::after` 铺金色渐变覆盖层 `linear-gradient(135deg, #fbbf24, #d97706)`，初始 `opacity: 0`，`transition: opacity 260ms ease`；`> *` 提到 `z-index: 1`。
  - 完成态 `.is-done`：**边框必须是金色 `#d97706`（hover `#ea8a06`）**。此前写成 `border-color: transparent` 会露出底下的主色蓝边，这就是「打卡后按钮边框仍有蓝色」的原因；背景保留 `var(--accent)`，金色由覆盖层呈现，`::after` 的 `opacity` 切到 1，让渐变能真正补间。
  - 一次性动效 `.is-flash`：按钮 `task-action-confirm`（380ms，scale `.96 → 1.04 → 1`）与图标 `task-action-icon-pop`（420ms，scale `.4 → 1.14 → 1`）。
  - `@media (prefers-reduced-motion: reduce)` 下关闭动画与覆盖层过渡。
- 整行金色（仅今日/当日事项 `.day-agenda` 作用域）：`.expand-task::before` 铺浅金渐变覆盖层，`is-done` 时 `opacity: 1`（260ms），边框 `rgba(217, 119, 6, 0.28)`；深色主题覆盖层为 `rgba(245, 158, 11, 0.08)`。行在 hover 时不再整块背景盖掉金色，只叠 `rgba(217, 119, 6, 0.06)`。
- 行内子元素通过 `z-index: 1` 浮在覆盖层之上，避免文字与按钮被渐变遮住。

### 6.4 移动端动作

- 共用组件，样式与动效自动生效。触摸端需要重点验证：
  - 完成/打卡按钮按 `min-width: 78px`、`min-height: 34px` 布局，移动端触摸目标偏小；如需放大，请在 `global-14-mobile.css` 里对 `html[data-shell="mobile"] .item-action-primary` 单独加高，不要改桌面基类。
  - hover 态在触摸端不出现，务必确认**按下态**（`:active` 的 `scale(.97)`）与完成态的视觉差异足够明显。
  - 排序切换时行会跳到另一段（未打卡→已打卡等），验证跳位是否有动画断裂；`rows` 数组的顺序是为了保住 key，不要再在移动端按 `habits` / `tasks` 分开渲染。
  - 移动端长按任务行会弹 `TaskActionSheet`（顺延/改期/优先级/删除）；习惯行目前**没有**长按面板，如需在移动端编辑/归档习惯，只能进习惯页。
  - 移动端若通过 `prefers-reduced-motion` 或省电模式关闭动画，金色覆盖层仍会瞬时切换，属预期。

---

## 7. 文案与交互收敛

### 7.1 新建命名统一

- 所有新建入口统一为「新建 XX」，**不再带 `＋`**，加载中文案统一为「新建中…」。涉及：
  - 新建任务（`CreateTaskDialog` 的按钮由「创建任务」改为「新建任务」）、新建目标（原「创建目标 / 创建长期目标」）、新建纪念日（原「新增纪念日」）、新建项目、新建习惯、新建标签、新建备忘（原「＋ 新建备忘录」）、账本「记一笔」（原「＋ 记一笔」）。
- 保留的 `＋`：`RemindersView` 里数字步进控件的加号、`LedgerView` 的快捷金额（`¥10 / ¥20 / ¥50 / ¥100`）等非「新建」含义的符号，不要误删。

### 7.2 二级弹窗标题

- 规则：弹窗标题**只显示功能名**，不再叠加实体名或装饰性眉题。已处理：
  - 习惯弹窗移除「有恒」眉题，标题「新建习惯 / 编辑习惯」。
  - 提醒弹窗移除「提醒」眉题。
  - 标签、项目弹窗移除「标签 / 项目」眉题，项目设置标题改为按功能命名。
  - 纪念日弹窗移除「收藏一个日子」；详情弹窗标题固定为「纪念日详情」，实体名改为下方 `.anni-detail-name` 的独立行。
  - `ExpandableTaskItem` 的「修改完成时间」弹窗移除任务标题行。
  - 成长回看弹窗由「成长回看 + 日期」双行标题改为 `<h3>成长回看</h3>` + `<p className="day-activity-date">日期</p>`。
- 相关样式：`.anni-detail-name`（`src/styles/parts/global-09-moments-workspace.css`）、`.day-activity-date`（`global-06-growth.css`）。

### 7.3 快捷键删除

应用内没有快捷键设置入口，因此按「不提供不可发现的隐藏快捷键」处理：

- 任务列表：移除 `↑` / `↓` 切换选中任务、`Delete` 直接删除。`MainApp` 的 keydown 只保留 `Esc` 关闭任务详情。
- 备忘录：移除 `Ctrl/Cmd+S` 保存，保存与删除统一走界面按钮。

### 7.4 移动端动作

- 文案逐条对齐即可（移动端与桌面共用组件，绝大多数自动生效）；若移动端有独立按钮文案表，需要单独核对。
- 移动端本身没有物理键盘，快捷键删除无需移植；但不要反过来给移动端加隐藏手势作为替代（没有设置入口就不可发现）。

---

## 8. 移动端重点核对清单

1. **移动壳分支**：`src/app/MainApp.tsx` 的 `if (isMobileShell())` 分支，确认命令面板已挂载、入口已安排、返回键语义已接入 `src/lib/mobileBack.ts`。
2. **移动样式入口**：`src/styles/parts/global-14-mobile.css`（级联顺序 `tokens → global-00…14 → polish-*`，不可重排）。所有移动端覆写放在这里或更后面的 polish 文件。
3. **移动组件**：`src/components/mobile/MobileNav.tsx`、`MobileMoreSheet.tsx`、`TaskActionSheet.tsx`，以及共用的 `src/components/today/BatchToolbar.tsx`。
4. **触摸可达性**：完成/打卡按钮、命令面板结果行、习惯卡片操作按钮的触摸目标建议 ≥ 44px；无 hover 场景要有按下态或选中态。
5. **软键盘**：命令面板搜索、记账备注、任务标题输入在 Android 上弹键盘后不应遮挡结果或提交按钮（`adjustResize` 与滚动容器）。
6. **安全区**：底部导航与命令面板的底部留白要带 `safe-area-inset-bottom`。
7. **今日事项排序**：习惯段落在任务段之前，点打卡后行会移动到「已打卡习惯」段，验证不闪断、不重播整页动效。
8. **习惯页打卡入口已移除**：移动端习惯卡片上不应再出现打卡按钮，否则会出现两处入口。
9. **无残留死字段 UI**：任务详情/编辑、习惯表单、备份页不得再出现前置依赖、完成标准、精力、灵活排程、多次提醒、延期原因。
10. **文案**：新建按钮不带 `＋`、统一「新建 XX」、二级弹窗只留功能名。

---

## 9. 数据与同步的升级顺序（硬要求）

- 双端必须同时升级到包含 **migration v16–v19** 的版本：
  - v16 删列删表（任务死字段 + `task_planning_metadata`）；
  - v17 加 `delay_reason`，v19 再删除；
  - v18 回填习惯每周目标；
  - 同步 `SYNC_SCHEMA_VERSION = 9`。
- 只升级一端时：新端日志会被旧端 header 闸门整体拒收并提示升级；旧端日志里的已删表 / 已删列条目在新端按表名与列白名单自然跳过，不会报错。
- 数据库只向前升级，不支持降级。升级前如需保留旧备份，桌面端 `backup.ts` 仍可导入旧 JSON：校验不再要求已删字段，多出来的键会被忽略。
- 发布策略：优先两端同批发布。若无法同批，应先暂停跨端同步，或至少明确接受过渡期内旧端拒收新端日志，并在最短时间内完成另一端升级；不要在混合 schema 状态下长期运行。

---

## 10. 移动端验收清单

命令类（在仓库根目录）：

```bash
npx tsc --noEmit
npx vitest run
npm run release:check
```

界面类（模拟器或真机逐条走）：

1. 今日页：不出现独立的「本周习惯」区块；活跃习惯出现在今日事项中；未打卡习惯排在最前。
2. 打卡习惯：右侧按钮由「打卡」变「已打卡」并落金，金色覆盖完整、**四周边框无蓝色残留**；行移动到「已打卡习惯」段，动画连贯。
3. 完成任务：右侧按钮由「完成」变「已完成」并落金；行移动到最底部；左侧没有 `○` 圆钮；任务名左对齐。
4. 习惯页：卡片有周进度条且无打卡按钮；新建/编辑习惯能设置每周目标次数 1–7，输入 0 或 8 有拦截提示。
5. 复盘页：切上周/本周/下周时完成率与高效时段随周变化；空周显示 `—`；无「延期完成」卡片；「精力投向」三个维度可切换、进度条不溢出。
6. 命令面板：有可见入口；输入能跨任务/备忘/账本/目标/项目/标签/纪念日检索；选择后定位到对应页面（账本会先切月）；搜索框文字不被圆角裁切。
7. 任务表单：可关联成长目标并填写贡献值；填 0 或负数被拦截。
8. 弹窗标题：新建/编辑类弹窗只显示功能名；新建按钮文案统一，不带 `＋`。
9. 备份与同步：双端升级后各自导入一次旧备份，同步一轮，确认任务、习惯周目标、账目无丢失，且不出现 `no such table: task_planning_metadata` 之类错误。

---

## 11. 关键文件索引

| 主题 | 文件 |
|---|---|
| 复盘口径与聚合 | `src/lib/review.ts`、`src/lib/review.test.ts`、`src/components/ReviewView.tsx` |
| 数据库 migration | `src-tauri/src/lib.rs`（v16–v19） |
| 同步契约 | `src/lib/sync/tables.ts`、`src/lib/sync/columns.ts`、`src/lib/sync/outbox.ts` |
| 任务读写与类型 | `src/lib/db/tasks.ts`、`src/lib/db/client.ts`、`src/types/index.ts` |
| 备份 | `src/lib/backup.ts`、`src/lib/db/backup.ts`、`src/lib/backup.test.ts` |
| 提醒 | `src/lib/nativeReminders.ts` |
| 习惯 | `src/lib/db/taxonomy.ts`、`src/components/HabitsView.tsx` |
| 命令面板 | `src/components/CommandPalette.tsx`、`src/components/GlassTitlebar.tsx`、`src/store/app.ts`、`src/lib/db/ledger.ts` |
| 今日事项 | `src/components/today/DayBoard.tsx`、`src/components/today/TodayAgenda.tsx`、`src/components/ExpandableTaskItem.tsx` |
| 闭环表单 | `src/components/CreateTaskDialog.tsx`、`src/components/DetailDrawer.tsx` |
| 样式 | `src/styles/parts/global-05-airy-light.css`、`global-06-growth.css`、`global-09-moments-workspace.css`、`global-11-ledger.css`、`polish-01-overrides.css`、`polish-03-solid-shells.css`、`global-14-mobile.css` |
| 发布门禁 | `scripts/release-check.mjs`、`README.md` |

> 说明：`scripts/release-check.mjs` 的已下线功能词扫描只作用于 `README.md`，本文档为了记录历史字段会正常出现这些词，不会触发门禁。
