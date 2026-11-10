# M5-4 任务：跨平台安装与运行 PoC

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 门禁已过：spec `ready`（2026-11-08 D1–D5 确认）。M5-4-1 `done`；M5-F1/F2/F3 为发布后跟踪，不计入 M5。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-4-1 | 本地冒烟与三端验收表 | 066 spec ready | `done` |

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

### 发布后跟踪 M5-F2：Linux 验证 / 修复（不计入 M5 完成）

- 状态：`todo`（发布后跟踪）
- 依赖：M5-4-1
- 目标：验证 Ubuntu x64，修复平台差异。
- 交付物：
  - Ubuntu 预编译 / 编译回退、终端、命令、PM2、路径结果。
  - Linux 编译工具要求；必要的平台修复与测试。
- 验收：A1、A2、A4、A5、A6、A7。
- 测试：平台条件测试；手动实机记录。
- 涉及路径：`apps/server/src/platform/*`、terminals / commands / service-ops、`packages/resources`。

### 发布后跟踪 M5-F1：Windows 原生验证 / 修复（不计入 M5 完成）

- 状态：`done`（2026-11-10，分支 `task/m5-f1-windows-support`；Windows 11 实机）
- 依赖：M5-4-1
- 目标：Windows 10/11 x64 原生安装与核心功能；移除 `TerminalManager` / `CommandManager` 的 win32 拒绝，补齐 ConPTY、进程树、服务身份、PM2 与路径差异后恢复 Windows 全量 check。
- 交付物：
  - PowerShell 安装、TUI、Server/Web、终端 ConPTY、命令、文件/Git、PM2。
  - 路径 / 盘符 / 大小写 / 进程终止 / 文件锁差异修复或限制。
- 验收：A3、A4、A5、A6、A7；WSL 单列。
- 测试：Windows 11 x64 实机；平台条件测试。
- 交付（2026-11-10，Windows 11 build 26200，Node 24.9.0）：
  - [x] `pnpm check`：server 549 通过 / 31 跳过，agent 42 通过，web 141 通过。
  - [x] `pnpm build`、`platform-smoke`、`verify-npm-pack --install`。
  - [x] TUI（源码与 dist）、ConPTY 终端、命令 `.cmd` shim、进程树停止、服务/预览。
  - [x] 真实 PM2 7.1.2 安装、启动、替换、健康失败回滚、对账。
  - [x] Mock E2E 19/19；Auth E2E 18/18；生产构建 E2E 18/18。
  - [x] Windows 10 同构实现（ConPTY/CIM/taskkill/Get-NetTCPConnection），剩余实机复测见 M5-F1-W10。
- 涉及路径：Windows 平台层、terminals / commands / services / PM2 / 路径与测试。

### 发布后跟踪 M5-F1-W10：Windows 10 x64 实机复测（不计入 M5 完成）

- 状态：`todo`
- 依赖：M5-F1
- 目标：在 Windows 10 x64 1809+ 复跑同一安装与核心链路，确认 ConPTY/进程树/PM2 行为一致。
- 交付物：`pnpm check`、build、platform-smoke、pack 安装、TUI、终端、命令、PM2 实机记录。
- 测试：Windows 10 实机；失败项回写支持矩阵，不标通过。

### 发布后跟踪 M5-F3：平台文档与整体验收（不计入 M5 完成）

- 状态：`todo`（发布后跟踪）
- 依赖：M5-F1、M5-F2
- 目标：公开支持矩阵、限制与验收证据。
- 交付物：
  - `docs/guides/install.md` 平台表、Node、原生依赖、已验证 / 未验证。
  - `specs/066-cross-platform/acceptance.md` 逐平台结果。
  - STATUS / ROADMAP / tasks 更新。
- 验收：A9；三平台安装/启动记录；未验证项如实。
- 测试：文档链接校验；主平台全量回归。
- 涉及路径：`docs/guides/install.md`、验收记录、STATUS/ROADMAP。
