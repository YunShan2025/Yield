---
name: 有秋 Yield
description: 本地优先的个人成长与行动工具 —— 桌面多栏工作台与 Android 单栏卡片流共享同一个视觉世界
colors:
  surface-base: "#f6f8fc"
  surface-panel: "#ffffff"
  surface-raised: "#ffffff"
  surface-sunken: "#f0f4fa"
  surface-hover: "rgba(47, 111, 237, 0.07)"
  surface-selected: "rgba(47, 111, 237, 0.11)"
  text-primary: "#17233b"
  text-secondary: "#5f6d83"
  text-muted: "#69778d"
  text-heading: "#101b31"
  text-label: "#41526b"
  text-on-accent: "#ffffff"
  text-on-solid: "#ffffff"
  text-overdue: "#c3505a"
  accent: "#2f6fed"
  accent-hover: "#245fd2"
  accent-soft: "rgba(47, 111, 237, 0.1)"
  accent-faint: "#edf4ff"
  accent-strong: "#174ea6"
  brand-gold: "#f4b942"
  success: "#2c8561"
  warning: "#a96622"
  danger: "#c3505a"
  danger-solid: "#c3505a"
  success-solid: "#2c8561"
  warning-solid: "#a96622"
  accent-solid: "#2f6fed"
  border: "rgba(34, 55, 91, 0.09)"
  border-strong: "rgba(34, 55, 91, 0.16)"
  focus-ring: "rgba(47, 111, 237, 0.28)"
typography:
  display:
    fontFamily: "\"Microsoft YaHei UI\", \"PingFang SC\", \"Segoe UI Variable Display\", sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "\"Microsoft YaHei UI\", \"PingFang SC\", \"Segoe UI Variable Display\", sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "\"Microsoft YaHei UI\", \"PingFang SC\", \"Segoe UI Variable Text\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "\"Microsoft YaHei UI\", \"PingFang SC\", \"Segoe UI Variable Text\", sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-quiet:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  tag:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-label}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  tag-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-strong}"
  tag-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.text-on-accent}"
  tag-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.text-on-accent}"
  tag-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.text-on-accent}"
  input:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "16px"
  nav-item-active:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.sm}"
---

# 有秋（Yield）设计系统

> 本文件是**契约**，不是现状描述。`docs/UI-REDESIGN-ROADMAP.md` 阶段 2/3/4 按本文件施工。
> 现状与本契约的差距见 §9 迁移映射表。

## Overview

有秋有**一个视觉世界、两个视图层**。

- **视觉世界**（跨端一致）：四套主题、品牌色、字体角色、间距与圆角刻度、状态色语义、图标语言。桌面端和 Android 端**看起来是同一个产品**。
- **视图层**（各自特色）：桌面端是**多栏工作台**（侧栏 + 主区 + 详情抽屉，鼠标键盘，高信息密度）；Android 端是**单栏卡片流**（顶部应用栏 + 底部导航 + 全屏详情页，触摸手势，单手可达）。

主题是"换一套衣服"，不是"换一个人"。两端共享的是**语义层**（色、字、间距、圆角、状态含义、图标），不共享的是**结构层**（导航形态、栏数、布局、交互模式、密度）。

### 共享 / 分端清单

| 层次 | 跨端共享 | 各自不同 |
|---|---|---|
| 数据 | SQLite 数据层、业务逻辑、store、同步协议 | — |
| 语义 token | 四套主题、品牌色、状态色、字体角色、间距、圆角 | — |
| 叶子组件 | 按钮、标签、图标、空状态、列表行、金额与日期排版、焦点环、滚动条 | 尺寸档位（桌面 36px / 移动 48dp）、图标尺寸 |
| 结构 | — | 导航（侧栏 / 底部导航）、页面容器、详情（抽屉 / 全屏页）、密度、间距档位上限 |
| 交互 | 操作的**语义**（完成、跳过、归档、改期） | 输入方式（hover+键盘 / 长按+手势+底部面板）、动效时长、系统返回行为 |
| 品牌 | 名称、典故、四个主题名、三份品牌资产、语气 | 材质层表现（桌面整窗玻璃 / Android 系统背景） |

## Colors

### 语义色板

前端 `src/styles/tokens.css` 是唯一真相源。**语义层**（四主题同构）与**材质层**（仅玻璃主题有值）必须拆开 —— 现状是两者混在 `--bg-panel` 一格里，这是阶段 2 的核心改造。

```
语义层  --surface-*  --text-*  --border-*  --accent*  --success/--warning/--danger  --focus-ring
材质层  --shell-opacity  --shell-blur  --shell-saturate  --shell-tint  --shell-border  --shell-shadow
```

### 四套主题（语义层取值）

| token | 清昼 | 静夜 | 晨曦玻璃 | 璃幕 |
|---|---|---|---|---|
| 气质 | 清爽 · 专注 | 沉静 · 低眩光 | 通透 · 有光 | 沉浸 · 透光 |
| 背景 | `#f6f8fc` | `#101722` | `#dfeafe` | 透明（透出壁纸） |
| 面板 | `#ffffff` | `#172131` | `rgba(255,255,255,.78)` | `rgba(22,30,44,.82)` |
| 正文 | `#17233b` | `#f7f9fd` | `#0b1428` | `#f7f9fd` |
| 次级 | `#5f6d83` | `#d0d8e6` | `#2c3d59` | `#d4dceb` |
| 弱化 | `#6b7a90` | `#a7b3c6` | `#4d5f7a` | `#b0bcd0` |
| 强调 | `#2f6fed` | `#70a1ff` | `#3478ee` | `#7eb0ff` |
| 成功 | `#2c8561` | `#32986e` | `#247c68` | `#5dcf9e` |
| 警告 | `#a96622` | `#c77828` | `#ae642e` | `#f0b35a` |
| 危险 | `#c3505a` | `#e05c67` | `#c84b5e` | `#f0888d` |
| 品牌金 | `#f4b942` | `#f4b942` | `#f4b942` | `#f4b942` |

> 品牌金是**品牌色，不随主题变**。它只用于题铭、里程碑这类有品牌含义的位置，绝不用于普通装饰。

### 状态色修正（阶段 2 必须落地）

**现状问题**：静夜主题**没有定义** `--success` / `--warning` / `--danger`，继承了浅色值；浅色主题的三个状态色本身也不达标。

| 用法 | 现状 | 对比度 | 判定 |
|---|---|---|---|
| 清昼 `--danger #d95964` 作文字 | on `#ffffff` | 3.77:1 | ❌ |
| 清昼 `--success #2f8f68` 作文字 | on `#ffffff` | 4.00:1 | ❌ |
| 清昼 `--warning #c77828` 作文字 | on `#ffffff` | 3.42:1 | ❌ |
| 清昼 `--text-muted #8d99ab` 作占位文字 | on `#ffffff` | 2.89:1 | ❌ |
| 静夜 `--danger`（继承浅色值） | on `#172131` | 4.28:1 | ❌ |
| 静夜 `--success`（继承浅色值） | on `#172131` | 4.04:1 | ❌ |
| 白字压 `--danger` 实心底 | 清昼 / 静夜 / 晨曦 / 璃幕 | 3.77 / 3.77 / 4.27 / 2.44 | ❌ 全挂 |
| 清昼 `--accent #2f6fed` 作文字 | on `#ffffff` | 4.55:1 | ✅ 刚好达标 |
| 清昼 `--text-secondary` / `--text-label` | on `#ffffff` | 5.25 / 7.94 | ✅ |

**契约取值**（最小改动量，全部 ≥4.5:1）：

| token | 清昼 | 静夜 | 晨曦玻璃 | 璃幕 |
|---|---|---|---|---|
| `--danger` | `#c3505a` | `#e05c67` | `#c5485a` | `#f0888d` |
| `--success` | `#2c8561` | `#32986e` | `#247c68` | `#5dcf9e` |
| `--warning` | `#a96622` | `#c77828` | `#aa612b` | `#f0b35a` |
| `--text-muted` | `#69778d` | `#a7b3c6` | `#4d5f7a` | `#b0bcd0` |
| `--text-overdue` | `#c3505a` | `#f0888d` | `#b93c52` | `#ffb0b6` |

> **三处最小微调**：上表原本写的是清昼 `--text-muted #6b7a90`、晨曦 `--danger #c84b5e`、晨曦 `--warning #ae642e`，
> 但这三值在本节自定的「≥4.5:1」标准下分别只有 4.36 / 4.35 / 4.31:1（面板基准：清昼 `#ffffff`、晨曦 `#f8faff`），
> 与本节声明的「全部 ≥4.5:1」不符。阶段 2 按声明的标准取**同色相最近的达标值**：
> `#69778d`（4.54:1）/ `#c5485a`（4.52:1）/ `#aa612b`（4.51:1）。其余取值一字未改。

**实心状态标签**（背景 + 白字）必须用**独立 token**，不能复用文字色 —— 四主题取值（括号内为白字对比度）：

| token | 清昼 | 静夜 | 晨曦玻璃 | 璃幕 |
|---|---|---|---|---|
| `--danger-solid` | `#c3505a` (4.55) | `#c3505a` (4.55) | `#c84b5e` (4.54) | `#b03a48` (5.92) |
| `--success-solid` | `#2c8561` (4.53) | `#2c8561` (4.53) | `#247c68` (5.05) | `#2c8561` (4.53) |
| `--warning-solid` | `#a96622` (4.55) | `#a96622` (4.55) | `#ae642e` (4.50) | `#a96622` (4.55) |

**「压在实心底上的文字色」也要分两种**（阶段 2 新增）：

| token | 清昼 | 静夜 | 晨曦玻璃 | 璃幕 | 用途 |
|---|---|---|---|---|---|
| `--text-on-accent` | `#ffffff` (4.55) | `#0b1428` (7.19) | `#060d18` (4.70) | `#0b1428` (8.33) | 压在 `--accent` 底上的字（主按钮） |
| `--text-on-solid` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | 压在 `--*-solid` 底上的字（状态标签） |

> 括号内是压在 `--accent` 上的对比度。**清昼的 `--accent` 够深，白字达标；静夜 / 晨曦玻璃 / 璃幕的
> `--accent` 是浅色调，白字只有 2.55 / 4.14 / 2.20:1** —— 这是 Material 3 的 `on-primary` 角色：
> 深色主题的 on-primary 用深色字，不是白字。阶段 2 已按此改写主按钮与分段控件的文字色。

**实心状态标签**（背景 + 白字）必须用**独立 token**，不能复用文字色：

- `--danger-solid` `#c3505a`（白字 4.55:1）/ 静夜 `#c3505a` / 晨曦 `#c84b5e` / 璃幕 `#b03a48`
- `--success-solid` `#2c8561`（白字 4.53:1）
- `--warning-solid` `#a96622`（白字 4.55:1）
- `--accent-solid` = `--accent`（清昼 `#2f6fed`，白字 4.55:1 已达标）

### Material color roles 映射（Android 端）

> **实现方式**：自建，**不引入 Material 组件库**（2026-10-21 评估，理由与数据见 `docs/MOBILE-IA.md` §6.1）。
> 下表是**结构规范**的落地：Material 3 管结构与交互，这 13 个 color role 由有秋的语义 token 填充，不是引入 Material 自己的色板。

结构用 Material 3，色彩用有秋。Android 端把有秋语义 token 映射到 Material role，**不引入 Material 自己的色板**：

| Material role | 有秋来源 |
|---|---|
| primary / on-primary | `--accent` / `--text-on-accent` |
| primary-container / on-primary-container | `--accent-soft` / `--accent-strong` |
| surface / surface-container | `--bg-root` / `--bg-panel` |
| surface-container-high | `--surface-elevated` |
| on-surface / on-surface-variant | `--text-primary` / `--text-secondary` |
| outline / outline-variant | `--border-strong` / `--border` |
| error / on-error | `--danger-solid` / `--text-on-accent` |
| tertiary | `--brand-gold` |

## Typography

### 字体策略

**保持系统字体**（决策已定）。理由：中文字体自托管的体积代价与「本地优先」定位冲突；中文系统字体（苹方 / 微软雅黑 / HarmonyOS Sans）品质不差，且自动跟随系统字号与语言。

**但要拆角色**：现状 `--font-display` 与 `--font-body` 是同一套字体，等于没有 display 字体。契约：

| 角色 | 字体栈 | 用途 |
|---|---|---|
| display | `Microsoft YaHei UI` / `PingFang SC` / `Segoe UI Variable Display` | 页面大标题、目标名称、金额大数 |
| body | `Microsoft YaHei UI` / `PingFang SC` / `Segoe UI Variable Text` | 正文、列表、说明 |
| label | body 栈 | 字段标签、计数、元信息 |

数字与金额用 `font-variant-numeric: tabular-nums`，避免跳动。

### 字号刻度

| 级别 | 桌面 | 移动 | 用途 |
|---|---|---|---|
| display | 30px | 30px | 页面大标题（**仅一处**，见 Do's） |
| h1 | 24px | 24px | 模块标题 |
| h2 | 20px | 20px | 区块标题 |
| h3 | 16px | 16px | 小节标题 |
| body | 14px | 15px | 正文 |
| label | 13px | 13px | 标签、计数 |
| caption | 12px | 12px | 元信息、占位 |

- 正文行高 1.6；标题 1.25-1.35
- 桌面正文字号 14px、移动 15px —— 移动端提高一档补偿密度差
- **输入控件字号 ≥16px**（避免 iOS 聚焦时整页缩放），输入框不适用 14/15px 刻度

## Layout

### 刻度

| token | 值 | 用途 |
|---|---|---|
| `--space-xs` | 4px | 图标与文字的最小间隙 |
| `--space-sm` | 8px | 同组元素 |
| `--space-md` | 12px | 组件内边距 |
| `--space-lg` | 16px | 卡片内边距 |
| `--space-xl` | 24px | 区块之间 |
| `--space-xxl` | 32px | 页面分节 |
| `--space-xxxl` | 48px | 空状态、大留白 |

**规则**：标题上方间距 > 标题下方间距（比 1:1 更大）。同组元素靠得紧，异组元素拉开。

### 桌面端（多栏工作台）

```
┌─────────────────────────────────────────────────┐
│ 标题栏（玻璃，命令面板入口居中）                    │
├──────────┬──────────────────────┬───────────────┤
│          │                      │               │
│  侧栏     │      主工作区          │   时间轴       │
│ 232px    │      弹性              │   300px        │
│          │                      │               │
│ 五分组    │  今日 / 账本 / 目标…   │  （按视图显示）  │
│ 可拖拽    │                      │               │
│          │                      │  详情 → 右侧抽屉  │
└──────────┴──────────────────────┴───────────────┘
```

- 侧栏宽 232px，可拖拽调整，可折叠
- 详情用**右侧抽屉**覆盖在主区上，不挤压主区
- 视图切换不重排侧栏（位置稳定）
- 最小窗口 800×560（`tauri.conf.json`），窄于此宽度时时间轴折叠

### Android 端（单栏卡片流）

```
┌───────────────────────┐
│ 顶部应用栏（标题 + 动作）  │
├───────────────────────┤
│                       │
│   单列卡片流（可滚动）     │
│   主操作 FAB（右下）      │
│                       │
├───────────────────────┤
│ 今日 待办 记账 更多      │  ← 底部导航（3-5 项）
└───────────────────────┘
```

- 内容区**单列**，卡片之间 12px
- 顶部应用栏承载屏幕上下文与返回；**不要**在顶部再放标题
- 底部导航 4 项：今日 / 待办箱 / 记一笔 / 更多
- 主操作 FAB 一个（今日页"新建任务"、账本页"记一笔"）
- 详情用**全屏页**，不用抽屉
- edge-to-edge：内容避开状态栏、导航栏、刘海与键盘（IME inset）

## Elevation & Depth

### 表面层级

| 层 | token | 用途 |
|---|---|---|
| 0 | `--bg-root` | 应用底 |
| 1 | `--bg-panel` | 卡片、面板、列表项 |
| 2 | `--surface-elevated` | 弹层、下拉、浮起的行 |
| 3 | `--surface-sunken` | 输入框、凹槽、分隔块 |

### 规则

> **升一级表面 = 换底色 XOR 加边框，不同时加阴影。**
> 1px 边框下面再压一层大软阴影 = 幽灵卡。

- **桌面端**：卡片**不给阴影**。分隔靠 1px `--border` 或一档色差。阴影只留给真正浮起的层（抽屉、下拉、对话框），且带偏移与柔和模糊。
- **移动端**：Material 的 tonal elevation 为主（surface 层级 + 极轻阴影），不靠大投影。
- 玻璃主题（晨曦玻璃 / 璃幕）：模糊与透明**只在整窗外壳与标题栏**使用，是特定效果不是装饰；内容区仍用实底，否则可读性崩塌。

## Shapes

| token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 8px | 标签、小控件、输入框内元素 |
| `--radius-md` | 12px | 按钮、输入框、卡片 |
| `--radius-lg` | 18px | 抽屉、对话框、整窗外壳 |
| `--radius-pill` | 999px | 仅小控件（分段控件、状态点） |

> 圆角从 10/16/22 三档混用收敛到 8/12/18 三档。
> 卡片圆角**不超过 16px**；`--radius-lg` 只给容器不给卡片。

**图标**：`src/components/AppIcon.tsx` 是唯一的图标来源，同一套描边粗细与网格。**不使用 emoji 或 Unicode 字形充当图标。**

## Components

### 跨端共享（叶子组件）

| 组件 | 规格 |
|---|---|
| 主按钮 | 高 36px（桌面）/ 48dp（移动），圆角 12px，`--accent` 底 + 白字，按下 `scale(0.97)` |
| 次按钮 | 高 32px（桌面）/ 40dp（移动），`--surface-hover` 底，无边框 |
| 幽灵按钮 | 无底无框，hover 才显底 |
| 输入框 | 高 36px（桌面）/ 48dp（移动），**字号 ≥16px**，聚焦显示 `--focus-ring` |
| 标签 | 高 22px，圆角 8px，13px 标签字；实心底必须用 `--*-solid` token |
| 状态点 | 6px 实心圆 + 同色 12% 底，**不用彩色描边** |
| 列表行 | 高 56px（桌面）/ 64dp（移动），左图标 20px + 标题 + 右侧元信息 |
| 空状态 | 标题 + 一句说明 + 一个动作，**不用图标瓦片** |

### 端差异（页面级）

| 元素 | 桌面端 | Android 端 |
|---|---|---|
| 导航 | 侧栏（五分组，典故注释） | 底部导航 4 项 + 「更多」面板 |
| 页面容器 | 多栏 | 单列卡片流 |
| 详情 | 右侧抽屉 | 全屏页 + 顶部返回 |
| 新建任务 | 居中对话框 | 全屏页或底部弹层 |
| 任务行操作 | hover 显形 + 右键菜单 | 长按 → 底部操作面板 |
| 账本录入 | 表格 + 弹窗 | 页面内快速录入（金额优先） |
| 空状态 | 居中单块 | 卡片流中的一张占位卡 |
| 系统返回 | 无 | 必须关闭最上层浮层，不退出应用 |

## Do's and Don'ts

### 必做

- **接管浏览器默认外观**：选中文本、插入符、滚动条、焦点环、下划线偏移、等宽数字，全部从调色板接管。
  *这是"看起来是构建出来的、而不是拼装出来的"最廉价也最可靠的信号。*
- 颜色**给数据**，不给装饰。彩色像素占比控制在 3% 左右。
- KPI 是**字号**，不是"彩色圆圈里一个图标"。
- 数字右对齐、零值打印为 0、缺失值打印灰破折号、空区块保留边框。
- 表格不用斑马纹、不用表头色带。
- 焦点环可见，不得移除。
- 尊重 `prefers-reduced-motion`。
- 移动端 hover 态必须用 `@media (hover: hover)` 隔离。

### 禁做

- ❌ 卡片 / 列表 / 提示块上 **>1px 的单侧彩色边框**（现状 6 处，见 §9）
- ❌ 标题上方的小标（kicker / eyebrow）—— 这是**绝对禁止项，没有任何 brief 能豁免**
- ❌ "大数字 + 小标签 + 辅助统计 + 强调色"的 hero-metric 模板
- ❌ 渐变文字；强调靠字重或字号
- ❌ 玻璃与模糊当装饰（只在整窗外壳与标题栏使用）
- ❌ 硬偏移阴影 `box-shadow: 4px 4px 0`
- ❌ emoji / Unicode 字形充当图标
- ❌ 1px 边框 + 大软阴影同时出现（幽灵卡）
- ❌ 圆角超出 12-16px 的卡片
- ❌ 字距减到 -0.04em 以下
- ❌ 页面出现第二个大标题
- ❌ 触摸目标小于 44px（桌面）/ 48dp（移动）

### 豁免（检测器会误报，勿改）

| 场景 | 判定 |
|---|---|
| `blockquote` 的左侧色条 | **保留** —— 引用语义 |
| 时间轴 / 日历的刻度条 | **保留** —— 信息语义 |
| 品牌题铭的强调条（`--brand-gold`） | **保留** —— 品牌语义 |

> 检测器报的是线索不是结论。每条人工判定，误报写进本节，不要盲从。

## 9. 迁移映射表（现状 → 契约，阶段 2 施工用）

| 现状 token | 契约 token | 处理 |
|---|---|---|
| `--bg-root` | `--surface-base` | 重命名，四主题对齐 |
| `--bg-panel` | `--surface-panel` | 重命名 |
| `--surface-elevated` | `--surface-raised` | 重命名 |
| `--surface-soft` | `--surface-sunken` | 重命名 |
| `--bg-rail` | **`--surface-rail`** | 重命名（新增 token，见下方注 1） |
| `--bg-hover` / `--bg-selected` | `--surface-hover` / `--surface-selected` | 重命名 |
| `--bg-input` | **`--surface-input`** | 重命名（新增 token，见下方注 2） |
| `--text-*` | 同名 | 保留，**`--text-muted` 改值**（四主题） |
| `--accent*` | 同名 | 保留 |
| `--success` / `--warning` / `--danger` / `--vip` | 同名 + 新增 `--*-solid` | **改值**（四主题） |
| `--border` / `--border-strong` | 同名 | 保留 |
| `--shadow` / `--shadow-soft` | `--shadow-2` / `--shadow-1` | 重命名，仅浮起层使用 |
| `--radius` / `--radius-sm` | `--radius-lg` / `--radius-sm`，**新增 `--radius-md`** | **改值**（8/12/18）。卡片用 `--radius-md`、容器用 `--radius-lg`（见下方注 3） |
| `--focus-ring` | 同名 | 保留 |
| `--rail-w` / `--side-w` / `--timeline-w` | `--layout-*` | 移出主题文件到 layout 层 |
| `--transition` | `--motion-fast` 等 | 移出主题文件到 motion 层 |
| `--font-display` / `--font-body` | `--font-display` / `--font-body` / **新增 `--font-label`** | 拆角色 |

**新增 token（阶段 2 引入）**：

```
语义层  --surface-base  --surface-panel  --surface-raised  --surface-sunken
        --surface-hover  --surface-selected
        --danger-solid  --success-solid  --warning-solid  --accent-solid
材质层  --shell-opacity  --shell-blur  --shell-tint  --shell-border  --shell-shadow
文字层  --text-on-accent  --text-on-solid
刻度层  --space-xs/sm/md/lg/xl/xxl/xxxl
        --font-size-display/h1/h2/h3/body/label/caption
        --radius-sm/md/lg/pill
        --motion-fast/base/slow  --motion-ease-out  --motion-ease-in
布局层  --layout-rail-w  --layout-side-w  --layout-timeline-w
```

> **注 1 · 侧栏单列 `--surface-rail`**：本表原写 `--bg-rail` 合并进 `--surface-sunken`。但 `--bg-rail`
> 同时承担两种角色 —— 侧栏底色（`polish-03-solid-shells.css`）与进度条凹槽（`g06` / `g08`）。
> 合并后静夜主题的侧栏会从 `#0c121c`（比面板更深）变成 `#202d40`（比面板更浅），
> 层级关系反转；璃幕主题的侧栏会从深色玻璃变成 `rgba(255,255,255,.12)` 的浅色洗白。
> 因此拆成两个 token：侧栏用 `--surface-rail`，凹槽用 `--surface-sunken`。
>
> **注 2 · 输入框单列 `--surface-input`**：本表原写 `--bg-input` 合并进 `--surface-panel`。
> 合并后璃幕主题的输入框会从 `rgba(255,255,255,.14)`（磨砂白内嵌场）变成面板色
> `rgba(22,30,44,.82)`，与面板同色后失去「内嵌场」的视觉暗示。`.表面层级` 表把
> 「输入框」列在第 3 层（`--surface-sunken`），但那会让清昼主题的输入框从纯白
> `#ffffff` 变成 `#f0f4fa`，与现有观感不符。故单列 `--surface-input`。
>
> **注 3 · 卡片与容器的圆角分工**：`§Shapes` 规定「卡片圆角不超过 16px，`--radius-lg` 只给容器不给卡片」。
> 现状 `--radius`（16px）被 7 处共用，其中 `.scope-card`、`.habits-card` 是卡片，
> 迁到 `--radius-lg`（18px）会越线 —— 这两处改用 `--radius-md`（12px），
> 其余 5 处（`--board-col` / `--timeline-h-scroll` / `--scope-empty` / `--week-board` / `--modal`）
> 是容器，用 `--radius-lg`（18px）。

## 10. 迁移映射的验证方式

- 阶段 2 完成后：四主题逐一肉眼比对 + `npx vite build` + 对比度脚本复算
- 阶段 3/4 完成后：`impeccable detect http://localhost:4173`（桌面）+ `adb exec-out screencap`（移动）
- 每次改 token 后跑一次 `impeccable doctor`，确认契约与实现没有漂移
