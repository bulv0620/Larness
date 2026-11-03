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
| `plan.updated` | `turnId, steps[]` | 是（M1 可选） |
| `assistant.delta` | `turnId, messageId, text` | 否（仅广播，完成时落最终消息） |
| `assistant.message` | `turnId, messageId, text` | 是 |
| `tool.requested` | `toolCallId, name, argsSummary` | 是 |
| `tool.approval.required` | `toolCallId, approvalId, summary, scope, expiresAt` | 是 |
| `tool.approval.resolved` | `approvalId, decision` | 是 |
| `tool.started` | `toolCallId, name` | 是 |
| `tool.completed` | `toolCallId, resultSummary, truncated, resourceTarget?`（M2-2 成功文件修改附授权 scope / path / version） | 是 |
| `tool.failed` | `toolCallId, errorCode, message` | 是 |
| `file.changed` | `path, changeType, version` | 是 |
| `artifact.created` | `artifactId, kind, title, url?` | 是 |
| `turn.completed` | `turnId, usage, durationMs, budgetExhausted?` | 是 |
| `turn.failed` | `turnId, errorCode, message` | 是 |
| `turn.cancelled` | `turnId, reason` | 是 |
| `turn.interrupted` | `turnId, reason` | 是 |

`assistant.delta` 可使用独立信封 `{ kind: "assistant.delta", topic: "agent", streamId, sessionId, turnId, messageId, text, timestamp }`，不占用持久化 `sequence`，刷新后不重放；最终 `assistant.message` 使用相同 `messageId` 覆盖完整文本。可按 50 ms / 16 KiB 聚合；`turn.*`、审批与工具状态不得仅存在内存。

### 4.2 `terminal`（streamId = terminalId）

| type | payload |
|---|---|
| `terminal.output` | `data`（base64 或 UTF-8）、`cursor`、`truncated?` |
| `terminal.exit` | `exitCode`, `signal?` |
| `terminal.lease` | `ownerClientSessionId`, `expiresAt` |

PTY 输出不逐字节入库：使用限长环形缓冲 + 可选落盘日志；游标回放走 `GET /api/terminals/:id/output?after=`。

### 4.3 `service`（streamId = serviceId）

| type | payload |
|---|---|
| `service.status` | `desiredState`, `observedState`, `pid?`, `port?` |
| `service.log` | `chunk`, `cursor` |
| `deployment.status` | `deploymentId`, `phase` |

### 4.4 `system`（streamId = `system`）

| type | payload |
|---|---|
| `system.ready` | `version`, `startedAt` |
| `system.update-starting` | `targetVersion`, `estimatedImpact` |
| `system.session.revoked` | `clientSessionId`, `reason` |
| `system.device.revoked` | `deviceId`, `reason` |
| `system.shutdown` | `reason` |

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

## M2 详细草案入口（2026-11-02，未冻结）

文件 / 命令 / PTY / Git 的接口、资源事件与回放、数据迁移、锁与错误码拟细化于 [m2-resources.md](m2-resources.md)，配套 [030 spec](../../specs/030-dev-resources/spec.md)。本文件中原 M2 摘要只作范围索引；细化提案须经 G-Spec-M2 / ADR-029 确认后才生效，实施时同步 Zod schema 与测试，不改变 M0 / M1 已实现契约。

## ADR-030 服务与资源生命周期补充（2026-11-02）

[资源视图契约](resource-views.md) 已按人类确认修订：关闭 / 最小化窗口只隐藏，主动关闭终端 Tab 经 terminate 结束资源；服务无资源 Tab。临时服务仅登记 Terminal 源执行并在退出时自动退登，持久服务由 PM2 管理，详情、预览 / 结果卡片与拟议接口 / 事件 / 数据见 [services-preview.md](services-preview.md)。产品规则已接受，M2/M3 技术 schema / 迁移 / 代码尚未实施，既有认证和事件权威性不变。


## M2-1b 已实施补充（2026-11-03）

文件订阅 resourceId 为 `project:<id>` / `session:<id>`，支持 paths（默认 `["."]`、最多 128）与 after；流键为 `file:` + resourceId。确认携带 currentSequence / resyncRequired=true / partial；确认后刷新当前文件快照，历史走 `/api/resource-events`。file.changed / file.resync.required 均先持久化再通知，路径不包含已知凭据，正文不推送。详见 [m2-resources §12](m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。

资源流使用 `{ items, currentSequence, resyncRequired }`，与既有 Agent 重放分页形状不同。资源事件固定保留 30 天；清理保留流序号，缺口要求快照刷新。本次实现发送缓冲超过 8 MiB 直接关闭 1008，通过持久重放恢复；输入上限 1 MiB，控制队列 64 条，订阅 / 取消串行执行。此为当前实现边界，不将此前“先丢可聚合帧”描述为已实现。


M2-2（2026-11-03）：文件结果 target 从真实工具上下文生成，点击重新 GET 授权 / realpath 去重，不重新执行工具。文件视图消费订阅 / 补拉只做 Query 失效，草稿不会被通知覆盖；详见 [资源契约 §13](m2-resources.md#13-m2-2-编辑器与文件结果2026-11-03)。

M2-3（2026-11-03）：新增 command 主题，resourceId / streamId 均为真实 commandId；订阅 after 先鉴权并拒绝未来游标。command.status 为持久 ServerEvent，payload 为 status / exitCode / reasonCode / truncated / startedAt / endedAt；GET `/api/resource-events` 补拉。状态事务提交后才推送，每次推送重查客户端与资源归属；关闭 WS 不取消命令。当前逐块输出走授权游标 GET，command.output 推送与实时界面在 M2-3b；见 [资源契约 §14](m2-resources.md#14-m2-3-命令执行后端2026-11-03)。
