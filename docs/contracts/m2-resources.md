# M2 资源契约（设计已批准，按任务实施）

> 2026-11-02 人类要求开始 M2，并明确按最新 spec；[030 spec](../../specs/030-dev-resources/spec.md) / [ADR-029](../adr/ADR-029-development-resource-execution.md) 已通过 G-Spec-M2，含 §10 完整 AI 交互。以下接口按任务逐步实施，不代表服务器已有能力。M2-0 仅做隔离 PoC，不新增产品 REST / WS / 数据迁移；G-PoC-M2 待人类确认。

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
