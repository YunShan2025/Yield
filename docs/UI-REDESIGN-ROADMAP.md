# 有秋（Yield）UI 视觉优化路线图

> **适用范围**：有秋（Yield）桌面端 + Android 端前端视觉层（`src/components/**`、`src/styles/**`）
> **编写时间**：2026-10-21
> **基线代码**：`9b8bc6b`，分支 `main`（文中全部数字均在此提交上实测复核）
> **关联文档**：[README](../README.md)（产品说明）、[ARCHITECTURE](ARCHITECTURE.md)（架构）、[PRODUCT_REVIEW](PRODUCT_REVIEW.md)（功能评估）、[GIT_CONVENTIONS](GIT_CONVENTIONS.md)（提交规范）
> **配套工具**：项目级 skill `impeccable` v4.7.0（已装于 `.agents/skills/impeccable/`，不入库）

本文把 UI 优化拆成 4 个阶段，每个阶段给出**目标、入口命令、产出物、验收标准**。
设计成可以跨会话接力：任何新会话先读本文的「会话交接」一节，就知道现在在哪个阶段、下一步该做什么。

---

## 0. 怎么用这份文档

### 0.1 核心原则

> **这不是一次「重做」，是「先收口契约，再逐模块精修」。**

有秋已经是一个功能完整、有真实用户数据的成熟应用（README + PRODUCT_REVIEW 记录了 5 周真实使用）。
重做 37 个组件 × 桌面/移动双端 × 4 套主题，风险与收益完全不成比例。
**真正的问题是结构性的，不是美观的**——所以顺序不能反：

1. 先把「什么叫好看」写成契约（阶段 1）
2. 再把 CSS 从「时间序堆叠」改成「职责分层」（阶段 2）
3. 然后才逐个页面改（阶段 3）
4. 最后加手感（阶段 4）

**跳过阶段 1-2 直接做阶段 3 = 白做。** 原因见 §3。

### 0.2 会话交接

**新会话第一步永远是这两条，不要跳过：**

```bash
# 1) 让 impeccable 读一遍项目上下文（只读，不改文件）
.agents/skills/impeccable/scripts/impeccable.cmd context
```

然后把本文贴给 agent，或说：

> 读 `docs/UI-REDESIGN-ROADMAP.md`，按其中「当前阶段」继续。开始前先复述你认为当前处于哪个阶段、本阶段的验收标准是什么。

### 0.3 工具就绪情况（已验证）

| 项 | 状态 |
|---|---|
| impeccable | ✅ v4.7.0，引擎 v0.1.16 (windows-x64)，项目级 `.agents/skills/impeccable/` |
| 启动器 | ✅ `.agents/skills/impeccable/scripts/impeccable.cmd`（Windows 需带 `.cmd`） |
| 钩子 | ✅ `.codex/hooks.json`，PostToolUse + Stop 自动跑检测器 |
| 遥测 | ✅ 已关闭（`.impeccable/config.json` 中 `telemetry: false`） |
| 每日更新检查 | ✅ 已关闭（`updateCheck: false`） |
| 重新安装 | `npx impeccable install --scope=project --providers=codex -y` |
| 完整检测（需 DOM 解析） | `npx vite build && npx vite preview` 后 `impeccable detect http://localhost:4173` |
| Tauri WebView2 | ❌ 连不上 CDP，无法直接被检测；用上面的 vite preview 代替 |

---

## 1. 项目现状基线

> 以下为 2026-10-21 实测数据（`b3e702b`），阶段 1 开工前请重新核对。

### 1.1 样式层

| 指标 | 数值 | 说明 |
|---|---|---|
| CSS 文件 | 23 个 | `global-00` ~ `global-14` + `polish-01` ~ `polish-09` |
| CSS 总行数 | 9,530 行 | |
| 硬编码色值 | **339 处** | `tokens.css` 82 处（主题定义，合理，保留）；**其余 257 处在非 token 文件里，需回填** |
| `!important` | **30 处** | 分布：`g01`×1 `g05`×4 `g06`×1 `g09`×4 `g11`×6 `g12`×3 `p01`×2 `p02`×2 `p03`×3 `p04`×2 `p05`×2 |
| `var(--*)` 引用 | 1,206 处 | token 体系其实**已经在用**，不是没有 |
| CSS 类名总数 | 601 | 其中 25 个在 TSX/TS/HTML 中找不到对应（**需人工确认**，部分由模板字符串动态拼接） |

**疑似未使用类名（25 个，需人工确认）**：

`chip` `create-task-weekdays` `drag-handle` `drop-zone` `goal-filter-row` `habits-section` `is-markdown` `is-richtext` `level-1`~`level-4` `memo-list-title` `modal` `project-card` `subtask-item` `subtask-list` `tag-pill` `text-muted` `theme-preview-glass` `today-week-beat` `today-week-beat-label` `today-week-beat-stats`（另有 `getClientRects` 为误报，是 DOM API 名）

> ⚠️ level-1~level-4 / item-action- 等是模板字符串动态拼接出来的，**多半在用**，别删。
**逐文件明细**（行数 / 硬编码色值 / `!important` / token 引用）：

| 文件 | 行 | 硬编码 | !imp | token 引用 |
|---|---:|---:|---:|---:|
| `g05-airy-light.css` | 1,761 | 101 | 4 | 156 |
| `g14-mobile.css` | 1,404 | 2 | 0 | 44 |
| `g06-growth.css` | 1,323 | 37 | 1 | 306 |
| `p01-overrides.css` | 966 | 39 | 2 | 155 |
| `g11-ledger.css` | 623 | 6 | 6 | 92 |
| `p05-glass-shell.css` | 478 | 14 | 2 | 55 |
| `p07-weekly.css` | 413 | 9 | 0 | 43 |
| `g01-base-memos.css` | 399 | 0 | 1 | 91 |
| `g08-reminders.css` | 362 | 0 | 0 | 67 |
| `g13-selects.css` | 293 | 1 | 0 | 43 |
| `g02-visual-2026.css` | 286 | 5 | 0 | 31 |
| `g09-moments-workspace.css` | 228 | 8 | 4 | 54 |
| `g04-structural-v2.css` | 190 | 13 | 0 | 33 |
| `p03-solid-shells.css` | 175 | 11 | 3 | 13 |
| `tokens.css` | 170 | 82 | 0 | 0 |
| `g10-final-theme.css` | 164 | 4 | 0 | 13 |
| `p04-dawn-shell.css` | 137 | 7 | 2 | 7 |
| `g07-moments.css` | 45 | 0 | 0 | 1 |
| `p02-window-shell.css` | 33 | 0 | 2 | 2 |
| `p09-brand-mark.css` | 23 | 0 | 0 | 0 |
| `g00-preamble.css` | 22 | 0 | 0 | 0 |
| `g12-scrollbars.css` | 11 | 0 | 3 | 0 |
| `index.css` | 24 | 0 | 0 | 0 |

### 1.2 token 体系（已存在，是好消息）

`src/styles/tokens.css` 共 145 次 token 定义：

| 主题块 | token 数 | 说明 |
|---|---:|---|
| `:root` | 38 | 基准语义 token（清昼/浅色） |
| `:root[data-theme="dark"]` | 24 | 静夜 |
| `:root[data-theme="dawn"]` | 28 | 晨曦玻璃 |
| `:root[data-theme="glass"]` | 31 | 璃幕（整窗透明变体） |
| `@media(prefers-color-scheme:dark)` + `system` | 24 | 跟随系统 |

**关键结构性事实**：`dark` 24 个 token **少于** `root` 的 38 个 —— 说明暗色主题没有覆盖全部 token，靠继承 `:root` 的值。这不是 bug，但意味着**语义 token 集在四主题间并不对齐**，是阶段 2 要收口的对象。

### 1.3 组件层

37 个 `.tsx`，体积最大的几个：

| 文件 | 大小 | 备注 |
|---|---:|---|
| `GrowthView.tsx` | 38.6 KB | 对应 53 KB 的 `g06-growth.css` |
| `MainWorkspace.tsx` | 36.3 KB | |
| `SettingsView.tsx` | 27.5 KB | |
| `LedgerView.tsx` | 23.4 KB | 高频入口 |
| `HabitsView.tsx` | 21.4 KB | |
| `DetailDrawer.tsx` | 18.1 KB | |
| `TodayAgenda.tsx` | 18.0 KB | 高频入口 |

### 1.4 检测器首轮结果

`impeccable detect src` → 142 文件扫描，**6 处命中，全部是同一条规则**：

> 卡片单侧粗彩色边框 —— "AI 生成 UI 最容易识别的特征"

| # | 文件:行 | 真实选择器 | 判定 |
|---|---|---|---|
| 1 | `g01-base-memos.css:331` | `.memo-reading-surface blockquote` | ⚠️ **语义正当**——引用块左侧色条是内容语义，非装饰 |
| 2 | `g01-base-memos.css:372` | `.memo-rich-editor blockquote` | ⚠️ **语义正当**——同上 |
| 3 | `g05-airy-light.css:1528` | `.week-event` | ✅ **真命中**——周历事件块，装饰性色条 |
| 4 | `g05-airy-light.css:834` | `.timeline-h-event::before` | ✅ **真命中**——时间轴刻度条 |
| 5 | `g06-growth.css:478` | `.brand-origin-epigraph` | ⚠️ **待议**——题铭卡片，具品牌含义 |
| 6 | `g09-moments-workspace.css:185` | `.anni-detail-dialog > section` | ✅ **真命中**——纪念日详情分区 |

> **重要**：检测器的 `[side-tab]` 是它自己的**分类名**，不是 CSS 类名。别去搜 `side-tab`。
> 检测器**会误报**：语义正当的引用条、度量刻度、进度条都可能被算进去。
> **每条都要人工判定，不许盲从。** 详见 §5.4。

### 1.5 检测覆盖率的诚实说明

直接扫 `.css` / `.tsx` 只做正则匹配，**对比度、文字过小、层级遮挡等需要解析 DOM 的规则不会跑**。
官方原话：*"findings are an undercount, not a clean bill of health."*

**要完整检查必须扫渲染后的页面：**

```bash
npx vite build
npx vite preview          # 另开一个终端
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173
```

---

## 2. 阶段总览

| 阶段 | 目标 | 产出物 | 是否改代码 | 预估 |
|---|---|---|---|---|
| **1** | 建立视觉契约 | `PRODUCT.md`、`DESIGN.md` | ❌ 否 | 半天 |
| **2** | 收口 CSS 分层 | `src/styles/` 重构、token 体系对齐 | ✅ 是 | 2-3 天 |
| **3** | 逐模块精修视觉 | 各页面视觉重做 | ✅ 是 | 每模块半天到 1 天 |
| **4** | 动效与手感 | 交互反馈、状态过渡 | ✅ 是 | 1 天 |

---

## 3. 阶段 1 · 建立视觉契约（不动代码）

### 3.1 为什么必须先做

现在的四套主题效果是靠 **CSS import 顺序**"拼"出来的：

```
src/styles/index.css
  /* Cascade entry — order is intentional. Do not reorder theme/override layers. */
```

`g05` 铺底 → `g06` 覆盖 → `p01` 兜底 → `g14-mobile` 最后压移动端；`p04-dawn-shell` / `p05-glass-shell` 是两个主题的专属补丁。

**后果**：你改一个 `--accent`，`p01-overrides.css` 里 39 处硬编码值会盖住它；你调一个间距，`g05` 和 `g06` 互相打架。**任何"让 UI 好看"的改动都会踩坑。**

所以阶段 1 产出的契约是阶段 2-4 的**施工图**，不是文档洁癖。

### 3.2 步骤

**Step 1 — 跑 init（需要你本人参与）**

```
/impeccable init
```

impeccable 会读代码和 README，**问你几个只有你能回答的问题**，然后写 `PRODUCT.md`（项目根）。

> ⚠️ `init` 只写**产品事实**（用户、用途、约束、平台、品牌承诺），**不写视觉决策**。
> 它明确**不会**问你要「什么颜色、什么字体、什么风格」——那些属于阶段 3 的判断。
> 如果它问到视觉偏好，答「先按现有实现记录」。
>
> 仓库里已有的强证据（本地优先、五分组典故、"不做多人协作"的克制、四套主题、真实使用数据）——**不用重复讲**，它会自己读到。

**Step 2 — 记录现状设计系统**

```
/impeccable document
```

从现有代码反推 `DESIGN.md`（项目根），格式是 YAML frontmatter（机器可读 token）+ 8 个规范章节（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts）。

> `document` 产出的是**「现在长什么样」**的描述。
> 你要手改成**「应该长什么样」**的契约——至少要补上：
> - 四主题的**结构关系**（当前两套明暗主题同构、两套玻璃主题是整窗透明变体，这个关系现在没写出来）
> - 间距 / 字号 / 圆角刻度
> - 表面层级与边框阴影的配对规则

**Step 3 — 人工补齐结构决策**

至少写清这几条（当前代码里是隐式的、散落在各处的）：

| 决策项 | 现状 | 需要定下来的 |
|---|---|---|
| 主题维度 | 明暗（`dark`/`system`）× 材质（`dawn`/`glass`）混在同一套 `--bg-panel` 里 | 拆成「语义层 + 材质层」两组 token |
| 圆角 | `--radius: 16px` / `--radius-sm: 10px`，玻璃主题另设 22/14 | 全局 3 档：`8 / 12 / 18` |
| 间距 | 各文件各写各的 | 4/8/12/16/24/32/48 |
| 字号 | 散落 10-48px | 12/13/14/16/20/24/30 |
| 表面层级 | `--bg-panel` / `--surface-elevated` / `--surface-soft` 三档，含义不稳 | `surface-0/1/2/3`，明确「谁比谁高」 |
| 边框与阴影 | `--border` / `--border-strong` / `--shadow` / `--shadow-soft` | 规定配对：升一级表面 = 换底色 **或** 加边框，**不同时**加阴影 |

### 3.3 验收标准

- [ ] `PRODUCT.md` 存在于项目根，事实全部有据可查（每条都能指回 README / 代码 / 使用数据）
- [ ] `DESIGN.md` 存在，YAML frontmatter 里的每个 token 都能在 `tokens.css` 里找到对应
- [ ] 「四主题结构关系」被明确写下来了
- [ ] 间距/字号/圆角/表面层级四张刻度表存在
- [ ] `impeccable doctor` 不报 PRODUCT.md / DESIGN.md 缺失
- [ ] **没有改动任何 `src/` 下的文件**

---

## 4. 阶段 2 · 收口 CSS 分层

### 4.1 目标结构

把「时间序命名」换成「职责序命名」：

```
src/styles/
  tokens.css        纯变量：语义 token（× 4 主题）+ 材质层
  primitives.css    按钮 / 输入 / 标签 / 图标 / 滚动条 的基础态
  components.css    模块级组件（任务行、目标卡、账目行…）
  views.css         页面布局（今日 / 账本 / 成长 / 习惯 / 设置…）
  index.css         只负责 @import 顺序
```

**迁移原则：一次迁一个文件，每迁一个跑一次回归。** 不要一口气改 23 个文件。

### 4.2 具体任务

1. **拆 token 维度**
   - 语义层：`--surface-*` `--text-*` `--border-*` `--accent*`（四主题同构，值可不同）
   - 材质层：`--glass-blur` `--glass-tint` `--shell-opacity`（只有 `dawn`/`glass` 有值）
   - 现状是 `--bg-panel: rgba(255,255,255,.78)` 这种**语义和材质混在一格**，必须拆开

2. **硬编码色值回填（非 token 文件的 257 处 → 0）**
   - `tokens.css` 里的 82 处是主题定义本身，**保留**，但要按 §4.2「语义层 / 材质层」拆开
   - 优先：`g05-airy-light.css`（101 处）、`p01-overrides.css`（39 处）、`g06-growth.css`（37 处）
   - 确实需要独立颜色的（如 `--brand-gold` / `--moment-warm`），**提升为正式 token**，不要留裸值

3. **消除 30 个 `!important`**
   - `g11-ledger.css` 6 个、`g09` 4 个、`g05` 4 个是重灾区
   - 通常是「被 `p01-overrides.css` 覆盖 → 加 `!important` 赢回来」的循环。**必须按依赖顺序解，不能单点改。**

4. **清理 25 个疑似未使用类名**（见 §1.1）
   - ⚠️ 先人工确认，动态拼接的（`level-1`~`level-4`、`item-action-`）多半是**在用的**

5. **移动端单独排期**
   - `g14-mobile.css` 有 1,404 行且**几乎不用 token**（只有 44 处引用）→ 大量硬编码
   - 建议作为**阶段 3 的第二波**，不在阶段 2 动

### 4.3 验收标准

- [ ] `src/styles/` 下只有职责命名的文件，`global-*` / `polish-*` 全部消失
- [ ] `index.css` 只剩 `@import`，且**每个文件只被一个职责层引用**
- [ ] 硬编码色值 = 0（`grep -rEn '#[0-9a-fA-F]{3,8}\b' src/styles` 除 `tokens.css` 外无输出）
- [ ] `!important` = 0
- [ ] 四主题的 token 集**完全对齐**（每一主题都定义全部语义 token，dark 不能再少 14 个）
- [ ] `npx tsc -b` ✅ `npx vitest run` ✅ `npx vite build` ✅
- [ ] **四套主题逐一肉眼比对**（清昼 / 静夜 / 晨曦玻璃 / 璃幕），没有回归
- [ ] 移动端（≤640px）断点无回归

### 4.4 回归验证命令

```bash
npx tsc -b && npx vitest run && npx vite build
```

> 项目已有 `npm run release:check`（= release-check.mjs + test + build），正式提交前跑它。

---

## 5. 阶段 3 · 逐模块精修视觉

### 5.1 顺序（按真实使用频次，来源 `docs/PRODUCT_REVIEW.md`）

| 序 | 模块 | 组件 | 依据 |
|---|---|---|---|
| 1 | **今日** | `TodayAgenda.tsx` / `today/*` | 主干流程，任务执行 |
| 2 | **记一笔** | `LedgerView.tsx` | 高频入口，106 笔真实数据，30% 回填 |
| 3 | **待办箱 / 周清单** | `MainWorkspace.tsx` / `p07-weekly.css` | 主干流程 |
| 4 | **详情抽屉** | `DetailDrawer.tsx` | 全局高频交互，18KB |
| 5 | **项目 / 提醒 / 备忘录** | `ProjectsView` / `RemindersView` / `MemosView` | 中频 |
| 6 | **成长 / 习惯 / 复盘** | `GrowthView` / `HabitsView` / `ReviewView` | ⚠️ **真实使用数据为 0**，优先级最低，说明这两个页面从未被真正检验过 |
| 7 | **设置 / 标签 / 纪念日** | `SettingsView` / `TagsView` / `AnniversariesView` | 低频 |
| — | 移动端 | `g14-mobile.css` | 第二波 |

### 5.2 每个模块的循环

```
# ① 拿问题清单
/impeccable critique src/components/LedgerView.tsx

# ② 技术体检（a11y / 响应式 / 性能）
/impeccable audit src/components/LedgerView.tsx

# ③ 落地
/impeccable polish src/components/LedgerView.tsx

# ④ 看渲染结果（vite preview，不是 Tauri）
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173
```

### 5.3 改的时候必须遵守的审美原则

来自对 23 个真实桌面工作台的实测中位数（"app screens" 调研）——**这些是对有秋最直接适用的**：

| 原则 | 具体做法 |
|---|---|
| **颜色给数据，不给装饰** | 彩色像素占比控制在 ~3%；边框、导航项、标签**不要**用彩色 |
| **KPI 是字号，不是图标瓦片** | 数字指标用大字号 + 文字标签，不要"彩色圆圈里一个图标" |
| **表面是平的** | 卡片不给阴影；分隔靠 1px 线或一档色差 |
| **没有 hero 大标题** | 页面标题中位数 24px；9/23 的屏幕干脆没有 16px 以上的标题 |
| **图表几乎不加壳** | 单序列不配图例；网格线 3-7 条淡线，或干脆不要 |
| **导航后退** | 选中项是中性灰药丸或文字变色；彩色左条只出现一次 |
| **表格是规则和对齐** | 不用斑马纹、不用表头色带、数字右对齐 |
| **数据状态诚实** | 零值打印为 0，缺失值打印灰破折号，空区块保留边框 |

**同时要避开的（impeccable 检测器盯的）**：
- 卡片套卡片
- 紫蓝渐变
- 每个标题上方都一个圆角方块图标
- 灰字压彩色底
- 单侧粗彩色边框（**但引用块、刻度条要豁免，见 §5.4**）

### 5.4 检测器判读规则

> **检测器报的是线索，不是结论。** 每条都人工判定。

| 检测器命中 | 判定 |
|---|---|
| 卡片 / 面板的单侧粗彩色边框 | ✅ 真问题，去掉 |
| `blockquote` 的左侧色条 | ⚠️ **保留**——引用语义 |
| 时间轴 / 日历的刻度条 | ⚠️ **保留**——信息语义 |
| 品牌题铭的强调条 | ⚠️ **待议**——品牌语义 |
| 圆角方块图标瓦片 | ✅ 真问题 |
| 卡片套卡片 | ✅ 真问题 |
| 紫蓝渐变 | ✅ 真问题 |

误报要显式豁免，写进 `DESIGN.md` 的 **Do's and Don'ts**，让后续会话不再反复纠结：

```bash
.agents/skills/impeccable/scripts/impeccable.cmd ignores
# 或在 .impeccable/config.json 的 detector.ignoreRules 里加规则
```

### 5.5 验收标准（每个模块）

- [ ] `impeccable critique` 提出的**全部 Critical/High 项**已处理或显式豁免
- [ ] `impeccable audit` 无 a11y 错误（对比度 ≥ 4.5:1，触控目标 ≥ 44×44px）
- [ ] 四主题下该模块都看过
- [ ] 移动端断点下看过
- [ ] `npx tsc -b && npx vitest run` 通过
- [ ] 该模块的改动单独提交（`style(ui):` 或 `refactor(ui):`），不要和别的模块混在一起

---

## 6. 阶段 4 · 动效与手感

### 6.1 判定框架（先问「一天看几次」）

| 频次 | 决策 | 有秋对应 |
|---|---|---|
| 100+ 次/天 | **永远不要动画** | 命令面板（`CommandPalette.tsx`）、侧栏切换、键盘快捷键 |
| 几十次/天 | 去掉或大幅压缩 | 任务行 hover、列表项选中 |
| 偶尔 | 标准动画 | 抽屉 `DetailDrawer`、弹窗、toast |
| 稀有 | 可以加 delight | 目标达成、习惯打卡、年度热点图 |

> **铁律：永远不要给键盘触发的动作加动画。** 命令面板一天开几十次，动画只会让它变慢。

### 6.2 具体规则

- 缓动：进入用 `ease-out`，退出用 `ease-in`（不要反）
- 过渡属性要写具体，**禁止 `transition: all`**
- 按钮 `:active` 状态：`transform: scale(0.97)`，给"被听见"的反馈
- 弹层从触发源缩放，`transform-origin` 用变量，不要写死 `center`
- 动画元素从 0.95 + opacity 0 开始，不要从 `scale(0)` 凭空出现
- 时长：高频 80-120ms，偶尔 160-200ms，稀有庆祝 400-600ms
- 必须有 `prefers-reduced-motion` 降级

### 6.3 验收标准

- [ ] 命令面板开合**零动画**或 ≤100ms 且无位移
- [ ] 所有 `transition` 无 `all`
- [ ] 全局有 `prefers-reduced-motion` 降级
- [ ] 动效只在 §6.1 的「偶尔」和「稀有」档出现
- [ ] 桌面端 + 移动端都验过（移动端动效要更克制）

---

## 7. 已知坑

| 坑 | 说明 | 处置 |
|---|---|---|
| **钩子会刷屏** | 每次 `Edit`/`Write` UI 文件后自动跑检测器，`Stop` 时还跑一次 30s 深度检查 | 嫌吵就 `impeccable hooks off`，改完再开 |
| **检测器只做正则** | 扫源码跑不出对比度/文字过小 | 必须用 `vite preview` + `detect http://localhost:PORT` |
| **Tauri 连不上 CDP** | WebView2 不是标准 Chrome 调试目标 | 用 `vite preview` 的纯浏览器版本代替，视觉层等价 |
| **`.agents/` 不入库** | 21MB（含 18.9MB 二进制），新克隆需重装 | `npx impeccable install --scope=project --providers=codex -y` |
| **skill 需新会话加载** | 会话启动时读 skill 列表 | 装完开新会话 |
| **四主题不是独立设计** | `dark` 只有 24 个 token，`root` 有 38 | 阶段 2 对齐；否则改 token 会有主题表现不一致 |
| **`p01-overrides.css` 是覆盖层** | 39 处硬编码值会盖住 token 改动 | 阶段 2 迁完后才敢动 token |
| **检测器误报** | 引用条、刻度条、品牌强调条被算成 AI 味 | §5.4 判读表 + 写进 `DESIGN.md` |

---

## 8. 提交约定

按 `docs/GIT_CONVENTIONS.md`：

```
docs: 新增 UI 视觉优化路线图
style(ui): 收口 CSS 分层，迁移 global-01 至 primitives
refactor(ui): 对齐四主题语义 token 集
feat(ui): 账本页密度与层级重做
```

- 每个阶段单独提交，不要混
- 阶段 2 的 CSS 重构建议**每个文件一次提交**，便于回退
- 提交前跑 `npm run release:check`

---

## 附录 A · 常用命令速查

```bash
# 上下文
.agents/skills/impeccable/scripts/impeccable.cmd context
.agents/skills/impeccable/scripts/impeccable.cmd doctor

# 检测
.agents/skills/impeccable/scripts/impeccable.cmd detect src
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173

# 钩子与遥测
.agents/skills/impeccable/scripts/impeccable.cmd hooks status
.agents/skills/impeccable/scripts/impeccable.cmd hooks off
.agents/skills/impeccable/scripts/impeccable.cmd telemetry status

# 检测器豁免
.agents/skills/impeccable/scripts/impeccable.cmd ignores

# 项目
npx tsc -b && npx vitest run && npx vite build
npm run release:check
```

## 附录 B · 阶段完成检查表

```markdown
## UI 优化进度

- [ ] 阶段 1 视觉契约
  - [ ] `PRODUCT.md` 已写入
  - [ ] `DESIGN.md` 已写入
  - [ ] 四主题结构关系 / 间距 / 字号 / 圆角 / 表面层级五张表已定
- [ ] 阶段 2 CSS 分层
  - [ ] 非 token 文件硬编码色值 = 0
  - [ ] `!important` = 0
  - [ ] 文件改为职责命名，`global-*` / `polish-*` 消失
  - [ ] 四主题 token 集完全对齐
  - [ ] 移动端断点无回归
- [ ] 阶段 3 模块精修
  - [ ] 今日
  - [ ] 记一笔
  - [ ] 待办箱 / 周清单
  - [ ] 详情抽屉
  - [ ] 项目 / 提醒 / 备忘录
  - [ ] 成长 / 习惯 / 复盘
  - [ ] 设置 / 标签 / 纪念日
  - [ ] 移动端
- [ ] 阶段 4 动效手感
```

> 用法：每完成一项就在本文档里打勾。**本文档就是跨会话的进度载体。**
