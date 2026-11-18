---
id: 082-agent-kernel
title: Agent 内核重构：单循环、核心工具与人类操作面分离
milestone: 发布后
status: draft
depends_on: [051-agent-tool-contract, 030-dev-resources, 040-services-preview, 081-agent-lean]
owners: []
created: 2026-11-18
updated: 2026-11-18
---

# Agent 内核重构：单循环、核心工具与人类操作面分离

> 状态：`draft`。本文只冻结目标、边界与验收；实现前必须完成 [ADR-068](../../docs/adr/ADR-068-agent-kernel.md) 并获得人类确认。网络搜索明确不在本切片范围内。

## 1. 背景与问题

当前 Agent 是“本机 Agent 工作台”的一体化实现：

- 生产注册 **28 个工具**：文件 5、计划 1、命令 1、终端 7、Git 10、服务 3、观察 1（`apps/server/src/bootstrap/start.ts`）。
- `turnRunner.ts` 约 2,415 行，同时承担循环、计划、预算、检查点、终端、服务、审批与恢复。
- 终端既是人类窗口，也是 Agent 工具；Agent 通过 7 个工具启动、读取、输入、中断和停止 PTY。
- Git 有 10 个专用工具；UI 的 Git 操作又走另一套 REST 路径。
- 计划是默认工具 + 系统提示 + 陈旧提醒 + UI 卡片的四层组合。
- 锁分散在 ProjectWriteLock、命令、Git、Files、ServiceOps 与终端租约中；审计同时承担安全决策和部分工具执行记录。
- 固定 schema 约 4.5k token、system 约 0.75k token；默认步数和工具调用不设上限。

这导致三个问题：模型行为被计划与终端协议持续推动、固定成本高、内核难以独立演进，被本机工作台能力绑架。

## 2. 目标

- G-1：内核只保留**单循环**：用户消息 → Provider → 工具调用 → 结果回填 → 继续/结束；不引入 subagent。
- G-2：建立 `coding`、`plan`、`workspace` 三种 Agent Profile；`coding` 是新会话默认。
- G-3：`coding` 只暴露文件读写编辑、代码搜索与有限命令执行；`list_files` 可保留为轻量目录入口。
- G-4：从模型工具面移除全部 Git 工具；Agent 通过命令执行 Git，人类 Git 操作继续使用独立 UI/REST。
- G-5：从模型工具面移除全部交互终端工具；交互终端成为仅面向人类的命令行窗口。
- G-6：为 Agent 提供后台进程与服务能力：有限命令、后台进程、命名服务、日志与停止；预览保持可选。
- G-7：计划降级为可选 `plan` Profile；`coding` 不注册计划工具，不注入计划提醒。
- G-8：能力说明按 Profile/Pack 注入；默认 system 不包含终端租约、服务生命周期、Git 可用性与计划协议。
- G-9：保留文件版本校验、项目锁、审批、审计、秘密保护、事件持久化与历史回放。
- G-10：遵守现有安全边界；轻量不等于取消后端鉴权、锁或审批。
- G-11：锁与审计全部留在执行 adapter，不进入 Agent 内核；锁域收敛为项目写锁与服务锁，终端控制租约退出模型面。
- G-12：审计分级：安全关键事件 fail-closed，操作事件与事务一致或明确失败，调试信息回到 `agent_events` / 日志，不双写审计。

## 3. 非目标

- NG-1：不实现网络搜索或网页抓取；`websearch` / `webfetch` 不进入本切片。
- NG-2：不新增 subagent、多 Agent 编排或并行 Turn。
- NG-3：不移除人类终端窗口、Git 面板、PM2 运维入口或服务预览 UI。
- NG-4：不改变模型 Provider 接入、模型选择、凭据和截图能力。
- NG-5：不改变 PM2 正式服务的领域分离与人工运维规则（ADR-048、ADR-050、ADR-051、ADR-052）。
- NG-6：不在本切片重写预算模型；ADR-059 的步数、花费、挂钟和自动接续另行评估。
- NG-7：不引入新的 OS 级沙箱；Shell 仍以 Larness 运行账户权限执行。
- NG-8：不删除历史终端、计划、Git 与服务事件；旧会话必须可回放。

## 4. 用户故事

- 作为 coding 用户，我希望新会话默认只有必要的读写、搜索和命令工具，以便模型快速开始工作。
- 作为需要 Git 的用户，我希望在 UI 中完成暂存、提交和推拉，而不是让模型多出 10 个 Git 参数。
- 作为终端用户，我希望终端始终是我的命令行工具，而不是被 Agent 抢占或输入。
- 作为需要开发服务的用户，我希望 Agent 能启动、读取日志和停止它启动的后台服务，但不要操作我的交互式 Shell。
- 作为计划用户，我希望在明确要求时得到计划，而不是每个任务都先写计划。
- 作为安全审查者，我希望移除模型工具后仍然保留审批、项目锁、审计与秘密保护。

## 5. 验收场景

### A1 默认 coding 工具面

```gherkin
Given 新会话使用默认 coding profile
When 装配模型请求
Then 模型工具只包含 list_files、read_file、search_code、write_file、apply_patch、run_command、run_shell
And 不包含 update_plan、任何 Git 工具、任何终端控制工具、任何服务工具
And system prompt 不包含计划、终端租约、Git 可用性或服务生命周期协议
```

### A2 Git 的人类与模型分面

```gherkin
Given 项目已识别为 Git 仓库且当前为 coding profile
When 用户让 Agent“提交这次改动”
Then Agent 通过 run_command 执行 git 命令
And 模型工具列表中没有 git_status/git_add/git_commit 等专用工具
And 人类在 Git UI 中仍可查看状态、暂存、提交、拉取和推送
```

### A3 终端仅属于人类

```gherkin
Given 用户打开项目终端并输入命令
When 当前会话运行 Agent
Then Agent 的工具列表中没有终端启动、读取、输入、中断或租约工具
And Agent 不能获取该终端的输入权或读取其输出
And 用户终端在 Agent Turn 完成、取消或切换会话后继续存在
```

### A4 Agent 后台进程

```gherkin
Given workspace profile 已启用
When Agent 启动一个后台开发命令
Then 返回稳定的 processId、cwd 与有界日志游标
And Agent 可读取新增日志并显式停止该进程组
And 停止后进程组不残留，重复停止幂等
```

### A5 服务与预览

```gherkin
Given Agent 通过后台进程启动了一个开发服务
When 服务被登记为命名服务
Then 服务记录绑定 processId、端口、命令摘要与项目
And 同一项目 + 名称 + 命令重复启动返回原服务或明确冲突
And 预览是否可用遵循 preview 配置；关闭预览不影响服务运行与日志
```

### A6 计划按需

```gherkin
Given 默认 coding profile
When 用户没有要求计划
Then Agent 不创建计划工具事件
And 运行时不注入计划陈旧提醒

Given 用户切换到 plan profile
When 用户要求先规划
Then plan profile 可更新计划元数据，但不能编辑普通项目文件
And 计划事件仍可在时间线回放
```

### A7 workspace profile 兼容

```gherkin
Given 用户需要在项目内启动开发服务
When 切换到 workspace profile
Then 模型工具增加后台进程与服务工具
And 仍不包含交互终端工具与 Git 专用工具
And 审批规则不变；锁与审计按 7.5 节收敛
```

### A8 安全与失败关闭

```gherkin
Given 模型请求启动命令或写入文件
When 审批策略要求确认
Then 未获授权的调用不会执行
And 失败不会以“成功”或“运行中”回给模型

Given 后台进程启动失败或端口冲突
Then 返回稳定错误码与可恢复摘要
And 不创建虚假的服务或预览记录
```

### A9 旧会话与历史

```gherkin
Given 升级前存在计划事件、终端事件、Git 事件或 AI 终端资源
When 打开旧会话并回放
Then 历史时间线仍显示原有事件
And 旧终端资源不被自动终止或重新赋权给 Agent
And 新默认 profile 只影响新会话或显式切换后的会话
```

### A10 明确排除的能力

```gherkin
Given 当前 coding profile
When 查看模型工具与 system
Then 不存在网络搜索、网页抓取或 subagent 工具
And 文档说明它们在后续切片单独评估
```

### A11 锁域收敛

```gherkin
Given Agent、人类 Git UI、文件保存或命令同时写同一项目
When 任一写者持有项目写锁
Then 其他写者等待或得到 RESOURCE_LOCKED
And 写锁保留 TTL、fencing token、过期接管与丢失检测
And 服务运维只使用服务锁，不与项目写锁混用
And Agent 终端控制不再申请或持有锁
```

### A12 审计分级

```gherkin
Given 认证、配对、审批、拒绝、部署或服务启停发生
When 写入审计失败
Then 操作失败关闭，不返回成功

Given 文件写入、命令执行、Git 操作或进程启停发生
When 审计与业务写入可以同事务
Then 审计与业务写入一起提交或一起回滚

Given 一次普通工具调用
When 记录执行过程
Then 细节写入 agent_events / 日志，不重复写入审计
And 审计只保留安全决策、拒绝、审批与资源生命周期
```

### A13 结构化命令

```gherkin
Given coding profile 需要运行 pnpm test
When Agent 调用 run_command
Then 使用 executable=pnpm、args=["test"]、cwd 和 timeout
And 不要求模型拼接 shell 字符串
And 参数缺失时返回稳定 VALIDATION_ERROR，而不是崩溃或误执行
```

### A14 跨平台 shell

```gherkin
Given 用户需要一个管道或重定向命令
When Agent 调用 run_shell
Then POSIX 使用 /bin/sh -c，Windows 使用可用的 PowerShell 或 CMD
And 结果返回实际 shell、exitCode、stdout 与 stderr
And 超时、取消与进程树停止与 run_command 一致
And Windows PowerShell 5.1 不支持的语法返回可操作错误，不做隐式翻译
And 交互式 TUI 命令被明确拒绝，提示使用非交互参数
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 内核只运行单循环，不引入 subagent、多 Agent 编排或并行 Turn。 |
| R-2 | MUST | 提供 `coding`、`plan`、`workspace` Profile；新会话默认 `coding`。 |
| R-3 | MUST | `coding` 的工具集合限定为文件、代码搜索、`run_command` 与 `run_shell`；不注册计划、Git、终端或服务工具。 |
| R-4 | MUST | 移除模型可见的全部 Git 工具；人类 Git UI 保留并独立于 Agent 工具面。 |
| R-5 | MUST | 移除模型可见的全部交互终端工具；人类终端保留，且 Agent 无法读取或输入。 |
| R-6 | MUST | `workspace` 提供后台进程的启动、输出读取与进程组停止。 |
| R-7 | MUST | 命名服务绑定项目、后台进程、命令摘要、端口与日志；启动与停止必须幂等。 |
| R-8 | MUST | 计划只在 `plan` Profile 可用；`coding` 不注册 `update_plan`，运行时删除计划陈旧提醒。 |
| R-9 | MUST | system 只保留 Profile 稳定的核心策略；终端/服务/计划协议随对应能力包按需注入。 |
| R-10 | MUST | 文件版本校验、项目锁、审批、审计、秘密保护、事件持久化与回放不得削弱。 |
| R-11 | MUST | 人类终端、Git 面板、服务预览与 PM2 运维入口继续可用。 |
| R-12 | MUST | 旧计划、终端、Git、服务事件保持可回放；不删除历史数据。 |
| R-13 | MUST | 本切片不新增网络搜索、网页抓取或 subagent 能力。 |
| R-14 | SHOULD | Profile 选择在会话级持久化，并在 UI 明确显示当前 Profile。 |
| R-15 | SHOULD | 后台进程与服务输出使用有界环形缓冲与游标，不把完整日志灌入每步上下文。 |
| R-16 | SHOULD | 人类 Git 写操作与 Agent Shell Git 写操作尽量串行化，避免索引竞争。 |
| R-17 | MUST | 锁域只保留项目写锁与服务锁；Agent 终端控制不再使用租约或 fencing。 |
| R-18 | MUST | 所有项目写入统一经 ProjectLease；保留 TTL、fencing、过期接管、丢失检测和重叠根规则；Files/Git/Commands/ServiceOps 不得各自维护一套锁语义。 |
| R-19 | MUST | 审计分级：安全关键事件 fail-closed；可事务化的操作审计与业务写入同事务；调试执行细节不写入审计。 |
| R-20 | MUST | 审计条目使用稳定 action、decision 与关联 ID（sessionId/turnId/toolCallId/requestId），不得记录秘密或原始命令输出。 |
| R-21 | SHOULD | 人类终端只在多客户端输入冲突时使用简单连接所有权，不复用 Agent 终端租约。 |
| R-22 | SHOULD | 审计按 Q-033 评估保留期与体积上限；清理前先 dry-run，不静默删除安全记录。 |
| R-23 | MUST | `run_command` 保持结构化 `executable + args`，`args` 默认空数组；用于构建、测试、Git、PM2 等可移植命令。 |
| R-24 | MUST | 新增 `run_shell`，接受命令字符串；POSIX 使用 `/bin/sh -c`，Windows 优先 PowerShell 7，其次 Windows PowerShell 5.1，最后 CMD；不得假设 bash 存在。 |
| R-25 | MUST | `run_shell` 返回实际 shell、退出码与 stdout/stderr；平台语法不做自动翻译，模型应选择平台适用的写法。 |
| R-26 | MUST | 两种命令工具复用现有超时、进程组/进程树停止、输出上限、秘密脱敏与审批；`run_shell` 默认 L2。 |
| R-27 | MUST | 命令工具补齐常见别名与可操作错误码（`COMMAND_NOT_FOUND`、`INVALID_CWD`、`SHELL_UNAVAILABLE`、`SPAWN_FAILED`、`NONZERO_EXIT`、`TIMED_OUT`）。 |
| R-28 | SHOULD | `run_command` / `run_shell` 结果区分 stdout/stderr，并对 shell 输出做 ANSI/编码处理；交互式 TUI 命令明确拒绝。 |

## 7. 接口与契约变更

### 7.1 模型工具面

移除（模型不可见，后端能力可保留给 UI/REST）：

- Git：`git_status`、`git_diff`、`git_log`、`git_branches`、`git_add`、`git_commit`、`git_create_branch`、`git_switch_branch`、`git_pull`、`git_push`
- 终端：`start_project_terminal`、`read_terminal_output`、`stop_project_terminal`、`acquire_terminal_control`、`send_terminal_input`、`interrupt_terminal`、`release_terminal_control`
- 计划：`update_plan` 从 `coding` 移除；仅在 `plan` Profile 保留（是否保留工具形态由 Q-043 决定）

新增（`workspace` Profile）：

- 后台进程：`start_process`、`read_process_output`、`stop_process`
- 服务：`start_service`、`list_services`、`read_service_logs`、`stop_service`（名称与最终粒度由 plan 冻结）
- `refresh_observations` 是否保留待 Q-044 决定；默认不进入 `coding`

保留（`coding`）：

- `list_files`、`read_file`、`search_code`、`write_file`、`apply_patch`
- `run_command`：结构化 `executable + args`，跨平台主路径
- `run_shell`：显式 shell 模式，用于管道、重定向、通配符和平台相关语法

### 7.2 Profile 配置

新增会话级 `agentProfile`：

- `coding`：默认新会话；
- `plan`：只读探索 + 计划元数据；
- `workspace`：`coding` + 后台进程 + 服务。

配置键名、持久化位置与是否允许项目级默认值在 plan 冻结，并同步 `docs/contracts/rest-api.md`、`docs/contracts/data-model.md` 与 Agent 工具契约。

### 7.3 REST / WebSocket

- 人类终端 API/WS 保留；模型工具层不再调用终端控制。
- 人类 Git API/WS 保留；模型 Git 工具移除。
- 后台进程/服务需要新增或复用 REST/WS 读写入口；具体路径在 plan 冻结。
- 旧事件类型 `terminal.*`、`git.*`、`plan.updated` 保持可回放；新增 process/service 事件必须持久化后再广播。

### 7.4 提示与工具描述

- `PROMPT_VERSION` 升版，去除计划、终端租约、Git 可用性、服务生命周期等默认段落。
- 能力包启用时才注入对应 `systemHint`。
- `run_command` 描述删除“full test suites / 30 分钟全量测试”引导，明确 `executable + args`、`cwd`、`timeoutMs`，并提示构建/测试/Git/PM2 优先使用它。
- `run_shell` 描述明确只用于管道、重定向、通配符和平台相关 shell 语法；不假设 bash，不自动翻译平台语法。
- 网络搜索工具不新增（NG-1）。

### 7.5 锁与审计契约

**锁域**：

| 锁域 | 作用 | 持有者 | 规则 |
|---|---|---|---|
| ProjectLease | 项目根目录写串行化 | Agent Turn、人类文件/Git 写、独立命令、服务操作 | TTL + fencing + 过期接管 + 丢失检测；重叠根按现有规则 |
| ServiceLease | 单个 PM2/服务目标的运维串行化 | 人类运维、Agent 服务操作 | 只覆盖同一目标；不与项目写锁混用 |
| 人类终端所有权 | 多客户端输入冲突 | 当前终端连接 | 仅 UI 输入归属；不进入模型工具、不做 Agent lease/takeover |

**审计分级**：

| 级别 | 例子 | 失败策略 |
|---|---|---|
| 安全关键 | 认证、配对、审批、拒绝、权限变更、部署、服务启停、秘密相关 | fail-closed；审计不可用则操作失败 |
| 资源操作 | 文件写入、Git 提交、命令执行、进程/服务创建与停止 | 与业务写入同事务；不能同事务则 fail-closed；只读查询可 best-effort |
| 调试 | 每次 tool.requested/completed、token 用量、步骤耗时 | 只进 `agent_events` / 日志，不写审计 |

实现约束：

- `AgentKernel` 不直接调用锁表或审计表；它只发出事件，由 `ToolExecutor` / `ResourceAdapter` 执行锁、审批、审计。
- `appendAudit` 的调用点必须声明级别；安全关键调用不得吞掉异常。
- `tool.requested` 不再写审计；`tool.denied`、审批决策、资源生命周期保留审计。
- 旧审计记录与旧 action 名称保持可读，不做破坏性迁移。

### 7.6 命令执行契约

`run_command`（结构化，跨平台主路径）：

```ts
{
  executable: string;
  args?: string[];      // default []
  cwd?: string;         // project-relative, default "."
  timeoutMs?: number;
}
```

`run_shell`（显式 shell，平台相关）：

```ts
{
  command: string;
  cwd?: string;
  timeoutMs?: number;
}
```

- POSIX 使用 `/bin/sh -c`，不带 `-l`；Windows 优先 `pwsh`，其次 Windows PowerShell 5.1，最后 `cmd /d /s /c`。
- 不假设 bash；不自动翻译 `&&`、管道或引号语法；结果返回实际 `shell`。
- 两者复用现有超时、进程组/进程树停止、输出上限、秘密脱敏与审批；`run_shell` 默认 L2。
- 不接受 `env`、`stdin` 或越界绝对 `cwd`；交互式 TUI 命令明确拒绝。
- 结果区分 stdout/stderr，并返回 `exitCode`、`reasonCode`、`truncated`。
- 常见别名（`program`/`arguments`/`workdir`/`timeout`）在 schema 校验前修复；错误码稳定。

## 8. 数据与迁移

- `sessions` 增加 `agent_profile`（或等价配置）：新会话默认 `coding`；存量会话建议保持 `workspace`/旧行为直到显式切换（Q-042）。
- 不删除 `terminals`、`services`、`plans` 或事件表；旧 AI 终端资源升级后作为人类终端保留，不自动终止。
- `resource_locks` 保留现有结构；ProjectLease 与 ServiceLease 复用该表，不新增锁表。`terminal_leases` 保留用于旧记录与人类终端兼容，但 Agent 不再创建或使用。
- 审计表结构不变；分级由调用契约表达，不新增 `level` 列。若后续需要结构化级别，单独迁移。
- 后台进程与命名服务是否新增表、复用 `services` 表或使用内存 + 事件，由 plan 冻结；任何新列/表必须提供迁移和回滚。
- 先写迁移测试，再做数据迁移；禁止破坏性迁移与静默清理。

## 9. 安全、权限与审计

- 模型能力减少不改变后端授权：Shell、文件写入、进程启动仍按现有审批策略、项目锁和审计执行。
- `plan` Profile 禁止普通文件编辑；计划元数据更新必须保持 L0 与秘密扫描。
- 后台进程以 Larness 运行账户执行；必须使用进程组停止并确认后代退出，不能只杀父进程。
- 人类终端与 Agent 完全隔离：Agent 不得获取终端租约、输入或输出；人类终端不进入模型工具面。
- Git UI 与 Agent Shell Git 可能并发；人类 Git 写操作必须使用 ProjectLease，Agent Shell Git 写命令尽量由命令扫描器识别并尝试同一把锁（Q-045）。
- ProjectLease 与 ServiceLease 是唯一锁域；Files/Git/Commands/ServiceOps 不得各自实现 acquire/release 语义。
- 锁丢失、过期接管、审计不可用时按失败关闭处理；不能以“已启动/运行中”掩盖未完成状态。
- 安全关键审计在操作成功前提交；资源操作审计必须与业务写入同事务，不能同事务则失败关闭。审计失败不能被静默忽略。
- 秘密、Cookie、Token、环境变量不得进入进程日志、服务摘要、审计详情或事件。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 后台进程启动即退出 | 返回失败与退出码/尾部输出；不登记服务 | 启动失败 |
| 命令不存在 / cwd 无效 | 返回 COMMAND_NOT_FOUND / INVALID_CWD | 命令或目录不可用 |
| shell 不可用 | 返回 SHELL_UNAVAILABLE，不退回 bash | 无法执行 shell |
| 交互式命令 | 拒绝并提示非交互参数 | 不支持交互式 TUI |
| 命令超时/取消 | 进程组/进程树停止；返回 TIMED_OUT/CANCELLED | 已停止 |
| 端口冲突 | 不创建第二个服务；返回稳定错误码 | 端口不可用 |
| 停止超时 | 升级为强制终止进程组；仍失败则保留记录并报错 | 停止未完成 |
| 输出超限 | 环形缓冲/游标；旧内容可截断 | 日志已截断 |
| 用户终端断开 | 只影响该客户端视图；资源按既有规则处理 | 连接已断开 |
| 人类 Git 锁被占用 | UI 操作等待或明确失败 | Git 正忙 |
| 项目写锁丢失/过期 | 当前写操作失败；重新读取/重新拿锁后重试 | 项目已被其他写者接管 |
| 安全关键审计不可用 | 操作失败关闭 | 操作未执行 |
| 资源操作审计不可用 | 与业务写入同事务回滚；不能同事务时失败关闭 | 操作未执行 |
| 终端多客户端输入冲突 | 仅当前终端连接拥有输入；不做 Agent takeover | 输入权在另一客户端 |
| 旧计划事件 | 正常回放；不自动改写状态 | 历史计划 |
| Profile 切换中的 Turn | 当前 Turn 使用开始时 Profile，不中途换工具集 | 当前模式 |
| 预览关闭 | 服务仍运行，只是不提供预览入口 | 预览未启用 |

## 11. 可观测性

- 日志包含 `sessionId`、`turnId`、`agentProfile`、`toolPack`、`processId`/`serviceId`、锁域与错误码。
- 指标：每 Profile 的固定工具 token、每 Turn 步数、工具调用数、计划事件数、进程启动/停止失败率、审批等待时间、锁等待/丢失次数、审计失败次数。
- 审计与 `agent_events` 分工：审计记录安全决策与资源生命周期；工具执行细节留在事件流。
- 不记录命令输出中的秘密；进程日志沿用输出脱敏。
- 提供诊断入口查看当前 Profile、可用工具包、运行中进程/服务、锁持有者与最近审计/错误。

## 12. 测试计划

- 单元：Profile 过滤、工具注册表、提示组装、计划提醒移除、进程组停止、输出环形缓冲、服务幂等键、ProjectLease/ServiceLease、审计分级、命令别名与 schema 校验。
- 集成：`/api/sessions` Profile 持久化、Agent 请求工具列表、Shell Git、人类 Git 锁、终端 API 与 Agent 隔离、服务/预览 REST/WS、审计失败关闭。
- 命令：macOS/Linux `/bin/sh -c`、Windows PowerShell 7/5.1/CMD、`.cmd/.bat/.ps1` shim、空格路径、UTF-8、管道/重定向、超时、取消、进程树停止、stdout/stderr 分离。
- E2E：默认 coding 会话工具面、Agent 用 shell 提交 Git、用户终端输入不受 Agent 影响、Agent 后台服务启动与停止、plan Profile 只读、旧事件回放、锁等待与审计 tail。
- 迁移：旧会话、旧计划、旧终端、旧服务数据升级后可打开与回放；`resource_locks`/`terminal_leases` 旧记录可读。
- 安全：未授权 Shell、写入、进程启动、Git UI 锁、锁丢失/接管、秘密扫描、安全关键审计 fail-closed、`run_shell` 审批与注入边界。
- 手动/视觉：Profile 切换、终端窗口、Git 面板、服务/预览界面。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| Q-042 默认 Profile 与存量会话迁移 | 新会话 `coding`；存量保持 `workspace` 直到显式切换 | 人类负责人 |
| Q-043 `plan` Profile 是否保留 `update_plan` 工具 | 保留为 plan-only 元数据工具，`coding` 不注册 | 人类负责人 |
| Q-044 后台进程/服务工具粒度与持久化 | 进程 3 工具 + 服务 4 工具；服务复用/扩展现有 services 记录 | 人类负责人 |
| Q-045 Git UI 与 Agent Shell Git 的并发锁 | 人类 Git 写操作加项目锁；Agent git 写命令尽量识别并串行化 | 人类负责人 |
| Q-048 预览默认值 | 沿用 ADR-060 的现有配置默认；是否改为默认关闭另行确认 | 人类负责人 |
| Q-044 / Q-046 ADR-030/038/048/059 的替代关系 | 先写 ADR-068；终端/服务生命周期条款按新 ADR 替代 | 人类负责人 |
| Q-047 AGENTS.md 是否自动加载 | 本切片不改变项目指令机制 | 人类负责人 |
| Q-049 锁/审计分级 | 按第 7.5 节：ProjectLease + ServiceLease，required/resource/debug 审计；终端租约退出模型面 | 人类负责人 |
| Q-050 命令双路径 | `run_command` 结构化 + `run_shell` 平台 shell；不假设 bash | 人类负责人 |

## 14. 完成定义

- [ ] A1–A14 全部通过；
- [ ] ADR-068 accepted，明确替代 ADR-030/038 的哪些条款；
- [ ] 工具契约、REST/WS、数据模型、Agent 提示、锁与审计契约同步更新；
- [ ] 旧会话、旧计划、旧终端与旧服务回放通过；
- [ ] ProjectLease/ServiceLease 成为唯一锁入口；Agent 终端租约已移除；
- [ ] `run_command` 与 `run_shell` 的跨平台矩阵、错误码与交互式命令拒绝通过；
- [ ] 审计分级与 fail-closed 行为通过安全测试；
- [ ] `pnpm check`、`pnpm build`、相关 E2E 通过；
- [ ] 人类验收默认 Profile、终端隔离、Git UI/Agent 分面、锁/审计与服务/预览行为。
