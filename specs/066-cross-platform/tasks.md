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
  - [x] 本地 macOS Apple Silicon Node 24 验证通过；Windows 11 / Windows 10 已实机验证（Windows 10 为用户确认，2026-11-18）；Ubuntu 结果待实机填写。
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
  - [x] Windows 10 同构实现（ConPTY/CIM/taskkill/Get-NetTCPConnection），实机复测见 M5-F1-W10（2026-11-18 用户确认通过）。
- 涉及路径：Windows 平台层、terminals / commands / services / PM2 / 路径与测试。

### 发布后跟踪 M5-F1-R1：Windows 部署产物提交

- 状态 `done`（2026-11-11），依赖 M5-F1。UI-F1 的全量检查暴露部署产物暂存目录重命名偶发 EPERM，用户授权先排查基线。
- 目标、验收与测试见 [规格](spec.md#m5-f1-r1-windows-部署产物提交)及[计划](plan.md#m5-f1-r1-部署产物重命名)。
- 涉及路径为 Server 部署存储与对应回归测试。
- [x] 注入一次 EPERM 和持续 EPERM，先复现失败，再验证原子提交与有界失败。
- [x] Windows、Node 24.19.0 下部署和运维定向测试 35 通过、2 跳过。`VITEST_MAX_WORKERS=3 pnpm check` 通过（Server 552/31、Agent 42/1、Web 141 通过）。本任务未运行构建或整套 E2E。

### 发布后跟踪 M5-F1-W10：Windows 10 x64 实机复测（不计入 M5 完成）

- 状态：`done`（2026-11-18 用户确认 Windows 10 x64 实机复测通过；具体 OS build、Node / npm 版本与日志未回填）
- 依赖：M5-F1
- 目标：在 Windows 10 x64 1809+ 复跑同一安装与核心链路，确认 ConPTY/进程树/PM2 行为一致。
- 交付物：`pnpm check`、build、platform-smoke、pack 安装、TUI、终端、命令、PM2 实机记录。
- 测试：Windows 10 实机；失败项回写支持矩阵，不标通过。
- 备注：本次仅记录用户确认结果；未提供的版本号与命令输出不补写。

### 发布后跟踪 M5-F1-W11：Windows 启动结算 /bin/ps 缺陷（不计入 M5 完成）

- 状态：`done`（2026-11-18，分支 `task/m5-f1-w11-reconcile-ps`；Windows 10 19045 / Node 24.19.0 实机）
- 依赖：M5-F1
- 起因：2026-11-18 用户实机 Windows 10 无法启动，TUI 报「无法读取或校验数据，请刷新重试」。排查确认迁移 33/33 已应用、`quick_check` 正常，非数据库问题；根因为 `CommandManager.reconcileDeadStoppedCommands()`（`apps/server/src/modules/commands/manager.ts`）调用 `groupAlive()` 无 win32 分支，存在遗留 `command.run RECONCILIATION_REQUIRED (STOP_UNCONFIRMED)` 行时启动必抛 `spawn /bin/ps ENOENT`。POSIX 上 `ps` 不可用的环境（如 DSH 沙箱）同样会崩溃启动。既有测试「does not keep a project root blocked by a command whose recorded process is gone」在 Windows 同因失败，说明该路径此前未在 Windows 覆盖。
- 修复：Windows 用 `processAlive(pid)` 判定（Windows 无 pgid，identity 仅 pid）；POSIX 保留进程组检查，快照失败保守视为无法确认、跳过该行保留屏障，不标记 FAILED 也不崩溃。
- 交付（2026-11-18）：
  - [x] 既有回归测试「does not keep a project root blocked…」修复前在 Windows 失败（`spawn /bin/ps ENOENT`），修复后通过；`commands.test.ts` 整文件 12 通过 / 1 平台跳过。
  - [x] 真实数据目录实机验证：server 正常启动监听 3210，遗留 `rop_92c40cbf…` 行自愈为 `FAILED/STOP_UNCONFIRMED`，锁释放，无待结算行。
  - [x] `biome ci`、六包 typecheck 通过；`VITEST_MAX_WORKERS=3 pnpm check` 在 apps/server 测试阶段存在 **2 个与本修复无关的存量失败**（stash 后复跑同样失败，见 M5-F1-W12），未冒充全量通过。
- 涉及路径：`apps/server/src/modules/commands/manager.ts`、`apps/server/test/resources/commands.test.ts`（既有测试，未改动）。

### 发布后跟踪 M5-F1-W12：Windows 全量 check 存量 shell 测试失败（不计入 M5 完成）

- 状态：`done`（2026-11-18，分支 `task/m5-f1-w12-shell-tests`；Windows 10 19045 / Node 24.19.0 实机；只改测试，未动产品代码）
- 依赖：M5-F1
- 现象与归因：
  - `test/agent/commands.test.ts`「runs run_shell through the platform shell…」与 `test/resources/command-runner.test.ts`「runs an explicit platform shell…」用带引号路径命令（`"node.exe" -e …`），POSIX sh 可执行但 PowerShell 需要 `&` 调用符，ParserError 导致 exit 1；shell 名断言硬编码 `sh`。
  - 「executes an exact project test script…」偶发 `TIMED_OUT`：fixture 默认命令预算 2000ms，Windows 下 `pnpm` .cmd shim 启动链常超 2s（已复现一次）。
  - `terminal-shell.test.ts` worker 崩溃为**确定性**（单独运行 5/5 复现）：「uses system CMD if PowerShell is unavailable…」把真实 cmd.exe 复制到 %TEMP% 再探测执行，被主机安全软件无声击杀整棵进程树（父进程 exit 0、无任何事件日志；脱离 vitest 可独立复现）。对照实验：where.exe 副本、cmd.exe 硬链接、仓库目录下的 cmd.exe 副本均存活——拦截模式是「%TEMP% 中新建的 cmd.exe 副本被执行」。
- 交付（2026-11-18）：
  - [x] 两个 shell 测试补 Windows 分支：命令加 `&` 调用符，shell 名按平台断言（POSIX `sh`；Windows `pwsh`/`powershell`）。Windows 首次真实覆盖 `selectWindowsShell` + `-EncodedCommand` 包装路径。
  - [x] `pnpm test` 用例预算 2000ms → 30s。
  - [x] terminal-shell 的 cmd 兜底夹具从 %TEMP% 改为工作目录暂存（`.terminal-shell-fixture-<pid>`，finally 清理）；3/3 稳定通过，cmd 兜底分支在本机首次完整执行。
  - [x] 定向复跑：两个测试文件 22/22 ×3 遍；terminal-shell 3/3 ×3 遍无 worker 崩溃。
  - [x] `VITEST_MAX_WORKERS=3 pnpm check` 全绿：biome、6 包 typecheck、server 152 文件 712 通过 / 31 跳过（082/083 测试合入后 Windows 首次全量通过）。
- 涉及路径：`apps/server/test/agent/commands.test.ts`、`apps/server/test/resources/command-runner.test.ts`、`apps/server/test/resources/terminal-shell.test.ts`。

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
