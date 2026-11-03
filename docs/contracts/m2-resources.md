# M2 资源契约（设计已批准，按任务实施）

> 2026-11-02 人类要求开始 M2，并明确按最新 spec；[030 spec](../../specs/030-dev-resources/spec.md) / [ADR-029](../adr/ADR-029-development-resource-execution.md) 已通过 G-Spec-M2，含 §10 完整 AI 交互。以下接口按任务逐步实施，不代表服务器已有能力。2026-11-03 G-PoC-M2 已确认，M2-1 文件 / 目录接口与迁移已实施，详见 §11；M2-1b 文件监听 / 订阅 / 补拉已实施，详见 §12；M2-2 文件编辑与结果卡片已实施，详见 §13；M2-3 命令执行后端已实施，详见 §14；M2-3b Agent 命令与实时卡片已实施，详见 §15；M2-4 PTY 与输入租约后端已实施，详见 §16；后续接口仍按任务逐步落地。

## 1. 共同约定

- 所有接口均经现有会话鉴权；写操作校验 Origin / CSRF，WS 握手及订阅沿用当前守卫。只接受 Zod 校验后的输入。
- Scope 为互斥联合 `{ projectId } | { sessionId }`；后者仅解析真实独立会话 workspace，不能用来源 sessionId 覆盖资源归属。服务端返回 `{ projectId: string | null, workspaceSessionId: string | null }`。项目终端可带 sourceSessionId，但只作为来源。
- 顶部全局终端无 scope 时由服务端选 dataDir 专用 workspace；该能力仅人工终端创建可用。文件 API 必须显式 scope，禁止任意绝对路径读取。
- 输入 path / cwd 为根内相对路径，分隔符在边界归一化；拒绝 NUL、`..` 逃逸、非法 Windows 路径和符号链接操作。返回 realpath 仅对已授权资源，用于冻结 viewKey 去重。
- 创建资源、Git 动作、执行与取消 / 终止支持 Idempotency-Key；同一认证会话 + 路由 + key 下参数不同返回 CONFLICT，相同请求返回第一次的资源结果。幂等记录持久化；不能仅在内存防重。
- 列表默认 50 / 最大 200；分页 cursor 不透明且有界。seq / 输出 after 为非负整数，未来游标拒绝；所有时间 Unix ms。
- 任何执行关联 scope、实际 clientSessionId、executionId、policySnapshotId；Agent 才附真实 sessionId / turnId / toolCallId。审批、租约 owner、锁 token 不由前端自行指定。

## 2. 文件 REST

| 方法 / 路径 | 输入 | 成功结果 |
|---|---|---|
| GET `/api/projects/:id/files` | `path=.`、`limit`、`cursor`；直接子项懒加载 | `{ items: FileEntry[], nextCursor, revision }` |
| GET `/api/sessions/:id/files` | 同上，仅独立 workspace | 同上 |
| GET `/api/files` | `projectId` 或 `sessionId`，`path`，可选 `version` | `{ path, realPath, content, version, size, encoding: "utf-8" }` |
| PUT `/api/files` | `{ scope, path, content, expectedVersion }` | `{ path, realPath, version, previousVersion, size }` |

FileEntry 为 `{ path, name, type: "file" | "directory", size? }`。稳定排序：目录优先，组内名称排序。目录内容变化导致分页快照失效时 CONFLICT，客户端从第一页刷新。version 参数只检查当前版本，不承诺历史版本存储。

读 / 写内容上限 512 KiB；JSON 受 1 MiB 限制，转义后过大也拒绝。只编辑已存在普通 UTF-8 文本，不支持创建文件。保存冲突为 409 VERSION_CONFLICT，details 只含 `{ currentVersion }`；Diff 通过授权 GET 重读后在前端生成，不在错误中塞文件全文。M1 文件工具按行读取契约不变。

项目根重新解析失败或项目解除关联后该 scope 不可继续写；文件 Tab unavailable，保留本地草稿供复制。所有活跃写资源存在时解除项目关联返回 RESOURCE_LOCKED；先显式停止 / 取消，不能级联删除源码或偷偷迁移锁归属。没有活跃资源时沿用 M1 仅删元数据的行为。

## 3. CommandExecution 与 Agent 工具

`run_command` 参数：`{ executable, args: string[], cwd?: string, timeoutMs?: number }`。scope / client / policy / Turn 关联由执行上下文注入。未提供 env 字段；不接受模型提供环境密钥。默认 shell:false，显式 Shell 作为 L2 命令审批。每个命令持久化规范化参数摘要及哈希，不在审计写完整命令正文。

状态：`CREATED → RUNNING → COMPLETED | FAILED | CANCELLED | TIMED_OUT | INTERRUPTED`；可经 `CANCELLING` 等待清理。spawn 失败 FAILED；exitCode 非 0 为 FAILED，不能报告成功。

| 方法 / 路径 | 说明 |
|---|---|
| GET `/api/commands/:id` | `{ id, scope, status, exitCode?, reasonCode?, truncated, startedAt?, endedAt?, currentSequence }` |
| GET `/api/commands/:id/output?after=&limit=` | 有界输出页；与终端输出页同结构，附 stdout / stderr 通道 |
| POST `/api/commands/:id/cancel` | 空对象；幂等停止请求，返回当前资源状态 |

本期不开放通用 POST /api/commands，创建来自受控 Agent 执行链；取消仍校验资源归属。ToolResult 附 commandId、exitCode、脱敏输出摘要、truncated。默认 120s / 最大 600s；输出总上限 1 MiB，WS 每块不超过 16 KiB。取消或续租失败先终止进程组，确认清理后才完成和解锁。

## 4. Terminal REST、输入与租约

| 方法 / 路径 | 输入 / 输出 |
|---|---|
| GET `/api/terminals` | 按 projectId / workspaceSessionId / 全局过滤；返回分页资源，不读取客户端 Tab |
| POST `/api/terminals` | `{ scope?, cwd?: ".", sourceSessionId?, riskAcknowledged: true }`；服务端固定平台 Shell；201 Terminal |
| GET `/api/terminals/:id` | Terminal 与当前租约元数据 |
| POST `/api/terminals/:id/terminate` | `{ confirmed: true }`；主动关闭终端 Tab 或显式终止都经此能力，幂等停止；窗口关闭不调用 |
| POST `/api/terminals/:id/resize` | `{ connectionId, leaseGeneration, cols, rows }`；cols 2–500、rows 1–300 |
| POST `/api/terminals/:id/lease` | `{ action: "acquire" \| "renew" \| "release", connectionId, leaseGeneration? }` |
| GET `/api/terminals/:id/output?after=&limit=` | 脱敏的有界游标回放，最多每页 64 KiB |

Terminal：`{ id, projectId, workspaceSessionId, sourceSessionId, executionId, cwd, shell, status, createdAt, startedAt?, endedAt?, exitCode?, currentSequence, lease }`；状态 `CREATED / RUNNING / STOPPING / EXITED / TERMINATED / INTERRUPTED`。重启不恢复 PTY，不因恢复 Tab 自动 POST 新资源。

订阅成功返回服务端 connectionId；人工申请仅接受该会话持有的活 WS 连接；AI 工具由真实 Turn / executionId principal 申请同一租约，见 §10。lease 为 `{ ownerType, ownerClientSessionId, ownerConnectionId?, ownerTurnId?, ownerExecutionId?, generation, expiresAt } | null`，generation 单调递增且不复用；不是身份 Token。30s TTL、10s renew；使用服务端时钟。旧 generation 输入 / resize / renew / release 均拒绝，两个并发 acquire 只成功一个。WS 输入新增消息：

```ts
{ type: 'terminal.input', terminalId: string, leaseGeneration: number, inputSequence: number, data: string }
```

服务端按当前连接验证持有者与 generation；inputSequence 在该租约内递增，重复不重放按键，未来跳号拒绝并要求重同步。每条 ≤ 8 KiB，单连接 ≤ 64 KiB/s；粘贴也受同一限制。禁止把输入正文记日志。身份过期 / 撤销 / 断线立即释放输入租约，PTY 仍运行；输入租约与源码写锁不绑定。不提供人工之间的 force takeover；人工显式接管 AI 控制按 §10 原子交接。

### 4.1 Agent 项目开发终端工具（设计已批准）

- `start_project_terminal({ role, executable, args, cwd? })`：projectId、sourceSessionId、Turn / ToolCall / 策略从执行上下文注入，不能改为其他项目或全局目录。role 为 1–64 个受限字符的用途标识（如 frontend / backend），不是授权范围。开发常驻执行逐次 L2 批准，参数规范化后绑定程序 / 参数 / cwd / 项目 / role；后端 PTY 直接 spawn 程序及参数，不靠向用户已有 Shell 模拟键入启动。显式 Shell 仍须批准其完整参数。
- `read_terminal_output({ terminalId, after?, limit? })`：按资源归属授权，返回与 REST 相同的脱敏游标页；单次最多 64 KiB，并受工具输出预算约束。不隐式抢输入租约。
- `stop_project_terminal({ terminalId })`：显式停止自己创建且归当前项目的终端，按工具策略授权和审计；不自动停止其他来源资源，不以停止 Turn 代替停止终端。终止需实际确认退出。

新增 Terminal 字段 `mode: "shell" | "dev"`、`role: string | null`、`launchParamsHash: string | null`、`createdByTurnId: string | null`；内部保存规范化启动程序 / 参数，敏感材料按现有规则拒绝 / 脱敏。人工与 AI 输入 / resize 共享唯一控制租约；Agent 创建进程无需伪装浏览器 connectionId，输入 / 中断 / 交接工具见 §10。

同项目 + role 只允许一个活跃 dev 资源；相同规范化参数重试返回已有 terminalId，不重新执行；参数不同 CONFLICT。角色不是服务 ID，不保证端口或健康。已结束资源可显式重新启动为新 terminalId，不能因订阅 / 恢复 Tab 自动启动。人工 Shell 与 dev 终端可分别存在；均不因窗口关闭 / 最小化结束；主动关闭终端 Tab 复用经授权 / 幂等的 terminate，确认终态才移除 Tab，失败保留。

创建成功持久化资源、创建结果与 `terminal.created` 事件后返回 `{ terminalId, role, status, reused }`；立即退出通过终态反馈，不宣称 ready。发起客户端据 origin=agent 在项目组插入 Tab（不抢焦点），其余客户端仅更新全局资源列表。真正 Tab / 窗口仍是各客户端本地状态。创建成功交付前取消需清理未交付进程；交付后终端属于项目，Turn 结束 / 取消不自动停止，需独立停止操作。服务端崩溃仍按 INTERRUPTED 对账。

锁例外已按 ADR-029 批准：dev / 交互终端不持续持有源码写锁，可与编辑并行；受管源码写任务仍串行，不能把安装 / 格式化 / 迁移等写任务送入 dev 路径规避锁。用途校验 / 审批不构成 OS 隔离；脚本仍可能修改源码或脱组，明确残余风险。M3 的服务登记、端口、健康与预览另行实施。

## 5. Git 与人工资源动作

| 方法 / 路径 | 输入 / 输出 |
|---|---|
| GET `/api/projects/:id/git/status` | 分支、HEAD、ahead/behind、staged / unstaged / untracked；含 snapshotVersion |
| GET `/api/projects/:id/git/diff` | `path`、`staged=true/false`；返回文本差异、二进制标志和 truncated |
| GET `/api/projects/:id/git/log` | limit ≤ 100、cursor；仅结构化 commit 信息 |
| GET `/api/projects/:id/git/branches` | 本地分支与当前分支，分页 |
| POST `/api/projects/:id/git/actions` | 规范化结构化 action，创建资源动作（201），不立即执行 |
| GET `/api/resource-actions/:id` | 状态、风险、脱敏摘要、paramsHash、snapshotVersion、expiresAt、结果 |
| POST `/api/resource-actions/:id/decision` | `{ decision: "approve" \| "reject" }`；仅 pending，绑定实际审批客户端 |
| POST `/api/resource-actions/:id/execute` | 空对象；幂等；校验审批 / 哈希 / 快照并执行 |

动作联合：`{ action: "add", paths: string[] }`、`{ action: "commit", message }`、`{ action: "createBranch", name }`、`{ action: "switchBranch", name }`、`{ action: "pull" }`、`{ action: "push" }`。paths 非空且最多 200 项；message 1–4000 字符；分支名用 git check-ref-format 验证，不接受任意 flags。

L1 人工动作创建为 PREPARED，execute 表示显式操作；L2 为 WAITING_APPROVAL，decision 批准后 APPROVED 再 execute。状态另有 RUNNING / COMPLETED / FAILED / REJECTED / EXPIRED / INTERRUPTED。5 分钟有效期，不支持长期 / 跨动作复用。执行原子消费批准状态；重试只返回同一执行结果，不能再次 push。

快照覆盖 HEAD、index、相关工作区状态、分支 / 上游 ref、远端配置摘要；远端 URL 含凭据时不得明文返回或记录。M2 不执行远端管理动作。Git hooks / filters 仍可能运行主机代码；写操作走同一执行身份、环境过滤、超时、输出上限和锁，不宣称 shell:false 消除了脚本风险。

Git Agent 工具使用相同 Manager，但通过既有 Turn 审批，不把人工 actionId 伪装成 toolCallId。read 类 L0，add / commit / 分支 L1，pull / push L2；严格 / 宽松策略仍不得放行被定义为逐次批准的远端动作。

## 6. 事件与回放

新增 `command` 主题，其他主题沿用 file / git / terminal；不修改 Agent 的 Session seq 规则。关键事件使用原 ServerEvent 信封并在事务内持久化：

| streamId | type | 关键 payload |
|---|---|---|
| `terminalId` | `terminal.created`, `terminal.status`, `terminal.exit`, `terminal.lease` | 状态 / exitCode / reasonCode、租约元数据 |
| `commandId` | `command.status` | 状态、退出码、truncated、时间 |
| `file:project:<id>` 或 `file:session:<id>` | `file.changed`, `file.resync.required` | path、version?、changeType；溢出需全量树刷新 |
| `git:<projectId>` | `git.status.changed`, `git.action.changed` | 缓存失效提示 / actionId / status |

GET `/api/resource-events?streamId=&after=&limit=` 返回 `{ items, currentSequence, resyncRequired }`；limit 默认 100 / 最大 500。streamId 先解析归属再鉴权，不能借它枚举无权资源。事件保留 30 天；过旧 / 已清理时 resyncRequired=true，客户端拉资源快照。file / git 通知只使 Query 失效，服务器查询为准。

大流量输出单独信封 `{ kind: "terminal.output" | "command.output", resourceId, cursor, data, channel?, timestamp }`，不占关键事件 sequence。输出页为 `{ chunks: [{ cursor, data, channel? }], oldestCursor, nextCursor, truncated, resyncRequired }`；cursor 是资源内脱敏输出块序号，与文件字节偏移无关。过旧时明确缺口并从 oldestCursor 继续，不能悄悄拼成完整历史。

终端每个内存环 1 MiB；落盘 7 天 / 每终端 10 MiB / 总量 100 MiB，先触发者轮转，0600；终端 / 命令输出不直接放 SQLite 事件。命令输出累计 1 MiB，最多保留 7 天。先脱敏再进环 / 写盘 / 推送；DB 写状态失败不得广播成功。慢客户端丢弃增量并提示补拉，不阻塞生产者或无限缓存。

## 7. 数据草案与迁移归属

| 任务 | 表 / 变化 | 约束 |
|---|---|---|
| M2-1 | `file_versions(scope_key, path, real_path, version_hash, size, mtime, updated_at)`；`resource_events(id, stream_id, seq, type, payload_json, created_at)`；`resource_streams(stream_id, last_seq)`；`resource_operations(id, scope_key, kind, status, params_hash, idempotency_key, client_session_id, result_json, created_at, updated_at)` | 文件索引不存内容，不作权威版本；UNIQUE(stream_id, seq)；操作记录包含写意图与幂等结果 |
| M2-3 | `command_executions(id, operation_id, project_id?, workspace_session_id?, session_id, turn_id, tool_call_id, policy_snapshot_id, params_hash, status, exit_code?, reason_code?, truncated, process_identity_json?, created_at, started_at?, ended_at?)` | 原始环境 / 秘密不存库；operation_id 唯一；进程身份用于恢复对账，不能单凭 PID 杀进程 |
| M2-4 | `terminals(id, operation_id, project_id?, workspace_session_id?, source_session_id?, cwd, shell, mode, role?, launch_params_json?, launch_params_hash?, created_by_turn_id?, status, process_identity_json?, created_at, started_at?, ended_at?, exit_code?)`；`terminal_leases(terminal_id, generation, owner_type?, owner_client_session_id?, owner_connection_id?, owner_turn_id?, owner_execution_id?, expires_at, heartbeat_at)` | 每终端一条租约；释放保留 generation，重启作废全部旧连接；事务更新资源与事件；同 project_id + role 的活跃 dev 资源唯一 |
| M2-5 | `resource_actions(id, operation_id, project_id, kind, risk, status, params_json, params_hash, snapshot_hash, requested_by, decided_by?, expires_at, decided_at?, started_at?, ended_at?, result_json)` | params_json 只含结构化非秘密参数；批准状态单次消费；不改变 M1 approvals 的 Turn 约束 |
| 各写任务 | 复用 `resource_locks` 的 owner / execution_id / fencing_token / expires_at / heartbeat_at | 顺序 global-maintenance → project → service → file/git；每次副作用前重验 |

每任务至多一个新增迁移，编号实施时取当时下一号；空库 / 升级库均测。M2-7 不新造第二套锁 / 表。数据不放源码目录；新增全局终端 workspace 位于 `<dataDir>/sessions/global-terminal/workspace`，避免新增顶层数据目录。该目录与独立会话 workspace 同样授权。

文件写、命令、PTY、Git 统一复用 resource_operations 幂等及写意图记录；结果不存文件全文 / 原始输出。参数哈希绑定请求，活动资源记录关联实际进程。既有项目写锁扩展为规范化根冲突域：根相同或互为祖先的受管源码写作业不能并发，独立 workspace 同规则；不能用不同 projectId 绕开。开发 / 交互终端是拟议例外，可能并行写入，边界已按 ADR-029 批准。M2-0 验证算法 / 身份恢复后在 plan 固化细节。

事件默认 30 天、终端与执行元数据 30 天；过期仅清理非活跃元数据 / 输出和已失效幂等记录，不自动删除 workspace 源码或会话 artifacts。输出不进备份，业务 DB 沿用既有一致性备份。回滚应用前先确保没有活跃新资源；不删列 / 表 / 用户数据来回退。

## 8. 错误码草案

继承 UNAUTHENTICATED、FORBIDDEN、ORIGIN_INVALID、CSRF_INVALID、VALIDATION_ERROR、NOT_FOUND、CONFLICT、VERSION_CONFLICT、PATH_OUTSIDE_PROJECT、RESOURCE_LOCKED、APPROVAL_INVALID、INTERNAL。拟补充：

| code | HTTP | 含义 |
|---|---|---|
| `FILE_NOT_EDITABLE` | 422 | 二进制、无效 UTF-8 或非普通文件 |
| `PAYLOAD_TOO_LARGE` | 413 | 文件 / 请求 / 输入超过上限 |
| `TERMINAL_LEASE_REQUIRED` | 409 | 无当前连接租约或 generation 已失效 |
| `RESOURCE_UNAVAILABLE` | 409 | 资源已结束 / 中断或仍需对账 |
| `GIT_UNAVAILABLE` | 503 | Git 未安装或无法执行 |
| `GIT_CONFLICT` | 409 | 脏工作区、ref 变化或无法快进 |
| `GIT_AUTH_REQUIRED` | 409 | 主机现有认证不可用，要求本机处理 |

命令非零 / 超时 / 取消是执行资源的终态，HTTP 查询仍返回该资源；不能把子进程 stderr 原样当服务器错误。错误 details 仅含有限的 owner / resourceId / 当前版本 / 可恢复原因，不返回输入、完整主机环境或认证材料。

## 9. ADR-030 补充：Tab 关闭、文件卡片与 M3 边界

主动关闭终端 Tab 携带显式后端终止意图，不能只从 store 删除；等待实际退出、持久化状态再移除发起者视图，其他客户端显示 ended。失败保留 Tab / 错误；重复请求查询同一资源结果。窗口关闭 / 最小化、刷新 / 断网、筛选 / 布局迁移不调用 terminate。关闭 Browser Tab 不停止源服务，关闭文件 Tab 不删除文件。

服务没有 Tab，采用服务窗口 filter / selectedServiceId、卡片 / 详情，不再把 services 作为 WindowTab.kind；旧布局按视图迁移，不触发资源停止。临时服务注册 / 退登归 M3，TerminalManager 提供 terminalId、每次执行身份、状态与退出事件，作为源进程的唯一控制者。PM2 持久服务不挂终端 Tab。

M2 文件工具结果与 artifact 事件补结构化 `resourceTarget`，file target / 点击解析见 [services-preview §6](services-preview.md)。预览 target 属 M3，须登记验证后才可生成，不以任意 URL 直接 iframe。

完整 AI 终端交互技术草案见 §10：输入 / 中断、principal 联合、generation、人工接管、审计与取消；M2-4d 负责接线与验收，schema 已通过 G-Spec-M2，按所属任务落地。

## 10. AI 终端输入与人工接管（技术草案）

为补齐完整终端操作，拟增加 `acquire_terminal_control({ terminalId })`、`send_terminal_input({ terminalId, leaseGeneration, inputSequence, data })`、`interrupt_terminal({ terminalId, leaseGeneration })`、`release_terminal_control({ terminalId, leaseGeneration })`；已有 start / read / stop 复用同一个 TerminalManager。身份、Turn / executionId、项目和 policy 由工具上下文注入，不接受模型伪造 owner 或浏览器 connectionId。

租约 principal 拟改为判别联合：human 绑定真实认证会话 + WS connectionId；agent 绑定真实发起认证会话 + sessionId / turnId / executionId。共享同一 terminalId 的唯一租约、30s TTL / 10s 续租、递增 generation，任何来源只有持有者能输入 / resize / 中断。读取输出不抢控制权，终止则按独立资源授权执行。Agent 工具经 ToolRegistry / 参数审批后才能调用内部输入能力，禁止直接连接 PTY 绕过审计。

人工显式“接管 AI 控制”由后端原子撤销 Agent generation 后授予人，旧 Agent 输入立即失败并告知 Turn 暂停终端操作；Agent 不自动抢回。两人工客户端不强抢，仍等待到期 / 主动交接。原始身份撤销、Turn 取消 / 结束、工具执行失效立即撤销相应 Agent 租约，但已成功交付的终端进程继续，只有显式中断 / 停止或终端 Tab 关闭才改变进程。人工断线同样只释放其输入租约。

inputSequence 在该租约中递增，重复包不重放，迟到 generation 拒绝；每次输入 ≤ 8 KiB、速率沿人工 64 KiB/s 上限，工具调用 / Turn 预算另行限制。interrupt 发送当前终端的中断控制（例如 ETX），不将“已发中断”报告为“进程已退出”；需重读输出 / 状态确认。输入 / 中断前按实际程序 / 操作风险沿工具策略审批，不能在取得一次租约后无限绕过工具策略。原始输入正文、密码、Token 不进入日志 / 事件；只记长度、资源、执行关联和允许 / 拒绝，不引入自动填写主机凭据能力。

M2-4 定义共享 principal 租约存储 / 校验；M2-4d 接工具、人机交接和假时钟 / 真实 PTY 验证；schema 已通过 G-Spec-M2，按任务实施，不把本文当作已经上线协议。

## 11. M2-1 实施契约（2026-11-03）

G-PoC-M2 已随人类“开始m2-1”确认通过。本节覆盖本任务已实现细节；命令 / PTY / Git、监听与 WS 补拉仍按后续任务实施。

- 文件 GET / PUT 和两个目录 GET 已注册在现有鉴权守卫后。PUT 再校验活动客户端和 scope；读取返回前同样复核客户端及资源登记。JSON 1 MiB；编辑内容按 UTF-8 字节最多 512 KiB，保留 BOM / CRLF / LF，使用原始字节 SHA-256。错误新增 FILE_NOT_EDITABLE(422)、PAYLOAD_TOO_LARGE(413)、RESOURCE_UNAVAILABLE(409)。
- path 归一化为根内相对路径；拒绝绝对路径、越界、NUL、Windows 非法保留名 / ADS、任一符号链接组件及非普通文件。打开 fd 后比较路径 / fd 的 dev、inode、size、mtime，再返回内容；不宣称能消除最后一次校验后的外部竞态。
- 项目 scope 禁止读取 Larness dataDir 内运行数据，目录列表隐藏该数据目录；独立会话只允许其真实 sessions/<id>/workspace。项目会话及被解除项目关联后 projectId=null 的历史会话不能伪装成独立 workspace。已知 SecretStore 凭据明文命中时拒绝编辑 / 返回，不以脱敏后的文本替换编辑底稿；不宣称识别任意未知秘密。
- 目录默认 path=. / limit=50，最大 200，目录优先、组内按名称排序。cursor 为有界 base64url 快照，绑定 canonical 目录 / revision / offset；快照变化返回 CONFLICT，非法 cursor 返回 VALIDATION_ERROR。不递归返回子树；沿用 M1 ignore 匹配方式。
- PUT 的 Idempotency-Key 可选、1–128 字符；省略时只为该请求生成独立操作标识。唯一键为 client_session_id + kind(file.save) + key；参数摘要绑定 scope / 规范化 path / expectedVersion / 目标内容哈希。相同参数返回首次持久结果，换参数 CONFLICT；进行中或待对账返回 RESOURCE_UNAVAILABLE。失败结果同键不重试副作用，修改后使用新键。
- 保存先在同一事务获取共同根冲突锁、写 PREPARED 意图和审计，再记 WRITING。锁内重新读取完整版本与文件身份，同目录 wx 临时文件写入 / fsync / 保留普通权限位，最终复核 scope / 客户端 / fencing 后 rename。临时名称为 .larness-save-<operationId>，不会把正文存进数据库或事件。
- 文件落盘后，同一事务提交版本缓存、file.changed 事件与递增 seq、COMPLETED 结果及审计；失败不返回成功。本任务只持久化资源事件，通知 / 补拉 / 事件保留清理在 M2-1b 接线，不能据此认为完整 A2 通知已交付。
- 状态为 PREPARED → WRITING → COMPLETED / FAILED / RECONCILIATION_REQUIRED。落盘或临时清理结果不确定时保留待对账，阻塞重叠根，不能仅按锁 TTL 开放新写作业。启动在监听前对账：目标等于目标版本则补记结果 / 事件，仍为原版本则标失败；其他内容 / 授权不明保持受阻，绝不自动回写。只清理该持久操作的确定临时文件名且字节哈希匹配的文件，不扫描清理用户源码；部分写入 / 文件不明需要本机核实。
- root_real_path 加到既有 resource_locks；migration 0005 将既有项目锁从 projects.real_path 回填。同根或祖先包含互斥；独立 workspace 同规则；不重叠根可并发。M1 Turn / 文件保存复用同一锁，写前检查有效 fencing；存在活跃写者时登记重叠根或解除项目关联返回 RESOURCE_LOCKED。

0005_resources 为唯一新增迁移：file_versions、resource_streams、resource_events 与 resource_operations，并增加锁的根字段。resource_operations 在 §7 摘要之外增加 root_real_path、path、expected_version、target_version、lock_id、fencing_token、error_code 用于对账 / fencing；不存正文。mtime 记录 Unix ms。无破坏性迁移，不修改 0001–0004；应用回滚保留表 / 数据，需先确认写操作已结束并清理不确定项，不执行 down migration。


## 12. M2-1b 文件监听与事件恢复（2026-11-03）

### 订阅与快照

文件订阅为 `{ topic: "file", resourceId: "project:<id>" | "session:<id>", paths?: string[], after?: number }`。paths 默认 `["."]`，1–128 个根内相对路径，代表已展开目录 / 已打开文件，不递归监听整个项目。after 默认为 0，必须为非负安全整数；超过当前流序号返回 VALIDATION_ERROR。目录 / 文件均复用 M2-1 scope 授权、真实路径和运行数据边界；独立会话只能使用其真实 workspace。

流键为 `file:project:<id>` / `file:session:<id>`。订阅确认 `{ kind: "subscribed", subscription: { topic: "file", resourceId }, currentSequence, resyncRequired: true, partial }`：每次订阅建立当前基线，确认后须重新 GET 文件 / 目录快照；不能假设未监听或断线期间的外部修改都有事件。partial 表示当前存在监控降级。历史通过 REST 补拉，实时事件可在确认之前到达，客户端按 sequence 去重、缓冲并衔接。取消订阅使用 `topics: [streamId]`；断线 / 撤销释放该连接引用，其他浏览器引用仍保留。两台电脑订阅同目录共用 watcher，文件视图和草稿仍由各浏览器维护。

### 有界监听与通知

每实例最多 128 个原生目录句柄，相同真实目录共享句柄；单次单层扫描最多检查 2000 个条目（含被忽略项）。默认忽略规则、符号链接和受保护数据目录不进入快照；保存暂存文件名不通知。50ms 合并通知，待对账集合最多 256 个，每 2s 轮转扫描已订阅路径；不依赖平台递归 watcher。超限路径不保存详细监听快照，降级后保留手动 GET 刷新和保存时版本校验。

`file.changed` payload 为 `{ path, changeType: "created" | "modified" | "deleted", version?: SHA256 }`；正文不进入事件、缓存或审计。编辑文件可提供版本，不可编辑 / 超限文件只通知元数据。API 保存的相同已提交版本不重复广播。外部变更提示缓存失效，GET 才是当前权威状态，不承诺记录每次中间写入。

`file.resync.required` payload 仅含 reasonCode：WATCH_UNAVAILABLE、WATCH_LIMIT、SCAN_LIMIT、QUEUE_OVERFLOW、ROOT_UNAVAILABLE、DIRECTORY_REPLACED、RECOVERED、SCAN_FAILED。句柄失败、目录身份替换、限额、扫描异常会要求刷新；恢复后重建句柄 / 基线并通知 RECOVERED。事件写入与 stream 序号在同一事务内提交后才广播；数据库失败不广播，失效标记保留并重试。已知凭据不得出现在路径通知中，失败只发通用失效原因，不回传异常原文。

### 补拉、保留与背压

GET `/api/resource-events?streamId=&after=&limit=` 当前仅支持文件流。返回 `{ items: ServerEvent[], currentSequence, resyncRequired }`，limit 默认 100、最大 500；翻页用最后一个 item.sequence，直至追上 currentSequence。未来 after 返回 400；每次解析流归属并授权，返回前重查 Cookie / scope，拒绝未登记或已移除资源。

事件保留 30 天，沿用定时清理；补拉即时过滤过期记录。清理只删 resource_events，保留 resource_streams.last_seq；发现头部 / 中间 / 尾部缺口返回 resyncRequired=true，即使全部清空也不重置序号。客户端收到失效事件或 resyncRequired 时重新查询资源快照。此任务不新增保留期配置键。

WebSocket 输入最大 1 MiB，控制消息串行处理且待处理最多 64 条；每连接最多 64 个主题。发送缓冲超过 8 MiB 时关闭 1008，使用持久事件补拉恢复，不堆积无界内存队列；广播失败不能回滚已完成文件保存。每次文件推送检查浏览器会话和资源归属；关闭时释放监听引用，Server 退出等待在途扫描后再关闭数据库。

本任务无新迁移 / 依赖 / 配置 / UI；手动刷新能力复用文件与目录 GET。编辑器刷新按钮、Query 失效及冲突交互在 M2-2 接线。


## 13. M2-2 编辑器与文件结果（2026-11-03）

真实模式文件树通过项目 / 独立会话目录 GET 单层懒加载，分页、失败重载与手动刷新复用原接口。打开文件先重新 GET 授权 / 完整正文 / realPath，按文件类型 + realPath 复用 Tab；切换授权来源更新 scope / 来源及项目分组，不根据当前左侧项目替换文件的授权根。旧 Demo 文件 Tab 不作为真实路径打开，提示重新选择。显式 Demo 模式保留只读静态资源。

当前正文与版本由 TanStack Query 管理；未保存草稿只在内存保存 `{ text, baseVersion }`。布局只持久化 scope / 相对路径 / realPath 身份等视图元数据，不持久化正文 / 草稿。Monaco model 按文件身份独立保留，切 Tab / 项目、隐藏或关闭文件窗口不丢草稿；文件窗口关闭只隐藏，主动关闭脏 Tab 弹保存并关闭 / 放弃改动 / 取消。保存失败保留 Tab 和草稿；刷新 / 退出页面前通过 beforeunload 提示可能丢失。

保存携带草稿 baseVersion 与单次 Idempotency-Key，仍由既有后端锁 / fd / 哈希 / 写意图保护。保存时禁止重复提交；失败不清草稿。磁盘版本改变时干净 Tab 自动更新，脏 Tab 保留文本并显示冲突；Diff 对比当前磁盘与草稿，只读。重新加载明确放弃草稿，手工合并明确采纳当前磁盘版本作为新 baseVersion 并保留草稿，编辑后再保存；后续磁盘变化仍需再次核验，无强制覆盖接口。不可编辑 / 超限 / 路径失效显示明确错误，失效时已有草稿仍可复制，不能把截断内容保存回源文件。

文件订阅使用 §12 契约，展开目录与全部已开文件分别按 scope 订阅，隐藏窗口的文件仍订阅。确认 / 重连 / 缺口使 Query 失效并重取快照；补拉每页 500、每次最多 10 页，长历史转快照恢复而非无限循环。每个订阅最多 128 路径、超出显示部分监听；连接失败 / 降级有提示及手动刷新。通知与补拉均以 shared Zod schema 验证，不用通知正文替代权威 GET。

`tool.completed` 增可选 `resourceTarget: { kind: "file", scope: { projectId } | { sessionId }, path, version? }`，当前由成功 apply_patch 的真实执行上下文 / 结果生成；模型不能选择授权 scope。目标不含正文 / 绝对路径 / 执行命令。卡片在工具组折叠时也可点击；点击只重新授权读取并打开 / 聚焦文件，不重复执行修改。文件已变化则打开当前版本并提示，已失效 / 无权访问显示错误。

无 REST 路径、数据库迁移、配置键、认证 / IPC 或依赖变更；Monaco / Query / Zustand 复用已冻结依赖。完整资源布局 schema 升级及其他资源窗口在 M2-6，不将文件接线视为终端 / Git / 服务已完成。

## 14. M2-3 命令执行后端（2026-11-03）

本任务只接执行底座、授权状态 / 输出 / 取消 API 及 command 状态订阅 / 补拉；`run_command` 工具注册、风险 / 审批接线和实时卡片由 M2-3b 实施。不开放 POST `/api/commands`，没有通用 Web 执行入口。内部执行上下文必须来自真实 session / Turn / 活动客户端，提供授权断言、policySnapshotId、toolCallId、剩余预算及可选 AbortSignal；scope 由会话归属推导，不能由模型指定。

### 参数、锁与状态

- 参数沿 §3：executable、args、cwd、timeoutMs；严格拒绝 env 等额外字段。程序名最多 4096 字符，参数最多 256 个、每个最多 8192 字符，合计字符上限 65536；拒绝 NUL。cwd 为根内规范化相对目录，拒绝链接 / 越界 / 受保护运行数据，执行前重新核验。
- 默认 120s / 最大 600s，启动前扣除准备耗时并取 Turn 剩余预算的较小值。到期开始有限停止流程，停止确认前保持冲突屏障；不把超时视为已停止。
- resource_operations 的 kind 为 command.run，幂等键为真实 Turn ID + toolCallId 的 SHA-256，仍按实际 client_session_id + kind + key 唯一；参数哈希绑定会话、Turn、策略、根及规范化参数。相同执行复用记录 / 等待原执行，参数不同 CONFLICT；不同 Turn 可复用供应商的同名 toolCallId。没有活动 Runtime 的未完成记录返回 RESOURCE_UNAVAILABLE，不伪报运行或重启进程。
- 先在事务内取共同根写锁、提交 PREPARED / CREATED、审计与递增序号，再准备输出与执行。command 的 operation.path 为 cwd，非文件操作的 expected_version / target_version 使用空字符串，不解释为文件版本。WRITING 在 spawn 前持久化；onSpawn 记录 RUNNING 和本代进程身份。状态 / 结果 / 序号事务提交后才广播。
- 自有锁在执行期间续租，直到进程组确认停止、最终状态落库后释放；可验证并复用相同 Turn / canonical root 的有效 inheritedLock，不重复获取或代替 Turn 释放。续租失败、Turn 取消、AbortSignal 均先停止；未确认停止或最终状态提交失败保留 RECONCILIATION_REQUIRED，TTL 不能解除根冲突。

### 进程与输出

使用 Node spawn、shell:false 和独立 POSIX 进程组；环境仅继承 PATH / HOME / 临时目录 / locale / TERM，不继承 NODE_OPTIONS、管理环境或 SecretStore 明文。显式 Shell 由后续审批层按 L2 处理，执行器不宣称命令名白名单或 cwd 是沙箱。

取消 / 超时先向本代受管组发 TERM，默认等待 300ms 后必要时 KILL，强制阶段轮询预算 2s（每次系统查询另有 2s 上限）。每次发信号前通过内存中的 PID / 启动时间 / 可执行文件快照复核本代成员；只在原组长仍存活时登记新增同组成员。组长退出后，必须仍有已登记成员匹配，不能只凭旧 PGID 发信号；无法确认归属时保守阻塞。这仍存在最后一次检查至发信号的竞态，不宣称原子进程身份。管道关闭额外等待有界 200ms。组 / 管道状态无法确认时返回 INTERRUPTED / STOP_UNCONFIRMED，输出标 truncated，保留根阻塞。主动脱组且关闭管道的主机进程不保证可追踪或约束；不能把进程组检查宣传为 OS 隔离。

stdout / stderr 分别流式 UTF-8 解码、按已知秘密与敏感字段跨块脱敏，再输出 / 落盘；认证头、Cookie、JSON 引号与转义均覆盖。每路保留有限匹配尾部，已知秘密超过 64 Ki 字符时执行前失败关闭。合计脱敏数据最多 1 MiB，每块最多 16 KiB；超限持续排空但不继续存储。输出落盘为 `<dataDir>/logs/commands/<commandId>.jsonl`，wx / 0600、目录防链接，含框架元数据最多 2 MiB；触及任一限额标 truncated。正文 / 原始环境 / 原始参数 / 输出不进入 SQLite、状态事件或审计。

### 查询、取消与恢复

- GET `/api/commands/:id` 返回 §3 的状态 DTO，不返回进程身份、参数正文或根绝对路径；查询和订阅均重新解析当前 scope 授权。
- GET `/api/commands/:id/output?after=&limit=` 返回 §6 输出页，after 默认 0、limit 默认 100 / 最大 500；未来游标 400。检测缺失 / 不连续 / 过期，resyncRequired=true；无可用记录时 nextCursor 推进到已知末尾，不伪造完整输出。
- POST `/api/commands/:id/cancel` 接受空对象，校验 Cookie / Origin / CSRF，真正停止前再检查客户端。持久的 CANCELLING / 终态使重复取消收敛，不重复发信号；Idempotency-Key 可选并校验长度，返回当前状态。200 只表示请求得到处理，STOP_UNCONFIRMED 不代表停止成功。
- WS `{ topic: "command", resourceId: commandId, after }` 订阅持久 command.status；未来 after 拒绝。GET `/api/resource-events` 已支持 commandId，复用 30 天保留 / 缺口语义。逐块 command.output 推送及 UI 在 M2-3b 接线，当前完整输出通过游标 GET 获取。
- 输出最多保留 7 天；安全终态元数据 / command.run 幂等记录 30 天后清理，保留流序号。不清理活动记录或待对账屏障，不删除源码 / workspace。
- 重启在监听前将未完成记录标 INTERRUPTED。仅 PREPARED 且无启动身份时可认定未启动并安全释放；WRITING 或已记录身份均保持 RECOVERY_UNCONFIRMED / 根阻塞，绝不按存储 PID 杀进程或重执行。未知情况由本机核实，后续恢复验收归 M2-7；本任务不新增强制解除接口。
- Server / TUI 关闭停止当前 Runtime，再关数据库；浏览器断线、窗口隐藏不取消命令。实际支持范围仅为已测试 macOS；Windows 入口失败关闭，不宣称跨平台清理已完成。

唯一新迁移为 0006_commands，新增 §7 command_executions 与 output_cursor（保存已知输出末游标以识别缺口）；不改已应用迁移 / 旧数据 / 配置 / IPC / 认证，未新增依赖。回退前排空受管进程并核实待对账项，保留新表、事件和用户源码，不做破坏性 down migration。

## 15. M2-3b Agent 命令与执行卡片（2026-11-03）

`run_command` 已注册到真实 Turn 工具集合，schema 复用 §14，严格拒绝 env / scope 等额外字段。创建 Turn 时由后端把真实发起 clientSessionId、随机 policySnapshotId 和当前审批策略写入 turns.input_json.executionContext；不接受模型或请求正文覆盖身份。DTO / 模型输入仍只取 text。旧 Turn 缺执行身份时命令失败关闭，不猜测客户端；无数据库迁移或新配置。

### 风险与审批绑定

- 只有程序名严格为 npm / pnpm / yarn，参数严格为 `[test|build|lint]` 或 `[run, test|build|lint]` 的调用分类 L1；绝对路径同名程序、额外参数 / flags、任意脚本与显式 Shell 均为 L2。直接调用 sudo / su / doas / chmod / chown / useradd / userdel / dscl / pfctl 分类 L3 并拒绝；这只是审批分类，不是完备风险检测或命令沙箱。
- standard 允许 L1，strict 要求审批，readonly 拒绝所有命令；L2 逐次批准，L3 即使提供批准也不放行。项目脚本依然可以执行主机代码，确认文案明确 Larness OS 账户与项目目录不是沙箱；常驻 dev 任务留给后续开发终端工具。
- 参数经 Zod 默认值 / 路径分隔符规范化后，审批哈希同时绑定参数、真实 session / Turn / client、策略快照与根。批准后重新取有效锁，真正 spawn 前再次校验同一审批与参数、客户端、Turn / 预算；批准 A 不能执行 B。审批摘要包含脱敏后的规范化程序 / 参数 / cwd / timeout，审计只记关联标识与风险，不保存原始命令正文。已知凭据字面量在产生摘要前拒绝，包括含引号的凭据；不声称识别任意编码 / 未知秘密。
- Turn 取消使待审批失效，不启动进程或后续工具；等待审批也消耗 Turn 时长，到期失效并结束预算。执行中的 Turn AbortSignal 传给 CommandManager；运行期间 Turn 持有的锁持续续租，命令只借用有效 handle，停止 / 结果不确定仍保留 §14 冲突屏障。卡片“取消命令”只取消该资源；“停止执行”取消 Turn 并阻止后续工具。

### 结果、实时输出与界面

- 创建 command 后先持久化 Agent `tool.command.created`，payload 为 `{turnId, toolCallId, commandId}`，沿用 Session seq；此关联提交失败不得 spawn。重放恢复同一资源卡片，不能重新执行或自动创建 Terminal / Tab。
- 工具结果包含 commandId、status、exitCode、有界脱敏输出摘要与 truncated；失败也可向模型返回摘要作诊断。摘要先限行 / 字符，再限制 JSON 转义后的尺寸，为 20,000 字符的工具消息预算保留包络空间；读取只取前 500 块，达到该页上限也保守标 truncated。完整有界输出仍由授权 GET 获取，不反复送入模型。
- 同一 command 订阅新增 `{kind:"command.output", resourceId, cursor, data, channel, timestamp}`；只推送已脱敏且写入输出文件的块，每块不超过 16 KiB，不占关键状态 seq、不存 SQLite。推送与状态均重查客户端 / 资源授权，复用 8 MiB 背压断连；遗漏块以 GET 输出游标补拉，实时帧不作权威历史。
- 单工具与折叠工具组均展示独立命令卡片：运行 / 停止 / 终态、退出码、原因、脱敏输出、截断 / 缺口、刷新与显式取消。服务端状态与输出只存 TanStack Query；WS 增量合并为 250ms 输出 Query 失效（状态事件另失效状态），输出 Query 按游标追加已获取的块，活动命令另有 2s 查询补偿。重连重新读快照并从输出游标读取，历史状态无需逐帧渲染；连接 / 页面卸载不取消进程。
- 输出读取最多 64 页 × 500 块，对应受限 2 MiB 日志快照；达到客户端页限明确截断，不无界循环。视图输出按文本渲染，不执行 HTML / ANSI；停止未确认明确显示中断与可能受阻，不把 HTTP 200 或取消请求当作已停止证明。

## 16. M2-4 TerminalManager 与输入租约后端（2026-11-03）

本任务已接真实 node-pty、REST / WS、持久状态、输入租约与输出轮转；xterm / 本地 Tab 接线在 M2-4b，Agent dev 工具与审批在 M2-4c，AI 控制 / 人工接管在 M2-4d。本节不把这些后续功能描述为已交付。

### 创建、范围与恢复

- POST `/api/terminals` 实施 §4，必须确认 riskAcknowledged=true，并提供 1–128 字符 Idempotency-Key；同一真实客户端 / kind / key 相同参数复用原资源，不同参数 CONFLICT。不接受 env、程序、args、owner、policy 等额外字段。人工 Shell 固定 `/bin/sh -i`（当前 POSIX 实现），初始 80×24 / xterm-256color，环境复用白名单并固定 HISTFILE=/dev/null，不继承 Shell 选择 / 管理环境 / SecretStore 明文。
- 项目 / 独立会话复用 canonical scope 与 cwd 授权；无 scope 使用 `<dataDir>/sessions/global-terminal/workspace`，逐层拒绝目录链接。sourceSessionId 仅用于来源且必须匹配实际 scope；全局终端不接受伪造来源会话。cwd 在 spawn 前重验；登记变化 / 主机最后时刻的路径替换仍不构成 OS 隔离。
- 内部 createDev 仅作为后续工具底座，需真实活动 Turn / 项目 / 发起客户端与授权断言，程序 / 参数 / cwd / role 使用 Zod；没有公共 dev 创建路由。相同项目 + role 的活跃记录在数据库唯一，相同启动哈希复用，参数不同 CONFLICT。程序参数的已知凭据字面量拒绝，持久 launch_params_json 为脱敏摘要、launch_params_hash 绑定原规范化参数；不把摘要当可恢复启动脚本。
- 唯一 0007_terminals 迁移新增 terminals / terminal_leases，补 reason_code / output_cursor 和人机 principal 预留列 / input_sequence，不修改旧迁移。终端 ID 为 term_UUID，executionId 为本次资源 ID；进程身份仅作本代关联 / 恢复诊断，不进入 DTO。
- resource_operations.kind=terminal.create，先事务提交 PREPARED / terminal.created / 审计与 seq，再写 WRITING / spawn；RUNNING 与创建完成同事务。创建操作 COMPLETED 仅表示交付资源，不表示进程退出。按 ADR-029 不长期占源码锁，既有 ledger 的 lock_id=""、fencing_token=0、文件版本空串仅作非文件 / 非持锁占位，不能解释为有效锁。
- 正常 Shell / dev 运行可与受保护文件写作业并行；活跃终端阻止项目解除关联 / 重叠根登记。未确认停止 / 结果提交失败 / 重启未知进程改 RECONCILIATION_REQUIRED，仍通过共同根屏障阻止受保护写，TTL 不能放行。重启将旧活动终端 INTERRUPTED、作废租约，不重建 PTY、不向存储 PID 发信号；仅 PREPARED 且无启动身份可认定未开始并安全结束意图。

### 生命周期与停止

终态为 EXITED / TERMINATED / INTERRUPTED，非零进程退出保持 EXITED + 真实 exitCode。显式 terminate 要求 confirmed=true，持久 STOPPING / 解除输入权后执行有限 TERM→KILL / 确认退出，再提交终态；重复请求复用同一 Runtime 停止 Promise，已结束资源只返回当前状态。只有实际拥有的本代 PTY 可停止，不按恢复 PID 杀进程。不能确认时 INTERRUPTED / STOP_UNCONFIRMED，最终结果提交失败尝试持久 RESULT_RECORD_FAILED / 屏障，既不能确认 Runtime 又无终态时查询失败关闭，不伪报运行。

PTY 适配器只在内存保存 PID / PPID / PGID / session / 启动时间快照，250ms 对账并在信号前重验；除主 Shell 组，也核对本 session 的前台任务与已知后代组。先处理其他组，再处理组长，300ms 后必要时 KILL、确认阶段 2s 预算（每次 ps 查询另有 2s 上限）。失去进程归属证据即停止发信号并保持受阻。ps / 信号之间仍有竞态，主动脱组且未观察到的后代不保证可发现；只据实支持已验收 macOS，不宣称强 PID 身份、沙箱或任意树清理。

窗口隐藏 / 页面断线 / 已交付资源的 Turn 完成和取消均不 terminate；断线只释放输入权。创建尚未交付时的内部 AbortSignal 会清理资源；成功返回后解绑创建 Turn。Server / TUI 关闭先停止当前 Runtime 并记录终态，再关闭数据库，未清理的情况继续保留恢复屏障。

### 租约与传输

- WS hello / terminal 订阅成功包返回 connectionId；只有实际认证连接订阅过该 terminalId 后，所属客户端才能用它申请 / 续租 / 释放租约。连接 ID 是关联标识，不是认证 Token，不能借其他连接 ID 输入或 resize。
- 人工租约 30s TTL，客户端按 10s 续租；数据库原子单控制者，generation 只在新授予时递增，释放 / 到期不清零。重复 acquire 本持有者返回当前租约；其他人等待释放 / 到期，无强抢。renew / release / resize 必须匹配当前 generation / 客户端 / 连接，旧请求拒绝。agent principal 的存储字段预留，公共人类路由不接受模型 owner 字段或 AI 接管参数。
- terminal.input 使用 §4 schema，每条 UTF-8 ≤8 KiB、每连接 ≤64 KiB/s；sequence 从 1 开始递增，事务先记序号与输入长度审计，再交给 PTY。重复序号 accepted=false，不重放；未来跳号拒绝。ACK 为 `{kind:"terminal.input.ack",resourceId,accepted,inputSequence}`，不表示 Shell 命令已执行完成；落盘后至写入前崩溃可能丢输入，但不能重放不确定按键。
- WS / HTTP 输入前均重新校验认证、scope、活连接 / 订阅、租约与活 Runtime；resize 范围 cols=2–500 / rows=1–300。输入正文不进入审计或关键事件；PTY 正常回显属于统一脱敏输出。断线 / unsubscribe / 登出 / 撤销立即失去输入资格并释放租约；过期每秒对账，迟到输入即时拒绝；PTY 保持运行。
- terminal.created / status / exit / lease 均先持久事件和 seq 再广播，payload 为状态 / exitCode / reasonCode / 当前租约。terminal 主题按资源授权，GET `/api/resource-events` 补拉并支持全局终端；保留 30 天和序号缺口语义。terminal.output 为 `{kind,resourceId,cursor,data,timestamp}`，只推已脱敏且落盘的数据、不占关键 seq，每块 ≤16 KiB；复用认证检查、控制队列与 8 MiB 背压断连。关闭 WS 不停止 PTY。

### 输出与保留

终端按 UTF-8 文本输出，复用跨块秘密 / 敏感字段脱敏器；只保留可能匹配秘密的尾部，普通短提示符和字段标签即时显示，字段值在后续块正确遮蔽。已知秘密最多 65,536 字符，不承诺识别未知编码 / 任意未知秘密。

每个 Runtime 内存环最多 1 MiB 输出 / 16,384 块；磁盘 `<dataDir>/logs/terminals/term_UUID.N.jsonl` 每段约 1 MiB，0600 / 防链接，按实际文件字节执行每终端 10 MiB / 总量 100 MiB 配额，先到先轮转。输出每块持久 cursor 元数据，不写正文到 SQLite。GET output after 默认 0、limit 默认 100 / 最大 500，但每页数据最多 64 KiB，不跨过未返回块；未来 cursor 拒绝，轮转 / 缺失 / 过期明确 resyncRequired / truncated，不假装完整历史。

输出保留 7 天，读时与每 10 分钟清理；安全终态元数据 / 创建幂等记录 30 天后清理，保留 stream 序号，不清理未知屏障、不删除源码 / workspace。列表默认 50 / 最大 200、cursor 为上页末 terminalId；资源已解除关联的历史项不授权返回，未知 Runtime 不伪报运行。新增错误码 TERMINAL_LEASE_REQUIRED(409)。无新依赖 / 配置 / IPC / 认证协议；回退前排空新资源并核实未知进程，保留新增表和用户数据，不执行破坏性 down migration。

若终态与持久 RECONCILIATION_REQUIRED 都无法写入，运行期另外隔离该 canonical 根：内存受阻标记参与现有根锁判断与新终端创建，停止确认且安全终态提交后才可清除；重启依靠未完成终端记录在监听前重新建立持久屏障。这不是第二套可接管写锁，不因 TTL 过期解除未知状态。没有 Runtime 的非终态查询失败关闭；无法确认清理时不调用 node-pty 的未核验 PID kill，也不依赖非公开 native 清理 API。


native spawn 抛异常不等于“没有进程”：WRITING 之后若拿不到可管理句柄，记录 SPAWN_UNCONFIRMED / RECONCILIATION_REQUIRED 并隔离根，不假定 fork 未发生；只有尚未尝试 spawn 的准备失败可记 NOT_STARTED / 安全失败。内部 spawnPty 注入仅用于 native 故障测试，不是配置键或模型参数。


principal 预留兼容：公共人工 acquire 不会因为 agent owner 没有浏览器 connectionId 就覆盖其未过期租约；公共 input / renew / release 仍只认 human principal。agent 字段不构成已授予 AI 工具能力，显式人机交接、真实 Agent 执行上下文校验与工具接线继续归 M2-4d。

## 17. M2-4b 真实终端界面（2026-11-03）

Terminal DTO 新增 `writeBlocked: boolean`，从资源创建记录的 canonical root 查询既有重叠根写锁 / 待恢复屏障；未知记录保守返回 true。只提供状态提示，不授予写入权限；PTY 不长期占源码写锁。列表与 detail / lease / resize / terminate 使用同一 DTO，公共前端响应使用 shared Zod schema 校验；无新路由、迁移或配置。

前端使用既有订阅连接 ID 与租约接口、10s 续租；重连不自动申请控制。输出以 WS 通知触发有界 REST 游标页，xterm 保留 2000 行、可访问文本摘要最多 16,384 字符，缺口明确提示。窗口 close 保留视图，Tab close 确认终态才移除，失败保留。真实双浏览器验收见 030 acceptance，当前待人类 UI review。

续租 / resize / 输入失败即关闭本地输入能力，但仍可显式释放当前连接在服务器上尚未过期的租约；同代重新申请不重置已发送序号，断线丢弃未确认输入且不自动重放。未知停止 / 恢复 / 输出故障状态保留 Tab 和原因；明确 EXITED / TERMINATED 或 INTERRUPTED + NOT_STARTED 才确认移除。列表 / 终端状态用 Query，输入队列与连接状态仅在当前视图内存；布局不持久化输出、输入或租约。
