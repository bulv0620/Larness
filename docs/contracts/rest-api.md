# REST API 契约

> 状态：M0 已冻结（Passkey / WebAuthn）；M1 为设计基线，实现时可补充字段但不得破坏既有语义。
> Base URL：默认监听 `127.0.0.1:3210`；浏览器 canonical origin 为 `http://localhost:3210`（Passkey 需要）或 HTTPS 域名；Vite 开发（5173）需把 origin 配置为 `http://localhost:5173`。所有业务接口前缀 `/api`。

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
