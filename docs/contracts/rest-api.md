# REST API 契约

> 状态：M0 已冻结（Passkey / WebAuthn）；M1 为设计基线，实现时可补充字段但不得破坏既有语义。
> Base URL：默认监听 `127.0.0.1:3210`；dev/打包浏览器 canonical origin 均为 `http://localhost:3210`（Passkey 需要）或配置的 HTTPS 域名。Vite 是 dev 的内部受管前端，不改变 API 来源；见 [入口契约](runtime-entry.md)。所有业务接口前缀 `/api`。

## 1. 通用约定

| 项 | 约定 |
|---|---|
| 编码 | UTF-8；请求 / 响应 `application/json`（文件下载除外） |
| 认证 | `larness_session` HttpOnly Cookie；公开接口仅健康、bootstrap、配对、Passkey options / verify |
| CSRF | 已认证的变更请求带 `x-csrf-token`；公开配对 / Passkey 接口校验 Origin |
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
| `HTTPS_REQUIRED` | 403 | 非 loopback 请求未通过 HTTPS（含 WebSocket） |
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
| `ENROLLMENT_EXPIRED` | 410 | Passkey 注册 enrollment 缺失 / 过期 |
| `CHALLENGE_EXPIRED` | 410 | WebAuthn challenge 过期 / 已使用 |
| `PASSKEY_REGISTRATION_FAILED` | 400 | 注册验证失败（签名 / UV / 重复凭据等） |
| `PASSKEY_AUTH_FAILED` | 401 | 认证失败（统一错误，不泄漏原因） |
| `WEBAUTHN_NOT_CONFIGURED` | 409 | WebAuthn 配置无效（如 RP ID 为 IP、缺少 canonical origin） |
| `RATE_LIMITED` | 429 | 触发限流 |
| `PATH_OUTSIDE_PROJECT` | 403 | 路径越界 |
| `APPROVAL_INVALID` | 409 | 审批过期 / 被撤销 / 参数不一致 |
| `PREVIEW_TARGET_INVALID` | 403 | 代理目标未登记或被禁止 |
| `PROVIDER_UNAVAILABLE` | 503 | 模型 Provider 不可用 |
| `DEV_WEB_UNAVAILABLE` | 503 | 受管开发前端暂不可用；仅用于 ADR-028 开发页面转发 |
| `PROVIDER_AUTH_FAILED` | 502 | 模型 Provider 拒绝凭据 / 未配置 Key |
| `PROVIDER_RATE_LIMITED` | 429 | 模型 Provider 限流 |
| `PROVIDER_CONTEXT_LIMIT` | 413 | 上下文超出模型上限 |
| `PROVIDER_CONTENT_FILTERED` | 422 | 模型 Provider 内容过滤 |
| `PROVIDER_UNKNOWN` | 502 | Provider 未分类错误 |
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
  "app": { "name": "Larness", "version": "0.1.0" },
  "initialized": true,
  "auth": {
    "authenticated": false,
    "pairingEnabled": true,
    "passkeyEnabled": true,
    "passkeyOrigin": "http://localhost:3210",
    "passkeyRegistered": true
  },
  "features": { "preview": false },
  "serverTime": 1761900000000
}
```

规则：

- 未初始化时 `initialized=false`，`auth.pairingEnabled=false`、`auth.passkeyEnabled=false`、`auth.passkeyRegistered=false`，不返回数据目录、主机名、设备数量。
- `passkeyEnabled` 表示 WebAuthn 配置有效（非 IP、HTTPS 或 localhost）；`passkeyOrigin` 是唯一允许的 Passkey 来源；Web 端必须用 `window.location.origin === passkeyOrigin` 判断当前地址是否可用。通过 `127.0.0.1` 访问时 origin 不匹配，Passkey 不可用，但 `allow_once` 配对仍可用（loopback Origin 例外）。
- `passkeyRegistered` 只表示“是否已存在有效可信凭据”，不返回数量与标签。
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
- 服务端记录请求 `Origin`（不信任 body），仅 canonical Origin 的申请可选择“始终允许”。
- 速率：每 IP 10 次 / 分钟。

### GET `/api/pairing/requests/:requestId`

请求头：`x-pairing-token: <pollToken>`

```json
{ "status": "pending", "expiresAt": 1761900600000 }
```

状态：`pending | approved | enrollment_pending | denied | expired | redeemed`。`approved` 时额外返回 `decision: "allow_once" | "trust"`，**不返回配对码**。浏览器看到 `approved` 后显示配对码输入框。

### POST `/api/pairing/redeem`

```json
{ "requestId": "pair_…", "code": "7K3M-9Q2X" }
```

配对码原子消费；同一码不可再次使用。

**`allow_once`**：成功 `200`，`Set-Cookie: larness_session`：

```json
{
  "status": "session",
  "clientSessionId": "bs_…",
  "kind": "once",
  "deviceId": null,
  "csrfToken": "…",
  "expiresAt": 1761943200000
}
```

**`trust`**：成功 `200`，**不签发会话**，`Set-Cookie: larness_enrollment`（HttpOnly、Path=/api/webauthn/registration、5 分钟）：

```json
{
  "status": "passkey_required",
  "requestId": "pair_…",
  "enrollmentExpiresAt": 1761900300000
}
```

申请进入 `enrollment_pending`；完成 Passkey 注册验证后才创建设备、签发会话并标记 `redeemed`。注册失败 / 超时可重试，直到 enrollment 过期；过期需重新配对。

失败：`CODE_INVALID`（剩余尝试次数在 `details.attemptsLeft`）、`PAIRING_DENIED`、`PAIRING_EXPIRED`、`RATE_LIMITED`；`trust` 在 WebAuthn 配置无效或申请 Origin 非 canonical 时返回 `WEBAUTHN_NOT_CONFIGURED` / `ORIGIN_INVALID`（TUI 应已隐藏该选项）。

## 5. 认证会话与 Passkey（M0）

### GET `/api/auth/session`

已认证返回：

```json
{
  "clientSessionId": "bs_…",
  "deviceId": "dev_…",
  "kind": "passkey",
  "createdAt": 1761900000000,
  "expiresAt": 1761943200000,
  "csrfToken": "…",
  "capabilities": ["workspace.read", "workspace.write"],
  "passkey": { "backupEligible": true, "backupState": true }
}
```

- `kind`：`once`（允许本次）或 `passkey`（可信设备）。
- `once` 会话 `deviceId=null`，无 `passkey` 字段；不可升级为可信设备。
- 未认证返回 `401 UNAUTHENTICATED`。`capabilities` 为粗粒度提示，最终授权仍在每个接口。
- **不存在 `/api/auth/refresh`**；会话过期后重新走 Passkey 认证。

### POST `/api/webauthn/registration/options`

- 需要 `larness_enrollment` Cookie（`trust` 配对兑换后签发，5 分钟），不接受普通会话代替。
- 校验 Origin；生成一次性 challenge（5 分钟），返回：

```json
{
  "challengeId": "chl_…",
  "options": {
    "rp": { "id": "localhost", "name": "Larness" },
    "user": { "id": "…", "name": "operator", "displayName": "Larness Operator" },
    "challenge": "…",
    "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }],
    "timeout": 60000,
    "attestation": "none",
    "authenticatorSelection": {
      "residentKey": "required",
      "userVerification": "required"
    },
    "excludeCredentials": [{ "id": "…", "type": "public-key" }]
  }
}
```

- `options` 为 SimpleWebAuthn 的 `PublicKeyCredentialCreationOptionsJSON` 子集；完整字段以库输出为准。
- 失败：`ENROLLMENT_EXPIRED`、`WEBAUTHN_NOT_CONFIGURED`、`ORIGIN_INVALID`、`RATE_LIMITED`。

### POST `/api/webauthn/registration/verify`

```json
{ "challengeId": "chl_…", "response": { /* RegistrationResponseJSON */ } }
```

- 需要同一个 enrollment Cookie；校验 challenge、Origin、RP ID、UV，attestation `none`。
- 成功：创建 `trusted_devices` + `webauthn_credentials`，配对申请标记 `redeemed`，清 enrollment Cookie，签发 `larness_session`，返回与 `GET /api/auth/session` 相同结构（`201`）。
- 重复 credential / 验证失败：`PASSKEY_REGISTRATION_FAILED`；challenge 过期：`CHALLENGE_EXPIRED`。浏览器不支持 WebAuthn 时由 Web 端阻止并提示，不发起验证。

### POST `/api/webauthn/authentication/options`

公开接口（无需会话），但校验 Origin 与限流：

```json
{ "challengeId": "chl_…", "options": { "challenge": "…", "rpId": "localhost", "allowCredentials": [], "userVerification": "required", "timeout": 60000 } }
```

- `allowCredentials` 为空，使用 discoverable credential；不暴露账号是否存在。
- 当前来源不是 canonical origin：`ORIGIN_INVALID`；RP ID / Origin 配置无效：`WEBAUTHN_NOT_CONFIGURED`。

### POST `/api/webauthn/authentication/verify`

```json
{ "challengeId": "chl_…", "response": { /* AuthenticationResponseJSON */ } }
```

- 校验 challenge、Origin、RP ID、UV、签名、credential 与设备状态；更新计数器与最后使用时间。
- 成功：签发新的 `larness_session`，返回与 `GET /api/auth/session` 相同结构（`200`）。
- 失败统一返回 `401 PASSKEY_AUTH_FAILED`，不区分“credential 不存在 / 已撤销 / 签名错误”；challenge 过期返回 `CHALLENGE_EXPIRED`。

### POST `/api/auth/logout`

撤销当前会话，清 Cookie，返回 `204`。需 CSRF。Passkey credential 与设备保留；撤销设备只能通过 TUI。

### GET `/api/system/info`（已认证）

```json
{
  "version": "0.1.0",
  "node": "v22.0.0",
  "platform": "darwin",
  "arch": "arm64",
  "dataDir": "/Users/…/Larness",
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
| GET | `/api/fs/directories?path=` | 本机 loopback 专用；只返回目录 `{ path, parent, home, entries, truncated }`，不返回文件内容 |
| GET | `/api/projects` | `{ projects: Project[] }`，按 `updatedAt` 倒序 |
| POST | `/api/projects` | `{ name?, rootPath }`；校验目录存在、可读、realpath；201 |
| GET | `/api/projects/:id` | 详情 |
| PATCH | `/api/projects/:id` | `{ name?, settings? }`；settings 局部合并 |
| DELETE | `/api/projects/:id` | `{ ok: true }`；仅删数据库行，不删目录 |
| GET | `/api/sessions?projectId=&limit=` | 会话列表 / 最近会话；`limit` 1–100（默认 50），默认不含已归档 |
| POST | `/api/sessions` | `{ projectId?, title? }`；无项目时创建独立工作目录；201 |
| GET | `/api/sessions/:id` | 会话详情 + 活跃 Turn |
| PATCH | `/api/sessions/:id` | `{ title?, modelProfileId?, approvalPolicyId? }`；模型 / 策略只影响下一 Turn |
| DELETE | `/api/sessions/:id` | 归档会话（`status=archived`，不删 workspace / 源码）；活跃 Turn 返回 409 |
| POST | `/api/sessions/:id/turns` | `{ input, modelProfileId? }` + `Idempotency-Key`（可选）；409 `TURN_IN_PROGRESS` |
| POST | `/api/turns/:id/cancel` | 活跃 Turn 置 `CANCELLING`；无活跃 Turn 返回 409 |
| GET | `/api/sessions/:id/events?after=<seq>&limit=` | 增量事件，按 `seq` 升序；`limit` 1–500（默认 100） |
| GET | `/api/approvals/:id` | 审批详情（参数摘要、范围、过期时间） |
| POST | `/api/approvals/:id` | `{ decision: "approve" \| "reject" }`；校验参数哈希与范围 |
| GET | `/api/models` | 可用模型 Profile（不含密钥） |
| POST | `/api/models` | 新建 Profile（`secretRef` 或提交密钥到 SecretStore） |
| POST | `/api/models/:id/test` | 可选：连通性 / 工具调用冒烟 |
| GET | `/api/credentials` | 凭据元数据（掩码，不含明文） |
| POST | `/api/credentials` | 新建凭据，密钥只写不读 |
| DELETE | `/api/credentials/:id` | 删除未被模型引用的凭据 |
| GET | `/api/projects/:id/files` | M2-1：目录懒加载，`path / limit / cursor`；分页快照失效返回 CONFLICT |
| GET | `/api/sessions/:id/files` | M2-1：仅真实独立会话 workspace；参数同项目目录 |
| GET | `/api/files?projectId=&path=&version=` | M2-1：projectId / sessionId 二选一；完整 UTF-8 / 原字节 SHA-256 |
| PUT | `/api/files` | M2-1：`{ scope, path, content, expectedVersion }`，scope 为 `{ projectId }` 或 `{ sessionId }`；可选 Idempotency-Key |

`Project` 响应字段：

```json
{
  "id": "prj_…",
  "name": "demo",
  "rootPath": "/Users/me/demo",
  "realPath": "/Users/me/demo",
  "settings": { "defaultModelProfileId": null, "instructions": "", "ignore": [] },
  "gitDetected": true,
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

`Session` 响应字段（详情额外带 `activeTurn`）：

```json
{
  "id": "ses_…",
  "projectId": "prj_…",
  "workspacePath": "/Users/me/demo",
  "title": "New session",
  "status": "active",
  "modelProfileId": null,
  "approvalPolicyId": "standard",
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000,
  "lastActivityAt": 1790000000000,
  "activeTurn": {
    "id": "trn_…",
    "sessionId": "ses_…",
    "status": "QUEUED",
    "modelProfileId": null,
    "provider": null,
    "model": null,
    "input": { "text": "…" },
    "usage": null,
    "error": null,
    "createdAt": 1790000000000,
    "startedAt": null,
    "endedAt": null
  }
}
```

独立会话的 `workspacePath` 是 `dataDir/sessions/<sessionId>/workspace`，创建时为空目录；项目会话使用项目 `realPath`。列表只返回 `active` 会话。

Turn 创建成功返回 `202`：

```json
{ "turnId": "trn_…", "status": "QUEUED", "sessionId": "ses_…" }
```

重复 `Idempotency-Key` 返回首次 Turn 的当前状态（不重复写事件）；同一会话已有活跃 Turn 时返回 `409 TURN_IN_PROGRESS`。

`GET /api/sessions/:id/events` 的响应为：

```json
{ "items": [ /* ServerEvent */ ], "nextSeq": 142, "hasMore": false }
```

`after` 缺省为 0；`nextSeq` 为本批最后一条事件的 `seq`，无事件时等于 `after`。

`GET /api/approvals/:id` 返回审批详情（不包含完整工具参数，只包含摘要与参数哈希）：

```json
{
  "id": "apv_…",
  "turnId": "trn_…",
  "toolCallId": "call_…",
  "toolName": "apply_patch",
  "risk": "L1",
  "status": "pending",
  "scope": { "summary": "patch README.md", "risk": "L1", "toolName": "apply_patch" },
  "paramsHash": "…64 hex…",
  "expiresAt": 1790000300000,
  "decidedAt": null,
  "decidedBy": null,
  "createdAt": 1790000000000
}
```

`POST /api/approvals/:id` 接受 `{ "decision": "approve" | "reject" }`；仅 `pending` 可决策，重复决策 / 超时返回 `409 APPROVAL_INVALID`。过期审批在读取或清理时置为 `expired`，默认拒绝。执行前必须用同一参数重新计算哈希并与 `paramsHash` 比较，不一致拒绝并审计。

`GET /api/models` 返回不含密钥的模型 Profile：

```json
{
  "models": [
    {
      "id": "deepseek-default",
      "label": "DeepSeek Chat",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "credentialProfileId": null,
      "credentialLabel": null,
      "endpoint": null,
      "capabilities": { "streaming": true, "toolCalls": true, "vision": false, "reasoning": false, "maxContextTokens": 128000 },
      "createdAt": 1790000000000
    }
  ]
}
```

凭据接口只返回元数据与掩码，`apiKey` 只写不读：

```json
{ "credentials": [{ "id": "cred_…", "provider": "deepseek", "label": "DeepSeek", "secretRef": "sec_…", "masked": "••••••", "createdAt": 1790000000000 }] }
```

`POST /api/credentials` 接受 `{ provider, label, apiKey }`；`DELETE /api/credentials/:id` 在被模型 Profile 引用时返回 `409 CONFLICT`。密钥使用本机 AES-256-GCM 加密存储，主密钥权限 0600。

## 8. 资源接口（M2–M5 摘要）

| 方法 | 路径 | 里程碑 |
|---|---|---|
| GET / POST | `/api/terminals` | M2 |
| POST | `/api/terminals/:id/terminate` | M2 |
| POST | `/api/terminals/:id/resize` | M2 |
| POST | `/api/terminals/:id/lease` | M2 |
| GET | `/api/projects/:id/git/status` | M2 |
| POST | `/api/projects/:id/git/actions` | M2 |
| GET / POST | `/api/services` | M3临时登记；M4扩展持久服务 |
| POST | `/api/services/:id/actions` | M4持久动作，临时返回所属终端入口 |
| GET | `/api/services/:id/logs?cursor=` | M3引用终端日志；M4扩展PM2日志 |
| POST | `/api/preview/resolve` | M3技术候选：CSRF/no-store短期票据，详[m3-preview](m3-preview.md)；未实现 |
| POST | `/api/deployments/plan` | M4 |
| POST | `/api/deployments/:id/approve` | M4人工审批条件分支；自主不依赖此调用 |
| GET | `/api/deployments/:id` | M4 |
| GET / POST | `/api/jobs` | M5 |
| GET | `/api/updates/check` | M5 |
| POST | `/api/updates/install` | M5 |

未列出的接口默认不存在；新增必须同步本文件、Zod schema 与测试。

## 9. 速率与大小限制

| 项 | 限制 |
|---|---|
| JSON 请求体 | 1 MiB（文件上传单独限制） |
| M2 可编辑文件 | 完整 UTF-8 ≤ 512 KiB；超限 413，无分块编辑；M1 工具按原工具上限执行 |
| 命令输出 | 单次 ≤ 1 MiB，超出截断并附 `truncated: true` |
| 事件拉取 | `limit` ≤ 500 |
| WS 消息 | 单条 ≤ 512 KiB |

## 10. 兼容性

- `/api` 内的破坏性变更（字段删除 / 语义变化）必须写 ADR，并保留至少一个小版本的兼容期。
- 错误码是契约的一部分，不得复用为不同语义。
- 新增响应字段默认允许；客户端必须忽略未知字段。

## M2 详细草案入口（2026-11-02，未冻结）

文件 / 命令 / PTY / Git 的接口、资源事件与回放、数据迁移、锁与错误码拟细化于 [m2-resources.md](m2-resources.md)，配套 [030 spec](../../specs/030-dev-resources/spec.md)。本文件中原 M2 摘要只作范围索引；细化提案须经 G-Spec-M2 / ADR-029 确认后才生效，实施时同步 Zod schema 与测试，不改变 M0 / M1 已实现契约。

## ADR-030 服务与资源生命周期补充（2026-11-02）

[资源视图契约](resource-views.md) 已按人类确认修订：关闭 / 最小化窗口只隐藏，主动关闭终端 Tab 经 terminate 结束资源；服务无资源 Tab。临时服务仅登记 Terminal 源执行并在退出时自动退登，持久服务由 PM2 管理，详情、预览 / 结果卡片与拟议接口 / 事件 / 数据见 [services-preview.md](services-preview.md)。产品规则已接受，M2/M3 技术 schema / 迁移 / 代码尚未实施，既有认证和事件权威性不变。

M2-1（2026-11-03）：文件与目录接口已落地；精确 scope、幂等、错误、锁与恢复语义见 [m2-resources §11](m2-resources.md#11-m2-1-实施契约2026-11-03)。本文件早期 M2 草案描述不代表后续 PTY / Git 接口已实现。


M2-1b（2026-11-03）：GET `/api/resource-events?streamId=&after=&limit=` 已落地，仅接受授权文件流，limit 默认 100 / 最大 500。返回 `{ items, currentSequence, resyncRequired }`；after 超前为 400，保留 30 天且不重置序号，缺口重取快照。文件 / 目录 GET 兼作手动刷新。完整恢复 / 背压语义见 [m2-resources §12](m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。

M2-3（2026-11-03）：GET `/api/commands/:id`、GET `/api/commands/:id/output?after=&limit=`、POST `/api/commands/:id/cancel` 已接现有认证守卫及资源授权；没有通用 POST `/api/commands`。资源事件补拉现也接受 commandId。参数、幂等、停止确认、输出缺口与保留见 [m2-resources §14](m2-resources.md#14-m2-3-命令执行后端2026-11-03)；Agent 创建与 UI 留在 M2-3b。

M2-3b（2026-11-03）：run_command 仅由已授权的 Agent Turn 创建；未增加 POST `/api/commands`。真实命令卡片复用既有状态 / 输出 GET 与空对象 cancel（Cookie / Origin / CSRF）；取消单个命令与取消整个 Turn 分开。刷新 / 重连读状态和输出游标，不重复创建资源；截断 / 过期 / 缺口与停止未确认均显示当前真实状态。见 [资源契约 §15](m2-resources.md#15-m2-3b-agent-命令与执行卡片2026-11-03)。

M2-4（2026-11-03）：已实现 `/api/terminals` 列表 / 人工创建及 `/:id` 状态、output、lease、resize、terminate，全部沿既有 Cookie / Origin / CSRF 守卫；创建要求风险确认与 Idempotency-Key，输入连接 ID 由真实 WS 产生。新增 TERMINAL_LEASE_REQUIRED(409)，后端校验 generation / 连接 / scope，不以输入前端状态授权。终端进程与浏览器布局 / 输入租约独立；完整参数与失败 / 保留边界见 [资源契约 §16](m2-resources.md#16-m2-4-terminalmanager-与输入租约后端2026-11-03)。

### M2-9 终端改名（2026-11-04）

`POST /api/terminals/:id/rename`：已认证 + Origin / CSRF，body `{ title: string }`，返回新增 nullable title 的 Terminal DTO；1–80 字符、非空、无控制字符 / 已知秘密。失败使用 VALIDATION_ERROR / UNAUTHENTICATED / FORBIDDEN / RESOURCE_UNAVAILABLE，审计不记录标题正文。详见 m2-resources §23。

### M2-10 默认工作区（2026-11-04）

- GET `/api/workspaces/default/files`：同项目文件树的查询参数 / 响应；其他 workspace ID 返回 VALIDATION_ERROR。
- GET `/api/files?workspace=default&path=...`、PUT `/api/files` 的 scope `{ workspace: "default" }`：仅固定默认目录，不开放任意 dataDir 路径；鉴权、Origin / CSRF、相对路径 / 符号链接、秘密扫描、版本 / 幂等与审计沿用现有文件接口。
- POST `/api/sessions` 不提供 projectId 时，新会话共用默认目录；Session DTO 增加 workspaceKind（project/default/session），旧独立会话仍返回原 workspacePath。
- POST `/api/terminals` 支持默认 scope；默认会话别名归并为共享终端，workspaceSessionId=null。cwd 响应为实际绝对目录，执行入参仍相对授权根。详见 m2-resources §24。

## M2-13 默认系统项目
GET /api/projects 在列表首位返回固定系统项目 `{ id: "prj_default", kind: "default", name: "默认工作区", rootPath, realPath, ... }`；kind 为可选新增字段，普通登记项目沿用原结构。GET /api/projects/prj_default 可读固定描述；系统元数据时间 createdAt / updatedAt 为 0，表示内建资源而非用户登记时间。PATCH 合法名称 / settings 或 DELETE 该 ID 返回 FORBIDDEN（403）并审计；无认证仍 401，非法请求仍按 schema 拒绝。目录和内容不删除、不只读；不能将默认目录重复登记为普通项目（409）。
POST /api/sessions 的 projectId=prj_default 归一为现有默认会话域（DTO projectId=null、workspaceKind=default）。文件 projectId=prj_default 是 workspace:default 的 HTTP scope 别名；终端 create scope 及 list projectId 同样归一为默认域，返回原 null 归属 / ID。文件事件 / WS 订阅仍使用 workspace:default，不创建新的事件流、窗口分组或租约。历史独立会话不归入默认项目，无数据库迁移。

## M2-25 完全自主策略（ADR-040）
现有 Session PATCH approvalPolicyId 与 Turn executionContext.policy 枚举增加 autonomous；新 Turn 持久化选择时的快照，运行中更改只影响下一轮。明确选择该策略时已登记 Agent 工具 L0–L3 均无需人工逐次审批，执行仍校验参数、客户端/资源范围、锁/fencing/幂等/预算/取消/租约/秘密保护，仍有审计与持久事件。其他策略与人工 Git 资源审批保持。客户端选择前风险弹窗确认，取消不更改，危险色盾牌持续可见；这不是沙箱，不扩大工具能力或授权管理接口。未鉴权/非法枚举拒绝，无 DB列/迁移/新 REST路径。

## M2-27 Git 单文件恢复与取消暂存（ADR-041）
现有 Git resource-action 接口新增 `{ action: "unstage", paths: string[] }`（1–200条精确路径）及 `{ action: "discard", path: string, confirmed: true }`（单文件）。动作仍按 L1 复用已鉴权/CSRF 的创建和执行、项目锁、快照重验、过期、审计与幂等，无新增路径/DB列/依赖，不注册新 Agent 工具。
unstage仅恢复选定index到HEAD；无HEAD使用仅index移除，工作区不变；重命名同时恢复原路径index。discard仅处理未暂存变更，tracked从index恢复工作区，已暂存内容保留；untracked经确认后仅删除指定普通文件，不递归、不含忽略文件、不清理全仓。冲突、目录、symlink/非普通文件及越界拒绝。Git以字面pathspec执行，通配符不扩张。
discard动作创建时和执行锁前/锁后读取目标内容哈希，发现后续内容或状态变化拒绝覆盖；外部进程仍不受项目锁隔离，不宣称OS原子性。untracked枚举使用--untracked-files=all，文件逐条呈现而非目录清理。UI放弃按钮先显示路径与丢失/删除后果，取消不创建写动作，确认后才调用；取消暂存无丢弃确认，因为它保留磁盘内容。编辑器内存草稿不自动删除，监听/版本冲突继续保护。

## ADR-042：M3/M4与自主部署（2026-11-05，草案阶段划分）
M3仅temporary登记/查询/日志与隔离预览；全部PM2/persistent创建/运行/启停和部署属于M4，见[服务契约](services-preview.md)和[部署契约](deployment.md)。autonomous的已授权Agent业务操作无人工审批/确认停等，包括首次发布/版本替换/重启/停止/支持的恢复；后端必须有计划/产物/目标/策略快照和授权记录，不伪造approvalId。标准/严格按风险询问，只读拒绝写入。部署approve端点仅用于需要人工的分支，自主由真实后端策略授权后继续，不能要求再调用人类approve。当前接口是规划摘要，详细schema/执行触发方式需G-Spec-M4冻结；没有本次运行代码/API/数据库变更。

## M3技术候选（待审批，未实现）
服务登记由后端产生执行身份，人工沿resource-actions准备/决策/execute、Agent沿Turn策略调用共同核心；当前Git路由不代表已通用。预览解析候选改POST，不交凭据给模型/事件/URL；新字段/错误码与失败边界见[m3-preview](m3-preview.md)。
