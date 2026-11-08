# M5-4 任务：跨平台安装与运行 PoC

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 门禁已过：spec `ready`（2026-11-08 D1–D5 确认）。当前 M5-4-1 `in_progress`。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-4-1 | 本地冒烟与三端验收表 | 066 spec ready | `done` |
| M5-4-2 | Linux 验证 / 修复 | M5-4-1 | `blocked`（等待实机） |
| M5-4-3 | Windows 原生验证 / 修复 | M5-4-1 | `blocked`（等待实机） |
| M5-4-4 | 平台文档与整体验收 | M5-4-2、M5-4-3 | `blocked`（等待实机） |

## 任务卡

### M5-4-1 本地冒烟与三端验收表

- 状态：`done`
- 依赖：066 spec ready
- 目标：提供本地冒烟脚本与三端验收表；不配置 CI。
- 交付物：
  - 删除 `.github/workflows/ci.yml`；保留 `platform-smoke.mjs` / `verify-npm-pack.mjs`。
  - `pnpm check`、`pnpm build`、`node scripts/platform-smoke.mjs`、`npm pack`、临时全局安装 + `larness --version`。
- 验收：A8、A10；失败单元不标通过。
- 测试：本地 macOS Apple Silicon 基线；三端由人类实机执行。
- 交付（2026-11-08）：
  - [x] CI 已按用户要求删除；保留本地冒烟脚本。
  - [x] 本地 macOS Apple Silicon：`pnpm check`、`pnpm build`、`platform-smoke`、`npm pack` 安装均通过。
  - [x] `verify-npm-pack.mjs` 跨平台：Windows `larness.cmd` 路径、路径分隔符归一。
  - [x] `platform-smoke.mjs`：Node 版本、better-sqlite3、node-pty、文件系统；macOS Apple Silicon 通过。
  - [x] 保留 `.gitattributes` LF 与 server Vitest 超时 20s，便于实机稳定运行。
  - [x] 本地 macOS Apple Silicon Node 24 验证通过；Windows / Ubuntu 结果待实机填写。
- 涉及路径：`scripts/verify-npm-pack.mjs`、`scripts/platform-smoke.mjs`、三端验收表。

### M5-4-2 Linux 验证 / 修复

- 状态：`blocked`
- 依赖：M5-4-1
- 目标：验证 Ubuntu x64，修复平台差异。
- 交付物：
  - Ubuntu 预编译 / 编译回退、终端、命令、PM2、路径结果。
  - Linux 编译工具要求；必要的平台修复与测试。
- 验收：A1、A2、A4、A5、A6、A7。
- 测试：平台条件测试；手动实机记录。
- 涉及路径：`apps/server/src/platform/*`、terminals / commands / service-ops、`packages/resources`。

### M5-4-3 Windows 原生验证 / 修复

- 状态：`blocked`
- 依赖：M5-4-1
- 目标：Windows 11 x64 原生安装与核心功能；当前 `TerminalManager` / `CommandManager` 对 win32 返回 `RESOURCE_UNAVAILABLE`，需先实现终端/命令/PM2 再恢复 Windows 全量 check。
- 交付物：
  - PowerShell 安装、TUI、Server/Web、终端 ConPTY、命令、文件/Git、PM2。
  - 路径 / 盘符 / 大小写 / 进程终止 / 文件锁差异修复或限制。
- 验收：A3、A4、A5、A6、A7；WSL 单列。Windows 实机当前需先补终端/命令实现，再跑全量 check；在此之前只记录 build / platform-smoke / pack。
- 测试：Windows 实机；平台条件测试。
- 涉及路径：同 M5-4-2 + Windows 路径 / IPC / 进程树。

### M5-4-4 平台文档与整体验收

- 状态：`blocked`
- 依赖：M5-4-2、M5-4-3
- 目标：公开支持矩阵、限制与验收证据。
- 交付物：
  - `docs/guides/install.md` 平台表、Node、原生依赖、已验证 / 未验证。
  - `specs/066-cross-platform/acceptance.md` 逐平台结果。
  - STATUS / ROADMAP / tasks 更新。
- 验收：A9；三平台安装/启动记录；未验证项如实。
- 测试：文档链接校验；主平台全量回归。
- 涉及路径：`docs/guides/install.md`、验收记录、STATUS/ROADMAP。
