# 有秋（Yield）UI 视觉优化路线图

> **适用范围**：有秋（Yield）桌面端（Windows/macOS）+ Android 端前端视觉层
> **编写时间**：2026-10-21（**2026-10-24 二次复核**：阶段 1–3 已完工；阶段 4 移动壳主体与逐页打磨完成，
> 末轮改动已真机验收通过；清零 / 真机全量核对等剩余项见附录 B 阶段 4 小节，均未达标勿当已完；附录中「阶段 2 清零」类断言有回归，已就地标注 ⚠）
> **基线代码**：`9b8bc6b`（第 1 节诊断数字均为该提交快照，与现状的漂移以代码与 `node scripts/ui-css-audit.mjs` 现算为准）
> **关联文档**：[PRODUCT.md](../PRODUCT.md)（产品事实）、[DESIGN.md](../DESIGN.md)（视觉契约）、[MOBILE-IA](MOBILE-IA.md)（移动端架构）、[README](../README.md)（产品说明）、[ARCHITECTURE](ARCHITECTURE.md)（架构）、[PRODUCT_REVIEW](PRODUCT_REVIEW.md)（功能评估）、[GIT_CONVENTIONS](GIT_CONVENTIONS.md)（提交规范）
> **配套工具**：项目级 skill `impeccable` v4.7.0 / `emil-design-eng` / `mobile-native` / `animate`（均装于 `.agents/skills/`，不入库）

---

## 0. 这份文档怎么用

### 0.1 需求基线

这次要解决的是四件事，顺序有先后：

1. **桌面端与移动端 UI 都过于简陋**，目标是让《有秋》看起来像一个**精心打造**的应用，而不是"拼起来的界面"。
2. **移动端复用了太多桌面端内容**，导致移动端表现不好。这是本次的**主问题**，不是附带的。
3. **先优化桌面端，再优化移动端。**
4. **双端大体主题一致，但不是简单复用** —— 要有各自端的特色。

第 4 条决定技术方案：一致的部分必须是**语义层**（主题、色彩、字体、品牌），差异的部分必须在**视图层**（导航形态、布局结构、交互模式、密度）。见 §2。

### 0.2 核心判断

> **移动端的问题不是 CSS 问题，是架构问题。**
> 桌面端的问题不是审美问题，是契约缺失问题。

两条都指向同一个结论：**先把"什么是不变的"写成契约（阶段 1），再改会变的部分（阶段 3-4）。**

移动端现在长成什么样，是被桌面端的结构决定的；桌面端现在为什么难看，是因为"什么叫好看"从来没被写下来过。
所以顺序不能反：

```
阶段 1  视觉契约（PRODUCT.md + DESIGN.md，含"跨端共享什么 / 各自差异什么"）
   ↓
阶段 2  桌面端 CSS / token 分层收口
   ↓
阶段 3  桌面端视图层重做        ← 先做桌面端
   ↓
阶段 4  移动端视图层重建        ← 再做移动端
   ↓
阶段 5  动效与手感
```

**跳过阶段 1 直接改 = 白做。** 原因见 §1 与 §4。

### 0.3 会话交接

**新会话的开场白（直接复制粘贴）：**

```
读 D:\AAA_CSU\2503\Yield\docs\UI-REDESIGN-ROADMAP.md，按其中「当前阶段」继续。

开工前请先做三件事：
1. 跑 `.agents/skills/impeccable/scripts/impeccable.cmd context`，确认已识别到 PRODUCT.md 与 DESIGN.md
2. 读 PRODUCT.md、DESIGN.md、以及本阶段对应的专项文档
3. 复述：当前处于哪个阶段、本阶段的验收标准是什么、你打算先做哪一步 —— 等我确认后再动手

不要重跑 /impeccable init 或 /impeccable document，契约已定稿。
```

**注意**：项目级 skill 只在本项目目录下加载。开会话前确认工作目录是 `D:\AAA_CSU\2503\Yield`。

**为什么要开新会话而不是接着聊**：阶段 2 是 23 个 CSS 文件的机械重构，输入是 `DESIGN.md` §9 的迁移映射表（不是聊天记录）。新会话上下文干净，agent 不会带着阶段 1 的讨论惯性跑偏；也顺便让 hook 生效。

### 0.4 工具就绪情况（已验证）

| Skill | 位置 | 作用 |
|---|---|---|
| `impeccable` | `.agents/skills/impeccable/` | 主控：24 条命令 + 61 条确定性检测规则 + `PRODUCT.md`/`DESIGN.md` 契约 + 钩子自动扫描 |
| `emil-design-eng` | `.agents/skills/emil-design-eng/` | 设计工程哲学：细节、间距、边框阴影、动效判断框架 |
| `mobile-native` | `.agents/skills/mobile-native/` | **移动端手感清单**：sticky hover、iOS 缩放、100vh bug、tap 延迟、notch 遮挡… |
| `animate` | `.agents/skills/animate/` | 动效实现：曲线、时长、属性的正确选择 |

| 运行环境 | 状态 |
|---|---|
| 钩子 | ✅ `.codex/hooks.json`，PostToolUse + Stop 自动跑检测器 |
| 遥测 / 每日更新检查 | ✅ 均已关闭（`.impeccable/config.json`） |
| 重新安装 impeccable | `npx impeccable install --scope=project --providers=codex -y` |
| skill 生效 | ✅ 四个 skill 已在项目级加载，无需重启 |
| 完整检测（需 DOM 解析） | `npx vite build && npx vite preview` 后 `impeccable detect http://localhost:4173` |
| 桌面端截图 | ✅ 走 vite preview 浏览器版 |
| **移动端截图** | ⚠️ **必须用真机/模拟器**：`adb exec-out screencap -p > shot.png` |
| Tauri WebView2 | ❌ 连不上 CDP，无法直接被检测 |

---

## 1. 现状诊断

### 1.1 桌面端 · 样式层

| 指标 | 数值 | 说明 |
|---|---|---|
| CSS 文件 | 23 个 | `global-00` ~ `global-14` + `polish-01` ~ `polish-09` |
| CSS 总行数 | 9,530 行 | |
| 硬编码色值 | **339 处** | `tokens.css` 82 处（主题定义，合理）；**其余 257 处在非 token 文件** |
| `!important` | **30 处** | `g01`×1 `g05`×4 `g06`×1 `g09`×4 `g11`×6 `g12`×3 `p01`×2 `p02`×2 `p03`×3 `p04`×2 `p05`×2 |
| `var(--*)` 引用 | 1,206 处 | token 体系**已经在用**，不是没有 |
| CSS 类名总数 | 601 | 25 个在 TSX/TS/HTML 中找不到对应（**需人工确认**） |
| 触摸目标声明 | 105 处 | **45 处 < 44px，50 处 < 48px**（Material 要求 48dp） |

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

### 1.2 桌面端 · token 体系（已存在，是好消息）

`src/styles/tokens.css` 共 145 次 token 定义：

| 主题块 | token 数 |
|---|---:|
| `:root`（清昼/浅色基准） | 38 |
| `:root[data-theme="dark"]`（静夜） | 24 |
| `:root[data-theme="dawn"]`（晨曦玻璃） | 28 |
| `:root[data-theme="glass"]`（璃幕） | 31 |
| `@media(prefers-color-scheme:dark)` + `system` | 24 |

**关键结构性事实**：`dark` 只有 24 个 token，**比 `:root` 少 14 个** —— 暗色主题靠继承 `:root` 补齐。
后果：改一个 token，**某些主题表现会不对**。这是阶段 2 要收口的对象。

**字体现状**：`--font-display` 和 `--font-body` **是同一套系统字体**（`Microsoft YaHei UI` / `PingFang SC` / `Segoe UI Variable`），**没有任何自托管字体文件**（`public/` 与 `src/` 下无 woff/woff2/ttf）。

> impeccable `craft-floor.md` 原文：
> *"A system display face … as the display voice of an own-world page. Source and self-host a face whose character matches the approved lettering; **the closest installed font is a failure, not a fallback**."*
> 中文自托管字重极大（见 §2.4 决策点 3），这里需要权衡。

### 1.3 桌面端 · 组件层

37 个 `.tsx`，体积最大的几个：

| 文件 | 大小 | 备注 |
|---|---:|---|
| `GrowthView.tsx` | 38.6 KB | 对应 53 KB 的 `g06-growth.css` |
| `MainWorkspace.tsx` | 36.3 KB | 1034 行 |
| `SettingsView.tsx` | 27.5 KB | `isMobileShell()` 分支 10 处 |
| `LedgerView.tsx` | 23.4 KB | 高频入口 |
| `HabitsView.tsx` | 21.4 KB | |
| `DetailDrawer.tsx` | 18.1 KB | |
| `TodayAgenda.tsx` | 18.0 KB | 高频入口 |

### 1.4 移动端 · 三层问题（**本次主问题**）

移动端壳（`src/app/MainApp.tsx:704`）实际渲染的内容：

```jsx
if (isMobileShell()) {
  return (
    <div className="app-root">
      <div className="app-body">
        <MainWorkspace />        {/* 桌面端 36.3KB 工作台，原样渲染 */}
        {detailOpen ? <DetailDrawer /> : null}   {/* 桌面端 18.1KB 抽屉 */}
      </div>
      <MobileNav />              {/* 移动端专属 */}
      {moreOpen ? <MobileMoreSheet /> : null}     {/* 移动端专属 */}
      <CommandPalette />         {/* 桌面端 13KB 命令面板 */}
      {createTaskOpen ? <CreateTaskDialog /> : null}  {/* 桌面端 11.6KB 弹窗 */}
      <AppConfirmHost />
      <OnboardingGuide />
      <DesktopNotificationCards />
    </div>
  );
}
```

**移动端专属组件只有 3 个，共 8.9 KB**（`MobileNav` 2.5K + `MobileMoreSheet` 2.7K + `TaskActionSheet` 3.7K），
其余全部是桌面组件原样渲染。

| 层 | 事实 | 后果 |
|---|---|---|
| **组件层** | 3 个专属组件 / 8.9KB vs 桌面组件原样渲染 | 桌面的多栏布局假设（侧栏 + 时间轴 + 抽屉）被强行压进竖屏 |
| **样式层** | `global-14-mobile.css` 1,404 行（占 CSS 15%），**只有 5 个媒体查询断点**（700px×3、560px、720px），主体是覆盖 `.projects-detail` / `.today-hero` / `.board` / `.workspace-top` 等**桌面选择器** | 这是**补丁不是设计**。改桌面样式会连带炸移动端，反之亦然 |
| **交互层** | 长按弹 `TaskActionSheet` 打补丁；**无顶部应用栏、无 FAB、无 Material 组件**；`isMobileShell()` 分支散落在 **11 个文件 38 处** | impeccable `android.md` 的原话：*"an iOS app wearing Android's skin: a bottom-only navigation copied from iPhone"* |

**结论**：移动端目前**没有自己的信息架构**。桌面有多少个视图，移动就有多少个视图，只是塞进竖屏。
所以「让移动端有自己的特色」不是加个皮肤，而是要**给移动端一套独立的视图层**（§2）。

### 1.5 移动端 · 手感层核对（emil `mobile-native` 清单）

逐条对照 `mobile-native` skill 的检查清单：

| 检查项 | 有秋现状 | 判定 |
|---|---|---|
| sticky hover states（触摸后 hover 粘住） | **91 条 `:hover` 规则，0 处 `@media (hover:none)` 包裹** | ❌ 缺失 |
| inputs that zoom the page（iOS 聚焦缩放） | 输入控件字号 **13px×2、14px×1**（应 ≥16px） | ❌ 缺失 |
| 100vh bug（地址栏收起） | 7 处 `100vh`，其中 `g14-mobile.css:1063/1245` 是 `height:100vh` | ⚠️ 需改 `dvh` |
| tap highlight flashes（点击闪白） | 3 处处理，覆盖不足 | ⚠️ |
| touch-action（滚动/点击冲突） | 仅 1 处 | ⚠️ 不足 |
| laggy taps | 未见 `touch-action` 配套 | ⚠️ |
| long-press selecting button text | 8 处 `user-select:none` | ✅ |
| content under the notch | 13 处 `safe-area-inset` | ✅ |
| pull-to-refresh hijacking scroll | 5 处 `overscroll-behavior` | ✅ |
| viewport | `width=device-width, viewport-fit=cover` | ✅（`user-scalable=no` 存疑，a11y 上一般不推荐） |
| 100dvh / svh | 7 处 | ✅ 部分 |

> 这一层是**独立于视觉设计**的：它决定了 App 在手上"像不像原生"。
> 阶段 4 的第一步应该是照着 `mobile-native` 清单逐条修，**一天内可完成、零视觉风险、用户可感**。

### 1.6 检测器首轮结果

`impeccable detect src` → 142 文件扫描，**6 处命中，全部是同一条规则**：

> 卡片单侧粗彩色边框 —— "AI 生成 UI 最容易识别的特征"

| # | 文件:行 | 真实选择器 | 判定 |
|---|---|---|---|
| 1 | `g01-base-memos.css:331` | `.memo-reading-surface blockquote` | ⚠️ **语义正当**——引用块左侧色条是内容语义 |
| 2 | `g01-base-memos.css:372` | `.memo-rich-editor blockquote` | ⚠️ **语义正当**——同上 |
| 3 | `g05-airy-light.css:1528` | `.week-event` | ✅ **真命中**——周历事件块，装饰性色条 |
| 4 | `g05-airy-light.css:834` | `.timeline-h-event::before` | ✅ **真命中**——时间轴刻度条 |
| 5 | `g06-growth.css:478` | `.brand-origin-epigraph` | ⚠️ **待议**——题铭卡片，具品牌含义 |
| 6 | `g09-moments-workspace.css:185` | `.anni-detail-dialog > section` | ✅ **真命中**——纪念日详情分区 |

> **重要**：检测器的 `[side-tab]` 是它自己的**分类名**，不是 CSS 类名。别去搜 `side-tab`。
> 检测器**会误报**。每条都要人工判定，不许盲从。详见 §6.4。

### 1.7 检测覆盖率的诚实说明

直接扫 `.css` / `.tsx` 只做正则匹配，**对比度、文字过小、层级遮挡等需要解析 DOM 的规则不会跑**。
官方原话：*"findings are an undercount, not a clean bill of health."*

```bash
npx vite build
npx vite preview          # 另开终端
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173
```

---

## 2. 技术方案：一个内核 + 两个视图层

需求 §0.1 第 4 条（「大体主题一致，但不是简单复用」）在技术上的唯一解法是**分层**：

```
共享内核 Core                        分端视图层 Surface
────────────────────────────────      ─────────────────────────────
数据层      src/lib/db/**             桌面：侧栏 + 多栏工作台
业务逻辑    src/lib/**                   TodayAgenda / DetailDrawer
                                          键盘流 / hover / 右键

token 语义层                          移动：底部导航 + 卡片流
  ├ 品牌层（跨端完全一致）               MobileToday / 底部动作面板
  │   四套主题、品牌色、字体、语气         手势 / 长按 / 底部弹层
  └ 端形态层（各自特色）
      密度、层级、控件形态、导航

叶子组件（跨端共享）
  按钮 / 标签 / 图标 / 空态 / 列表行 / 数字排版
```

这个分层和 impeccable 的 **world vs surface** 概念正好对应：

- **一个 visual world**（清昼 / 静夜 / 晨曦玻璃 / 璃幕 + 品牌色 + 字体）= 「大体主题一致」
- **两个 surface**（桌面工作台 / 移动卡片流）= 「各有特色」

### 2.1 决策点 1：移动端是「改」还是「重建」

| 选项 | 做法 | 代价 | 评价 |
|---|---|---|---|
| **A** 继续改现有 | 在共享组件上继续加 `isMobileShell()` 分支 + CSS 覆盖 | 最低 | ❌ 现状的延续。11 个文件 38 处分支会继续膨胀，且桌面一改移动就炸 |
| **B** 全量重建 | 移动端完全独立的组件树 | 最高 | ⚠️ 叶子组件也重写，主题一致性难保证，重复劳动大 |
| **C** 混合 | **页面级组件分端各写一套；叶子组件共享** | 中 | ✅ **推荐** |

**推荐 C**，具体边界：

| 共享 | 分端 |
|---|---|
| 按钮、标签、图标、空状态、列表行、日期/金额排版 | 页面容器（`Today` / `Ledger` / `Growth` …） |
| 四套主题与全部语义 token | 导航（侧栏 vs 底部导航） |
| 数据层、业务逻辑、store | 布局（多栏 vs 卡片流） |
| 品牌资产（`design/branding/*.svg`） | 交互（hover / 键盘 vs 长按 / 手势 / 底部弹层） |
| 交互语义（完成、跳过、归档） | 密度与留白 |

落地形态：新建 `src/components/mobile/views/`，与 `src/components/*.tsx` 桌面视图并列；
`MainApp.tsx` 的 `isMobileShell()` 分支从"渲染同一棵树"改成"渲染另一棵树"。

### 2.2 决策点 2：Android 端走 Material 3 吗

**推荐：Material 3 管结构与交互，有秋的品牌管色彩与语气。**

依据 `impeccable/reference/android.md`：

> *"Material Design 3 governs structure, navigation, and interaction in every mode; **brand expresses through Material's theming (color roles, type scale, shape, motion)**."*

理由：
1. 有秋**只有 Android，没有 iOS**（README：APK 侧载），Material 3 是 Android 用户的默认期待
2. 有秋的四套主题（清昼/静夜/晨曦玻璃/璃幕）正好可以映射成 **Material color roles**（primary / on-primary / surface / surface-variant / outline / error）—— 这就是 `craft-floor.md` 说的 "raw hex breaks there" 的解法，也是 257 处硬编码的收口方式
3. 纯走 Material 会丢掉有秋的品牌语气；纯走自定义会变成 "iOS app wearing Android's skin"。**结构用 Material、皮肤用有秋**是正解

同时要满足 android.md 的硬性项：
- 顶部应用栏（Top app bar）+ 主操作 FAB
- Material 导航（紧凑宽度底部导航 / 扩展宽度导航栏）
- 触摸目标 **48×48 dp**（有秋现状 50/105 处 < 48px）
- 预测性返回手势 + 系统返回键（`mobileBack.ts` 已有基础，需补 predictive back）
- edge-to-edge + 窗口 insets（有秋已有 `safe-area-inset`，需扩展到 IME inset）
- Dark theme 是一等公民，不是快速反色

### 2.3 决策点 3：字体

`craft-floor.md` 说系统字体是 "failure, not a fallback"，但中文自托管的现实约束是：**思源黑体全字重 10MB+**，对本地优先应用是实打实的体积代价。

| 选项 | 做法 | 评价 |
|---|---|---|
| **A** 保持系统字体 | 现状 | ✅ 现实最优。中文 UI 的系统字体（苹方 / 微软雅黑 / HarmonyOS Sans）**品质并不差**，且自动跟随系统字号与语言 |
| **B** 只自托管 display 字体 | 标题用自托管的西文/数字字体，中文回退系统 | ⚠️ 中西混排的基线与字重对齐容易翻车，收益有限 |
| **C** 全量自托管 | 思源黑体 / 霞鹜文楷等 | ❌ 体积代价与本地优先定位冲突 |

**推荐 A**，但补两件事：
1. `--font-display` 和 `--font-body` **拆成不同角色**（现在完全相同，等于没有 display 字体）
2. 数字用 `font-variant-numeric: tabular-nums`（`craft-floor.md` 明确点名 "the numerals in tabular data" 属于"没被画过的部分"）

> ⚠️ 这条**待你拍板**。见 §2.5。

### 2.4 三个决策点（✅ 已于 2026-10-21 拍板）

| # | 决策 | 结论 | 影响 |
|---|---|---|---|
| 1 | 移动端重建范围 | ✅ **C 混合**（页面级分端、叶子共享） | 阶段 4 工作量 3-5 天 vs 继续打补丁的长期成本 |
| 2 | Android 结构基准 | ✅ **Material 3 管结构，有秋管皮肤** | 决定阶段 4 的组件选型；见 `docs/MOBILE-IA.md` §6 |
| 2b | Material 组件实现路径 | ✅ **自建，不引入组件库** | 2026-10-21 评估：MUI 的 CSS-in-JS 与本项目 CSS 分层冲突；Material Web 的 Shadow DOM + ~800 条 MDC token 映射成本高于收益；净账 +2.5~4 天。完整数据见 `docs/MOBILE-IA.md` §6.1，**不要重复讨论** |
| 3 | 字体策略 | ✅ **A 保持系统字体**（display/body/label 拆角色 + tabular-nums） | 接受 craft-floor 的这一条不合格项，已在 `DESIGN.md` §Typography 记录取舍 |

> 三个决策已写入 `PRODUCT.md`（产品决策段）与 `DESIGN.md`（端差异清单）。
> 移动端的具体落地见 **`docs/MOBILE-IA.md`**。

---

## 3. 阶段总览

| 阶段 | 目标 | 产出物 | 改代码 | 预估 |
|---|---|---|---|---|
| **1** | 视觉契约（含端差异层） | ✅ `PRODUCT.md`、`DESIGN.md` | ❌ | 已完成 |
| **2** | 桌面端 CSS / token 分层收口 | `src/styles/` 重构 | ✅ | 2-3 天 |
| **3** | **桌面端视图层重做** | 各页面视觉重做 | ✅ | 每模块半天-1 天 |
| **4** | **移动端视图层重建** | `src/components/mobile/views/*` | ✅ | 3-5 天 |
| **5** | 动效与手感 | 交互反馈、状态过渡 | ✅ | 1 天 |

---

## 4. 阶段 1 · 视觉契约（不动代码） —— ✅ 已完成 2026-10-21

### 4.1 为什么必须先做

桌面端四套主题效果是靠 **CSS import 顺序**"拼"出来的：

```
src/styles/index.css
  /* Cascade entry — order is intentional. Do not reorder theme/override layers. */
```

`g05` 铺底 → `g06` 覆盖 → `p01` 兜底 → `g14-mobile` 最后压移动端。

**后果**：改一个 `--accent`，`p01-overrides.css` 里 39 处硬编码值会盖住它；改一个间距，`g05` 和 `g06` 互相打架。
**任何"让 UI 好看"的改动都会踩坑。** 而且移动端那 1,404 行覆盖 CSS 会跟着一起炸。

### 4.2 步骤

> **本阶段已于 2026-10-21 完成**，产出如下：
>
> | 产物 | 位置 | 状态 |
> |---|---|---|
> | 产品事实 | `PRODUCT.md`（项目根） | ✅ 按 `impeccable:product-schema 1` 写就，`impeccable doctor` 无漂移 |
> | 视觉契约 | `DESIGN.md`（项目根） | ✅ YAML frontmatter（25 色 / 4 字体角色 / 7 间距 / 4 圆角 / 11 组件）+ 8 个规范章节 + §9 迁移映射表 |
> | 移动端信息架构 | `docs/MOBILE-IA.md` | ✅ 导航重构 / 4 个页面结构 / 目录 / Material 3 清单 / 手感层 11 条 |
>
> 后续会话**直接读这三个文件**，不必重跑 init / document。

**Step 1 — 跑 init（需要你本人参与）**

```
/impeccable init
```

impeccable 会读代码和 README，**问你几个只有你能回答的问题**，然后写 `PRODUCT.md`（项目根）。

> ⚠️ `init` 只写**产品事实**（用户、用途、约束、平台、品牌承诺），**不写视觉决策**，也**不会问你要什么颜色什么字体**。
> 仓库里已有的强证据（本地优先、五分组典故、"不做多人协作"的克制、四套主题、真实使用数据）**不用重复讲**。
>
> **本轮要额外注入的一条**：在 `PRODUCT.md` 里明确写清「**双端一个视觉世界、两个视图层**」这条产品决策，以及 §2.4 三个决策点的结论。

**Step 2 — 记录现状设计系统**

```
/impeccable document
```

生成 `DESIGN.md`（项目根）：YAML frontmatter（机器可读 token）+ 8 个规范章节
（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts）。

> `document` 产出的是**「现在长什么样」**。你要手改成**「应该长什么样」**。

**Step 3 — 人工补齐结构决策**

| 决策项 | 现状 | 需要定下来的 |
|---|---|---|
| **端差异模型** | 无（移动端是桌面的补丁） | **共享什么 / 差异什么** 的明确清单（§2 的表） |
| 主题维度 | 明暗（`dark`/`system`）× 材质（`dawn`/`glass`）混在同一套 `--bg-panel` | 拆成「语义层 + 材质层」两组 token |
| 圆角 | 16 / 10，玻璃主题另设 22 / 14 | 全局 3 档：`8 / 12 / 18`（craft-floor 规定 12-16） |
| 间距 | 各文件各写各的 | 4 / 8 / 12 / 16 / 24 / 32 / 48 |
| 字号 | 散落 10-48px | 12 / 13 / 14 / 16 / 20 / 24 / 30 |
| 表面层级 | `--bg-panel` / `--surface-elevated` / `--surface-soft` 三档，含义不稳 | `surface-0/1/2/3` |
| 边框与阴影 | `--border` / `--border-strong` / `--shadow` / `--shadow-soft` | **升一级 = 换底色 XOR 加边框，不同时加阴影**（craft-floor："A 1px border under a wide soft shadow is the ghost card"） |
| 字体角色 | display 与 body 相同，均为系统字体 | 拆角色 + `tabular-nums` |

### 4.3 验收标准

- [x] `PRODUCT.md` 存在，事实全部有据可查
- [x] `PRODUCT.md` 含「双端一个世界、两个视图层」的产品决策
- [x] `DESIGN.md` 存在，frontmatter 的 token 引用全部可解析（18/18）
- [x] `DESIGN.md` 含**端差异清单**（共享表 / 分端表）
- [x] 间距 / 字号 / 圆角 / 表面层级 / 字体角色五张刻度表已定
- [x] `impeccable doctor` 不报漂移
- [x] **没有改动任何 `src/` 下的文件**
- [x] 状态色对比度基线已算清（发现 8 处不达标，修正值已写入 `DESIGN.md` §Colors）

---

## 5. 阶段 2 · 桌面端 CSS / token 分层收口

### 5.1 目标结构

把「时间序命名」换成「职责序命名」：

```
src/styles/
  tokens.css        纯变量：语义 token（× 4 主题）+ 材质层
  primitives.css    按钮 / 输入 / 标签 / 图标 / 滚动条 的基础态
  components.css    模块级组件（任务行、目标卡、账目行…）
  views.css         页面布局
  index.css         只负责 @import 顺序
```

**一次迁一个文件，每迁一个跑一次回归。**

### 5.2 具体任务

1. **拆 token 维度**
   - 语义层：`--surface-*` `--text-*` `--border-*` `--accent*`
   - 材质层：`--glass-blur` `--glass-tint` `--shell-opacity`（只有 `dawn`/`glass` 有值）
   - 现状是 `--bg-panel: rgba(255,255,255,.78)` 这种**语义和材质混在一格**

2. **硬编码色值回填（非 token 文件的 257 处 → 0）**
   - 优先：`g05-airy-light.css`（101）、`p01-overrides.css`（39）、`g06-growth.css`（37）
   - 确实需要独立颜色的（`--brand-gold` / `--moment-warm`）**提升为正式 token**

3. **消除 30 个 `!important`**
   - `g11-ledger.css` 6 个、`g09` 4 个、`g05` 4 个 是重灾区
   - 通常是「被 `p01` 覆盖 → 加 `!important` 赢回来」的循环，**必须按依赖顺序解**

4. **清理 25 个疑似未使用类名**
   - ⚠️ `level-1`~`level-4` / `item-action-` 是模板字符串动态拼接，**多半在用**

5. **移动端 CSS 暂不动**
   - `g14-mobile.css` 1,404 行且几乎不用 token（44 处引用）
   - 阶段 4 会整体重写，**现在动它是白费力气**

### 5.3 验收标准

- [ ] `src/styles/` 下只有职责命名的文件，`global-*` / `polish-*` 全部消失
- [ ] `index.css` 只剩 `@import`
- [ ] 非 token 文件硬编码色值 = 0
- [ ] `!important` = 0
- [ ] 四主题的 token 集**完全对齐**（dark 不能再少 14 个）
- [ ] `npx tsc -b` ✅ `npx vitest run` ✅ `npx vite build` ✅
- [ ] **四套主题逐一肉眼比对**（清昼 / 静夜 / 晨曦玻璃 / 璃幕），无回归
- [ ] 移动端断点（≤700px）无回归

### 5.4 回归验证命令

```bash
npx tsc -b && npx vitest run && npx vite build
```

> 正式提交前跑 `npm run release:check`（= release-check.mjs + test + build）。

---

## 6. 阶段 3 · 桌面端视图层重做

### 6.1 顺序（按真实使用频次，来源 `docs/PRODUCT_REVIEW.md`）

| 序 | 模块 | 组件 | 依据 |
|---|---|---|---|
| 1 | **今日** | `TodayAgenda.tsx` / `today/*` | 主干流程，任务执行 |
| 2 | **记一笔** | `LedgerView.tsx` | 高频入口，106 笔真实数据，30% 回填 |
| 3 | **待办箱 / 周清单** | `MainWorkspace.tsx` / `p07-weekly.css` | 主干流程 |
| 4 | **详情抽屉** | `DetailDrawer.tsx` | 全局高频交互 |
| 5 | **项目 / 提醒 / 备忘录** | `ProjectsView` / `RemindersView` / `MemosView` | 中频 |
| 6 | **成长 / 习惯 / 复盘** | `GrowthView` / `HabitsView` / `ReviewView` | ⚠️ **真实使用数据为 0**，说明从未被真正检验过，优先级最低 |
| 7 | **设置 / 标签 / 纪念日** | `SettingsView` / `TagsView` / `AnniversariesView` | 低频 |

### 6.2 每个模块的循环

```
# ① 拿问题清单
/impeccable critique src/components/LedgerView.tsx

# ② 技术体检（a11y / 响应式 / 性能）
/impeccable audit src/components/LedgerView.tsx

# ③ 落地（落地前读 craft-floor.md）
/impeccable polish src/components/LedgerView.tsx

# ④ 看渲染结果（vite preview，不是 Tauri）
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173
```

### 6.3 审美原则（改的时候必须遵守）

**A. 来自真实桌面工作台的实测中位数**（对有秋最直接适用）：

| 原则 | 具体做法 |
|---|---|
| 颜色给数据，不给装饰 | 彩色像素占比 ~3%；边框、导航项、标签不要用彩色 |
| KPI 是字号，不是图标瓦片 | 数字指标用大字号 + 文字标签，不要"彩色圆圈里一个图标" |
| 表面是平的 | 卡片不给阴影；分隔靠 1px 线或一档色差 |
| 没有 hero 大标题 | 页面标题中位数 24px |
| 图表几乎不加壳 | 单序列不配图例；网格线 3-7 条淡线或不要 |
| 导航后退 | 选中项是中性灰药丸或文字变色；彩色左条只出现一次 |
| 表格是规则和对齐 | 不用斑马纹、不用表头色带、数字右对齐 |
| 数据状态诚实 | 零值打印为 0，缺失值灰破折号，空区块保留边框 |

**B. `craft-floor.md` 的红线**（"精心打造"的判定标准）：

| 红线 | 有秋现状 |
|---|---|
| 卡片 / 列表 / 提示块上 **>1px 的单侧彩色边框** | ❌ 6 处命中（§1.6） |
| 标题上方的小标（kicker / eyebrow） | 待查 |
| "大数字 + 小标签 + 辅助统计 + 强调色"的 hero-metric 模板 | ❌ 成长页很可能命中 |
| 渐变文字 | 待查 |
| 玻璃与模糊当装饰（而非特定效果） | ⚠️ 晨曦玻璃 / 璃幕两套主题需要自证 |
| 硬偏移阴影 `box-shadow: 4px 4px 0` | 待查 |
| 用 emoji / Unicode 字形冒充图标系统 | 有 `AppIcon.tsx`（自绘），✅ |
| 1px 边框 + 大软阴影同时出现（幽灵卡） | ⚠️ token 层存在这个组合 |
| 圆角 12-16px（pills 只给小控件） | ❌ 现状 10 / 16 / 22 |
| 跟字减到 -0.04em 以下 | 待查 |
| **浏览器默认外观未接管**：选中文本、插入符、自定义滚动条、焦点环、下划线偏移、等宽数字 | ❌ 待查（`g12-scrollbars.css` 仅 11 行） |
| 用系统字体当 display voice | ❌ 现状 display = body = 系统字体 |

> 最后一条（"browser surfaces"）是 `craft-floor.md` 自己的评价：
> *"This is the cheapest signal that a page was built rather than assembled, and the one models skip most reliably."*
> **对「看起来像一个精心打造的应用」这个诉求，这是性价比最高的一处改动。**

### 6.4 检测器判读规则

> **检测器报的是线索，不是结论。** 每条都人工判定。

| 检测器命中 | 判定 |
|---|---|
| 卡片 / 面板的单侧粗彩色边框 | ✅ 真问题，去掉 |
| `blockquote` 的左侧色条 | ⚠️ **保留**——引用语义 |
| 时间轴 / 日历的刻度条 | ⚠️ **保留**——信息语义 |
| 品牌题铭的强调条 | ⚠️ **待议**——品牌语义 |

误报要显式豁免，写进 `DESIGN.md` 的 **Do's and Don'ts**：

```bash
.agents/skills/impeccable/scripts/impeccable.cmd ignores
# 或在 .impeccable/config.json 的 detector.ignoreRules 里加规则
```

### 6.5 验收标准（每个模块）

- [ ] `impeccable critique` 的**全部 Critical/High 项**已处理或显式豁免
- [ ] `impeccable audit` 无 a11y 错误（对比度 ≥ 4.5:1，触控目标 ≥ 44×44px）
- [ ] `craft-floor.md` 的红线逐条对照过
- [ ] 四主题下该模块都看过
- [ ] `npx tsc -b && npx vitest run` 通过
- [ ] 该模块改动单独提交

> **阶段 3 的实际执行口径**（2026-10-22 收口时定的，写在这里免得下次会话再踩）：
>
> - 第 1 条：`impeccable critique` 本机跑不通（自带浏览器起不来，报 connection closed）。
>   改为按 DESIGN.md + `craft-floor.md` 手工逐条对照 —— 这一条**不算自动闭环**。
> - 第 2 条：改由 `scripts/ui-a11y.mjs` 承担，且**结论以真实像素为准**：
>   渐变底不再是「待目检」，而是解析色标 + 截图差分逐像素量。
>   触控目标底线按 WCAG 2.5.8 (AA) 取 24px（见 §附录 B 的 `[!]` 备注）。

---

## 7. 阶段 4 · 移动端视图层重建

> **这是本次需求的主战场。** 桌面端是"精修"，移动端是"重建"。

### 7.1 第 1 步 · 手感层修复（1 天，零视觉风险）

照 `mobile-native` 清单逐条修，**这一步不改视觉，只改平台行为**：

| # | 修什么 | 判定 |
|---|---|---|
| 1 | **91 条 `:hover` 用 `@media (hover: hover)` 包裹**（触摸设备 hover 会粘住） | ❌ 必改 |
| 2 | **输入控件字号提到 ≥16px**（否则 iOS 聚焦时整页缩放） | ❌ 必改 |
| 3 | `height:100vh` → `100dvh`（2 处在 mobile css） | ⚠️ |
| 4 | 补 `touch-action`、`-webkit-tap-highlight-color` | ⚠️ |
| 5 | 复核 `user-scalable=no` 是否要放开 | ⚠️ |
| 6 | IME inset（键盘弹起时不遮挡输入框） | ⚠️ |

**验收**：真机上（`adb`）逐条对照清单确认。

### 7.2 第 2 步 · 信息架构重建

**桌面端有多少个视图，移动端不该就有多少个视图。** 按移动场景重新组织：

| 移动端入口 | 内容 | 取代桌面的 |
|---|---|---|
| **今日**（底部导航 1） | 当日事项卡片流 + 目标进度条 | 今日多栏工作台 |
| **待办箱**（底部导航 2） | 收集箱 + 快速整理 | 待办箱工作区 |
| **记一笔**（底部导航 3） | 金额输入 + 分类 + 账户（**页面内快速录入**） | 账本表格 + 弹窗 |
| **更多**（底部导航 4） | 目标 / 习惯 / 复盘 / 备忘 / 项目 / 标签 / 纪念日 / 设置 | 侧栏分组 |

设计要点：
- **顶部应用栏**（Top app bar）提供屏幕上下文与返回
- **主操作 FAB**：今日页的"新建任务"、账本页的"记一笔"
- 桌面端的三栏 → 移动端的**单列卡片流 + 底部动作面板**（复用 `TaskActionSheet` 的概念但重做）
- 桌面端 `DetailDrawer` → 移动端**全屏详情页**（不是抽屉）

### 7.3 第 3 步 · Material 3 结构落地

按 §2.2 决策点 2 的清单逐项落地：导航模式、48dp 触摸目标、预测性返回、edge-to-edge、
color roles 映射四套主题、深色主题一等公民。

### 7.4 第 4 步 · 共享叶子组件

移动端视图复用 §5.1 建立的 `primitives.css` 叶子组件（按钮 / 标签 / 图标 / 空态 / 列表行），
保证主题一致；**只重写页面级组件**。

### 7.5 移动端的验证方式（重要）

> **移动端截图必须来自模拟器或真机，不能用浏览器。**
> `impeccable/reference/android.md` 原文：
> *"Screenshots come from the emulator or a connected device, never a browser."*

```bash
adb exec-out screencap -p > shot.png          # 截屏
adb shell cmd uimode night yes                 # 切深色
adb shell settings put system font_scale 1.3   # 放大字号（会暴露固定布局的截断）
adb shell settings put system font_scale 1.0   # 还原
```

> `font_scale 1.3` 这一步特别重要——**固定 px 布局在放大字号时的截断**，浏览器预览发现不了。
> 有秋现在是 `sp` 等价的固定 px 体系（`craft-floor.md` 明确点名 "sp units, never fixed px"），
> 阶段 4 需要把字号改成跟随系统缩放。

### 7.6 验收标准

> **2026-10-22 进度**：「今日」页已重建为独立视图层并落地生产代码
> （`4465c0f`）。下方勾选只反映**已验证**的状态，未做的如实留着。

- [ ] `mobile-native` 清单 11 条**逐条在真机确认**
- [~] 移动端**有独立的信息架构**（不是桌面的竖屏版）—— 今日页已完成；
      待办箱 / 记一笔 / 更多三页仍复用桌面视图层
- [x] `src/components/mobile/views/` 存在，页面级组件与桌面分离
- [~] 叶子组件跨端共用，主题一致 —— 今日页用语义 token 着色，尚未整体收口
- [~] Material 3 硬性项全部落地（48dp / FAB / top app bar / predictive back / edge-to-edge）
      —— 今日页已落 48dp 命中区 / FAB / 顶栏；predictive back 与 edge-to-edge 未做
- [ ] 四主题在真机上各截一轮 —— 浏览器评审库已验清昼 / 静夜两套，真机未验
- [ ] 深色 + `font_scale 1.3` 下无截断、无重叠 —— 字号已改 rem 跟随系统缩放，真机未验
- [x] 主题切换在移动端生效 —— 浏览器评审库已验清昼 / 静夜
- [x] `npx tsc -b && npx vitest run` 通过（32 文件 / 224 用例）

---

## 8. 阶段 5 · 动效与手感

### 8.1 判定框架（先问「一天看几次」）

| 频次 | 决策 | 有秋对应 |
|---|---|---|
| 100+ 次/天 | **永远不要动画** | 命令面板（`CommandPalette.tsx`）、侧栏切换、键盘快捷键 |
| 几十次/天 | 去掉或大幅压缩 | 任务行 hover、列表项选中 |
| 偶尔 | 标准动画 | 抽屉 `DetailDrawer`、弹窗、toast |
| 稀有 | 可以加 delight | 目标达成、习惯打卡、年度热点图 |

> **铁律：永远不要给键盘触发的动作加动画。**

### 8.2 具体规则

- 缓动：进入 `ease-out`，退出 `ease-in`（不要反）
- **禁止 `transition: all`**，写具体属性
- 按钮 `:active`：`transform: scale(0.97)`
- 弹层从触发源缩放，`transform-origin` 用变量
- 从 0.95 + opacity 0 开始，不要从 `scale(0)` 凭空出现
- 时长：高频 80-120ms，偶尔 160-200ms，稀有庆祝 400-600ms
- 必须有 `prefers-reduced-motion` 降级
- 移动端动效比桌面端**更克制**（Material 动效规范优先）

### 8.3 验收标准

- [ ] 命令面板开合零动画或 ≤100ms 且无位移（待验：需真机/预览实测）
- [x] 所有 `transition` 无 `all`（2026-10-24 实测 0 处）
- [x] 全局有 `prefers-reduced-motion` 降级（`tokens.css` 的 `--motion-scale` 机制）
- [ ] 动效只出现在「偶尔」和「稀有」档
- [ ] 桌面 + 移动都验过

---

## 9. 已知坑

| 坑 | 说明 | 处置 |
|---|---|---|
| **钩子会刷屏** | 每次 `Edit`/`Write` UI 文件后自动跑检测器，`Stop` 时再跑一次 30s 深度检查 | 嫌吵就 `impeccable hooks off`，改完再开 |
| **钩子需重启才生效** | `.codex/hooks.json` 是会话启动时读的；本项目创建于会话中途，**首次开新会话才会自动跑检测器** | 阶段 2 开工前开一次新会话即可 |
| **检测器只做正则** | 扫源码跑不出对比度/文字过小 | 桌面用 `vite preview`；**移动端必须真机** |
| **检测器会误报** | 引用条、刻度条、品牌强调条被算成 AI 味 | §6.4 判读表 + 写进 `DESIGN.md` |
| **`[side-tab]` 不是类名** | 是检测器的分类名，搜不到 | 别去搜 |
| **Tauri 连不上 CDP** | WebView2 不是标准 Chrome 调试目标 | 用 `vite preview` 代替，视觉层等价 |
| **`.agents/` 不入库** | 21MB（含 18.9MB 二进制），新克隆需重装 | `npx impeccable install --scope=project --providers=codex -y` |
| **skill 加载范围** | 项目级 skill 只在**本项目目录**下的会话加载；换目录开会话则失效 | 会话前确认 cwd 在 `D:\AAA_CSU\2503\Yield` |
| **四主题不是独立设计** | `dark` 只有 24 个 token，`root` 有 38 | 阶段 2 对齐 |
| **`p01-overrides.css` 是覆盖层** | 39 处硬编码盖住 token 改动 | 阶段 2 迁完后才敢动 token |
| **改桌面会炸移动** | `g14-mobile.css` 1,404 行覆盖桌面选择器 | 阶段 2 之前别动桌面选择器；阶段 4 整体重写 |
| **`.agents/` 沙箱内只读** | 往里写文件需提权 | 装 skill 时用提权 |

---

## 10. 提交约定

按 `docs/GIT_CONVENTIONS.md`：

```
docs: 新增 UI 视觉优化路线图
refactor(ui): 收口 CSS 分层，迁移 global-01 至 primitives
refactor(ui): 对齐四主题语义 token 集
feat(ui): 账本页密度与层级重做
feat(mobile): 移动端信息架构重建，新增 mobile/views
fix(mobile): 修复触摸端 hover 粘住与输入框聚焦缩放
```

- 每个阶段单独提交；阶段 2 建议**每个文件一次提交**，便于回退
- 提交前跑 `npm run release:check`

---

## 附录 A · 常用命令速查

```bash
# 上下文
.agents/skills/impeccable/scripts/impeccable.cmd context
.agents/skills/impeccable/scripts/impeccable.cmd doctor

# 检测（桌面）
.agents/skills/impeccable/scripts/impeccable.cmd detect src
.agents/skills/impeccable/scripts/impeccable.cmd detect http://localhost:4173

# 钩子与遥测
.agents/skills/impeccable/scripts/impeccable.cmd hooks status
.agents/skills/impeccable/scripts/impeccable.cmd hooks off
.agents/skills/impeccable/scripts/impeccable.cmd telemetry status

# 检测器豁免
.agents/skills/impeccable/scripts/impeccable.cmd ignores

# 移动端真机
adb exec-out screencap -p > shot.png
adb shell cmd uimode night yes
adb shell settings put system font_scale 1.3

# 项目
npx tsc -b && npx vitest run && npx vite build
npm run release:check
```

## 附录 B · 进度检查表

```markdown
## UI 优化进度

- [x] 阶段 1 视觉契约 ✅
  - [x] `PRODUCT.md` 已写入（含"一个世界、两个视图层"）
  - [x] `DESIGN.md` 已写入
  - [x] 端差异清单（共享 / 分端）已定
  - [x] 间距 / 字号 / 圆角 / 表面层级 / 字体角色五张表已定
  - [x] 三个决策点（§2.4）已拍板
  - [x] `docs/MOBILE-IA.md` 已写入
- [x] 阶段 2 桌面 CSS 分层 ✅（2026-10-21）
  - [!] 非 token 文件硬编码色值 = 0（531 处 → 0，迁成 296 枚色阶 token）
        ⚠ 已回归：阶段 4 的 `mobile.css` 现含 85 处硬编码色值，收尾前清零（`ui-css-audit` 红）
  - [!] `!important` = 0（30 处 → 0，减弱动效改用 `--motion-scale` 变量）
        ⚠ 已回归：`mobile.css` 现存 2 处生效（:2401 / :3650 压 TSX 内联样式），收尾清零
  - [x] 文件改为职责命名（`tokens` / `primitives` / `components` / `views` / `mobile` / `index`）
  - [!] 四主题 token 集完全对齐（每套 40 枚，含 `system`）
        ⚠ 现况：`:root`/`dawn` 38 枚、`dark`/`glass`/`system` 各 34（缺 `--prio-1..4`，补声明或改 audit 口径为「含继承」）
  - [x] 5 个失效的 token 引用已修（整条声明此前被丢弃）
  - [x] 状态色契约取值已落地（8 处对比度不达标已修）
  - [x] `index.css` 只剩 `@import`
  - [x] 回归：`tsc` / `vitest`(224，当时口径) / `vite build` 全绿；四主题 + 移动壳
        32 视图的计算样式逐项比对差异 0，截图逐像素一致
- [x] 阶段 3 桌面视图层（✅ 2026-10-22 收口，评审基线 1440×900）
  - [x] 今日
  - [x] 记一笔
  - [x] 待办箱 / 周清单
  - [x] 详情抽屉
  - [x] 项目 / 提醒 / 备忘录
  - [x] 成长 / 习惯 / 复盘
  - [x] 设置 / 标签 / 纪念日
  - [x] 跨模块：删掉 10 个视图的标题小标（craft-floor 禁项）
  - [x] 跨模块：接管浏览器默认外观（选中文本/插入符/占位符/焦点环/等宽数字）
  - [x] 跨模块：实底对比度不达标从 118 种降到 17 种（余 10 类为既有误报）
  - [x] 跨模块：内容卡去阴影，桌面端表面改平（幽灵卡，DESIGN.md §Shapes）
  - [x] 跨模块：引导块从 126px 压成一行 56px，1440×900 下「今日事项」进首屏
  - [x] 跨模块：侧栏默认宽改 232px（对齐契约），窗口 < 1330px 自动收成 64px 图标条
  - [x] 跨模块：侧边彩条真问题 2 处修掉（周历事件条 → 优先级伪元素条；纪念日 4px → 1px）
  - [x] 跨模块：删除类动作统一降权（列表里的红按钮只在悬停时变红）
  - [x] 触控目标：桌面端底线改为 24px（WCAG 2.5.8 AA），当前 0 处 < 24px
  - [x] 字号 / 圆角刻度全面采纳（detector advisory 302 → 5，余 5 条为 DESIGN.md 已豁免的侧边彩条）
  - [x] 评审基线从 1600×1000 改到 1440×900（= 桌面端默认窗口）
  - [x] 缺口 1 · 渐变底对比度逐条目检 —— **已收口，且从「需目检」变成「可执行的数字」**
        （原状：1394 处渐变底文字被判「待目检」，脚本判不了）
        1. 重写 `scripts/ui-a11y.mjs` 的底色解析：自底向上逐层合成背景，
           把每个 background-image 的**色标**展开成候选色集，对文字取最差端点。
           渐变不再需要人看。
        2. 再加一层**像素复核**：对计算样式判失败的项，在同一会话里做两张截图差分
           （A 有字 / B 无字），只量「文字真正压住的那几个像素」的底色 —— 得到真实对比度。
           计算样式判失败但像素通过的，是推断过头。
        3. 全量跑：180 个视图组合（4 视口 × 4 主题 × 14 视图），
           **渐变底文字 17 253 处全部逐条量到，真实不达标 0 处，未采到 0 处**。
        4. 途中修掉 176 条真实不达标，归为 5 个根因：
           - 强调色作文字（清昼/晨曦的 `--accent` 压浅底）→ 统一改 `--accent-strong`
           - 次级/弱化文字压带色面（暖引导块 / 暖事件 chip / 计数 chip）→ 提到 `--text-label`
           - 状态色作文字的基准面算错（写的是白底，实际是应用底）→ `--danger` 加深一档
           - 璃幕主题漏了静夜同款的「已完成」版式（浅色金卡 + 浅色字 = 隐形，实测 1.04:1）
           - 金圆上的白勾 2.19:1 → 改墨色勾
  - [x] 缺口 2 · 提醒页「运行中 0 / 已结束 0」零值状态条 —— 数为 0 的统计格整格不渲染
        （与周清单引导块「要么有数据，要么不出现」同一原则），状态条改 flex，
        缺席的格自动收拢，主文案不再被挤断
  - [x] 缺口 3 · 复盘页「任务完成去向」进度条 + 1/1 + 100% 三处重复 ——
        删掉百分比列，只留「进度条 + done/total」，与周清单同构
  - [ ] 缺口 4 · impeccable CLI 的 critique/audit 未真正跑通（本机自带浏览器起不来，
        报 connection closed）。§6.5 的验收结论成立（按 DESIGN.md + craft-floor 逐条过的），
        但走的不是该工具。**改判法**：a11y 一项已由 `scripts/ui-a11y.mjs` 以
        「计算样式 + 真实像素」双层判定替代，结论可复现；craft-floor 的红线
        仍是人工逐条对照，这一项不算自动闭环。
  - [!] 备注 · 触控目标底线由 44px 改为 24px（WCAG 2.5.8 AA），理由写在
        DESIGN.md §Do's。此项是设计判断，尚未经用户确认。
- [ ] 阶段 4 移动端重建（进行中，2026-10-24 刷新）
  - [x] 信息架构重建：底部导航 4 项 + 「更多」按典故分组 + 二级页入口
  - [x] Material 3 结构落地：三页独立移动视图（今日/待办/记账）+ 页头/FAB + 底部弹层家族 + 长按动作面板
  - [x] 共享叶子组件：`.mrow` 行件、`item-action-btn` 动作族、MobileTaskRow/Line/Pills、TaskActionSheet、LedgerEntrySheet
  - [x] 弹层语言统一 + 边缘手势（右缘右滑关闭）+ 系统返回键语义接管
  - [x] 移动字号 rem 化、edge-to-edge / IME inset（SDK≥35）
  - [!] 手感层（mobile-native 11 条）：代码侧基本完成，**真机确认**未做
  - [ ] 四主题真机截图 + font_scale 1.3 验证
  - [ ] 48dp 触摸目标全量核对
  - [ ] Android 13+ 预测性返回（现走 onBackPressed 兼容路径）
  - [ ] `mobile.css` 硬编码色值 85 处 + `!important` 2 处清零；hover 隔离在共享层补齐
  - [ ] viewport `user-scalable=no` 放开评估
- [ ] 阶段 5 动效手感
```

> 每完成一项就在本文档里打勾。**本文档就是跨会话的进度载体。**

### 阶段 2 的验收手段（后续阶段照此复用）

| 工具 | 作用 | 用法 |
|---|---|---|
| `scripts/ui-css-audit.mjs` | 硬编码色值 / `!important` / 失效引用 / 四主题 token 集对齐 | `node scripts/ui-css-audit.mjs` |
| `scripts/ui-a11y.mjs` | 渲染态对比度（**渐变底逐像素**）/ 触控目标 / 焦点环 | `node scripts/ui-a11y.mjs docs/ui-baseline/a11y.json` |
| `scripts/ui-snapshot.mjs` | 四主题 × 六视图 + 移动壳截图（时钟固定，可重复） | `node scripts/ui-snapshot.mjs <outDir>` |
| `scripts/ui-style-dump.mjs` | 导出 32 个视图里每个可见元素的 50 项计算样式 | `node scripts/ui-style-dump.mjs <out.json>` |
| `scripts/ui-style-diff.mjs` | 逐元素逐属性比对两份计算样式快照 | `node scripts/ui-style-diff.mjs <a.json> <b.json>` |
| `scripts/ui-visual-diff.py` | 两组截图的像素级差异 + 热区图 | `python scripts/ui-visual-diff.py <before> <after>` |

> 计算样式比对比像素比对更严：它能抓到「只影响交互过程」的变化（例如动效时长
> 被改错 1000 倍，截图看不出来）。阶段 2 里有两条真 bug 就是它抓出来的。

**基线截图不入库**（`docs/ui-baseline/` 已 gitignore），随时可重建。

## 附录 C · 参考位置

| 想要什么 | 去哪读 |
|---|---|
| 质量底线、红线清单 | `.agents/skills/impeccable/reference/craft-floor.md` |
| Android 规范（Material 3） | `.agents/skills/impeccable/reference/android.md` |
| 响应式 / 原生适配 | `.agents/skills/impeccable/reference/adapt.md` / `adapt.native.md` |
| 移动端手感清单 | `.agents/skills/mobile-native/SKILL.md` |
| 动效曲线与时长 | `.agents/skills/animate/SKILL.md` |
| 细节哲学 | `.agents/skills/emil-design-eng/SKILL.md` |
| 桌面工作台实测中位数 | `taste-skill/references/app-screens.md`（**只覆盖桌面宽屏，无手机屏**） |
| 产品事实与决策 | `PRODUCT.md`（项目根） |
| 视觉契约与迁移映射 | `DESIGN.md`（项目根） |
| 移动端信息架构 | `docs/MOBILE-IA.md` |
