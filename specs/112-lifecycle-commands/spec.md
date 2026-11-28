---
id: 112-lifecycle-commands
title: 服务生命周期命令（start / stop / tui / status / logs）
milestone: 发布后
status: ready
depends_on: [017-unified-entry, 050-deploy]
owners: [human]
created: 2026-11-28
updated: 2026-11-28
---

# 112 服务生命周期命令（start / stop / tui / status / logs）

> 状态：`ready`（2026-11-28 用户确认 Q-086～Q-095 与 `logs --follow`，同日批准 ADR-077）。LC-1～LC-7 已实现并通过 `pnpm check` / `pnpm build`；LC-8 待 Windows 实机与 Playwright E2E 收口。
> 实现按 [tasks.md](tasks.md) 一次一个任务推进；[plan.md](plan.md) 记录拆分与验证门禁。
> 冻结依据：[ADR-023](../../docs/adr/ADR-023-tui-as-managed-entry.md)、[ADR-028](../../docs/adr/ADR-028-unified-dev-entry.md)、[ADR-046](../../docs/adr/ADR-046-pm2-delivery-and-lifecycle.md)、[运行入口契约](../../docs/contracts/runtime-entry.md)、[TUI 契约](../../docs/contracts/tui.md)、[IPC 契约](../../docs/contracts/ipc.md)。

## 1. 背景与问题

当前产品入口是前台受管 TUI：`larness` / `node app.js` / `pnpm dev` 由 TUI 以 supervisor 身份启动 Server（开发时另起 Vite），关闭 TUI 停止全部（ADR-023、ADR-028）。`larness status` / `doctor` 是只读子命令。

用户提出的目标模型与 [larness.md §16.1](../../larness.md) 和 [§35.1.4](../../larness.md) 的原始设计一致：

```bash
larness start    # 启动服务
larness stop     # 关闭服务
larness tui      # 打开 TUI 控制面板
larness status   # 查看服务状态
larness logs     # 查看最近日志
```

现在的问题：

1. **关闭终端会中断工作**：关闭 TUI 即停止管理面、临时开发资源和在途 Turn；长时间 Agent 任务不应因为关掉控制面板而被取消。
2. **命令语义与名字不符**：`app.js` 把 `start` 当 `tui` 的别名（`app.js:110`），`larness tui` 实际也是启动全部，而不是附加到已运行实例。
3. **缺少显式停止入口**：没有 `larness stop`；只能退出 TUI、Ctrl+C 或直接发信号。
4. **状态输出不适合日常查看**：`larness status` 固定输出 JSON，无法一眼读出“是否在运行、地址、PID、正式服务是否受影响”。
5. **已有基础未接线**：TUI 已有 IPC 附加分支（`apps/server/src/tui/main.ts:118`）、`server.shutdown`（`apps/server/src/ipc/handlers.ts:300`）、实例锁与状态采集；本切片是把它们组合成稳定的命令行生命周期，而不是重写运行时。
6. **裸命令语义含糊**：不带参数的 `larness` 直接进入前台受管 TUI，用户无从发现 `stop` / `status` / 日志入口。
7. **日志只能翻文件**：`larness.log` 是 pino JSON 行，后台启动后还会新增 stdout/stderr 日志，日常排查需要先知道路径与格式。
8. **dev 与产品入口关系未写明**：`pnpm dev`（Vite + 源码 Server）与打包运行的差异、哪些命令能作用于 dev 实例，当前只写在实现和测试里。

## 2. 目标

- G-1：`larness start` 在后台启动管理面（Server；打包模式由 Server 直接提供已构建 Web），等待就绪后返回，退出终端不结束服务。
- G-2：`larness stop` 通过本机 IPC 优雅停止管理面，释放端口、锁与 IPC；不停止 PM2 守护和正式服务。
- G-3：`larness tui` 只附加到运行中的管理面；退出 TUI（`q` / Ctrl+C）不再停止服务，在途 Turn 继续。
- G-4：`larness status` 默认给出可读摘要，`--json` 保留机器可读输出；明确区分管理面与 PM2 正式服务。
- G-5：所有命令共享同一数据目录、实例锁、IPC 权限和审计；同一数据目录最多一个管理面实例。
- G-6：裸 `larness` / `node app.js` 只打印命令帮助（等价 `--help`），不启动服务、不附加 TUI、不产生副作用。
- G-7：认证、设备配对、WebAuthn、REST / WS 权限、PM2 部署契约零放宽；`start` 不自动初始化、不自动批准设备。
- G-8：`larness logs` 提供有界、脱敏的最近日志查看，未运行实例时也能用，不新增远程入口。
- G-9：显式定义 dev 模式：`pnpm dev` 保持前台受管（Vite + 源码 Server，退出即停止）；`larness start` 只运行打包产物，不启动 Vite、不加载源码入口。

## 3. 非目标

- NG-1：不实现开机自启、登录自启、launchd / systemd / Windows 服务注册，也不做崩溃自动重启（见 Q-093）。
- NG-2：不提供远程 CLI、远程启停、HTTP 管理接口或新的 TCP 监听。
- NG-3：不改变 PM2 正式服务的交付、替换、健康检查、日志与授权模型；`stop` 不调用 `pm2 kill` 或停止正式服务（见 Q-086）。
- NG-4：不改变 Web / REST / WS / IPC 的认证与授权规则；不新增“免 TUI 初始化”或“Web 自助配对”。
- NG-5：不把 `stop` 实现成“杀进程”；IPC 不可达时的强制终止不在 v1（见 Q-092）。
- NG-6：不新增 `larness attach`、`larness open`、`--foreground`、`--daemonize` 等命令或参数；`logs` 只做 Q-095 限定的只读尾部查看与 `--follow`。
- NG-7：`start` 不启动 Vite、不运行 `src` 入口、不改变 `pnpm dev` 的前台受管体验（见 Q-088、§7.7）。
- NG-8：不改变 TUI 的页面结构、配对 / 设备 / 日志 / 审计的读取契约；只改退出语义、菜单文案与附加模式下的连接行为。
- NG-9：不改变 Agent Turn 的取消语义：`stop` 仍会优雅关闭 Server 并取消在途 Turn，只是不再由“关面板”隐式触发。
- NG-10：不引入新的运行时依赖；后台启动使用 Node 内置能力。
- NG-11：`logs` 不提供级别 / 时间过滤、日志上传或通过 IPC 读其他数据目录的日志；`--follow` 只跟随当前进程已选定的单个文件（见 Q-095）。
- NG-12：不把 dev 实例“升级”为后台实例：`restart` 遇到 dev 实例时拒绝，不在用户未预期时切换运行形态（见 Q-094）。

## 4. 用户故事

- 作为长时间运行 Agent 任务的用户，我希望关掉 TUI 或终端后任务继续跑，浏览器仍然可用。
- 作为运维者，我希望用脚本可靠地 `start` / `stop` / `status`，不依赖交互式终端。
- 作为本机操作者，我希望随时打开 TUI 审批新设备，而不是为了审批先重启服务。
- 作为开发者，我希望 `pnpm dev` 的热更新与前台调试体验保持不变，并清楚哪些命令可以作用于这个实例。
- 作为安全负责人，我希望后台化不新增远程入口、不自动放行设备、不把秘密写进日志。
- 作为排查问题的用户，我希望不进 TUI 就能看到最近的、脱敏的日志尾部。

## 5. 验收场景

### A1 冷启动后台运行

```gherkin
Given 打包形态（存在 apps/server/dist/index.js）、临时数据目录、没有运行实例
When 执行 larness start
Then 命令在管理面就绪后以 0 退出，输出 PID、Web 地址和日志路径
And larness status 显示 running=true
And 关闭执行 start 的终端后，/api/health 仍返回 200
And start 不进入 TUI
```

### A2 重复与并发启动

```gherkin
Given 同一数据目录已有运行实例
When 再次执行 larness start，或两个 start 并发执行
Then 只存在一个管理面实例和一个监听端口
And 后到的命令输出“已在运行”、PID 与 Web 地址，并以 0 退出
And 不重启、不修改现有实例的配置或数据
```

### A3 附加与退出 TUI

```gherkin
Given 管理面已在运行
When 执行 larness tui，然后按 q 或 Ctrl+C
Then TUI 以 0 退出，footer 与退出提示说明“服务继续运行”
And Server、业务 WS 和已认证浏览器会话仍可用
And 审计中不出现因退出 TUI 触发的 server.shutdown
```

### A4 长任务跨 TUI 退出继续

```gherkin
Given 已认证会话中存在一个由测试 Provider 驱动的在途 Turn，TUI 已附加
When 退出 TUI
Then 该 Turn 继续执行到终态，事件正常持久化
And 不产生 turn.interrupted
And 重新执行 larness tui 能看到该 Turn 的结果
```

### A5 显式停止管理面

```gherkin
Given 管理面在运行，且存在一个 PM2 正式服务
When 执行 larness stop
Then 管理面优雅关闭，端口、实例锁和 IPC 端点释放，命令以 0 退出
And PM2 守护与正式服务仍在线
And 输出明确说明“管理面已停止；PM2 正式服务继续运行”
And 输出提前说明停止会中断在途 Turn、终端与临时开发服务
And 再次执行 larness stop 时输出“未运行”并以 0 退出
```

### A6 未初始化实例

```gherkin
Given 一个尚未初始化的临时数据目录
When 执行 larness start，再执行 larness tui
Then start 以“已就绪、未初始化”返回，业务 API 仍不开放
And TUI 进入现有初始化向导，初始化只经本机 IPC 完成
And 若初始化修改了监听地址或端口，TUI 提示执行 larness restart，而不是静默停服或假装已生效
```

### A7 启动失败清理

```gherkin
Given 目标端口已被其他进程占用
When 执行 larness start
Then 命令以非 0 退出，不进入 TUI
And 不留下锁、监听端口或本次启动的子进程
And 输出有界、已脱敏的失败原因和日志路径
```

### A8 停止失败不误杀

```gherkin
Given 实例锁显示 PID 存活，但本机 IPC 无法连接
When 执行 larness stop
Then 命令以非 0 退出，并报告 PID、数据目录和手动终止命令
And 不向该 PID 发送信号，不删除锁文件
And larness status 仍显示“运行状态未知/不可核验”并给出警告
```

### A9 非 TTY 与无运行实例

```gherkin
Given 没有运行实例或当前不是 TTY
When 执行 larness tui
Then 未运行时以“未运行，请先 larness start”提示退出，非 TTY 时以“需要交互终端”提示退出
And 不创建数据目录、数据库、日志或任何子进程
```

### A10 状态输出与退出码

```gherkin
Given 管理面运行中、未初始化或未运行
When 执行 larness status 或 larness status --json
Then 默认输出可读摘要，--json 输出稳定字段
And 运行中退出码为 0，未运行为 3，读取失败为 1
And 输出不包含配对码、Cookie、Token、API Key 或初始化密钥
And 若运行中的管理面是旧版本、IPC 未返回 dataDir / mode / dev / 日志路径 / formalServices，
    按本地只读快照补齐，人读摘要不崩溃，mode 显示 unknown
```

### A11 配置变更与重启

```gherkin
Given 管理面在运行，TUI 中修改了监听地址或端口并保存
When 执行 larness restart
Then 先优雅停止再以同一数据目录启动，新配置生效
And 若停止失败则不启动新实例，命令以非 0 退出
And 未运行时 larness restart 等价于 larness start
```

### A12 设备配对不被后台化绕过

```gherkin
Given TUI 未打开，浏览器发起新的配对申请
When 等待一段时间后执行 larness tui
Then 该申请保持 pending，未自动批准
And TUI 仍显示来源、编号与允许本次/始终允许/拒绝选项
And 过期申请不会被重新激活，Web 不能自行批准
```

### A13 前台开发实例的停止

```gherkin
Given 通过 pnpm dev 启动的前台受管实例正在运行
When 在另一个终端执行 larness stop
Then Server 优雅关闭，前台 supervisor 清理本次 Vite 并退出
And TUI 显示“服务已停止”而不是内部错误堆栈
And 不停止 PM2 正式服务
```

### A14 裸命令只打印帮助

```gherkin
Given 当前目录没有运行实例，或已有运行实例
When 执行不带参数的 larness 或 node app.js
Then 打印与 larness --help 一致或等价的使用说明，包含 start / stop / tui / status / logs
And 不启动 Server、不创建数据目录 / 数据库 / 日志、不启动子进程、不连接 IPC
And 以 0 退出
```

### A15 日志尾部查看

```gherkin
Given 数据目录中存在 larness.log（可能还有后台 daemon 日志）
When 执行 larness logs、larness logs --lines 50、larness logs --daemon
Then 默认输出最近 200 行（或更少），按时间顺序、最新在后
And --lines 接受 1–1000，超出范围按用法错误退出 2
And 输出已脱敏，不包含配对码、Cookie、Token、API Key、初始化密钥
And 管理面未运行时仍可读取；日志文件不存在时提示“暂无日志”并以 3 退出
And 不提供过滤、上传或其他数据目录的日志
```

### A15b 日志跟随

```gherkin
Given 主日志或后台日志文件存在
When 执行 larness logs --follow 或 larness logs --daemon --follow
Then 先输出与不带 --follow 相同的尾部，然后持续输出新追加的行
And Ctrl+C 结束跟随并以 0 退出，不停止管理面
And 跟随只针对启动时选定的文件，不切换到轮转后的新文件或另一个来源
```

### A16 dev 实例的命令边界

```gherkin
Given 通过 pnpm dev 启动的前台受管实例正在运行（Vite + 源码 Server）
When 执行 larness status、larness start、larness tui、larness restart
Then status 显示 mode=foreground、dev=true，并警告关闭前台终端会停止服务；退出 0
And start 报告“已在运行”，不启动 Vite、不产生第二个实例；退出 0
And tui 可以附加，但 footer 标明“前台 dev 实例”，q / Ctrl+C 只退出面板
And restart 拒绝执行并以非 0 退出，提示在 pnpm dev 终端重启；不切换为打包后台实例
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 提供 `start`、`stop`、`tui`、`status`、`logs` 五个稳定子命令；`doctor`、`--version`、`--help` 保持可用。 |
| R-2 | MUST | `start` 在后台启动管理面；进程必须脱离当前终端会话，stdin 不连接终端，stdout/stderr 写入数据目录下的有界日志。 |
| R-3 | MUST | `start` 必须等待管理面就绪（IPC 可连接且 `/api/health` 成功）后才以 0 返回；就绪前失败按 §10 清理并返回非 0。 |
| R-4 | MUST | `start` 是幂等的：同数据目录已有健康实例时报告 PID/地址并以 0 返回，不启动第二个实例。 |
| R-5 | MUST | `stop` 必须优先通过本机 IPC `server.shutdown` 请求优雅关闭，并等待锁/端口/IPC 释放；不得把杀 PID 作为正常路径；输出必须提示会中断在途 Turn、终端与临时开发服务。 |
| R-6 | MUST | `stop` 不得停止 PM2 守护或 PM2 正式服务，也不得调用 `pm2 kill`；输出必须说明这一点。 |
| R-7 | MUST | `tui` 只附加到运行中的管理面；不负责启动 Server / Vite。未运行时以稳定提示和非 0 退出码失败。 |
| R-8 | MUST | 附加模式的退出（`q` / Ctrl+C）只断开 TUI，不发送 `server.shutdown`；TUI 文案、footer 与最终输出必须与服务实际状态一致。 |
| R-9 | MUST | `tui` 在附加模式下检测到服务被外部停止时，以明确提示退出，不显示未处理异常；服务崩溃且锁仍存活时以非 0 退出并提示日志路径。 |
| R-10 | MUST | `status` 默认人读摘要；`--json` 输出稳定、可解析的 `StatusReport`。若 IPC 端是旧版本管理面、未返回新增字段，必须按本地只读快照补齐（`mode` 缺失按 `unknown`），不得崩溃或输出残缺对象。退出码按 §7.2。 |
| R-11 | MUST | 所有命令使用同一数据目录解析规则（`LARNESS_DATA_DIR` / 平台默认）；`status` 必须显示实际数据目录，避免多目录误判。 |
| R-12 | MUST | 同一数据目录仍由现有实例锁保证单实例；并发 `start` 不能让两个进程同时服务。 |
| R-13 | MUST | 新增 `restart`（Q-089 确认后）：先 `stop` 再 `start`；停止失败不得继续启动；当前实例为 dev 前台时拒绝并提示在 `pnpm dev` 终端重启（Q-094）。 |
| R-14 | MUST | `start` 不得跳过初始化、不得自动批准配对、不得放宽认证；后台运行不改变现有 REST / WS / IPC 权限。 |
| R-15 | MUST | 后台启动必须保留受管入口现有的 PM2 初始化环境（`LARNESS_PM2_AUTO_INSTALL` 默认 `1`），避免正式服务管理静默不可用。 |
| R-16 | MUST | 后台日志必须位于数据目录，权限与现有日志一致（0600/用户级 ACL），有界轮转并沿用脱敏规则；不得新增明文秘密落盘。 |
| R-17 | MUST | `tui` 必须要求 TTY；`start`、`stop`、`status` 必须可在非 TTY 环境运行。 |
| R-18 | MUST | 裸 `larness` / `node app.js` 只打印命令帮助（等价 `--help`），以 0 退出；不启动 Server、不创建数据目录 / 数据库 / 日志、不启动子进程、不连接 IPC。 |
| R-19 | MUST | dev 模式：`pnpm dev` 保持现有前台受管 TUI（Vite + 源码 Server，退出即停止）；`start` 只运行打包后的 Server 与已构建 Web，不启动 Vite、不加载 `src`，缺少构建产物时拒绝并提示 `pnpm build` 或 `pnpm dev`（见 §7.7）。 |
| R-20 | MUST | TUI 菜单与快捷键按模式区分：附加模式提供“停止服务”和“退出面板（服务继续运行）”；前台受管模式保持“退出并停止服务”。 |
| R-21 | MUST | 附加模式下初始化保存后若需重启，只显示明确指引（`larness restart`），不得静默停止服务或假装新配置已生效。 |
| R-22 | MUST | `server.shutdown` 审计必须能区分 CLI `stop` 与 TUI 退出/停止；审计不得包含秘密。 |
| R-23 | MUST | Windows 原生行为必须实机验证：关闭终端后后台进程仍存活、`stop` 可优雅关闭、无 POSIX 信号时仍走 IPC。 |
| R-24 | MUST | 变更必须同步 `runtime-entry`、`tui`、`ipc` 契约与安装 / 升级文档；不得让文档继续宣称“关闭 TUI 停止全部”。 |
| R-25 | MUST | `logs` 默认输出最近 200 行主日志，`--lines 1–1000` 限定行数，`--daemon` 读取后台 stdout/stderr 日志；按时间顺序、最新在后；`--follow` 只跟随已选定的单个文件，Ctrl+C 结束，不做过滤 / 上传。 |
| R-26 | MUST | `logs` 失败关闭且不泄露秘密：只读取当前数据目录下的已知日志文件，输出沿用现有脱敏；不执行、不求值日志内容；文件不存在以 3 退出，读取失败以 1 退出。 |
| R-27 | MUST | 未运行实例时 `logs` / `status` 仍可用；`start` / `stop` / `logs` / `status` 必须可在非 TTY 环境运行，交互与颜色在非 TTY 自动关闭。 |

## 7. 接口与契约变更

### 7.1 命令行行为

| 命令 | 行为 | 退出码 |
|---|---|---|
| `larness` | 打印命令帮助（等价 `--help`）；不启动、不创建数据目录、不连接 IPC | 0 |
| `larness start` | 后台启动管理面并等待就绪；已运行则报告现状 | 0 / 1 / 2 |
| `larness stop` | 优雅停止管理面；未运行视为成功 | 0 / 1 / 2 |
| `larness restart` | 先 stop 再 start；未运行等价 start；dev 实例拒绝 | 0 / 1 / 2 |
| `larness tui` | 附加到运行中的管理面 | 0 / 1 / 2 / 3 |
| `larness status` | 默认人读摘要；`--json` 机器可读 | 0 / 1 / 2 / 3 |
| `larness logs` | 最近日志尾部；`--lines N`、`--daemon`、`--follow` | 0 / 1 / 2 / 3 |
| `larness doctor` | 保持现有本机诊断 | 0 / 1 / 2 |

### 7.2 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功；`start` 发现已在运行、`stop` 发现未运行也算成功 |
| 1 | 启动、停止、读取或运行失败 |
| 2 | 用法错误（未知参数、非法组合） |
| 3 | 目标未运行或没有可读日志（仅 `tui` / `status` / `logs`） |

`tui` 先检查 TTY：不是 TTY 时退出 1，不连接；是 TTY 但目标未运行时退出 3。`logs` 在日志文件不存在时退出 3，存在但不可读时退出 1。

### 7.3 IPC

- `server.shutdown` 继续要求 `confirm: true`；新增可选 `source: "cli" | "tui"`，缺省按旧客户端处理（视为 `tui`）。服务端只接受枚举值，写审计时使用该来源。
- 不新增 `server.start` / `server.restart`；`restart` 由 CLI 组合 `stop` + `start` 完成。
- `tui` 继续使用现有 `hello` / `system.ping` / `system.status` / 初始化 / 配对 / 设备 / 日志 / 审计方法。
- `logs` 不新增 IPC 方法，直接读取当前数据目录下已知日志文件；`logs.tail` 保持现有 TUI 语义，两者互不替代。
- 允许多个 TUI 客户端同时附加；写操作仍由服务端状态和现有授权决定，不引入客户端间锁。

### 7.4 `StatusReport`

在现有字段上增加（追加，不改变既有字段语义）：

- `dataDir: string`
- `mode: "foreground" | "background" | "unknown" | null`
- `dev: boolean`（当前实例是否由 `pnpm dev` 的 Vite + 源码 Server 启动；打包模式为 `false`）
- `logPath: string | null`（主日志 `larness.log`）
- `daemonLogPath: string | null`（后台 stdout/stderr 日志；前台模式为 `null`）
- `formalServices: { managedSeparately: true; note: string }`（固定说明，不查询 PM2；避免 CLI 依赖认证接口）

实例锁记录增加可选的 `mode` 与 `dev` 字段；旧锁缺少这些字段时按 `unknown` / `false` 读取，不拒绝启动。

### 7.5 配置与环境

- 不新增用户配置文件键。
- 内部环境变量 `LARNESS_LIFECYCLE_MODE=background` 由 `start` 注入，用于写锁和状态；不得作为用户行为开关。
- dev 前台模式由受管 TUI 注入 `LARNESS_LIFECYCLE_MODE=foreground` 与 `LARNESS_RUNTIME_DEV=1`，用于写锁与 `status`；两者都是内部约定，不作为用户开关，也不改变业务行为。
- `start` 继承现有 `LARNESS_*` 数据目录 / 配置覆盖，并像受管 TUI 一样设置 `LARNESS_PM2_AUTO_INSTALL`（用户显式值优先）。
- 后台 stdout/stderr 日志路径固定为 `<dataDir>/logs/daemon.log`（或等价文件名，实施前固定），与 `larness.log` 同目录、同权限策略。
- `logs` 只读取 `<dataDir>/logs/larness.log` 与上述后台日志；不接受任意路径参数，不读取其他数据目录。

### 7.6 文档与契约

必须同步：

- `docs/contracts/runtime-entry.md`：命令表、后台进程模型、就绪判定、日志与退出码。
- `docs/contracts/tui.md`：附加模式退出语义、footer、菜单、初始化重启指引、并发 TUI 客户端。
- `docs/contracts/ipc.md`：`server.shutdown` 的 `source`、附加语义、多个 TUI 客户端。
- `docs/guides/install.md`、`README.md`、`docs/architecture/overview.md`：安装后的启动 / 停止 / 升级流程。
- `docs/known-limitations.md`：无开机自启、无崩溃自动重启、`stop` 不停 PM2 正式服务、Windows 无 POSIX 信号。
- `AGENTS.md` §2：TUI 不再被描述为“关闭即停止全部”的唯一受管前台入口；以 ADR-077 为准。
- 命令帮助：`larness --help` 与裸命令输出同一份命令表，包含五个子命令、退出码与环境变量说明，不再写“关闭 TUI 停止全部”。

### 7.7 开发模式（dev）行为

现状（2026-11-28 代码事实）：

- 入口固定为 `pnpm dev` → `pnpm --filter @larness/server run tui:dev` → `tsx src/tui/main.ts --managed --dev`。
- `dev=true` 时 supervisor 先起 Vite wrapper（`node --import tsx apps/web/scripts/managed-vite.ts`，cwd `apps/web`，OS 分配 127.0.0.1 端口，经私有 IPC 回报 `dev-web.ready`），再起源码 Server（`node --import tsx src/index.ts --managed-dev-web`，注入 `LARNESS_SERVE_WEB=0`、`LARNESS_TUI_CHILD=1`、`LARNESS_PM2_AUTO_INSTALL` 默认 `1`、`LARNESS_LOG_STDERR=0`），并发送 `dev-web.attach`。
- 就绪判定：`/api/health`、`/` 返回 HTML（Host 为 canonical origin）、`/@vite/client` 可访问、Vite 进程存活、IPC token 存在；任一步失败整组清理。
- Vite 退出或控制通道断开视为 dev 运行环境失败，supervisor 停止本次 Server 与其余子进程，不退回静态 dist。
- `app.js` 只有在存在 `apps/server/dist/tui.js` 时才走打包分支；源码模式回退到 `--managed --dev`。

112 后的边界：

| 能力 | `pnpm dev`（dev 前台） | `larness start`（打包后台） |
|---|---|---|
| Server | `src` + tsx | `apps/server/dist/index.js` |
| Web | Vite dev server + HMR，经 Server 转发 | 已构建 `apps/web/dist` 静态资源 |
| 进程形态 | 前台 supervisor，与 TUI 同终端 | detached 后台进程，无 TUI |
| 关闭终端 / 退出前台 TUI | 停止 Server 与 Vite | 不影响服务 |
| `stop` | 支持（A13）；supervisor 清理 Vite 并退出 | 支持 |
| `restart` | 拒绝（Q-094） | 支持 |
| `tui` | 允许附加，标注“前台 dev 实例” | 允许附加 |
| `status` | `mode=foreground`、`dev=true` | `mode=background`、`dev=false` |
| 日志 | `larness.log` + TUI 环形缓冲 | `larness.log` + `daemon.log` |

- D-1：`pnpm dev` 的参数、热更新、终端体验与环境变量不变；不新增 `--background`，不读取 `LARNESS_LIFECYCLE_MODE`。
- D-2：`start` 只运行打包产物，不启动 Vite、不加载 `src`。缺少 `apps/server/dist/index.js` 或 `apps/web/dist/index.html` 时以非 0 退出，提示 `pnpm build`（打包运行）或 `pnpm dev`（开发调试）。
- D-3：dev 实例运行时执行 `start`，报告“已在运行”（`mode=foreground`、`dev=true`）并以 0 退出；不启动第二个实例、不抢端口。
- D-4：`tui` 可以附加 dev 实例；footer 与标题标明“前台 dev 实例（pnpm dev）”，`q` / Ctrl+C 仍只退出面板；菜单中的“停止服务”需确认，并明确会结束前台 supervisor 与 Vite。
- D-5：`stop` 对 dev 实例仍走 IPC `server.shutdown`；前台 TUI 检测到 `serverExited` 后清理 Vite、恢复终端，显示“服务已停止”，不打印异常堆栈。
- D-6：`restart` 对 dev 实例拒绝并以非 0 退出，提示在 `pnpm dev` 终端重启；不得静默把开发会话切换成打包后台实例。
- D-7：dev 实例没有 `daemonLogPath`；`logs --daemon` 输出“暂无后台日志”并以 3 退出，不回退到 TUI 内存缓冲。
- D-8：dev 的转发、CSP、HMR 与 `/_larness/dev/*` 规则完全沿用 [运行入口契约](../../docs/contracts/runtime-entry.md)，本切片不修改。
- D-9：打包前台受管 TUI 不再是产品入口；`startManagedRuntime` 的打包分支只保留给 smoke / 测试与后台启动的内部复用，不新增 headless daemon 概念。
- D-10：`larness` 与 `node app.js` 语义一致；`node app.js start` 不再是 TUI 别名，而是后台启动（源码检出无构建时按 D-2 失败）。

## 8. 数据与迁移

- 无数据库表 / 列 / 索引变更，无 schemaVersion 变更。
- 实例锁 `larness.lock` 只追加可选字段（`mode`、`dev`）；旧记录可读，新记录可被旧版本忽略。不得因缺字段拒绝启动。
- 新增后台日志文件，沿用现有日志目录、权限、轮转与脱敏；不写入数据库。`logs` 只读，不新增索引或游标。
- 备份、降级、更新流程不变；升级前由文档要求先 `larness stop`。

## 9. 安全、权限与审计

- **本机边界**：所有新命令只通过本机 IPC 与文件系统工作，不新增监听端口；`start` / `stop` 不提供远程调用。
- **执行身份**：CLI 以当前 OS 账户运行，使用现有 0600 IPC token；不新增提权、不读取其他用户的数据目录。
- **命令注入**：`start` 只启动固定的 Server 入口，不经过 shell，不接受用户提供的脚本路径或任意参数；不得把秘密放入 argv。
- **设备准入**：后台化不改变 ADR-006；TUI 未打开时新配对申请保持 pending，`start` 不自动批准。
- **审计**：`server.shutdown` 记录来源（CLI / TUI）与结果；不记录配对码、Cookie、Token、API Key。
- **秘密**：后台日志、启动失败输出、`status`、`logs` 与 `doctor` 继续使用现有脱敏；`status` 只显示会话计数，不显示凭据；`daemon.log` 写入前必须过与 `larness.log` 相同的脱敏，不能只靠终端展示层。
- **日志读取**：`logs` 只读当前数据目录下的固定文件名，不跟随符号链接到目录外，不执行内容；单次读取上限 1000 行 / 1 MiB，超出截断并提示。
- **PM2 边界**：`stop` 不操作 PM2 守护与正式服务；后台启动必须保留 PM2 初始化，避免“服务管理不可用但不报错”。
- **失败关闭**：状态无法核验时报告“未知/不可核验”，不假装已停止；不自动删除存活进程的锁。
- **Windows**：使用 IPC 优雅关闭；强制终止仅作为文档中的手动兜底，不由 `stop` 自动执行。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 同一数据目录已运行 | 不启动第二个实例 | “已在运行”、PID、Web 地址；退出 0 |
| 两个 `start` 并发 | 锁竞争，只有一个实例 | 后到者报告已有实例；退出 0；不重启 |
| 陈旧锁 | 沿用现有启动逻辑替换 | 提示陈旧锁 PID；继续启动 |
| 端口被占用 | 子进程退出，清理本次启动 | 非 0；脱敏原因 + 日志路径 |
| 启动超时 | 终止本次启动的已知子进程并清理 | 非 0；超时阈值与日志路径 |
| 未初始化 | Server 就绪但业务关闭 | `status` 显示未初始化；`tui` 进入向导 |
| `tui` 无 TTY | 不连接、不创建数据目录 | “需要交互终端”；非 0 |
| `tui` 无运行实例 | 不启动服务 | “未运行，请先 larness start”；退出 3 |
| TUI 附加时服务被 `stop` | 检测断开，区分正常停止 | “服务已停止”；退出 0，不打印异常堆栈 |
| TUI 附加时服务崩溃 | 锁仍存活则提示连接失败 | 非 0；日志路径；可重新 `tui` |
| `stop` 时未运行 | 幂等成功 | “未运行”；退出 0 |
| `stop` 时 IPC 不可达、锁显示存活 | 不发送信号、不删锁 | 非 0；PID + 手动命令 + 数据目录 |
| `stop` 优雅关闭超时 | 不强制杀死 | 非 0；提示进程可能仍在运行 |
| `restart` 停止失败 | 不启动新实例 | 非 0；保留原状态 |
| `restart` 遇到 dev 实例 | 拒绝，不切换运行形态 | 非 0；“请在 pnpm dev 终端重启” |
| `start` 遇到 dev 实例 | 不启动第二个实例、不启动 Vite | “已在运行（前台 dev）”；退出 0 |
| `logs` 无日志文件 | 不创建日志、不启动服务 | “暂无日志”；退出 3 |
| `logs` 文件不可读 | 不重试、不提权 | 非 0；路径与权限提示 |
| `logs --lines` 越界 | 不读取文件 | 提示 1–1000；退出 2 |
| `logs` 文件超过 1 MiB | 只读尾部并按上限截断 | 提示已截断；退出 0 |
| `logs --daemon` 无后台日志 | 不回退到主日志或内存缓冲 | “暂无后台日志”；退出 3 |
| `logs --follow` 文件被删除 / 轮转 | 输出已读取内容后提示文件已变更并退出 | 非 0 或明确提示；不切换到其他文件 |
| 裸 `larness` | 只打印帮助 | 命令、退出码、环境变量；退出 0 |
| 配置修改需重启 | TUI 只提示 | “请执行 larness restart”；不静默停服 |
| 日志写入失败 | 启动失败关闭 | 非 0；不继续无日志运行 |
| 数据目录不可写 | 启动失败 | 非 0；路径与权限提示 |
| Windows 关闭终端 | 后台进程继续 | 由实机验收确认；失败则不得宣称支持 |
| 主机重启 | 不自动恢复管理面 | 文档说明需重新 `start`；PM2 正式服务按既有能力 |

## 11. 可观测性

- **日志**：继续使用 pino + `larness.log`；新增后台 stdout/stderr 日志；启动、就绪、停止、超时、失败均记录结构化事件，包含 `pid`、`dataDir`、`mode`，不含秘密。`logs` 把主日志格式化为“时间 + 级别 + 消息”，`--daemon` 输出原始行；两者都保持最新在后。
- **状态**：`status` 显示运行状态、PID、启动时长、监听地址、数据目录、运行模式（前台 / 后台、是否 dev）、数据库 schema、IPC、会话计数、日志路径、警告与正式服务边界说明。
- **审计**：`server.shutdown` 记录来源；不新增业务事件。
- **诊断**：`doctor` 保持现有检查；如增加后台日志可读性检查，只做只读诊断，不自动修复。

## 12. 测试计划

- **单元**：
  - 参数解析、未知参数、`--json`、退出码；
  - 裸命令输出与 `--help` 一致，且不触碰文件系统；
  - `StatusReport` 人读格式化与 JSON 稳定性；
  - IPC 返回的 `StatusReport` 缺字段（旧管理面）时按本地快照补齐，`mode` 缺失显示 `unknown`；
  - 实例锁 `mode` / `dev` 缺省、未知、新值兼容；
  - 就绪轮询的超时、子进程提前退出、并发 `start`；
  - `logs` 行数解析与上限、主 / 后台日志选择、截断提示、脱敏输出；
  - TUI 模式判定与 footer / 菜单文案（附加 / dev 前台）。
- **集成（真实子进程，临时数据目录）**：
  - 构建产物 `start` → `status` → `tui`（PTY）→ 退出 TUI → 服务仍健康 → `stop` → 端口/锁/IPC 释放；
  - 重复 `start` / 并发 `start` / 重复 `stop`；
  - 端口占用、启动超时、数据目录不可写、日志写入失败；
  - IPC 不可达但锁存活的 `stop` 不杀进程；
  - `restart` 成功、停止失败不启动、dev 实例拒绝；
  - 未初始化实例的 `start` / `tui` / 初始化 / 重启指引；
  - 附加 TUI 时外部 `stop` 的退出表现；
  - `pnpm dev` 前台实例被 CLI `stop` 后 supervisor 与 Vite 清理；
  - `logs`：无文件、不可读、`--daemon` 缺失、行数超限截断、日志含测试用假秘密不输出。
- **E2E / 浏览器**：
  - 认证页面在 TUI 退出后仍可用；
  - 在途 Turn（测试 Provider）跨 TUI 退出继续到终态；
  - 新配对申请在 TUI 未打开时保持 pending，附加后可审批；
  - `stop` 后 Web / API / WS 不可达，PM2 正式服务仍可用（使用现有 fixture）。
- **手动 / 平台**：
  - macOS Apple Silicon：关闭终端后后台进程存活；`start/stop/status/tui` 全流程。
  - Windows 11 / Windows 10：PowerShell / cmd 下 detached 启动、关闭终端存活、`stop`、无 POSIX 信号路径；必要时用 `taskkill` 手动兜底。
  - `npm pack` + 临时全局安装，验证 bin / 五个命令 / 构建产物齐全。
- **门禁**：实现阶段每个任务跑定向测试；跨包改动完成后 `pnpm check`、`pnpm build`；涉及 TUI 的 PTY 测试与既有 `test:e2e*` 按任务范围执行，未运行项如实记录。

## 13. 开放问题

| 问题 | 推荐默认 | 需要谁决策 |
|---|---|---|
| Q-086 `stop` 是否同时停止 PM2 正式服务？ | 只停管理面；PM2 守护与正式服务继续运行，输出明确说明 | 人类负责人 |
| Q-087 TUI 的 `q` / Ctrl+C 语义？ | 附加模式只退出面板；新增独立“停止服务”菜单；`pnpm dev` 前台模式保持退出即停止 | 人类负责人 |
| Q-088 v1 是否支持源码 / dev 后台 `start`？ | 不支持；`pnpm dev` 保持前台受管，打包模式才支持后台 | 人类负责人 |
| Q-089 是否新增 `larness restart`？ | 新增；初始化改监听配置与升级都需要，避免要求用户手动两步 | 人类负责人 |
| Q-090 裸 `larness` / `node app.js` 的行为？ | 只打印命令帮助（等价 `--help`），以 0 退出，不启动 / 不创建数据目录 / 不连接 IPC；`node app.js start` 改为后台启动语义 | 人类负责人 |
| Q-091 `status` 默认格式与退出码？ | 默认人读 + `--json`；运行 0、未运行 3、读取失败 1 | 人类负责人 |
| Q-092 `stop` 在 IPC 不可达时是否提供 `--force`？ | v1 不提供；只报告 PID 与手动终止命令，避免 PID 复用误杀 | 人类负责人 |
| Q-093 是否做开机自启或崩溃自动重启？ | 都不做；主机重启后需手动 `start`，PM2 正式服务按既有能力 | 人类负责人 |
| Q-094 dev 实例与生命周期命令的边界？ | `pnpm dev` 保持前台受管；`start` 只跑打包产物；`tui` / `stop` 可作用于 dev 实例；`restart` 对 dev 拒绝并提示在 `pnpm dev` 终端重启（§7.7） | 人类负责人 |
| Q-095 `larness logs` 的形态？ | 2026-11-28 用户确认要简单实现，并采纳增加 `--follow`：`logs [--lines 1–1000] [--daemon] [--follow]`，默认主日志 200 行、最新在后、人读格式化；无过滤 / 上传；无文件退出 3 | 人类负责人（已确认） |

**实现门禁**：ADR-077 已于 2026-11-28 批准；Q-086～Q-095 已按推荐默认确认（Q-095 增加 `--follow`），本 spec 已转 `ready`。任务拆分与验证门禁见 [plan.md](plan.md) / [tasks.md](tasks.md)。

## 14. 完成定义

- [x] ADR-077 已批准，ADR-023 的相关条款标记为 superseded；
- [x] Q-086～Q-095 已确认，spec 转 `ready`（2026-11-28 已确认）；
- [ ] A1～A16 验收场景全部通过；
- [ ] 单元 / 集成 / PTY / E2E / `pnpm check` / `pnpm build` 按范围通过，未运行项如实记录；
- [ ] macOS 与 Windows 原生实机结论已记录；未验证平台不标通过；
- [ ] `runtime-entry`、`tui`、`ipc` 契约与安装 / 升级 / 已知限制文档已更新；
- [ ] `AGENTS.md`、`STATUS.md`、`ROADMAP.md` 与本切片状态一致；
- [ ] 没有新增未授权入口、未放宽设备准入、未把秘密写入日志；
- [ ] 人类评审通过。
