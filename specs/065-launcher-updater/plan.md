# M5-3 实施计划：Launcher、签名更新与回滚

> 对应 [spec](spec.md)。D1–D6 确认、spec 转 `ready` 后执行；本文件只讲实现，不改变需求。

## 1. 技术方案

M5-3 把“运行程序”和“安装版本”分开：

1. **发布清单层**：`updates/manifest.ts` 读取原始 JSON 字节 → Zod 校验 → Ed25519 验证 `manifest.json.sig` → semver / channel / schema 范围检查。公钥由构建时注入，不读用户配置。
2. **下载层**：`updates/download.ts` 用 Node `fetch` 下载到 `staging/`，限制 HTTPS、无凭据、无重定向、总大小与时间；边写边算 SHA-256，结束校验大小 / 哈希。
3. **归档层**：`updates/archive.ts` 先枚举 tar entry 做拒绝规则（绝对路径、`..`、链接、设备、重复、超限），再解压到临时目录，最后 `rename` 为 `versions/<version>/`；entry 必须存在。
4. **Launcher**：`launcher.js` 是安装根稳定入口，读 `current.json`，只允许 `versions/` 内路径，启动对应版本 `app.js`；失败回退 `previousVersion`。
5. **Updater**：`apps/server/src/cli/update.ts` 作为独立进程，由 TUI 在安全点后 spawn；负责锁、备份、切换、健康、回滚，状态写 `state/update-state.json`。
6. **安全点**：TUI 先通过 IPC 请求 Server 进入维护模式并读取活跃项；Server 拒绝新 Turn / Job / 部署，返回 counts；TUI 等待 counts 归零后停止 Server，再启动 Updater。
7. **健康检查**：新版本启动后轮询 `/api/health` 的 `version` 与 `/api/bootstrap`；30 秒超时或版本不符即回滚。
8. **TUI**：新增“更新”页；检查 / 下载 / 安装 / 取消 / 状态恢复；Web 不提供安装。

状态机：

```text
idle → checking → available → downloading → verifying
     → waiting-safe-point → switching → restarting → health-checking
     → succeeded
     ↘ failed（签名/哈希/包/磁盘/健康）
     ↘ rolled-back（健康失败且回退成功）
     ↘ manual-recovery（回滚或数据库恢复失败）
```

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 独立 Launcher + current 指针 | 原子切换、可回滚、不覆盖运行中程序 | 需要发布布局 | 采用 |
| 原地覆盖当前目录 | 简单 | 无法回滚、运行中覆盖风险 | 不采用 |
| 符号链接 current | POSIX 简单 | Windows 权限、悬空链接 | 不采用；用 JSON 指针 + rename |
| `.tar.gz` + `tar` | 通用、可流式、纯 JS | 解压安全需严格校验 | 采用（D4） |
| `.zip` + 系统 unzip | 系统自带 | 平台差异、难统一校验 | 不采用 |
| GitHub Releases API | 现成 | 未确定发布源、速率限制、认证 | 后续；D1 用可配置 manifest |
| 自动安装 | 省事 | 违反 ADR-007，风险高 | 不采用 |
| Web 安装 | 远程方便 | 停止 / 切换权限过大 | 不采用（D3） |

## 3. 目录与文件变更

```text
新增：
specs/065-launcher-updater/spec.md / plan.md / tasks.md
launcher.js                                  # 安装根稳定入口
apps/server/src/modules/updates/manifest.ts
apps/server/src/modules/updates/version.ts   # semver / schema 兼容
apps/server/src/modules/updates/signature.ts
apps/server/src/modules/updates/download.ts
apps/server/src/modules/updates/archive.ts
apps/server/src/modules/updates/lock.ts
apps/server/src/modules/updates/state.ts
apps/server/src/modules/updates/updater.ts
apps/server/src/modules/updates/launcher.ts
apps/server/src/cli/update.ts
apps/server/src/tui/update-page.ts
apps/server/src/tui/update-flow.ts
apps/server/test/updates/*
docs/contracts/update.md                     # 或补 runtime-entry / rest-api
docs/adr/ADR-055-signed-updates.md

修改：
apps/server/src/api/health.ts                # 增加 version
packages/shared/src/config.ts                # updates.manifestUrl
apps/server/src/bootstrap/start.ts           # 维护模式 / 活跃项 IPC
apps/server/src/ipc/handlers.ts              # system.update.prepare / status
apps/server/src/tui/main.ts / dashboard.ts   # 更新入口 / 状态
apps/server/tsdown.config.ts                 # 构建 update 入口
app.js                                       # 发布布局下委托 launcher（M5-4）
docs/contracts/rest-api.md / runtime-entry.md / data-model.md
```

## 4. 实施步骤

### M5-3-1 清单、签名与检查

- 先写失败测试：manifest Zod、semver、channel、schema 范围、Ed25519 正反例、原始字节签名。
- 新增 `updates.manifestUrl` 可选配置；health 增加 `version`。
- TUI “检查更新”先使用 fixture manifest，不下载包。
- 检查结果只读；不自动安装。

### M5-3-2 Launcher 与安装布局

- 先写失败测试：current.json 解析、路径越界、previous 回退、原子写、锁重入 / 陈旧。
- 实现 `launcher.js`、`current.json`、`update.lock`、`update-state.json`。
- 版本目录 fixture；开发仓仍走 `app.js`。
- 不涉及下载 / 切换。

### M5-3-3 下载、归档与安全校验

- 先写失败测试：HTTPS 拒绝、重定向、超限、哈希 / 大小、tar 恶意 entry、重复 entry、entry 缺失。
- 实现 download / archive / staging 清理；加入 `tar` / `semver`（D4 批准后）。
- 验证包只落到 `versions/<version>/`，失败不产生目录。

### M5-3-4 安全点、切换、健康与回滚

- 扩展 IPC：`system.update.prepare` 返回 `{safe, counts}` 并进入维护模式；`system.update.cancel` 恢复。
- TUI 停止 Server 后 spawn `update.js`；Updater 备份 DB/config，原子切换，启动新版本，健康检查，失败回滚。
- 状态文件阶段与错误码；备份恢复。
- 测试并发更新、崩溃恢复、PM2 服务不受影响（有环境时）。

### M5-3-5 TUI 更新页与验收

- 更新页：当前版本、通道、检查、可用版本、安装确认、进度、失败 / 回滚 / 人工恢复。
- 启动时读取未完成状态并提示。
- E2E / 手动：签名失败、下载中断、活跃任务等待、健康失败回滚、数据库恢复。
- 验收记录与契约同步。

## 5. 数据与迁移

- 不新增数据库表；状态文件是更新进行中的权威状态，Server 下次启动写审计。
- 备份到 `dataDir/backups`（现有 `backupDatabase`）；config 备份到同一目录。
- `current.json` / `update.lock` / `update-state.json` 位于安装根，不进入数据目录。
- 旧 config 无 `updates.manifestUrl` 时默认 null；不提升 config version。

## 6. 回滚策略

- 健康失败：`current` 切回上一版本，启动旧版本；数据库未迁移则保留原库。
- 数据库已迁移：从更新前备份恢复后再启动旧版本；恢复失败进入 `manual-recovery`，停止自动重试。
- 更新器自身崩溃：下次 Launcher / TUI 读取 `update-state.json` 与锁，按 `phase` 回退或提示人工；不自动重跑坏包。
- 关闭更新：`updates.manifestUrl=null` 或 `autoCheck=false`；已下载 staging 清理。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
pnpm test:e2e:auth
```

定向：

```bash
pnpm --filter @larness/server exec vitest run test/updates
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 签名私钥泄漏 | 可发布恶意更新 | 离线私钥、双公钥轮换、发布审计 |
| tar 路径穿越 / 链接 | 任意文件写入 | 先枚举 + 严格拒绝 + 只写新目录 |
| 更新中崩溃 | 半切换 / 无程序 | 原子指针 + 状态文件 + Launcher 回退 |
| 健康检查误判 | 回滚正常版本 | 30s 超时 + 版本匹配 + 旧版本可启动 |
| 数据库迁移后回滚失败 | 数据不可用 | 强制备份、人工恢复指引、不自动重试 |
| 活跃任务被终止 | 用户工作丢失 | 维护模式 + 安全点 + 可取消等待 |
| 磁盘 / 权限不足 | 更新失败 | 预检 + staging 清理 + 明确错误 |
| 自动检查网络请求 | 隐私 / 代理 | 仅 HTTPS、可关闭、无遥测 |

## 9. 未决事项

- D1–D6 见 [spec §13](spec.md#13-开放问题与待确认决策)。
- M5-4 的发布打包布局需与本规格的 `versions/<version>/` 对齐；Windows / Linux 文件锁与启动器行为归 M5-4。
- 真实发布服务器、Apple 公证、PM2 环境下的更新演练在 M5-3-5 / M5-5 记录。
