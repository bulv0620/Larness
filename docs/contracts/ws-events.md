# WebSocket 与事件契约

> 状态：M0 已冻结（握手 / 订阅 / 序号）；M1 起补充主题事件。  
> 权威状态在 SQLite；WebSocket 只负责通知与增量推送。

## 1. 连接与握手

- 端点：`GET /ws`（HTTP Upgrade）。
- 必须携带有效 `larness_session` Cookie；否则 `401` 并关闭。
- 必须校验 `Origin` 在允许列表；缺失或不匹配返回 `403`。
- 不接受 URL 查询参数中的 Token。
- 握手成功后服务端发送 `hello`：

```json
{
  "kind": "hello",
  "protocolVersion": 1,
  "clientSessionId": "bs_…",
  "serverTime": 1761900000000,
  "heartbeatMs": 25000,
  "topics": []
}
```

- 客户端 30 秒内未发送 `subscribe` 视为空闲，服务端可关闭。
- 心跳：服务端每 25 秒发 `ping`，客户端回 `pong`；60 秒无响应关闭。

## 2. 客户端消息

```ts
type ClientMessage =
  | { type: 'subscribe'; subscriptions: Subscription[] }
  | { type: 'unsubscribe'; topics: string[] }  // 形如 "agent:ses_…"
  | { type: 'pong'; at: number };
```

订阅前服务端再次校验该资源的访问权限；越权返回：

```json
{ "kind": "error", "code": "FORBIDDEN", "message": "subscription denied", "requestId": "…" }
```

订阅成功：

```json
{
  "kind": "subscribed",
  "subscription": { "topic": "agent", "resourceId": "ses_…", "after": 142 },
  "currentSequence": 142
}
```

`after` 只用于告知客户端应补拉的起点；**实时推送从订阅后的新事件开始**，缺口通过 REST 补齐。

## 3. 服务端事件包络

```ts
interface ServerEvent<T = unknown> {
  kind: 'event';
  eventId: string;            // evt_…
  protocolVersion: 1;
  topic: 'agent' | 'terminal' | 'service' | 'git' | 'file' | 'system';
  streamId: string;           // 序列所属资源：sessionId / terminalId / serviceId / "system"
  projectId?: string;
  sessionId?: string;
  resourceId?: string;
  sequence: number;           // 每个 streamId 内严格递增
  timestamp: number;          // Unix ms
  type: string;               // 如 turn.completed
  payload: T;
}
```

规则：

- 同一 `streamId` 的 `sequence` 由服务端在事务中分配，不允许回退或重复。
- 关键事件（Turn 状态、工具调用、审批、服务状态、文件变更）必须先落库再广播。
- 客户端检测到 `sequence` 跳号时，暂停该 stream 的渲染并通过 REST 补拉；补拉失败则全量重同步。
- 事件 `payload` 不得包含秘密、Cookie、完整命令环境或未脱敏路径。

## 4. 主题与事件类型

### 4.1 `agent`（streamId = sessionId）

| type | 关键 payload | 持久化 |
|---|---|---|
| `user.message` | `turnId, text` | 是 |
| `turn.created` | `turnId, status` | 是 |
| `turn.status` | `turnId, status, reason?` | 是 |
| `plan.updated` | `turnId, plan:{id,kind:"plan",title,steps[],createdAt,turnId}` | 是（M2-14） |
| `assistant.delta` | `turnId, messageId, text` | 否（仅广播，完成时落最终消息） |
| `assistant.reasoning.delta` | `turnId, messageId, text`（M5-1e 思考过程） | 否（仅广播，不落库、不重放） |
| `assistant.message` | `turnId, messageId, text` | 是 |
| `tool.requested` | `toolCallId, name, argsSummary` | 是 |
| `tool.approval.required` | `toolCallId, approvalId, summary, scope, expiresAt` | 是 |
| `tool.approval.resolved` | `approvalId, decision` | 是 |
| `tool.started` | `toolCallId, name` | 是 |
| `tool.completed` | `toolCallId, resultSummary, truncated, resourceTarget?, closedTerminalTarget?, originClientSessionId?`（M2-2 成功文件修改附授权 scope / path / version） | 是 |
| `tool.failed` | `toolCallId, errorCode, message` | 是 |
| `file.changed` | `path, changeType, version` | 是 |
| `artifact.created` | `artifactId, kind, title, url?` | 是 |
| `turn.completed` | `turnId, usage, durationMs, terminalReason, budgetExhausted?`（`usage` 与 `model.usage` 同口径，含 `cacheReadTokens?` / `noCacheTokens?`） | 是 |
| `model.usage` | `turnId, model, inputTokens, outputTokens?, totalTokens?, cacheReadTokens?, noCacheTokens?, usageSource, contextWindow`（M5-1 单次请求；M6-1 增缓存细分） | 是 |
| `context.compressed` | `turnId, summaryId, coveredUpToSeq, tokensBefore, tokensAfter, degraded`（M5-1d 压缩） | 是 |
| `turn.failed` | `turnId, errorCode, message, terminalReason` | 是 |
| `turn.cancelled` | `turnId, reason, terminalReason` | 是 |
| `turn.interrupted` | `turnId, reason, terminalReason` | 是 |

`assistant.reasoning.delta` 使用与 `assistant.delta` 相同的临时信封，不含 `sequence`，不写 `agent_events`，刷新 / 重连后不重放；只发给订阅该会话的已认证客户端。推理正文不得进入日志、审计、其他会话或跨模型上下文。

`assistant.delta` 可使用独立信封 `{ kind: "assistant.delta", topic: "agent", streamId, sessionId, turnId, messageId, text, timestamp }`，不占用持久化 `sequence`，刷新后不重放；最终 `assistant.message` 使用相同 `messageId` 覆盖完整文本。可按 50 ms / 16 KiB 聚合；`turn.*`、审批与工具状态不得仅存在内存。

`terminalReason`（M6-3，[ADR-057](../adr/ADR-057-runtime-efficiency.md)）在每个 `turn.*` 终态事件中给出结束原因：`normal / budget / output_truncated / provider_error / error / cancelled / interrupted`。它和事件类型正交——`turn.completed` 也可能是 `budget` 或 `output_truncated`，客户端必须按 `terminalReason` 而不是仅按事件类型判断「任务是否真的做完」。

`context.compressed` 在压缩成功后先持久化再广播；`degraded: true` 表示摘要失败，Turn 继续使用截断历史。摘要正文只存 `session_context_summaries`，不进入事件、日志或审计。

`model.usage`（M5-1，061 / ADR-053）在每个模型请求完成且上游返回用量时写入一条，只含模型标识、单次输入 / 输出 / 总量、缓存命中 / 未命中与同次窗口，不含 prompt、推理正文或密钥。缓存细分为 M6-1（[ADR-057](../adr/ADR-057-runtime-efficiency.md)）：`usageSource=provider` 表示上游确实回报了缓存字段（`cacheReadTokens=0` 是已知未命中），`usageSource=unknown` 表示上游未回报，此时 `cacheReadTokens` / `noCacheTokens` 必须缺省而不是填 0；命中率只能对 `usageSource=provider` 的请求求分母，并单独报告未知占比。上下文圆环取当前时间线中「最近一条 model 等于所选模型」的 `model.usage` 计算单次占比；无匹配时显示「暂无统计」。整轮累计仍由 `turn.completed.usage` 提供，两者口径独立。

### 4.2 `terminal`（streamId = terminalId）

| type | payload |
|---|---|
| `terminal.output` | `data`（base64 或 UTF-8）、`cursor`、`truncated?` |
| `terminal.exit` | `exitCode`, `signal?` |
| `terminal.lease` | `ownerClientSessionId`, `expiresAt` |

PTY 输出不逐字节入库：使用限长环形缓冲 + 可选落盘日志；游标回放走 `GET /api/terminals/:id/output?after=`。

### 4.3 开发 `service`（streamId = serviceId）

| type | payload |
|---|---|
| `service.registered` / `service.status` / `service.unregistered` | 临时服务状态和终端绑定，见 [M3 技术契约](m3-preview.md) |

正式服务状态、日志和部署在独立运维事件流中处理。M4-3 已冻结：订阅 `{topic:"service-ops",resourceId:<tgt_ targetId>,after}`，streamId `ops:<targetId>`；事件类型 `service-ops.status` / `service-ops.deployment`，payload 为 `{observedState,desiredState,version,artifactHash,pid,deploymentId,reasonCode}`，不含日志正文或秘密。订阅、补拉、日志读取均校验域/作用域与 target 存在；`GET /api/resource-events?streamId=ops:<targetId>` 重放。M4-1/M4-2 的构建/产物/计划与授权记录不直接产生事件。

### 4.4 `system`（streamId = `system`）

| type | payload |
|---|---|
| `system.ready` | `version`, `startedAt` |
| `system.update-starting` | `targetVersion`, `estimatedImpact` |
| `system.session.revoked` | `clientSessionId`, `reason` |
| `system.device.revoked` | `deviceId`, `reason` |
| `system.shutdown` | `reason` |

已订阅 `{topic:"system",resourceId:"system"}` 的已认证连接在 Turn 创建（入队）或结束落库后接收 `{kind:"workspace.sessions.changed"}`。该帧仅用于失效会话列表缓存，不含资源标识或内容，不分配序号。订阅成功（含重连）时重新读取会话快照。

### 4.5 `git` / `file`

用于多客户端同步（M2）：`git.status.changed`、`file.changed`、`file.conflict`。Git 状态以查询结果为准，事件只用于失效缓存。

## 5. 重放与恢复

```text
连接 → subscribe(after=lastSeq)
  → 服务端返回 currentSequence
  → 若 currentSequence > after：客户端 GET /api/sessions/:id/events?after=…
  → 应用历史事件到 after=currentSequence
  → 恢复实时事件渲染
```

- 增量接口返回 `{ items: ServerEvent[], nextSeq, hasMore }`。
- 事件保留期默认 30 天（可配置）；超期或缺失时客户端全量同步会话状态。
- Turn 执行与 WS 连接解耦：断线不会取消执行。

## 6. 背压与限流

- 服务端为每连接维护发送队列上限（默认 8 MiB）；超限先丢弃可聚合的 `assistant.delta` / `terminal.output`，再关闭连接（1008）。
- 关键事件不得丢弃；宁可断开让客户端重放。
- 单连接订阅数上限 64；超出返回 `RATE_LIMITED`。

## 7. 安全

- 握手失败不返回业务信息；日志不记录 Cookie / Token。
- 撤销会话后，服务端在 1 秒内关闭对应连接。
- 订阅校验按资源进行：跨项目会话、未授权终端、未登记服务一律拒绝。
- 预览 iframe 不建立管理端 WebSocket；预览页面不共享管理 Cookie。

## M2 资源实施契约入口

文件 / 命令 / PTY / Git 的接口、资源事件与回放、数据迁移、锁与错误码见 [m2-resources.md](m2-resources.md) 的实施章节，配套 [030 spec](../../specs/030-dev-resources/spec.md)。

## ADR-030 服务与资源生命周期补充（2026-11-02）

[资源视图契约](resource-views.md) 已按人类确认修订：关闭 / 最小化窗口只隐藏，主动关闭终端 Tab 经 terminate 结束资源；服务无资源 Tab。临时服务仅登记 Terminal 源执行并在退出时自动退登，持久服务由 PM2 管理，详情、预览 / 结果卡片与接口 / 事件 / 数据见 [services-preview.md](services-preview.md)。M2/M3 已交付，当前证据见 [M2 收尾](../../specs/030-dev-resources/closure.md) 与 [M3 收尾](../../specs/040-services-preview/closure.md)。


## M2-1b 已实施补充（2026-11-03）

文件订阅 resourceId 为 `project:<id>` / `session:<id>`，支持 paths（默认 `["."]`、最多 128）与 after；流键为 `file:` + resourceId。确认携带 currentSequence / resyncRequired=true / partial；确认后刷新当前文件快照，历史走 `/api/resource-events`。file.changed / file.resync.required 均先持久化再通知，路径不包含已知凭据，正文不推送。详见 [m2-resources §12](m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。

资源流使用 `{ items, currentSequence, resyncRequired }`，与既有 Agent 重放分页形状不同。资源事件固定保留 30 天；清理保留流序号，缺口要求快照刷新。本次实现发送缓冲超过 8 MiB 直接关闭 1008，通过持久重放恢复；输入上限 1 MiB，控制队列 64 条，订阅 / 取消串行执行。此为当前实现边界，不将此前“先丢可聚合帧”描述为已实现。


M2-2（2026-11-03）：文件结果 target 从真实工具上下文生成，点击重新 GET 授权 / realpath 去重，不重新执行工具。文件视图消费订阅 / 补拉只做 Query 失效，草稿不会被通知覆盖；详见 [资源契约 §13](m2-resources.md#13-m2-2-编辑器与文件结果2026-11-03)。

M2-3（2026-11-03）：新增 command 主题，resourceId / streamId 均为真实 commandId；订阅 after 先鉴权并拒绝未来游标。command.status 为持久 ServerEvent，payload 为 status / exitCode / reasonCode / truncated / startedAt / endedAt；GET `/api/resource-events` 补拉。状态事务提交后才推送，每次推送重查客户端与资源归属；关闭 WS 不取消命令。当前逐块输出走授权游标 GET，command.output 推送与实时界面在 M2-3b；见 [资源契约 §14](m2-resources.md#14-m2-3-命令执行后端2026-11-03)。

M2-3b（2026-11-03）：command 订阅已推送 `command.output`，信封为 `{kind:"command.output", resourceId:commandId, cursor, data, channel:"stdout"|"stderr", timestamp}`。脱敏块写入输出文件后才推送，单块 ≤16 KiB、不占 SQLite 关键 seq；缺口走输出 GET，慢连接沿用 8 MiB 背压断开。Session 流新增持久 `tool.command.created`，绑定真实 `{turnId, toolCallId, commandId}`，关联提交失败不启动命令；刷新重放只恢复卡片。状态与输出消费重查授权，页面卸载不 cancel。详见 [资源契约 §15](m2-resources.md#15-m2-3b-agent-命令与执行卡片2026-11-03)。

M2-4（2026-11-03）：hello 和 terminal 订阅 ACK 新增 connectionId；订阅 `{topic:"terminal",resourceId:terminalId,after}`，状态 / 租约事件持久化后推送，资源 REST 补拉支持 terminalId（含全局）。新增 terminal.output 游标帧与 terminal.input / terminal.input.ack；输入实际绑定当前认证连接 / 租约 generation，8 KiB / 条、64 KiB/s，重复序号不重放，未来跳号拒绝。每次输入 / 推送重查授权，断线 / unsubscribe / 登出 / 撤销释放输入权，保留 PTY。慢消费者沿既有 8 MiB 背压断开。AI 控制与接管尚未接线，详见 [资源契约 §16](m2-resources.md#16-m2-4-terminalmanager-与输入租约后端2026-11-03)。

### M2-10 默认文件流

文件订阅 resourceId 新增精确值 `workspace:default`，对应 streamId `file:workspace:default`；paths / after / seq / resync 与项目流相同。鉴权后仅解析固定默认目录，未知 workspace 拒绝；事件先事务落库再广播。默认共享会话别名和直接 workspace scope 使用相同持久事件流，不对其他运行数据授权。无协议号变化。

## M2-14 真实任务计划
Agent工具 `update_plan({title,steps:[{id,title,status,detail?}]})` 为L0元数据操作，不取得项目写锁；每轮唯一 `plan_<turnId>` 全量替换，1–12步、ID唯一、最多一项running。状态pending/running/done/failed；拒绝非法参数和已知凭据。由Runner按现有Turn预算/取消/审计执行，先事务持久化plan.updated再广播；前端Zod校验并按ID覆盖，刷新重放。Turn结束不自动勾完计划；模型报告不是执行授权或验证证据。无DB/协议号变化。

界面仅为活跃 Turn 的 `running` 步骤播放动画。Turn 结束后仍报告为 `running` 的步骤显示「未完成」，实时更新和历史重放采用相同规则。

## M2-15 对话呈现补充
`tool.command.created`新增可选`command`（CommandParamsSchema：executable/args/cwd/timeoutMs），仅在已授权Manager验证参数及凭据后、启动前写入；字段经输出脱敏器处理，敏感选项后的值隐藏，不包含环境。客户端Zod验证后用于折叠详情。命令输出仍经授权游标接口读取，不复制进消息。UI按turnId分轮，工具视图身份为turnId+toolCallId，防止Provider在不同轮复用call ID覆盖历史；历史无turnId按用户消息边界分组。Turn终态及durationMs从既有持久事件恢复。审批只在输入框上方可操作，后端确认前不乐观标成功，失败保留。

## M2-21 Agent 终端关闭视图同步
成功 `stop_project_terminal` 的 `tool.completed` 可附 `closedTerminalTarget: { kind: "terminal", projectId, terminalId, role }` 和 `originClientSessionId`。字段来自经过授权的真实 stop 结果（EXITED / TERMINATED）与 Turn 快照；失败 / 中断未知结果不附。事件先持久化再广播，兼容旧客户端忽略可选字段。不是打开资源的 resourceTarget，不生成“打开”结果卡或创建终端。
发起客户端实时、补拉或初次历史加载时核对该目标；GET 最新资源确认 ID / 项目和已确认终态后移除对应本地 Tab，最后一个 Tab 移除时收起窗口。其他客户端保持结束视图，读取失败或未确认停止保留 Tab。重复通知 / 重放幂等，不发送第二次 terminate、不清除历史输出。

## ADR-042：服务/部署阶段与自主事件（2026-11-05，draft）
M3 的 `service.*` 及其 streamId 保持开发服务语义。M4 的正式运维和部署使用独立事件类型与流标识，后端按实际领域核验订阅和补拉。共用事件持久化与 seq 事务。自主授权记录真实策略决策、planHash、policySnapshotId 和结果，只有策略要求人工时才发审批事件或记录 approvalId。见 [部署契约](deployment.md) 与 [ADR-048](../adr/ADR-048-service-domain-separation.md)。

## M3 早期事件候选（历史）
registered/status/unregistered拟含kind/status/terminalId/terminalExecutionId/endpointGeneration/reasonCode?，不含票据、Cookie、原始进程身份；详[m3-preview](m3-preview.md)。temporary不发送PM2 desiredState；日志引用已有终端游标、允许缺口，不伪造独立命令完整历史。失效先撤路由，状态与seq提交后广播；DB失败不伪造成功。

## M5-2 任务变更通知（2026-11-07）

调度器不新增带序号的持久事件流。JobRun 状态变化后，通过 `system` 主题发送非持久通知：

```json
{ "kind": "workspace.jobs.changed" }
```

- 客户端收到后重拉 `/api/jobs`、`/api/jobs/summary` 与当前任务详情；失败角标来自 `failedLast24h`。
- 通知不携带脚本、提示词、输出、错误正文或秘密；不是权威状态，丢失时可轮询或重连后重拉。
- 任务运行历史与详情只经认证 REST 读取；任务专用会话的事件仍走既有 `agent` 主题与序号。
