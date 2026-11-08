---
id: 065-launcher-updater
title: Launcher、签名更新与回滚
milestone: M5
status: draft
depends_on: [050-deploy, 064-scheduler]
owners: [human]
created: 2026-11-08
updated: 2026-11-08
---

# Launcher、签名更新与回滚（M5-3）

> **方向变更（2026-11-08，待重写）**：用户要求改为 **npm 全局安装 + TUI 仅提示新版本，不自动更新**；本文件的签名发布包、Launcher / current 指针、UpdateLock、自动回滚方案不再作为实现依据。
> 状态：`draft`。M5-3 / M5-4 的新边界待人类确认后重写；确认前不得实现。
> 源设计：[larness.md](../../larness.md) §22；[060 M5](../060-extension/spec.md) M5-3；ADR-007 / ADR-012 / ADR-023。

## 1. 背景与问题

当前 Larness 以 `node app.js` 启动当前工作区代码：没有版本目录、下载与签名校验、Launcher 指针、更新锁、健康检查或回滚。程序升级只能人工替换源码，失败后没有可信的旧版本可回退；数据库迁移后也无法判断旧代码是否仍兼容。

M5-3 补齐受签名保护的、人工确认的更新链路：检查新版本、下载并验证发布包、停止管理面并等待安全点、原子切换版本、健康检查失败回滚、崩溃或断电后不留下半更新状态；正式 PM2 服务与更新互不影响。

## 2. 目标

- **G-1 可验证发布**：发布清单与安装包必须通过预置公钥的 Ed25519 签名和 SHA-256 校验；任一失败不进入可安装状态。
- **G-2 稳定入口**：独立的 Launcher 读取 `current` 指针并启动版本目录中的程序；版本目录不可变，切换是原子的。
- **G-3 安全切换**：更新锁、单实例锁、维护模式与安全点协作；有活跃 Turn / JobRun / 部署时等待，不强制中断。
- **G-4 可恢复**：新版本健康检查失败时切回旧版本；数据库迁移后失败时按备份恢复或明确进入人工恢复，不假装回滚成功。
- **G-5 可解释**：TUI 显示检查 / 下载 / 校验 / 等待 / 切换 / 健康 / 回滚的当前状态与失败原因；状态文件跨重启保留。
- **G-6 人工安装**：仅本机 TUI 可确认安装；自动检查可以后台进行，但不自动安装。

## 3. 非目标

- **NG-1 自动安装**：不静默安装、不强制重启、不自动重试坏版本。
- **NG-2 跨平台安装器**：Windows / Linux 的目录、文件锁、服务与升级行为归 M5-4；macOS 先验证。
- **NG-3 代码签名 / 公证**：不替代 Apple Developer ID / notarization；仅验证 Larness 发布包签名。
- **NG-4 增量 / 热更新**：只支持完整发布包；不支持差分、热替换、运行中替换 JS。
- **NG-5 更新服务器实现**：只消费 HTTPS 清单与包；不实现托管、CDN、账号或计费。
- **NG-6 Web 安装**：本切片不提供 Web 端安装按钮；Web 只可读取版本状态（如后续需要另开任务）。
- **NG-7 更新 Agent / 项目依赖**：不更新项目 `node_modules`、PM2 服务或用户代码。

## 4. 用户故事

- 作为操作者，我希望 TUI 告诉我是否有新版本，并由我确认后安装，以便升级可控。
- 作为操作者，我希望坏包、错签名或下载中断都不会替换当前版本。
- 作为操作者，我希望 Agent 正在运行时更新先等待，而不是把我的任务杀掉。
- 作为操作者，我希望新版本启动失败时自动回到旧版本，并看到失败原因。
- 作为操作者，我希望正式 PM2 服务在更新期间保持运行。

## 5. 验收场景

### A1 检查与展示

```gherkin
Given 已配置 HTTPS 清单地址且当前版本为 0.1.0
When TUI 执行检查更新
Then 下载 manifest.json 与 manifest.json.sig，验证 channel / semver / 签名
And 新版本 0.2.0 显示为“可安装”，包含版本、发布时间、包大小
And 不自动下载或安装
```

### A2 签名 / 哈希失败

```gherkin
Given manifest 签名不匹配，或安装包 SHA-256 / 大小与清单不一致
When 用户尝试安装
Then 安装被拒绝，当前版本不变，临时文件清理
And 状态记录稳定错误码，不显示原始签名或下载内容
```

### A3 活跃任务安全点

```gherkin
Given 有 RUNNING 的 Turn、queued/running JobRun 或进行中的部署
When 用户确认安装
Then Server 进入维护模式并报告活跃项，更新等待安全点
And 不取消任务、不强行停止；用户可取消更新
And 活跃项全部结束后才允许停止 Server
```

### A4 成功切换

```gherkin
Given 新版本已下载并验证，安全点已满足
When 更新执行停止 Server、备份数据库、切换 current 指针并启动新版本
Then `/api/health` 返回新版本且 30 秒内就绪
And 旧版本目录保留，current.json 指向新版本，更新锁释放
And 正式 PM2 服务 PID 不变
```

### A5 健康失败回滚

```gherkin
Given 新版本启动后健康检查超时或返回错误版本
When 回滚执行
Then current 指针切回旧版本，旧版本重新启动并通过健康检查
And 更新记录为 failed，失败原因可见
And 新版本目录保留供诊断，不删除数据库
```

### A6 数据库迁移后失败

```gherkin
Given 新版本已执行数据库迁移，schemaVersion 从 22 变为 23
When 新版本健康检查失败
Then 按更新前备份恢复数据库，再启动旧版本
And 恢复失败时停止自动重试，标记“需要人工恢复”，并给出备份路径与恢复指引
```

### A7 并发与中断

```gherkin
Given 另一个更新进程持有 update.lock，或 Launcher 正在切换
When 第二个更新请求到达
Then 返回 UPDATE_LOCKED，不下载、不切换
And 进程崩溃 / 断电后，下次启动依据状态文件与锁的 pid / 时间判定可恢复或人工处理
```

### A8 版本与降级保护

```gherkin
Given 当前版本 schemaVersion=22，清单声明 minSchemaVersion=23
When 检查 / 安装
Then 拒绝该版本并说明需要先升级到中间版本
And 清单版本低于当前版本、通道不匹配或 minAppVersion 不满足时拒绝
```

### A9 Launcher 指针损坏

```gherkin
Given current.json 缺失、路径越界或 entry 不存在
When 启动 Launcher
Then 使用 previousVersion / last-known-good 启动并记录错误；没有可用版本时失败关闭
And 不猜测任意目录、不执行更新目录以外的代码
```

### A10 权限与磁盘

```gherkin
Given 安装根不可写、磁盘空间不足，或下载超过声明大小
When 下载 / 解压 / 切换
Then 在产生副作用前拒绝，清理 staging，当前版本不变
And 错误信息包含可操作原因，不含秘密或任意路径注入
```

### A11 状态与审计

```gherkin
Given 一次更新从检查到完成或失败
When 操作者查看 TUI / 状态文件 / 审计
Then 能看到阶段、时间、from/to 版本、结果和稳定错误码
And 审计不含私钥、签名原文、包内文件内容或完整下载 URL 查询串
```

### A12 人工安装边界

```gherkin
Given 浏览器已认证，或后台自动检查发现新版本
When 没有 TUI 确认
Then 不得安装；Web 最多显示版本状态，不能触发停止 / 切换
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 发布清单 `manifest.json` 与 detached `manifest.json.sig` 通过 HTTPS 获取；禁止 HTTP、凭据 URL、任意重定向。 |
| R-2 | MUST | 签名使用 Ed25519，读取原始 manifest 字节验证；public key 内置于 Launcher / Updater，支持 `keyId` 与最多 2 个有效公钥。 |
| R-3 | MUST | SHA-256 仅用于完整性，不替代签名；包大小必须匹配，超限拒绝。 |
| R-4 | MUST | 清单包含 `schemaVersion / channel / version / releasedAt / minAppVersion / minSchemaVersion / maxSchemaVersion / archive{url,sha256,size} / entry / keyId`；严格 Zod 校验。 |
| R-5 | MUST | semver 比较；降级、跨 channel、低于 `minAppVersion` 或 schema 不兼容时拒绝。 |
| R-6 | MUST | 安装根与数据目录分离；版本目录 `versions/<version>/` 不可变，`current.json` 指针原子更新（临时文件 + fsync + rename）。 |
| R-7 | MUST | Launcher 是稳定入口；只解析 `current.json` 指向的 `versions/` 内路径，缺失时回退 `previousVersion` 或失败关闭。 |
| R-8 | MUST | `update.lock` 单写者；含 pid / host / startedAt / phase / 随机 owner；同进程重入拒绝，陈旧锁需确认 pid 不存活且超时。 |
| R-9 | MUST | 安装前检查安装根可写、磁盘空间 ≥ 包大小 × 3、entry 存在。 |
| R-10 | MUST | 下载到 `staging/`，支持超时 / 大小上限 / 取消；失败或取消清理 staging 文件。 |
| R-11 | MUST | 解压拒绝绝对路径、`..`、符号链接 / 硬链接、设备文件、重复 entry、超出解压上限；失败不产生版本目录。 |
| R-12 | MUST | 安装前 Server 进入维护模式，拒绝新 Turn / Job / 部署；等待已有活跃项结束，不自动取消。 |
| R-13 | MUST | 活跃项检查至少覆盖 Turn（QUEUED/PREPARING/RUNNING/WAITING_APPROVAL/CANCELLING）、JobRun（queued/running）、部署 / 构建非终态。 |
| R-14 | MUST | 切换前备份数据库与 config；备份位于数据目录备份区，失败则不切换。 |
| R-15 | MUST | 停止 Server 使用既有优雅关闭；等待实例锁释放后再启动新版本。 |
| R-16 | MUST | 健康检查使用 `/api/health`（增加 `version`）与 `/api/bootstrap`，超时 30 秒；版本不匹配视为失败。 |
| R-17 | MUST | 健康失败回滚 `current` 与数据库；数据库已迁移且回滚失败时进入人工恢复状态，不再自动重试。 |
| R-18 | MUST | `update-state.json` 记录 phase / from / to / times / errorCode；跨重启保留，成功后归档最近 N 条。 |
| R-19 | MUST | 稳定错误码：`UPDATE_UNAVAILABLE`、`UPDATE_MANIFEST_INVALID`、`UPDATE_SIGNATURE_INVALID`、`UPDATE_HASH_MISMATCH`、`UPDATE_LOCKED`、`UPDATE_BUSY`、`UPDATE_UNSAFE_PACKAGE`、`UPDATE_HEALTH_FAILED`、`UPDATE_ROLLBACK_FAILED`、`UPDATE_DISK_FULL`。 |
| R-20 | MUST | 只有本机 TUI 可触发安装 / 取消；Web / Agent 工具不能触发停止或切换。 |
| R-21 | MUST | 检查后可显示新版本；`autoInstall` 配置保持 false 且不生效；自动检查默认每日一次。 |
| R-22 | MUST | 正式 PM2 服务不因管理面更新而停止；更新不得修改 PM2 配置、dump 或服务环境。 |
| R-23 | SHOULD | TUI 更新页展示当前版本、通道、最近检查、可用版本、阶段进度、失败原因与备份路径。 |
| R-24 | SHOULD | 发布工具校验清单、签名、包哈希并生成 fixture；发布流程文档化。 |
| R-25 | SHOULD | 状态与审计记录 from/to、耗时、结果；不含包内容、签名原文、私钥、完整查询串。 |

## 7. 接口与配置

### 7.1 发布清单

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "0.2.0",
  "releasedAt": 1794067200000,
  "minAppVersion": "0.1.0",
  "minSchemaVersion": 22,
  "maxSchemaVersion": 23,
  "archive": {
    "url": "https://updates.example.com/larness-0.2.0.tar.gz",
    "sha256": "64-hex",
    "size": 12345678
  },
  "entry": "app.js",
  "keyId": "release-2026"
}
```

- `manifest.json.sig` 为 Ed25519 detached 签名（对 manifest 原始字节）。
- 清单与签名响应 `Cache-Control: no-store`；允许的时钟偏差 ±10 分钟，仅用于展示，不作为安全判断。
- 发布说明如提供，只作为纯文本截断显示，不渲染 HTML。

### 7.2 安装目录

```text
<installRoot>/
  launcher.js                 # 稳定入口，不随版本切换
  current.json                # { schemaVersion, version, path, previousVersion, activatedAt }
  update.lock                 # 单写者
  versions/<version>/         # 不可变程序目录，entry=app.js
  staging/                    # 下载 / 解压临时目录
  backups/                    # 更新前数据库与 config 备份
  state/update-state.json     # 当前 / 最近更新状态
  logs/update.log             # 脱敏更新日志
```

- `installRoot` 默认为 `LARNESS_APP_DIR`；未设置时由发布包决定，不与 `LARNESS_DATA_DIR` 混用。
- `current.json` 使用原子 rename；路径必须解析在 `versions/` 内。
- 版本目录切换后不再写入；回滚只改指针，不修改旧目录。

### 7.3 Launcher

```bash
node launcher.js             # 读取 current.json，启动对应版本 TUI / Server
node launcher.js --version   # 打印当前版本
node launcher.js --check     # 仅检查更新（不安装）
```

- Launcher 不执行网络更新；只负责选择版本与启动。
- 启动失败时记录状态；若新版本连续失败，回退 `previousVersion` 并提示人工处理。
- 开发仓仍使用 `app.js`；发布布局由 M5-4 打包。

### 7.4 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `updates.manifestUrl` | `null` | HTTPS manifest 完整 URL；null 表示禁用检查 |
| `updates.channel` | `stable` | 已有键；`stable` / `beta` |
| `updates.autoCheck` | `true` | 每日后台检查；不自动安装 |
| `updates.autoInstall` | `false` | 固定 false，M5-3 不启用自动安装 |

- 新增配置键为可选，旧 config 读取时补 null；不改变 config version 1。
- 公钥不进入 config；由构建时注入 Launcher / Updater，避免用户替换。

### 7.5 健康检查

`GET /api/health` 增加 `version`：

```json
{ "status": "ok", "uptimeMs": 1234, "version": "0.2.0" }
```

- 旧客户端忽略新字段；更新器必须校验 `version` 与目标一致。
- 不新增公开更新 REST 接口；Web 版本展示可复用 `/api/bootstrap` 或后续任务。

## 8. 数据与迁移

- 本切片不新增数据库表；`update-state.json` 是更新进行中的权威状态，Server 下次启动读取并写审计。
- 更新前使用现有 `backupDatabase` 备份到 `backups/`；同时备份 `config.json`（若存在）。
- 版本目录与数据目录分离；升级失败不得删除数据目录、项目源码或 PM2 服务。
- 数据库迁移由新版本正常执行；迁移后回滚只能恢复备份，不能假设旧代码兼容新 schema。
- 备份保留最近 5 次或 90 天；清理在更新成功后执行，失败备份保留。

## 9. 安全、权限与审计

- **发布信任**：私钥离线保存；仓库只含公钥；`keyId` 轮换需新旧双签或保留旧公钥至少一个发布周期。签名验证失败时失败关闭。
- **下载**：只允许 HTTPS、无凭据、无 IP 字面量、无 localhost；拒绝重定向；限制大小与时间；环境代理仅在不改变 TLS 校验时使用。
- **解压**：所有 entry 先校验后写入；拒绝符号链接 / 硬链接 / 设备 / 绝对 / `..` / 超限；只写入 `versions/<version>/` 新目录。
- **权限**：安装根与版本目录不 world-writable；`update.lock` / 状态文件 0600；更新器以 Larness 账户运行，不请求 sudo。
- **安全点**：活跃 Turn / Job / 部署存在时等待；维护模式拒绝新工作；不自动取消或强制终止。
- **审计**：记录 `update.checked` / `update.downloaded` / `update.verified` / `update.started` / `update.succeeded` / `update.failed` / `update.rolled_back`；不含签名原文、包内容、私钥、完整查询串。
- **Web / Agent**：不新增更新工具或 Web 安装入口；Agent 不能触发更新、停止或回滚。
- **PM2**：更新只停止管理面，不触碰 PM2 守护、dump、服务环境或正式服务进程。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| manifest 404 / 网络失败 | 检查失败，保留上次结果 | “检查更新失败”，可重试 |
| 签名 / 哈希 / 大小失败 | 拒绝安装，清理 staging | 稳定错误码，不显示签名原文 |
| 版本过低 / channel 不符 / schema 不兼容 | 拒绝安装 | 说明原因 |
| 活跃任务未结束 | 等待安全点，可取消更新 | 活跃 Turn / Job / 部署数量 |
| 安装根不可写 / 磁盘不足 | 下载或切换前拒绝 | “安装目录不可写 / 空间不足” |
| 解压 entry 异常 | 删除新版本目录，保持 current | “发布包不安全” |
| 切换后健康超时 | 回滚 current，重启旧版本 | “新版本启动失败，已回滚” |
| 健康失败且数据库已迁移 | 恢复备份；失败则人工恢复 | 备份路径与恢复步骤 |
| 回滚后旧版本仍失败 | 停止自动重试，`UPDATE_ROLLBACK_FAILED` | 人工恢复提示 |
| 更新进程崩溃 / 断电 | 下次 Launcher 读状态与锁；未完成则回退 / 人工 | “上次更新未完成” |
| 并发更新 | `UPDATE_LOCKED` | 不下载、不切换 |
| 旧版本目录被删 | Launcher 失败关闭或使用 previous | 不猜测其他目录 |
| PM2 服务运行中 | 保持运行；管理面停止 | 正式服务不受影响 |

## 11. 可观测性

- `update-state.json` 字段：`phase`（idle/checking/downloading/verifying/waiting-safe-point/switching/restarting/health-checking/succeeded/failed/rolled-back/manual-recovery）、`fromVersion`、`toVersion`、`startedAt`、`updatedAt`、`errorCode`、`errorMessage`、`backupPath`、`activeCounts`。
- `logs/update.log` 结构化 JSON 行；只含版本、阶段、耗时、结果、稳定错误码。
- TUI 更新页显示当前阶段和最近结果；启动时若发现未完成状态，先提示再进入主界面。
- 审计在 Server 启动后补齐；更新器自身不写业务数据库。

## 12. 测试计划

- **单元**：manifest Zod / semver / channel / schema 范围；Ed25519 正反例；SHA-256 / size；路径与 entry 校验；当前指针解析与回退；锁的获取 / 陈旧 / 重入；状态机转换。
- **集成**：本地 fixture HTTPS 服务器（自签测试证书）下载；中断 / 超时 / 超限；tar 恶意 entry 拒绝；磁盘不足；原子切换；健康检查失败回滚；数据库备份恢复；并发更新；Launcher 指针损坏。
- **TUI / E2E**：检查 → 显示 → 安装确认 → 安全点 → 成功；签名失败；取消；回滚提示；启动时未完成状态。
- **回归**：`pnpm check`、`pnpm build`、Demo、auth E2E；PM2 服务 PID 在更新期间不变（有 PM2 环境时）。
- **手动**：真实 macOS 安装根；断网 / 断电恢复；正式服务运行中更新；备份恢复演练。

## 13. 开放问题与待确认决策

| ID | 问题 | 推荐 | 需要决策 |
|---|---|---|---|
| D1 | 发布清单来源 | 用户可配置的 HTTPS manifest URL；null 禁用；不做固定官方域名 | 人类 |
| D2 | 签名格式 | Ed25519 detached 签名（原始 manifest 字节）；内置最多 2 个公钥 / keyId；私钥离线 | 人类 |
| D3 | 安装权限 | 仅本机 TUI 可确认；Web / Agent 不可安装 | 人类 |
| D4 | 包格式与依赖 | `.tar.gz` + `tar`（纯 JS）+ `semver@7`；先校验 entry 再解压 | 人类 |
| D5 | 数据库迁移后失败 | 更新前备份；健康失败且 schema 已变化时恢复备份，恢复失败进入人工恢复 | 人类 |
| D6 | 自动下载 | 每日自动检查；下载只在用户确认后开始 | 人类 |

确认后：本 spec 转 `ready`，补 `docs/contracts/runtime-entry.md` / `rest-api.md`（health.version）/ `data-model.md`（文件布局与备份）并新增 ADR 记录发布信任与切换边界。

## 14. 完成定义

- [ ] A1–A12 通过；
- [ ] 签名、哈希、解压、锁、健康、回滚、数据库备份测试通过；
- [ ] TUI 更新页与状态恢复可用；
- [ ] `pnpm check`、`pnpm build`、auth / Demo E2E 通过；
- [ ] 契约、ADR、STATUS、ROADMAP、tasks 更新；
- [ ] 未验证项（Windows / Linux、真实发布服务器、Apple 公证）如实记录；
- [ ] 人类验收通过。
