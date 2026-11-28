# 112 任务清单

> 状态：`done`。一次只做一个任务；任务完成后勾选并在「备注」记录验证命令与未运行项。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| LC-1 | [CLI 参数、分派与裸命令帮助](#lc-1-cli-参数分派与裸命令帮助) | — | `done` |
| LC-2 | [status 人读、状态字段与锁 mode](#lc-2-status-人读状态字段与锁-mode) | LC-1 | `done` |
| LC-3 | [logs 尾部与 --follow](#lc-3-logs-尾部与---follow) | LC-1 | `done` |
| LC-4 | [start 后台启动与 daemon.log](#lc-4-start-后台启动与-daemonlog) | LC-2 | `done` |
| LC-5 | [stop / restart 与 IPC source](#lc-5-stop--restart-与-ipc-source) | LC-4 | `done` |
| LC-6 | [TUI 附加模式、菜单与退出文案](#lc-6-tui-附加模式菜单与退出文案) | LC-2 | `done` |
| LC-7 | [dev 边界与 supervisor 清理](#lc-7-dev-边界与-supervisor-清理) | LC-5 | `done` |
| LC-8 | [契约、安装文档与整仓验证](#lc-8-契约安装文档与整仓验证) | LC-6, LC-7 | `done` |

## LC-1 CLI 参数、分派与裸命令帮助

**验收**

- `larness` / `node app.js` 无参数：打印与 `--help` 等价的命令表，退出 0，不创建数据目录、不连 IPC。
- 支持 `start`、`stop`、`tui`、`status`、`logs`、`restart`、`doctor`、`--version`、`--help`；未知命令退 1，非法参数退 2。
- 帮助包含五个命令、退出码与 `LARNESS_*` 环境变量；不再出现“关闭 TUI 停止全部”。
- 源码检出（无 dist）时 `--help` / `--version` 仍可用；子命令按构建产物或源码入口运行。

**测试**

- `apps/server/test/cli/args.test.ts`：解析、默认值、未知参数、退出码。
- `apps/server/test/cli/app.test.ts`：裸命令与 `--help` 一致、无副作用、未知命令。

**备注**

- 2026-11-28 完成。`test/cli/args.test.ts` 15 项、`test/cli/app.test.ts` 5 项；裸命令与 `--help` 输出一致且不创建数据目录。

## LC-2 status 人读、状态字段与锁 mode

**验收**

- `status` 默认输出人读摘要（运行状态、PID、运行时长、模式、dev、Web、数据目录、日志、IPC、会话、警告、PM2 说明）；`--json` 输出完整 `StatusReport`。
- 运行 0 / 未运行 3 / 读取失败 1。
- 锁记录写入可选 `mode` / `dev`；旧锁缺字段按 `unknown` / `false` 读取，不拒绝启动。
- `system.status` 经 IPC 返回同一组字段。

**测试**

- 格式化单元测试；锁兼容测试；IPC 集成断言新字段。

**备注**

- 2026-11-28 完成。`status --json` 与默认摘要均验证；旧锁缺 `mode` / `dev` 可读。

## LC-3 logs 尾部与 --follow

**验收**

- `logs` 默认 200 行，`--lines 1–1000`；`--daemon` 读后台日志；`--follow` 先尾部再持续输出。
- 文件不存在退 3；不可读退 1；超过 1 MiB 只读尾部并提示。
- 只读当前数据目录固定文件；主日志格式化，解析失败保留原文；不输出秘密。
- `--follow` 只跟随启动时选定的文件，Ctrl+C 退 0，不停止服务。

**测试**

- `apps/server/test/cli/logs.test.ts`：尾部、行数、截断、缺失、跟随追加、文件替换。

**备注**

- 2026-11-28 完成。手动验证 `logs`、`logs --follow`（SIGINT 退 0）；修复 follow 计时器 `unref` 导致命令立即退出的问题。

## LC-4 start 后台启动与 daemon.log

**验收**

- 构建产物存在时 detached 启动，就绪后退出 0，输出 PID / Web / 日志。
- 已运行 / 并发 `start` 不启动第二个实例，退 0。
- 缺构建产物退 1 并提示 `pnpm build`；端口占用 / 超时清理本次子进程。
- `daemon.log` 0600、有界、不写秘密；`LARNESS_PM2_AUTO_INSTALL` 保留。
- 关闭终端后 `/api/health` 仍 200。

**测试**

- fixture 子进程集成；真实构建后手动全流程。

**备注**

- 2026-11-28 完成。fixture 验证 detached 启动、幂等、缺构建拒绝；手动 `start → status → restart → stop` 通过，start 的 shell 退出后服务仍存活。

## LC-5 stop / restart 与 IPC source

**验收**

- `stop` 走 IPC 优雅关闭，等待锁 / IPC / 端口释放，退 0；未运行幂等 0。
- IPC 不可达时不杀进程、不删锁，退 1 并给出手动命令。
- `restart` 先停后起；停止失败不启动；dev 实例拒绝。
- 审计区分 `source=cli` / `tui`。

**测试**

- 真实 `startServer` + CLI stop 集成；重启路径；审计断言。

**备注**

- 2026-11-28 完成。真实 server 经 IPC 停止并释放锁 / token；IPC 不可达不杀进程；`restart` 更换 pid。

## LC-6 TUI 附加模式、菜单与退出文案

**验收**

- `tui` 只附加；未运行退 3 并提示 `larness start`；无 TTY 退 1。
- `q` / Ctrl+C 只退出面板，退 0，服务与在途 Turn 继续。
- 菜单拆为“停止服务”（确认后 IPC shutdown）与“退出面板”；前台受管模式保持原语义。
- 退出确认默认选中“取消”，光标位置与 Enter 的实际动作一致（前台受管与附加模式均是）。
- 服务被外部停止时明确提示，不打印异常堆栈。

**测试**

- PTY 测试；dashboard 文案单元测试；退出后健康检查。

**备注**

- 2026-11-28 完成。PTY 附加 → 菜单显示“停止服务 / 退出面板” → 退出面板后 status 仍 running；`onClose` 使服务被外部停止时及时退出。
- 2026-11-28 用户实机发现退出确认的光标与动作相反（默认光标停在“退出面板”但 Enter 取消，移到“取消”后 Enter 才退出），前台受管模式的确认页还同时缺少光标。改为“取消/确认项”统一由 `confirmExit` 决定光标（默认取消），与停止服务确认页一致；同时去掉菜单与选项里的“（服务继续运行）”。新增 2 项回归测试（附加 / 前台各一项，先红后绿），`test/tui` 57 项通过。

## LC-7 dev 边界与 supervisor 清理

**验收**

- `pnpm dev` 参数、热更新与环境不变；锁写 `mode=foreground`、`dev=true`。
- `status` 标注前台 dev 并警告关闭终端会停止；`start` 报告已在运行。
- `tui` 可附加并标注；`stop` 使 supervisor 清理 Vite 并退出，不打印堆栈。
- `restart` 对 dev 拒绝。

**测试**

- `pnpm dev` + CLI `stop` 集成；supervisor 生命周期测试。

**备注**

- 2026-11-28 完成。PTY `pnpm dev` → `status` 显示 `foreground (dev)`、无 daemon.log → CLI `stop` 后 TUI 退出 0、显示“服务已停止”、无异常堆栈。

## LC-8 契约、安装文档与整仓验证

**验收**

- 更新 `runtime-entry.md`、`tui.md`、`ipc.md`、`install.md`、`README.md`、`known-limitations.md`、`AGENTS.md` §2。
- `pnpm check`、`pnpm build`、PTY / E2E 按范围通过；未运行项如实记录。
- macOS / Windows 实机结论记录；未验证平台不标通过。
- `STATUS.md` / `ROADMAP.md` 状态一致。

**备注**

- 2026-11-28：契约、安装、README、已知限制、架构概览与 AGENTS §2 已更新。
- 2026-11-28 复跑门禁：`pnpm check` 通过（biome 821 文件、server 193 文件 / 1069 通过 / 15 跳过、web 全量通过）；`pnpm build` 通过（server 19 产物含 `dist/cli.js`、web 构建成功）。
- 2026-11-28 `pnpm test:e2e`（Mock Chromium）：25/25 通过。
- 2026-11-28 `LARNESS_E2E_PORT=3310 pnpm test:e2e:prod`（真实 Server + 内置 FakeProvider）：12/20 通过，8 项失败**全部**是 `e2e-auth` 落后于已发布产品行为，与本切片无关：期望的 “Agent Profile” 切换已由 094 移除、“设置与模型” 已改名 “模型与凭据”、Toast 改为固定层后断言 `position: fixed` 失效；其余为同类过期或时序断言。记录为 [Q-096](../../docs/open-questions.md)，不修改测试、不宣称 prod E2E 通过。
- 2026-11-28 复跑中发现并修复 `status` 混合版本缺陷：运行中的旧管理面不返回新增字段时，人读摘要读取 `formalServices.note` 抛错（`Cannot read properties of undefined`）。改为按字段回退到本地只读快照，`mode` 缺失显示 `unknown`；新增 `apps/server/test/cli/status.test.ts` 4 项（先红后绿），并用真实运行实例验证 `node app.js status` 退 0。
- 2026-11-28 用户在 Windows 实机验证通过（`start` / `stop` / `tui` / `status` / `logs` 及本次退出确认修复），Windows 阻塞项据此关闭；本文只记录用户确认的结果，不推断未测版本与路径。
- E2E 范围：`test:e2e`（Mock）通过；`test:e2e:prod` 的 8 项失败按 [Q-096](../../docs/open-questions.md) 处理，未改测试、未宣称通过。
