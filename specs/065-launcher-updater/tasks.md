# M5-3 任务：Launcher、签名更新与回滚

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 门禁：[spec](spec.md) 转 `ready`（D1–D6 确认）后才可开始 M5-3-1。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-3-1 | 发布清单、签名与版本检查 | 065 spec ready | `todo` |
| M5-3-2 | Launcher、安装布局与更新锁 | M5-3-1 | `todo` |
| M5-3-3 | 下载、归档校验与安全解压 | M5-3-1 | `todo` |
| M5-3-4 | 安全点、切换、健康与回滚 | M5-3-2、M5-3-3 | `todo` |
| M5-3-5 | TUI 更新页与整体验收 | M5-3-4 | `todo` |

## 任务卡

### M5-3-1 发布清单、签名与版本检查

- 状态：`todo`
- 依赖：065 spec ready（D1/D2/D5 确认）
- 目标：安全地判断“是否有可安装的新版本”，不下载、不切换。
- 交付物：
  - `updates/manifest.ts`：严格 Zod、原始字节、Ed25519 detached 签名、`keyId`。
  - `updates/version.ts`：semver、channel、`minAppVersion`、schema 范围。
  - `updates.manifestUrl` 可选配置；`/api/health` 增加 `version`。
  - TUI 检查更新入口（fixture / 真实 URL）。
- 验收：
  - A1、A2、A8、A12；签名 / 哈希 / 版本 / channel 失败不进入可安装。
  - 无配置时检查禁用；不自动下载。
- 测试：manifest 正反例、semver、schema、签名篡改、health version。
- 涉及路径：`apps/server/src/modules/updates/*`、`apps/server/test/updates/*`、`packages/shared/src/config.ts`、`apps/server/src/api/health.ts`。

### M5-3-2 Launcher、安装布局与更新锁

- 状态：`todo`
- 依赖：M5-3-1
- 目标：建立稳定入口与不可变版本目录，保证切换前状态可控。
- 交付物：
  - `launcher.js`：current.json、versions 路径限制、previous 回退。
  - `current.json` 原子写；`update.lock`、`update-state.json`。
  - 安装根预检（可写、磁盘、entry）。
- 验收：
  - A7、A9、A10；指针损坏 / 越界 / entry 缺失失败关闭。
  - 锁重入、陈旧锁、并发 Launcher。
- 测试：原子写、路径越界、回退、锁生命周期、状态机。
- 涉及路径：`launcher.js`、`apps/server/src/modules/updates/launcher.ts` / `lock.ts` / `state.ts`、`apps/server/test/updates/*`。

### M5-3-3 下载、归档校验与安全解压

- 状态：`todo`
- 依赖：M5-3-1（D4 依赖批准）
- 目标：把签名包安全落到 `versions/<version>/`，失败不留半成品。
- 交付物：
  - `download.ts`：HTTPS / 无凭据 / 无重定向 / 超时 / 大小 / SHA-256。
  - `archive.ts`：entry 预检、拒绝链接 / 设备 / 绝对 / `..` / 重复 / 超限；原子 rename。
  - staging 清理与错误码。
- 验收：
  - A2、A10；中断 / 超限 / 恶意 tar / 磁盘不足不产生版本目录。
- 测试：本地 fixture HTTPS、流中断、哈希、路径穿越、链接、重复 entry。
- 涉及路径：`apps/server/src/modules/updates/download.ts` / `archive.ts`、`package.json` 依赖。

### M5-3-4 安全点、切换、健康与回滚

- 状态：`todo`
- 依赖：M5-3-2、M5-3-3
- 目标：完成可恢复的原子更新。
- 交付物：
  - IPC `system.update.prepare` / `system.update.cancel`；维护模式与活跃项计数。
  - `update.js`：备份、切换、重启、健康、回滚、数据库恢复、状态文件。
  - TUI 在安全点后 spawn Updater；PM2 服务不受影响。
- 验收：
  - A3–A6、A11；健康失败回滚；数据库迁移后失败恢复；并发更新拒绝。
- 测试：活跃 Turn / Job / 部署等待、健康超时、回滚、数据库备份恢复、崩溃恢复。
- 涉及路径：`apps/server/src/api/health.ts`、`apps/server/src/ipc/*`、`apps/server/src/modules/updates/updater.ts`、`apps/server/src/cli/update.ts`、`apps/server/src/bootstrap/start.ts`。

### M5-3-5 TUI 更新页与整体验收

- 状态：`todo`
- 依赖：M5-3-4
- 目标：操作者可见、可取消、可恢复；完成验收记录。
- 交付物：
  - TUI 更新页：版本、通道、检查、安装确认、阶段、失败 / 回滚 / 人工恢复。
  - 启动时未完成状态提示；staging / 备份清理提示。
  - 验收记录、契约 / ADR / STATUS / ROADMAP 更新。
- 验收：
  - TUI 成功更新、签名失败、取消、回滚、数据库恢复演练。
  - `pnpm check`、`pnpm build`、Demo、auth E2E 通过。
- 测试：TUI 渲染与交互、E2E / 手动记录。
- 涉及路径：`apps/server/src/tui/update-page.ts` / `update-flow.ts`、`specs/065-launcher-updater/acceptance.md`。
