# REST API 契约

> 状态：M0 已冻结；M1 为设计基线，实现时可补充字段但不得破坏既有语义。  
> Base URL：`http://127.0.0.1:3210`（默认）；所有业务接口前缀 `/api`。

## 1. 通用约定

| 项 | 约定 |
|---|---|
| 编码 | UTF-8；请求 / 响应 `application/json`（文件下载除外） |
| 认证 | `harness_session` HttpOnly Cookie；公开接口仅健康、bootstrap、配对 |
| CSRF | 已认证的变更请求带 `x-csrf-token`；公开配对接口校验 Origin |
| 请求 ID | 客户端可传 `x-request-id`，否则服务端生成；响应回显 |
| 幂等 | 变更接口支持 `Idempotency-Key`；Turn、服务动作、部署必须支持 |
| 时间 | 所有时间戳为 Unix 毫秒整数（UTC） |
| 分页 | `?limit=&cursor=`；返回 `{ items, nextCursor }`；默认 50，最大 200 |
| 错误 | `{ "error": { "code", "message", "details"?, "requestId" } }` |
| 缓存 | 业务 JSON `Cache-Control: no-store`；静态资源带 hash 长缓存 |

成功响应直接返回资源对象或 `{ items, nextCursor }`，不再外包 `data`。

## 2. 错误码

| code | HTTP | 含义 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 参数 / 查询 / 请求体不合法 |
| `UNAUTHENTICATED` | 401 | 无有效会话 |
| `FORBIDDEN` | 403 | 已认证但无权访问 |
| `ORIGIN_INVALID` | 403 | Origin / Referer 不在允许列表 |
| `CSRF_INVALID` | 403 | CSRF Token 缺失或不匹配 |
| `NOT_FOUND` | 404 | 资源不存在（不泄漏他人资源是否存在） |
| `NOT_INITIALIZED` | 409 | 尚未完成本机初始化 |
| `CONFLICT` | 409 | 状态冲突（重复创建、版本不匹配等） |
| `TURN_IN_PROGRESS` | 409 | 同一会话已有活跃 Turn |
| `RESOURCE_LOCKED` | 409 | 项目 / 服务 / 文件锁被占用 |
| `VERSION_CONFLICT` | 409 | 文件版本已变化 |
| `PAIRING_DENIED` | 403 | 本机拒绝配对 |
| `PAIRING_EXPIRED` | 410 | 配对申请或配对码过期 |
| `CODE_INVALID` | 400 | 配对码错误 |
| `RATE_LIMITED` | 429 | 触发限流 |
| `PATH_OUTSIDE_PROJECT` | 403 | 路径越界 |
| `APPROVAL_INVALID` | 409 | 审批过期 / 被撤销 / 参数不一致 |
| `PREVIEW_TARGET_INVALID` | 403 | 代理目标未登记或被禁止 |
| `PROVIDER_UNAVAILABLE` | 503 | 模型 Provider 不可用 |
| `INTERNAL` | 500 | 未预期错误（不返回堆栈） |

## 3. 公开接口（M0）

### GET `/api/health`

```json
{ "status": "ok", "uptimeMs": 12345 }
```

不返回版本、路径、初始化状态等可用于指纹识别的信息（版本在 bootstrap 中）。

### GET `/api/bootstrap`

未认证可访问；返回进入配对页所需的最小信息。

```json
{
  "app": { "name": "Harness", "version": "0.1.0" },
  "initialized": true,
  "auth": { "authenticated": false, "pairingEnabled": true },
  "features": { "preview": false },
  "serverTime": 1761900000000
}
```

规则：

- 未初始化时 `initialized=false`，`auth.pairingEnabled=false`，不返回数据目录、主机名、设备数量。
- 已认证时 `authenticated=true`，但不在此返回会话详情。

## 4. 配对（M0）

### POST `/api/pairing/requests`

请求：

```json
{ "clientLabel": "MacBook Chrome" }
```

响应 `201`：

```json
{
  "requestId": "pair_…",
  "shortCode": "428193",
  "pollToken": "…",
  "expiresAt": 1761900600000
}
```

- `shortCode` 仅用于与 TUI 核对，不是凭据；`pollToken` 只存于浏览器内存。
- 速率：每 IP 10 次 / 分钟。

### GET `/api/pairing/requests/:requestId`

请求头：`x-pairing-token: <pollToken>`

```json
{ "status": "pending", "expiresAt": 1761900600000 }
```

状态：`pending | approved | denied | expired | redeemed`。`approved` 时额外返回 `decision: "allow_once" | "trust"`，**不返回配对码**。浏览器看到 `approved` 后显示配对码输入框。

### POST `/api/pairing/redeem`

```json
{ "requestId": "pair_…", "code": "7K3M-9Q2X" }
```

成功 `200` 并 `Set-Cookie`：

```json
{
  "clientSessionId": "bs_…",
  "kind": "once",
  "deviceId": null,
  "csrfToken": "…",
  "expiresAt": 1761943200000
}
```

失败：`CODE_INVALID`（剩余尝试次数在 `details.attemptsLeft`）、`PAIRING_DENIED`、`PAIRING_EXPIRED`、`RATE_LIMITED`。成功兑换后申请进入 `redeemed`，同一码不可再次使用。

## 5. 认证会话（M0）

### GET `/api/auth/session`

已认证返回：

```json
{
  "clientSessionId": "bs_…",
  "deviceId": "dev_…",
  "kind": "trusted",
  "createdAt": 1761900000000,
  "expiresAt": 1761943200000,
  "csrfToken": "…",
  "capabilities": ["workspace.read", "workspace.write"]
}
```

未认证返回 `401 UNAUTHENTICATED`。`capabilities` 为粗粒度能力提示，最终授权仍在每个接口。

### POST `/api/auth/refresh`

使用 `harness_device` 设备凭据换取新的短期会话（`允许本次` 的会话没有设备凭据，不能刷新）。

- 请求头必须带合法 `Origin`；不要求 CSRF（尚无会话）。
- 成功：轮换设备凭据、撤销旧会话、`Set-Cookie` 新的 `harness_session` 与 `harness_device`，返回与 `GET /api/auth/session` 相同结构。
- 失败：`UNAUTHENTICATED`（凭据缺失 / 过期 / 已撤销），清 Cookie。
- 速率：每设备凭据 10 次 / 分钟。

### POST `/api/auth/logout`

撤销当前会话，清 Cookie，返回 `204`。需 CSRF。设备凭据保留（用户可在 TUI 撤销设备）。

### GET `/api/system/info`（已认证）

```json
{
  "version": "0.1.0",
  "node": "v22.0.0",
  "platform": "darwin",
  "arch": "arm64",
  "dataDir": "/Users/…/Harness",
  "initializedAt": 1761900000000,
  "uptimeMs": 12345
}
```

`dataDir` 仅返回给已认证客户端；日志中脱敏。

## 6. WebSocket

`GET /ws`（Upgrade）。握手校验见 [ws-events.md](ws-events.md)。

## 7. 工作区（M1 设计基线）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表（含 git 检测状态） |
| POST | `/api/projects` | `{ name, rootPath }`；校验目录存在、可读、realpath |
| GET | `/api/projects/:id` | 详情 |
| PATCH | `/api/projects/:id` | 改名、默认模型、设置 |
| DELETE | `/api/projects/:id` | 仅解除关联，不删目录 |
| GET | `/api/sessions?projectId=&limit=` | 会话列表 / 最近会话 |
| POST | `/api/sessions` | `{ projectId?, title? }`；无项目时创建独立工作目录 |
| GET | `/api/sessions/:id` | 会话详情 + 活跃 Turn |
| PATCH | `/api/sessions/:id` | 标题、下一轮模型 |
| DELETE | `/api/sessions/:id` | 归档 / 删除会话（先预览，不删项目源码） |
| POST | `/api/sessions/:id/turns` | `{ input, modelProfileId? }` + `Idempotency-Key`；409 `TURN_IN_PROGRESS` |
| POST | `/api/turns/:id/cancel` | 取消；无活跃 Turn 返回 409 |
| GET | `/api/sessions/:id/events?after=<seq>&limit=` | 增量事件，按 `seq` 升序 |
| GET | `/api/approvals/:id` | 审批详情（参数摘要、范围、过期时间） |
| POST | `/api/approvals/:id` | `{ decision: "approve" \| "reject" }`；校验参数哈希与范围 |
| GET | `/api/models` | 可用模型 Profile（不含密钥） |
| POST | `/api/models` | 新建 Profile（`secretRef` 或提交密钥到 SecretStore） |
| POST | `/api/models/:id/test` | 可选：连通性 / 工具调用冒烟 |
| GET | `/api/credentials` | 凭据元数据（掩码，不含明文） |
| POST | `/api/credentials` | 新建凭据，密钥只写不读 |
| DELETE | `/api/credentials/:id` | 删除未被模型引用的凭据 |
| GET | `/api/projects/:id/files` | 文件树（M2） |
| GET | `/api/files?path=&version=` | 读取文件（M2） |
| PUT | `/api/files` | `{ path, content, expectedVersion }`（M2） |

Turn 创建成功返回 `202`：

```json
{ "turnId": "trn_…", "status": "QUEUED", "sessionId": "ses_…" }
```

`GET /api/sessions/:id/events` 的响应为：

```json
{ "items": [ /* ServerEvent */ ], "nextSeq": 142, "hasMore": false }
```

`after` 缺省为 0；`nextSeq` 为本批最后一条事件的 `seq`，无事件时等于 `after`。

## 8. 资源接口（M2–M5 摘要）

| 方法 | 路径 | 里程碑 |
|---|---|---|
| GET / POST | `/api/terminals` | M2 |
| POST | `/api/terminals/:id/terminate` | M2 |
| POST | `/api/terminals/:id/resize` | M2 |
| POST | `/api/terminals/:id/lease` | M2 |
| GET | `/api/projects/:id/git/status` | M2 |
| POST | `/api/projects/:id/git/actions` | M2 |
| GET / POST | `/api/services` | M3 |
| POST | `/api/services/:id/actions` | M3 |
| GET | `/api/services/:id/logs?cursor=` | M3 |
| GET | `/api/preview/resolve?serviceId=` | M3 |
| POST | `/api/deployments/plan` | M4 |
| POST | `/api/deployments/:id/approve` | M4 |
| GET | `/api/deployments/:id` | M4 |
| GET / POST | `/api/jobs` | M5 |
| GET | `/api/updates/check` | M5 |
| POST | `/api/updates/install` | M5 |

未列出的接口默认不存在；新增必须同步本文件、Zod schema 与测试。

## 9. 速率与大小限制

| 项 | 限制 |
|---|---|
| JSON 请求体 | 1 MiB（文件上传单独限制） |
| 文件读取 | 单次 ≤ 2 MiB；更大走分块 / 只读预览 |
| 命令输出 | 单次 ≤ 1 MiB，超出截断并附 `truncated: true` |
| 事件拉取 | `limit` ≤ 500 |
| WS 消息 | 单条 ≤ 512 KiB |

## 10. 兼容性

- `/api` 内的破坏性变更（字段删除 / 语义变化）必须写 ADR，并保留至少一个小版本的兼容期。
- 错误码是契约的一部分，不得复用为不同语义。
- 新增响应字段默认允许；客户端必须忽略未知字段。
