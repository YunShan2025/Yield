# 有秋（Yield）Git 推送与发布惯例

本文约定本仓库的分支、提交、推送、版本号、标签与发布流程。除第 8 节「本仓库补充约定」外，均为业界通用默认惯例（GitHub Flow + SemVer + Conventional Commits），日常开发与发版时对照执行。开发验证与变更记录约定见 `docs/CHANGES.md`，架构与模块地图见 `docs/ARCHITECTURE.md`。

## 1. 分支模型

| 分支 | 用途 | 约束 |
|---|---|---|
| main | 唯一长期分支，任何时刻可构建、可发布 | 禁止强推，禁止改写已推送历史 |

- 单人维护，日常改动直接提交 main，不强制开分支。
- 较大功能或试验性改动开短生命周期分支（`feat/xxx`、`fix/xxx`），完成并验证后合并回 main，随即删除；合并方式不限（个人项目 fast-forward 即可），以历史清晰为准。
- 长周期 feature 分支（如 Android 版开发）应**定期合并 main**，把桌面端修复持续带进开发线；合并间隔越长冲突越大，建议每个开发小阶段收尾时合并一次。
- 不设 develop / release 等常驻分支；将来多人协作时再启用 Pull Request + 分支保护。

## 2. 提交信息

采用 **Conventional Commits** 格式：

```
<type>(<scope>)?: <一句话描述>

[可选正文：动机与影响]
```

| type | 含义 |
|---|---|
| feat | 新功能 |
| fix | 缺陷修复 |
| docs | 文档 |
| style | 格式调整（不影响代码语义） |
| refactor | 重构（既非新增也非修复） |
| perf | 性能优化 |
| test | 测试 |
| build | 构建系统 / 依赖变更 |
| ci | 持续集成配置 |
| chore | 杂项（版本发布用 `chore(release)`） |

**scope 词汇（双端开发时代）**：按受影响端或领域取用——`desktop`（桌面端）、`android`（移动端）、`sync`（数据同步）；双端共用改动不写 scope，或写领域名（如 `db`、`schema`、`ui`）。

1. **原子提交**：一次提交只做一件事，方便回退和定位。
2. 描述用一行、现在时、不加句号；详细动机写在正文（空一行后）。
3. 破坏性变更用 `!` 标记（如 `feat!:`）或在正文写 `BREAKING CHANGE: 说明`。
4. 描述写「为什么」，改动内容代码自解释的不重复。
5. type 保持英文，描述可用中文（本仓库惯例）。

示例：

```
fix: 修复交互式安装产生重复桌面快捷方式的问题
feat(installer): 统一快捷方式命名为「有秋」
chore(release): v1.0.1
```

## 3. 提交与推送节奏

- **提交**：逻辑完整、本地验证通过即可提交，粒度宜小；未推送的提交可自由整理（amend / rebase / squash）。
- **推送 = 公开**：推送到远端后历史即视为不可变，之后只能追加（revert），不能改写。
- 行业默认节奏是「小步快推」：一个独立改动完成即推；单人仓库至少在每个工作阶段结束时推送，兼作异地备份。
- 推送前自查：
  1. 发布前必须 `npm run release:check`（release-check + 测试 + 前端构建）通过；日常提交至少 `npm test`；
  2. 不含密钥、令牌、内网地址等敏感信息；
  3. 不含构建产物与本地工作文档（`dist/`、`src-tauri/target/`、`node_modules/` 已由 .gitignore 覆盖，不要 `git add -f` 绕过）。

## 4. 版本号（SemVer）

`v主版本.次版本.修订号`。**改了源码不等于要改版本号**——版本号只在「发布」那一刻更新，多次提交可同属一个版本。

| 变更类型 | 升哪位 | 示例 |
|---|---|---|
| 缺陷修复，不新增功能 | PATCH | v1.0.0 → v1.0.1 |
| 向后兼容的新功能 | MINOR | v1.0.x → v1.1.0 |
| 不兼容的破坏性变更 | MAJOR | v1.x → v2.0.0 |

- 判断不准时：用户可感知的改进按 MINOR，纯修正错误行为按 PATCH。
- 0.x 开发阶段例外：MINOR 中允许包含破坏性变更（v0.2.0 → v0.3.0）。

## 5. 标签（tag）

- 每个发布版本对应一个**附注标签**，打在发布提交上：

```
git tag -a v1.0.1 -m "v1.0.1"
git push origin v1.0.1
```

- **已推送的标签永不移动、永不删除**：Release 链接与安装包指向标签，移动标签等于让同一个版本号对应两份不同产物。发错按第 6 节发新版本修正。
- 本地已打、尚未推送的标签可随意删改（`git tag -d v1.0.1`）。

## 6. 纠错与回退

| 场景 | 处理方式 |
|---|---|
| 提交了但未推送 | reset / rebase / squash 随意整理 |
| 已推送的提交有问题 | `git revert <sha>` 生成反向提交，不改写历史 |
| 已发布版本发现 bug | 修复后发 PATCH 新版本（v1.0.1 → v1.0.2），旧 tag 与旧 Release 原样保留，可在 Release 说明中标注已知问题 |
| tag 打错且未推送 | 删除重打 |
| tag 打错且已推送 | 不移动，发新版本 |
| 误推敏感信息 | 先作废泄露的密钥/令牌（旋转密钥优先于清洗历史），再评估是否需要改写历史 |

## 7. 发布流程（桌面 + Android 双端）

**双端判定（默认规则）**：先判断本次改动落在哪一端。

- **只改了一端**（桌面或 Android 仅其一受影响）：**不升版本号**。重新构建该端产物，直接替换现有 Release 里的对应文件（`gh release upload vX.Y.Z "…/产物" --clobber`），产物文件名沿用当前版本号；标签与版本号不变，Release 正文可追加一行更新说明。
- **两端都改变了**：才走下面的完整流程发布新版本号。
- 拿不准哪端受影响时按两端处理（升版本号），宁可多一个版本号也不要静默替换。

1. **同步版本号三处**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（`Cargo.lock` 用 `cargo update -p youqiu` 同步更新）。漏一处会导致前端、安装器与 Rust 元数据版本不一致。
2. **版本记录**：在 `docs/CHANGES.md`「版本记录」区顶部按 `#### v{版本号} 标题` 追加条目（发布 Release 时按该标题撰写说明）。
3. **验证**：`npm run release:check` 通过。
4. **提交**：`chore(release): vX.Y.Z`。
5. **构建双端**：
   - 桌面：`npm run tauri build` → `src-tauri/target/release/bundle/nsis/Yield_X.Y.Z_x64-setup.exe`
   - Android：`npm run tauri android build -- --target aarch64` → `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`，复制重命名为 **`Yield_X.Y.Z.apk`**（自 v1.0.6 起不带架构后缀，每版仅一个 arm64 包）
6. **推送**：`git push origin main`，再推标签 `git push origin vX.Y.Z`。
7. **创建 Release** 并附两个产物：

```
gh release create vX.Y.Z "…/Yield_X.Y.Z.apk" "…/Yield_X.Y.Z_x64-setup.exe" \
  --title "有秋 vX.Y.Z · 一句话主题" --notes-file notes.md
```

Release 说明面向使用者：一段摘要 + 修复/新增列表 + 双端安装说明，不写实现细节；需含「桌面安装包未做代码签名，杀毒软件可能误报拦截」的提示。

> Android 签名为自签 keystore（`keys/youqiu-release.jks`，凭据文件 `keystore.properties`，两者均不入库）；versionName/versionCode 由 Tauri 自动取自 `tauri.conf.json` 的 version，不另设版本线。

## 8. 本仓库补充约定（相对行业默认的增量）

- **推送与发布由维护者明确发起**：日常会话中的改动默认只做本地提交，未经明确要求不推送、不发 Release。
- `docs/CHANGES.md` 条目仅在明确要求时写入。
- 版本号三处同步（第 7 节第 1 步）是本仓库历史易漏点，发布前逐项核对。
