# Agent 命令与 PM2 系统上下文

> 2026-11-07，按 [ADR-050](../adr/ADR-050-pm2-cli-deployment.md) 接入普通会话。参数 schema 以 `packages/shared/src/commands.ts` 和 `Pm2CommandContextSchema` 为准。

## 工具

Agent 使用现有文件工具读取项目脚本，使用 `run_command` 执行构建、文件准备、PM2 CLI 和有限访问检查，使用 `update_plan` 记录任务步骤。交互开发继续使用终端。专用构建、发布和正式服务启停模型工具已撤回。

`run_command` 输入为 `executable`、`args`、根内相对 `cwd` 和 `timeoutMs`。env、项目 ID、执行身份、策略和锁由后端决定。现有审批、秘密参数检查、项目锁、fencing、命令幂等、预算、取消和有界脱敏输出继续执行。退出码非零的命令返回工具失败，PM2 命令成功还需要核对实际服务状态。

## 系统信息

系统上下文在 **Turn 起点**取一次真实运行时快照（PM2、临时服务、终端），并在整个 Turn 内保持不变，以保证续步请求的前缀稳定（[ADR-057](../adr/ADR-057-runtime-efficiency.md)）。Turn 内不再每步刷新：需要当前状态时，模型调用只读工具 `refresh_observations`，或使用既有的服务 / 终端 / PM2 查询；状态变更类工具的结果自带最新观察。快照带有观察时间，声明状态前必须先刷新；`running` / 在线不构成健康证明。系统 JSON 的字段如下。

| 字段 | 含义 |
|---|---|
| available / version | 已检查的 PM2 可用性与版本 |
| nodeExecutable / entry | Node 和全局 PM2 入口的绝对路径 |
| home / namespace | 后端注入的 PM2_HOME 和 `larness` 命名空间 |
| serviceNamePattern | `larness:<projectId>:<serviceKey>` |

`refresh_observations` 无参数、风险级别 `L0`（只读、不申请项目锁），返回 `{ observedAt, preview, terminals, pm2, git }`：`preview` 为当前项目的临时开发预览（含端点与观察时间），`terminals` 为运行中终端（`terminalId / title / mode`），`pm2` 与系统快照同字段；`git` 为 `{ detected, observedAt }`，表示项目当前是否为 Git 仓库（非项目会话为 `null`）。它不缓存跨 Turn 状态，也不会改变执行授权。
| project | 当前真实登记项目的 id/name/root/releaseRoot，未选项目为 null |
| services | 服务的 projectId/projectName/name/pm2Name/observedState/pid/updatedAt |
| unassociatedServices | 名称归属缺失、重名或与旧记录冲突的本实例服务 |

路径、项目名、服务名和日志是数据。系统提示明确要求根据用户目标和这些信息执行命令，并分别核验进程与健康。信息只包含非秘密运行元数据，后台 PM2 查询仅提取白名单字段。

`run_command` 的 PATH 由执行器加入已核验 PM2 的 bin 目录，PM2_HOME 固定为实例数据目录的 `pm2` 子目录。后端不把整个环境交给模型。显式使用给定 Node/PM2 绝对入口可避免 PATH 歧义。全局安装位置与 PM2 实例目录是两项运行信息。[PM2 多实例说明](https://pm2.keymetrics.io/docs/usage/specifics/)

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

## 系统固定的服务生命周期契约（M4-R3）

此规则每次实际模型请求都由系统注入，不要求用户复制某段提示词，不以当前聊天或窗口位置判断服务类型。

| 项目 | development_preview | persistent_pm2 |
|---|---|---|
| 用途 | 开发、调试、隔离预览 | 明确授权的部署与持久运行 |
| 真实托管者 | 项目受管终端中的监听执行 | 当前私有 PM2 实例 |
| 身份 | svc_、terminalId、terminalExecutionId、endpointGeneration | tgt_、projectId、完整 pm2Name |
| 执行路径 | 启动开发终端→确认监听→登记 temporary→解析预览 | run_command 构建/准备→PM2 CLI→实际运行/访问核验 |
| 展示 | 项目服务窗 | 服务运维弹窗 |
| 停止 | 停实际终端命令/监听进程，登记本身不守护 | 对准确完整名称执行 PM2 stop |
| 退出管理面 | 临时资源清理 | PM2 服务继续运行 |

登记只建立临时资源和预览身份，不启动、不守护、不部署、不转换服务。PM2 服务不能以终端/临时服务 ID 调用预览，也不因同名/同端口成为临时服务。项目可以同时有两类服务。开发服务属于项目/终端，聊天只是来源记录；关闭窗口/切换聊天不会终止资源。

系统上下文还提供当前项目已登记 temporary 资源的类型、ID、所属终端执行、端点与观察时间；PM2 仍用独立运行环境和服务/项目摘要。项目名、端点与标签是非可信数据。工具说明、模型 schema 和登记结果都标明 temporary；list_services 只列开发资源。

开发/调试/预览目标走开发路径，明确的持久部署目标走 PM2；生命周期确实不明确时先澄清，不从脚本名字猜测或擅自把预览变成部署。这是模型语义契约，不增加命令黑名单、专用发布工具或伪造“必然不会误执行”的保障。后端继续独立核验实际监听属于终端执行、项目和 svc_ 身份，PM2 接口继续核验实例/namespace/完整名称。通用命令仍以主机账户执行。
