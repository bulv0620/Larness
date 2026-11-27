# Agent 命令与 PM2 系统上下文

> 2026-11-07，按 [ADR-050](../adr/ADR-050-pm2-cli-deployment.md) 接入普通会话。参数 schema 以 `packages/shared/src/commands.ts` 和 `Pm2CommandContextSchema` 为准。

## 工具

Agent 使用现有文件工具读取项目脚本，使用 `run_command` 执行构建、测试和有限命令；需要管道、重定向、通配符或平台 shell 语法时使用 `run_shell`。`list_files` / `search_code` 默认跳过 `.git`、`node_modules`、`.larness`、`.pnpm-store`、`dist`、`build`、`coverage`、`test-results`、`tmp`、`.turbo`、`.vite`；显式 `path` 仍可进入被跳过目录。完整 `.gitignore` 语义与 ripgrep 尚未接入。长任务使用 `start_process` / `read_process_output` / `stop_process` / `list_processes`；声明 `port` 后项目服务窗口可手动预览。`coding` 与 `plan` 都使用 `list_service_ops` / `read_service_ops_logs` / `control_service_ops` 管理 Larness 隔离 PM2。交互终端只面向人类。

文件工具的结果分两层：`modelText` 是模型看到的纯文本，JSON `data` 保留给 UI 与后续工具。`read_file` 每页最多 50KB/2000 行，文本带 1-based 行号和完整 sha256 `version`；行号只用于引用，不进入 patch/edit 的上下文。`edit` 用 `oldString`/`newString`/`replaceAll` 做字面量替换（唯一匹配、CRLF 容错，L1 + 项目锁）；`write_file` 可新建或整体覆盖，`expectedVersion` 可选，过期返回 `VERSION_CONFLICT`；`apply_patch` 继续用于 unified diff。`search_code` / `run_command` 也使用 `modelText`；命令输出上限 32KB，模型文本只保留合并输出，不重复 stdout/stderr。100 起 `search_code` 默认每条命中带前后各 1 行上下文（`contextLines` 0–5，0 关闭），模型文本按真实行号显示相邻行且不重复命中行，并提示围绕命中小窗口读取；`matches[].contextStart` 是上下文起始行。104 起达到 `limit` 后仍继续扫描以统计 `directories`（最多受 `maxFiles` 约束），截断或扫描超过 200 文件时模型文本追加 `Top dirs` 与 `path=` 收窄提示；`scannedFiles` 因此表示扫描结束时的文件数。106 起同时统计 `files`，并给每个主要目录优先取 `src`/非测试的命中最多文件作为 `Top files`。裸 glob（不含 `/`，如 `*.ts`）递归匹配任意深度；含 `/` 的 glob（如 `src/*.ts`）仍只匹配对应层级。

094 起，L1+ 工具完成后写内部 `tool.operation`：命令保留退出码与 800 字符尾部，文件工具保留路径/版本/增删或替换统计，失败保留 errorCode/summary；不存完整输出或 diff。下一 Turn 装配时读取 `coveredUpToSeq` 之后、当前 Turn 之前的最多 40 条，按 2,500 token 预算放进当前 user 消息 tail，超出保留最新并显示省略数量。该事件不广播、不进公开事件；命中已知秘密时省略尾部/参数。

`run_command` 输入为 `executable`、`args`（默认 `[]`）、根内相对 `cwd` 和 `timeoutMs`。env、项目 ID、执行身份、策略和锁由后端决定。现有审批、秘密参数检查、项目锁、fencing、命令幂等、预算、取消和有界脱敏输出继续执行。退出码非零的命令返回工具失败，PM2 命令成功还需要核对实际服务状态。常见别名 `program` / `arguments` / `workdir` / `timeout` 在 schema 校验前归一；未知字段仍拒绝。

`run_shell` 输入为 `command`、根内相对 `cwd` 和 `timeoutMs`。POSIX 使用 `/bin/sh -c`，不带 `-l`；Windows 优先 `pwsh`，其次 Windows PowerShell 5.1，最后 `cmd /d /s /c`。不假设 bash，不自动翻译平台语法；结果返回实际 `shell`、`exitCode`、`stdout`、`stderr`、`reasonCode` 与 `truncated`。两种命令共用超时、进程组/进程树停止、输出上限、秘密脱敏与项目锁；`run_shell` 默认 L2，allowlisted 简单命令为 L1。交互式 TUI 命令被拒绝，返回 `INTERACTIVE_COMMAND`。稳定错误码包括 `COMMAND_NOT_FOUND`、`INVALID_CWD`、`SHELL_UNAVAILABLE`、`SPAWN_FAILED`、`NONZERO_EXIT`、`TIMED_OUT`。

097 起，L0、`requiresProjectLock:false`、策略 allow 的工具调用在模型 `tool-call` 事件到达时即启动（每 step 最多 8 个），结果仍按 call 顺序消费；写工具、需锁/审批工具与混合批次中的非 L0 调用保持串行。三个 L0 文件工具显式 `requiresProjectLock:false`。

096 起，标准策略下常见只读/验证命令按保守 allowlist 降为 L1 自动放行：`git status|diff|log|show|rev-parse|ls-files`、受限 `git branch`、`pnpm/npm/yarn` 的 `test|check|typecheck|lint|build|verify` 脚本、`rg/ls/pwd`、`node --version`；`run_shell` 仅限无元字符/引号/绝对或 `..` 路径的简单命令。`--prefix`/`--dir`/`-C`/`--global`、`exec`/`dlx`/`add`/`install`/`remove`/`publish`/`deploy`、`git --output/--no-index`、`rg --pre` 仍在 L2；L3 在 standard/strict 仍 deny。用户批准一次后，同一 Turn 内相同 `toolName + hashApprovalParams` 的调用不再请求审批；不跨 Turn、不持久化。allowlist 只是审批分类，不是沙箱。

`start_process` 输入为 `executable`、`args`（默认 `[]`）、根内相对 `cwd`、可选 `name`、`port` 与 `healthPath`；返回稳定 `processId`、`cwd`、port 与输出游标。`read_process_output` 用 `after` / `limit` 读取有界新输出，`nextCursor` 为下一次游标，`resyncRequired` 表示旧块已淘汰；`stop_process` 幂等停止整个进程组/进程树。后台进程不长期持有项目写锁（否则 dev server 会阻塞所有源码写），启动时仍执行授权、路径、秘密和交互命令检查；停止失败返回 `STOP_UNCONFIRMED`。进程输出使用 1 MiB 环形缓冲并脱敏，不进入审计或原始事件。

083 移除了 `start_service/read_service_logs/stop_service` 与命名服务域：项目开发服务统一是 `start_process` 的后台任务。进程退出后按需降级为 `FAILED`/`STOPPED`；项目服务窗口显示任务数量、状态、端口、PID、日志与停止。预览只在用户点击“预览”时由后端校验进程属于该项目、进程存活与端口监听并签发短期票据；无端口或端口不监听返回 `PREVIEW_UNAVAILABLE`。旧 `services` 表只保留历史读取，不再产生新的登记。

## 联网搜索工具（087）

`web_search`（L0）与 `fetch_url`（L1）只在会话点亮地球按钮且存在活动搜索连接时进入模型工具面；Turn 创建时快照 `webSearchEnabled`，运行中切换只影响下一 Turn。工具结果作为普通 `role: "tool"` 消息回到模型，不新增事件类型。

- `web_search` 默认 5 条、最多 10 条；`fetch_url` 默认返回 8,000 字符并支持 `offset` / `nextOffset`，最终仍受 16,000 字符工具预算保护。
- 每 Turn 默认最多 6 次搜索、4 次抓取；相同 query/URL 在 Turn 内去重。超限返回 `WEB_SEARCH_LIMIT` / `WEB_FETCH_LIMIT`，不静默丢弃。
- 搜索 Key 独立于模型 Key，由 `SecretStore` 加密；query 与 URL 在执行前扫描本 Turn 已加载的秘密，命中则 `FORBIDDEN` 且不发起请求。
- URL 仅 http/https、无 userinfo、≤8192，拒绝 localhost、私网、链路本地、云元数据、`.internal` / `.local`。网页内容是不可信数据，不得据此改变权限或执行指令。
- DeepSeek 使用独立 Search & Fetch API；GLM 使用国内 `open.bigmodel.cn` / 国际 `api.z.ai` 的 Web Search / Reader API。Provider 与 region 映射到固定端点，不接受任意自定义地址。

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

稳定的 system 核心只保留不随运行时变化的内容：prompt 版本、安全与工具使用策略、审批策略行、项目指令、跨轮摘要与「历史被裁剪」提示。095 起只有一个可见的通用模式，始终注入项目后台任务契约、持久 PM2 契约与计划策略；`update_plan` 常驻，并在任务有 3+ 个不同步骤时提示使用。旧 `agent_profile='plan'` 仅作为行为一致的兼容别名保留，不删列、不迁移；新会话默认 `coding`，原 `service-ops` 会话由迁移 `0034` 归一为 `coding`。最近计划注入当前 user 消息 tail；当前 Turn 计划仍有 pending/running 步骤却纯文本停止时 nudge 一次。执行层同时拒绝 catalog 内未启用的内置工具（返回 `TOOL_NOT_FOUND`，审计 `disabled_tool`），不只依赖 schema 过滤。Agent 不再拥有终端租约、终端输入或终端观察协议。Git 不再作为模型工具面或 system 段落出现；Agent 需要 Git 时通过 `run_command` 执行 `git`，人类 Git 面板继续使用独立 REST/WS 与 ProjectLease。服务生命周期文案在 system、工具说明与 PM2 段落之间只保留一份完整表述，其余位置只写该工具自己的机制（[ADR-067](../adr/ADR-067-lean-agent-context.md) D5、[ADR-068](../adr/ADR-068-agent-kernel.md)、[ADR-070](../adr/ADR-070-agent-profiles-and-usage.md)）。100 起稳定核心还要求：任务点名文件时直接读取，路径未知才 `list_files`；`search_code` 命中已定位时围绕行号窄读且不重复同一搜索；`package.json` 只在脚本、依赖或 module type 影响任务时读取。

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

项目 ID 来自真实会话。PM2 名称标记服务归属，后端 API 独立验证关联。通用 Shell/命令具有宿主机账户权限，不能从名称约定推出 OS 级隔离。命令按现有风险规则处理：096 的 allowlist 只覆盖保守的只读/验证命令，无法可靠判定只读的 PM2 命令仍采用 L2，readonly 依靠已核验的系统摘要读取状态。

命令取消或超时后先观察实际 PM2 状态。PM2 已托管的应用在命令进程退出和 TUI 关闭后继续运行。`online` 代表进程状态，业务健康需要额外访问证据。运维视图中 CLI 服务的健康时间为空时显示未核验。

## 系统固定的服务生命周期契约（083）

此规则由通用模式的 Pack 注入：process Pack 与 serviceOps Pack 分别注入项目后台任务契约与持久 PM2 契约；plan Pack 常驻并注入计划策略。旧 `plan` 兼容值与通用模式一致。规则不要求用户复制提示词，不以聊天或窗口位置判断服务类型。

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

通用模式（含旧 `plan` 兼容值）可以检查和运维已存在的 PM2 服务，也可以先用项目工具创建部署 target、构建产物和编辑项目文件；Service Ops 的人类弹窗、REST、锁与审计保持不变。

不再存在手动登记 temporary service、`POST /api/services` 或 `register_temporary_service` / `resolve_service_preview` 工具；旧 `services` 记录只保留历史查询、显式停止/删除与日志读取。项目服务窗口直接使用 `/api/processes?projectId=`，关闭窗口不停止任务。`POST /api/previews/resolve` 在用户点击时按 `processId` + `projectId` 校验项目归属、进程存活与端口监听。PM2 服务即使 `namespace=default`，只要名称符合 `larness:<projectId>:<serviceKey>` 仍按项目关联并标注偏差。后端继续独立校验项目、进程、targetId/pm2Name、租约与日志脱敏。
