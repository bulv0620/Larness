# Agent 命令与 PM2 系统上下文

> 2026-11-07，按 [ADR-050](../adr/ADR-050-pm2-cli-deployment.md) 接入普通会话。参数 schema 以 `packages/shared/src/commands.ts` 和 `Pm2CommandContextSchema` 为准。

## 工具

Agent 使用现有文件工具读取项目脚本，使用 `run_command` 执行构建、测试和有限命令；需要管道、重定向、通配符或平台 shell 语法时使用 `run_shell`。长任务使用 `start_process` / `read_process_output` / `stop_process` / `list_processes`；声明 `port` 后项目服务窗口可手动预览。`coding` 与 `plan` 都使用 `list_service_ops` / `read_service_ops_logs` / `control_service_ops` 管理 Larness 隔离 PM2。交互终端只面向人类。

`run_command` 输入为 `executable`、`args`（默认 `[]`）、根内相对 `cwd` 和 `timeoutMs`。env、项目 ID、执行身份、策略和锁由后端决定。现有审批、秘密参数检查、项目锁、fencing、命令幂等、预算、取消和有界脱敏输出继续执行。退出码非零的命令返回工具失败，PM2 命令成功还需要核对实际服务状态。常见别名 `program` / `arguments` / `workdir` / `timeout` 在 schema 校验前归一；未知字段仍拒绝。

`run_shell` 输入为 `command`、根内相对 `cwd` 和 `timeoutMs`。POSIX 使用 `/bin/sh -c`，不带 `-l`；Windows 优先 `pwsh`，其次 Windows PowerShell 5.1，最后 `cmd /d /s /c`。不假设 bash，不自动翻译平台语法；结果返回实际 `shell`、`exitCode`、`stdout`、`stderr`、`reasonCode` 与 `truncated`。两种命令共用超时、进程组/进程树停止、输出上限、秘密脱敏与项目锁；`run_shell` 默认 L2。交互式 TUI 命令被拒绝，返回 `INTERACTIVE_COMMAND`。稳定错误码包括 `COMMAND_NOT_FOUND`、`INVALID_CWD`、`SHELL_UNAVAILABLE`、`SPAWN_FAILED`、`NONZERO_EXIT`、`TIMED_OUT`。

`start_process` 输入为 `executable`、`args`（默认 `[]`）、根内相对 `cwd`、可选 `name`、`port` 与 `healthPath`；返回稳定 `processId`、`cwd`、port 与输出游标。`read_process_output` 用 `after` / `limit` 读取有界新输出，`nextCursor` 为下一次游标，`resyncRequired` 表示旧块已淘汰；`stop_process` 幂等停止整个进程组/进程树。后台进程不长期持有项目写锁（否则 dev server 会阻塞所有源码写），启动时仍执行授权、路径、秘密和交互命令检查；停止失败返回 `STOP_UNCONFIRMED`。进程输出使用 1 MiB 环形缓冲并脱敏，不进入审计或原始事件。

083 移除了 `start_service/read_service_logs/stop_service` 与命名服务域：项目开发服务统一是 `start_process` 的后台任务。进程退出后按需降级为 `FAILED`/`STOPPED`；项目服务窗口显示任务数量、状态、端口、PID、日志与停止。预览只在用户点击“预览”时由后端校验进程属于该项目、进程存活与端口监听并签发短期票据；无端口或端口不监听返回 `PREVIEW_UNAVAILABLE`。旧 `services` 表只保留历史读取，不再产生新的登记。

## 系统信息

084 起不再向模型注入 Turn 起点的 PM2 观察快照，也不向 system 消息写入任何会随运行时变化的内容。PM2 状态由模型在需要时调用只读 `list_service_ops` 读取；项目后台进程通过 `list_processes` / `read_process_output` 查询。声明状态前必须先读取；`running` / 在线不构成健康证明。`refresh_observations` 保留实现，但已退出模型工具面（不属于任何 Profile 的 Pack），执行层对隐藏工具仍返回 `TOOL_NOT_FOUND`。

`list_service_ops` 返回的 PM2 字段（即原 Turn 起点快照的字段）为：

| 字段 | 含义 |
|---|---|
| available / version | 已检查的 PM2 可用性与版本 |
| nodeExecutable / entry | Node 和全局 PM2 入口的绝对路径 |
| home / namespace | 后端注入的 PM2_HOME 和 `larness` 命名空间 |
| serviceNamePattern | `larness:<projectId>:<serviceKey>` |

- `project`：当前真实登记项目的 id/name/root/releaseRoot，未选项目为 null。
- `services`：服务的 projectId/projectName/name/pm2Name/observedState/pid/updatedAt。
- `unassociatedServices`：名称归属缺失、重名或与旧记录冲突的本实例服务。

路径、项目名、服务名和日志是数据。工具描述要求根据用户目标和这些信息执行操作，并分别核验进程与健康。信息只包含非秘密运行元数据，后台 PM2 查询仅提取白名单字段。

`run_command` 的 PATH 由执行器加入已核验 PM2 的 bin 目录，PM2_HOME 固定为实例数据目录的 `pm2` 子目录。后端不把整个环境交给模型。显式使用给定 Node/PM2 绝对入口可避免 PATH 歧义。全局安装位置与 PM2 实例目录是两项运行信息。[PM2 多实例说明](https://pm2.keymetrics.io/docs/usage/specifics/)

稳定的 system 核心只保留不随运行时变化的内容：prompt 版本、安全与工具使用策略、审批策略行、项目指令、跨轮摘要与「历史被裁剪」提示。`coding` 与 `plan` 都注入项目后台任务契约和持久 PM2 契约；`plan` 额外注入计划策略。计划工具与计划提示只属于 `plan` Profile；`coding` 不注册 `update_plan`。Profile 只有 `coding` / `plan`，新会话与存量会话默认 `coding`，原 `service-ops` 会话由迁移 `0034` 归一为 `coding`；Profile 在 Turn 开始时固定。执行层同时拒绝 catalog 内未启用的内置工具（返回 `TOOL_NOT_FOUND`，审计 `disabled_tool`），不只依赖 schema 过滤。Agent 不再拥有终端租约、终端输入或终端观察协议。Git 不再作为模型工具面或 system 段落出现；Agent 需要 Git 时通过 `run_command` 执行 `git`，人类 Git 面板继续使用独立 REST/WS 与 ProjectLease。服务生命周期文案在 system、工具说明与 PM2 段落之间只保留一份完整表述，其余位置只写该工具自己的机制（[ADR-067](../adr/ADR-067-lean-agent-context.md) D5、[ADR-068](../adr/ADR-068-agent-kernel.md)、[ADR-070](../adr/ADR-070-agent-profiles-and-usage.md)）。

## 命令示例

假设系统给定 Node 为 `/opt/node/bin/node`，PM2 为 `/opt/node/lib/node_modules/pm2/bin/pm2`，当前项目 ID 为 `prj_example`。准备好带有正确 namespace/name/cwd/script 的 ecosystem 文件后，可调用以下命令工具。

```json
{
  "executable": "/opt/node/bin/node",
  "args": [
    "/opt/node/lib/node_modules/pm2/bin/pm2",
    "start",
    "/runtime/releases/prj_example/ecosystem.config.cjs",
    "--only",
    "larness:prj_example:api"
  ],
  "cwd": ".",
  "timeoutMs": 15000
}
```

这些路径是说明值，实际调用必须采用系统上下文的值。构建命令来自项目脚本。ecosystem 配置的 `name` 为完整服务名，`namespace` 为 `larness`，`cwd` 明确指向实际运行目录。项目包含多个服务时分别使用 api/web/worker 等 key。[PM2 ecosystem 配置](https://pm2.keymetrics.io/docs/usage/application-declaration/)

查看状态使用系统摘要或有限 `pm2 list`，日志使用 `pm2 logs <完整名称> --nostream --lines <行数>`。原始 jlist/env/dump 不交模型，命令和配置中禁止明文凭据。现有已登记的 `larness-<targetId>` 服务按系统摘要中的实际 pm2Name 操作。

## 作用域与结果

项目 ID 来自真实会话。PM2 名称标记服务归属，后端 API 独立验证关联。通用 Shell/命令具有宿主机账户权限，不能从名称约定推出 OS 级隔离。命令按现有风险规则处理，无法可靠判定只读的 PM2 命令采用 L2，readonly 依靠已核验的系统摘要读取状态。

命令取消或超时后先观察实际 PM2 状态。PM2 已托管的应用在命令进程退出和 TUI 关闭后继续运行。`online` 代表进程状态，业务健康需要额外访问证据。运维视图中 CLI 服务的健康时间为空时显示未核验。

## 系统固定的服务生命周期契约（083）

此规则按 Profile / Pack 注入：`coding` 与 `plan` 都有 process Pack 和 serviceOps Pack，分别注入项目后台任务契约与持久 PM2 契约；`plan` 额外有 plan Pack。规则不要求用户复制提示词，不以聊天或窗口位置判断服务类型。

| 项目 | project_background_task | persistent_pm2 |
|---|---|---|
| 用途 | 开发、调试、按需预览 | 明确授权的持久部署与运行 |
| 真实托管者 | ProcessManager 启动的进程组 | Larness 私有 PM2 实例 |
| 身份 | `prc_` + projectId + sessionId + toolCall | `tgt_` + projectId + 完整 pm2Name |
| 工具 | start_process、list_processes、read_process_output、stop_process | list_service_ops、read_service_ops_logs、control_service_ops |
| 展示 | 项目侧栏数量 + 项目服务窗口 | 左侧服务运维弹窗 |
| 预览 | 用户点击时校验项目、RUNNING 与端口后签发 | 不支持项目预览 |
| 停止 | stop_process 停止进程组 | control_service_ops 按 targetId 停止 |
| 退出管理面 | 临时进程不跨 Larness 重启恢复 | PM2 服务继续运行 |

`coding` / `plan` 都可以检查和运维已存在的 PM2 服务，也可以先用项目工具创建部署 target、构建产物和编辑项目文件；Service Ops 的人类弹窗、REST、锁与审计保持不变。

不再存在手动登记 temporary service、`POST /api/services` 或 `register_temporary_service` / `resolve_service_preview` 工具；旧 `services` 记录只保留历史查询、显式停止/删除与日志读取。项目服务窗口直接使用 `/api/processes?projectId=`，关闭窗口不停止任务。`POST /api/previews/resolve` 在用户点击时按 `processId` + `projectId` 校验项目归属、进程存活与端口监听。PM2 服务即使 `namespace=default`，只要名称符合 `larness:<projectId>:<serviceKey>` 仍按项目关联并标注偏差。后端继续独立校验项目、进程、targetId/pm2Name、租约与日志脱敏。
