# 有秋（Yield）Android 端信息架构与视图层设计

> **配套文档**：[PRODUCT.md](../PRODUCT.md)（产品事实与决策）、[DESIGN.md](../DESIGN.md)（视觉契约）、[UI-REDESIGN-ROADMAP](UI-REDESIGN-ROADMAP.md)（阶段 4 施工计划）
> **编写时间**：2026-10-21
> **基线代码**：`9b8bc6b`
> **适用端**：Android（APK 侧载）。不做 iOS 版本。

---

## 1. 目标与约束

### 目标

让 Android 端成为**为手机设计的应用**，而不是桌面的竖屏版。具体三条：

1. **有独立的信息架构** —— 手机上要干的事，和桌面上要干的事不一样。桌面是「规划与复盘」，手机是「查看与快速记录」。
2. **有平台自己的质感** —— Material 3 的结构与交互，有秋的色彩与语气。
3. **看得见的细节** —— 手感层（触摸、返回、安全区、字号缩放）必须逐条修到位。

### 约束

- **共享内核**：数据层、业务逻辑、store、同步协议、四套主题、语义 token、叶子组件（按钮/标签/图标/空态/列表行/选择器/日期时间选择）。
- **分端视图层**：页面容器、导航形态、详情形态、布局、密度、交互模式。
- **零新增 UI 组件库**（决策已定）：Material 3 的结构与行为规范**照着自建**，不引入 `@material/web` / MUI。理由见 §6.1。
- 同一份前端代码，Android 端通过 `isMobileShell()`（UA 含 `android`，桌面 WebView2/WKWebView 不含）进入移动壳。桌面浏览器加 `?shell=mobile` 可预览移动布局。

---

## 2. 现状诊断

| 层 | 事实 | 后果 |
|---|---|---|
| 组件层 | 移动端专属组件仅 3 个 / 8.9 KB；`MainWorkspace`（36.3 KB）、`DetailDrawer`（18.1 KB）、`CommandPalette`（13 KB）、`CreateTaskDialog`（11.6 KB）在移动端**原样渲染** | 桌面多栏布局被强行压进竖屏 |
| 样式层 | `global-14-mobile.css` 1,404 行，占 CSS 14.7%，**只有 5 个媒体查询断点**（700px×3、560px、720px），主体是覆盖 `.projects-detail` / `.today-hero` / `.board` / `.workspace-top` 等**桌面选择器** | 补丁不是设计；改桌面连带炸移动 |
| 交互层 | 长按弹 `TaskActionSheet` 打补丁；无顶部应用栏、无 FAB、无 Material 组件；`isMobileShell()` 分支散落在 **11 个文件 38 处** | "iOS app wearing Android's skin" |
| 信息架构 | 「更多」是 **13 个图标的扁平宫格**，五分组典故结构丢失 | 品牌承诺被平台差异抹平 |

---

## 3. 导航重构

### 3.1 桌面 14 入口 → 移动 4 入口

桌面侧栏有 5 组 14 个入口（`src/components/NavSidebar.tsx`）。移动端**不复制这个列表**。

| 桌面侧栏 | 移动端归属 | 理由 |
|---|---|---|
| **积微** 今日 | **底部导航 ①** | 每天必开的第一屏 |
| **积微** 待办箱 | **底部导航 ②** | 收集箱，随时往里扔 |
| **积微** 周清单 | 更多 → 积微组 | 一周一次的事，不必占底部导航 |
| **观澜** 收支总览 | **底部导航 ③**「记账」，落地页即收支总览 | 实测最高频入口（106 笔） |
| **有恒** 成长 / 习惯 / 复盘 | 更多 → 有恒组 | 复盘是周频，习惯是日频但在今日页可打卡 |
| **百工** 提醒 / 备忘录 / 项目 / 标签 | 更多 → 百工组 | 低频 |
| **更多** 纪念日 / 设置 / 回收站 | 更多 → 更多组 | 低频 |

**底部导航固定 4 项**：今日 / 待办 / 记账 / 更多（Material 规定紧凑宽度下 3–5 项 ✅）

### 3.2 「更多」面板：从扁平宫格改为典故分组列表

现状是 13 个图标的宫格，丢失了品牌承诺里的五分组结构。改为：

```
┌─────────────────────────────┐
│  ▣  有秋                      │  ← 品牌锁定（品牌标 + 名称 + 副题）
│     Yield · 服田力穑，乃亦有秋    │
├─────────────────────────────┤
│  🔍  搜索                     │  ← 全局搜索入口（移动壳没有标题栏）
├─────────────────────────────┤
│  积微                         │  ← 分组标题 + 释义（桌面端 hover 才显示，移动端直接显示）
│  积微 ——《荀子·强国》「积微，月不胜日。」  │
│    · 周清单                    │
│                              │
│  观澜                         │
│  观澜 ——《孟子·尽心上》「观水有术，必观其澜。」│
│    · 收支总览                  │
│                              │
│  有恒                         │
│  有恒 ——《论语·述而》「得见有恒者，斯可矣。」│
│    · 成长  · 习惯  · 复盘       │
│                              │
│  百工                         │
│  百工 ——《论语·子张》「百工居肆以成其事。」│
│    · 提醒  · 备忘录  · 项目  · 标签  │
│                              │
│  更多                         │
│    · 纪念日  · 设置  · 回收站    │
└─────────────────────────────┘
```

**变化点**：
- 分组标题**直接显示释义**（桌面端是 hover 提示，移动端没有 hover，所以常驻）
- 宫格 → **列表**，13 项宫格在小屏上每项只有 ~40px，列表每项 48dp 可点
- 保留典故分组 = 品牌承诺在移动端也成立

---

## 4. 各页面的移动端结构

### 4.1 今日（底部导航 ①）

```
┌─────────────────────────────────┐
│ 10月21日  周二        [搜索] [⋯] │  ← 顶部应用栏
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 目标进度 ▓▓▓▓░░░  读完前5本  │ │  ← 目标条（GoalStrip 移动版，单行）
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 09:00  写周报                 │ │  ← 任务卡
│ │        项目：读书 · 目标：读完  │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 14:30  整理素材               │ │
│ └─────────────────────────────┘ │
│                                 │
│  已完成 3 项              展开 ▾  │  ← 折叠区
│                         ╭─────╮  │
│                         │  ＋  │  │  ← FAB：新建任务
│                         ╰─────╯  │
├─────────────────────────────────┤
│  今日     待办     记账    更多   │
└─────────────────────────────────┘
```

- **顶部应用栏不放大标题**（大标题只在页面内容里出现一次）
- 任务卡 = 时间 + 标题 + 归属标记（项目/目标），**一行一处，不嵌套**
- **长按任务卡** → 底部动作面板（改期 / 顺延 / 优先级 / 项目 / 目标 / 备注 / 删除）
- 目标条单行显示，不做成卡片里的卡片

### 4.2 待办（底部导航 ②）

- 顶部应用栏：待办 + 未整理计数
- 内容：无日期 / 非今日的任务卡片流，按"最早添加"排序
- 每张卡右上角一个**快速归类**按钮 → 直接选日期或拖入项目
- FAB：新建任务（默认无日期）

### 4.3 记账（底部导航 ③）

**页面本体是账单统计与展示**（对齐桌面「观澜 · 收支总览」）；新建与修改明细走 FAB 打开的底部弹层。

```
┌─────────────────────────────────┐
│ 记账      2026年10月账单 ‹ 10月 › │  ← 顶部应用栏 + 月份切换
├─────────────────────────────────┤
│ ¥ 33.10  10月支出        ▁▃▂    │  ← 淡蓝顶卡：本月支出 + 构成色条
│ 收入 ¥500.00 · 结余 ¥466.90 · 15笔 │
│                                 │
│ 支出去向                 8 类    │
│ ● 餐饮        38% ¥12.50       │  ← 分类占比横条
│                                 │
│ 六个月流向          ●收入 ●支出  │
│  ▂▄ ▅▂ ▁▅ ▃▂ ▂▅ ▅▃             │  ← 六个月成对竖条
│  5月  6月  7月  8月  9月  10月    │
│                                 │
│ 明细                     15 笔  │
│ 今天                    −¥18.10 │
│ 🍜 午餐 · 微信 · 12:30  −¥12.50 │  ← 点行打开修改弹层
│                                 │
│                         ╭─────╮  │
│                         │  ＋  │  │  ← FAB：记一笔（底部弹层）
│                         ╰─────╯  │
├─────────────────────────────────┤
│  今日     待办     记账    更多   │
└─────────────────────────────────┘
```

要点：
- 顶卡与今日 / 待办共用「淡蓝顶卡」族，衬线大数字是本月支出；构成色条与「支出去向」同类别同颜色
- 金额键盘录入移到弹层里，统计页不被输入框占据；弹层沿用任务操作面板的 action-sheet 底，表单用「灰标签 + 值 + 发丝线」行式结构（与任务详情面板同族）
- 分类占比用横条、趋势用成对竖条（390px 宽度下环形图不好读）
- 明细按日分组（今天 / 昨天 / 月日 + 星期），今天行用强调色药丸标记；点行打开修改弹层（底部动作栏放删除）
- 预算进度、隐藏金额、回收站入口暂不进移动端（留待后续迭代）

### 4.4 更多（底部导航 ④）

见 §3.2。

### 4.5 详情形态

| 对象 | 桌面 | 移动 |
|---|---|---|
| 任务详情 | 右侧抽屉 `DetailDrawer` | **全屏页**，顶部应用栏带返回 |
| 目标详情 | 抽屉 / 侧栏 | 全屏页 |
| 成长阶段勾选 | 抽屉内 | 目标页内联展开 |
| 账目详情 | 弹窗 | **底部弹层**（轻量） |
| 任务操作菜单 | hover + 右键 | 长按 → 底部动作面板 |
| 新建任务 | 居中对话框 | **底部面板**（92dvh sheet，与「待办」弹层同族；表单长、内部滚动） |

---

## 5. 技术结构

### 5.1 目录

```
src/components/
  mobile/
    MobileNav.tsx            底部导航（改造：4 项 + 选中态 + 安全区）
    MobileMorePanel.tsx      ← 改造自 MobileMoreSheet，改成典故分组列表
    MobileTaskSheet.tsx      ← 改造自 TaskActionSheet，改成 Material 底部动作面板
    views/
      MobileToday.tsx        今日
      MobileInbox.tsx        待办
      MobileLedger.tsx       记账（统计 + FAB 弹层录入）
      MobileMore.tsx         更多
      MobileTaskDetail.tsx   任务详情全屏页
      （新建任务复用桌面 CreateTaskDialog，移动壳样式做成底部 sheet）
      MobileGoalDetail.tsx   目标详情
  AppIcon.tsx                共享（唯一图标来源）
  SelectMenu.tsx             共享叶子组件
  DatePicker.tsx             共享叶子组件
  TimePicker.tsx             共享叶子组件
  ...
```

### 5.2 `MainApp.tsx` 的分支改造

**现状**（`src/app/MainApp.tsx:704`）：

```jsx
if (isMobileShell()) {
  return (
    <div className="app-root">
      <div className="app-body">
        <MainWorkspace />            {/* 桌面组件 */}
        {detailOpen ? <DetailDrawer /> : null}
      </div>
      <MobileNav />
      ...
    </div>
  );
}
```

**目标**：

```jsx
if (isMobileShell()) {
  return (
    <div className="app-root">
      <MobileShell />               {/* 新的移动壳：内部按 nav 渲染 mobile/views/* */}
      <MobileNav />
      <MobileTaskSheet />
      <AppConfirmHost />
      ...
    </div>
  );
}
```

- 移动壳**不再渲染** `MainWorkspace` / `DetailDrawer` / `CommandPalette` / `CreateTaskDialog`
- 移动端不提供命令面板；全局搜索改为「更多」面板里的搜索入口（`openCommandPalette` 可复用，但呈现为移动端搜索页）
- 移动端不渲染 `DesktopNotificationCards`（桌面通知卡片是桌面概念），移动端走系统通知

### 5.3 共享叶子的处理

`SelectMenu` / `DatePicker` / `TimePicker` / `AppIcon` **直接复用**，只做尺寸与触控目标适配（触控目标 ≥48dp、输入字号 ≥16px）。

新建 `src/styles/primitives.css` 放跨端叶子样式（按钮/标签/输入/选择器/列表行），桌面与移动共用。

### 5.4 样式

- 移动端样式**独立成文件**：`src/styles/views/mobile.css`（或 `src/styles/mobile/` 目录）
- **不再在移动端 CSS 里覆盖桌面选择器**（现状 `global-14-mobile.css` 的做法）
- 断点不再是"桌面布局被压扁"，而是移动端**自己的布局**，因此不需要那么多断点

---

## 6. Material 3 结构落地清单

> 依据 `impeccable/reference/android.md`。
> **结构与交互用 Material 3，色彩与语气用有秋**（决策已定）。Material 的色板、字体一律不用。

### 6.1 为什么自建而不引组件库（决策已定，2026-10-21 评估）

**评估过的三个方案**：

| 方案 | 结论 | 决定性理由 |
|---|---|---|
| **MUI** (`@mui/material`) | ❌ 否决 | 整个样式模型是 **CSS-in-JS（`sx` props）**。有秋现状是 100% 普通 CSS（0 处 CSS-in-JS、0 Tailwind、0 CSS Modules）。引入 MUI 等于把 37 个组件的样式全部搬进 `sx`，并且 MUI 的主题是 **JS 对象**——四套主题要挂四棵 ThemeProvider 树，阶段 2 的"职责命名 CSS 分层"计划当场作废。而且 MUI v6/v7 主体是 Material Design **2**，不是 3。体积约 +95 KB gzip。 |
| **Material Web** (`@material/web`) | ❌ 否决 | 技术上可行（MDC 用 `--md-sys-*` CSS 变量，确实能映射到有秋 token），但代价高于收益：① **Shadow DOM**——有秋现在 0 处 shadow DOM，MDC 组件在 shadow 里，外层 CSS 进不去，每个组件定制都要 `::part()` 穿透；② **不是 React 组件**，要引社区 wrapper（对 React 19 支持滞后）或多包一层适配；③ MDC 主题系统约 **200 个 token × 4 套主题 = 800 条定义**，比有秋现在 145 条还多——而我们真正需要的 Material color roles 只有 **13 个**，`DESIGN.md` 已经画好映射表；④ 要替换 `DESIGN.md` 里 11 个**已经在用**的叶子组件（`SelectMenu` / `DatePicker` / `TimePicker` / `AppIcon` 等），带回归风险。体积约 +30~45 KB gzip。 |
| **自建（选定）** | ✅ 采纳 | 见下 |

**关键判断：Material 3 提供的是规范，不是代码。**

把 `android.md` 要求的东西逐条拆开，看自建成本和库能省多少：

| M3 要求 | 有秋的现状 / 成本 | 引入库能省多少 |
|---|---|---|
| 底部导航栏（3-5 项） | 已有 `MobileNav.tsx`，改造即可 | ~0（本来就存在） |
| 顶部应用栏 | 新建 1 个组件 | ~0 |
| FAB | 新建 1 个组件 | ~0 |
| 底部动作面板 | 已有 `TaskActionSheet`，重做 | ~0 |
| 颜色角色（13 个） | `DESIGN.md` §Colors 已画好映射表 | ~0 |
| 字体尺度（7 级） | `DESIGN.md` §Typography 已定义 | ~0 |
| 形状（3 档圆角） | `DESIGN.md` §Shapes 已定义 | ~0 |
| 动效曲线与时长 | `emil-design-eng` / `animate` skill 已有 | ~0 |
| 48dp 触控目标 | CSS 一行 | ~0 |
| 系统返回 / IME inset | `mobileBack.ts` 已有，需补预测性返回 | ~0 |
| Dialog / Snackbar / Switch / Chips / TextField | 唯一真正需要新建的一批 | **但有秋已有等价物**（`AppConfirm` / `CreateTaskDialog` / toast / 标签 / 自绘输入框），且都不是 Material 专属 |

**库唯一能省的那一块，是有秋已经有的东西。**

**体积账**（实测当前构建产物）：

```
JS   原始 1,068 KB → gzip 341 KB
CSS  原始   182 KB → gzip  32 KB
合计 gzip 373 KB

@material/web（实际用到的组件）  +30~45 KB gzip
@mui/material（core）            +95 KB   gzip
material-color-utilities         +8 KB    gzip（纯色彩算法，无组件）
```

`material-color-utilities` 也一并评估了并否决：**有秋的四套主题是刻意不同的气质**（清昼清爽 / 静夜沉静 / 晨曦通透 / 璃幕沉浸），不是同一 seed 的色调阶梯。算法生成的 tonal palette 会覆盖掉这份美术判断；而状态色的 AA 达标值已经算好（`DESIGN.md` §Colors），不需要算法。

**时间账**（阶段 4 估 3-5 天）：

| | 引库 | 自建 |
|---|---|---|
| 学习 MDC theming + Shadow DOM 穿透 + React wrapper | ~0.5-1 天 | 0 |
| 映射 4 套主题到 `--md-sys-*`（~800 条） | ~1 天 | 0（13 个 role 已在 `DESIGN.md`） |
| 替换 11 个在用组件为 MDC 等价物 | ~1-2 天，带回归风险 | 0 |
| 新建 6 个真正需要的组件 | 0 | 已在阶段 4 范围内 |
| **净账** | **+2.5~4 天** | **基线** |

**"看起来 Material" ≠ "感觉原生"**。有秋的 Android 端是 **WebView 应用**，不是原生 Android App。装 `@material/web` 只能得到 Material 的*样子*，得不到原生*手感*：

- MDC 的 ripple 是网页 ripple，不是 Android 的物理水波
- 原生文本选择手柄、原生长按菜单、原生下拉刷新、原生键盘行为 —— 一个都不会因此出现
- 300ms 点击延迟、sticky hover、iOS 聚焦缩放 —— 全都还得按 `mobile-native` 清单手动修

而 `android.md` 的"Android slop test"说的三条硬伤是：

> *"a bottom-only navigation copied from iPhone, a back arrow that ignores the system Back gesture, Cupertino-shaped switches and dialogs"*

**没有一条是关于库的。** 三条都是**设计系统层面**可修的：
① 底部导航不是 iPhone 抄的就行（我们要加顶部应用栏 + FAB + Material 形态的开关与对话框）
② 返回键不响应系统手势 → 补预测性返回
③ Cupertino 形态的开关与对话框 → 按 M3 形态重画

**决策**：Material 3 管**结构与交互**，有秋管**色彩与语气**，两者都**自建**，零新增 UI 依赖。

> 这条决策记在 `PRODUCT.md`（已决定的事实）与本节。**不要在后续会话里重复讨论**；若将来要改，先读本节的数据。

### 6.2 落地项

| 项 | 要求 | 验收 |
|---|---|---|
| 导航 | 紧凑宽度 → 底部导航栏（3-5 项）；扩展宽度 → 导航栏 | 本期只做紧凑宽度；平板布局留待后续 |
| 系统返回 | 预测性返回手势 + 返回键；**不拦截、不劫持** | 已有 `mobileBack.ts` 栈，需接 Android 预测性返回 |
| 窗口 insets | edge-to-edge：状态栏、导航栏、刘海、**IME inset** | 内容不被键盘遮挡（现状未处理 IME） |
| 顶部应用栏 | 提供屏幕上下文 + 返回 | 每个页面有，且**不放大标题** |
| FAB | 每屏一个主操作 | 今日页 = 新建任务；记一笔页 = 保存 |
| 触摸目标 | ≥48×48 dp，间距 ≥8 dp | 现状 50/105 处 < 48px |
| 配色 | Material color roles ← 有秋语义 token | 见 `DESIGN.md` §Colors |
| 深色主题 | 一等公民，不是快速反色 | 四主题逐个真机验 |
| 组件 | 按钮（filled/tonal/outlined/text）、开关、chips、snackbar、底部弹层、导航栏、对话框 | 全部用有秋 token 重新实现 |
| 动效 | Material 动效模式（container transform / shared axis / fade through）+ 标准缓动时长 | 桌面端动效另算（阶段 5） |

---

## 7. 手感层修复清单

> 依据 `emil-design-eng/mobile-native/SKILL.md` 逐条核对，**全部需在真机确认**。
> "The user's phone is the source of truth."

| # | 项 | 有秋现状 | 动作 |
|---|---|---|---|
| 1 | sticky hover states | **91 条 `:hover`，0 处 `@media (hover:none)`** | 全部用 `@media (hover: hover)` 包裹 |
| 2 | inputs that zoom the page | 输入控件 13px×2、14px×1 | **≥16px** |
| 3 | 100vh bug | 7 处 `100vh`（mobile 内 2 处 `height:100vh`） | 改 `100dvh` |
| 4 | tap highlight flashes | 3 处处理，覆盖不足 | 全面接管 `-webkit-tap-highlight-color` |
| 5 | touch-action | 1 处 | 补 `touch-action: manipulation`（去掉 300ms 延迟） |
| 6 | content under the notch | ✅ 13 处 `safe-area-inset` | 扩展到顶部应用栏与底部导航 |
| 7 | pull-to-refresh hijacking | ✅ 5 处 `overscroll-behavior` | 保持 |
| 8 | long-press selecting button text | ✅ 8 处 `user-select:none` | 补到所有长按触发的元素 |
| 9 | mismatched status bars | 未处理 | 状态栏图标深浅随主题切换 |
| 10 | inputs zoom / 键盘遮挡 | IME inset 未处理 | 补 `env(safe-area-inset-bottom)` + 键盘监听 |
| 11 | `user-scalable=no` | viewport 里禁了缩放 | 放开（a11y），用 `maximum-scale` 不再禁用 |

---

## 8. 验证方式

> **移动端截图必须来自模拟器或真机，不能用浏览器。**
> 依据 `impeccable/reference/android.md`：
> *"Screenshots come from the emulator or a connected device, never a browser."*

```bash
adb exec-out screencap -p > shot.png           # 截屏
adb shell cmd uimode night yes                  # 切深色
adb shell settings put system font_scale 1.3    # 放大字号（暴露固定布局的截断）
adb shell settings put system font_scale 1.0    # 还原
```

- `font_scale 1.3` 特别重要：固定 px 布局在放大字号时的截断，浏览器预览发现不了
- 每套设备至少覆盖一种手机；目标含平板时再加一种平板
- 四套主题各截一轮
- 手感层 11 条逐条在真机上手动确认

---

## 9. 验收标准

### 信息架构
- [ ] 底部导航固定 4 项（今日 / 待办 / 记账 / 更多）
- [ ] 「更多」按典故五分组组织，分组释义常驻显示
- [ ] 移动端不渲染 `MainWorkspace` / `DetailDrawer` / `CommandPalette` / `CreateTaskDialog`
- [ ] 移动端存在独立的信息架构，不是桌面的竖屏版

### 视图层
- [ ] `src/components/mobile/views/` 存在，页面级组件与桌面分离
- [ ] 叶子组件（按钮/标签/图标/空态/选择器/日期时间）跨端共用
- [ ] 详情用全屏页，账目用底部弹层
- [ ] 记一笔为**页面内录入**，可连续记账
- [ ] 移动端 CSS 独立成文件，**不覆盖桌面选择器**

### Material 3
- [ ] 底部导航 3-5 项 ✅
- [ ] 每页有顶部应用栏，不放大标题
- [ ] 每屏一个 FAB
- [ ] 全部触摸目标 ≥48×48dp
- [ ] 预测性返回 + 系统返回键正常，不退出应用
- [ ] edge-to-edge + IME inset 正确
- [ ] 深色主题是一等公民
- [ ] 四主题在真机各验一轮

### 手感层
- [ ] 7 节 11 条**逐条真机确认**

### 质量门槛
- [ ] `npx tsc -b` ✅ `npx vitest run` ✅ `npx vite build` ✅
- [ ] `impeccable detect` 对移动端 CSS 无新增命中
- [ ] 主题切换在移动端实时生效
- [ ] `font_scale 1.3` 下无截断、无重叠、无横向滚动
