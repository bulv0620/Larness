# 本机 IPC 契约（TUI ↔ Server）

> 状态：M0 基线。本机受 OS 权限保护的通道，不监听 TCP、不经公网、不经过 Fastify。
> 客户端：`node app.js tui`、`node app.js status`、测试用 IPC 客户端。

## 1. 传输与权限

| 平台 | 地址 | 权限 |
|---|---|---|
| macOS / Linux | `<dataDir>/ipc/larness.sock` | socket `0600`；数据目录 `0700` |
| 路径过长 | `<tmpdir>/larness-<sha256(dataDir).slice(0,16)>/larness.sock` | 目录 `0700`，socket `0600` |
| Windows | `\\.\pipe\larness-<sha256(dataDir).slice(0,16)>` | 依赖用户 ACL + Token |

- 启动时生成 32 字节随机 IPC Token，写入 `<dataDir>/ipc/token`（`0600`）。
- 客户端首帧必须是 `hello`，携带 Token；错误 / 缺失立即断开。
- 可用平台可追加 peer uid 校验，但不作为唯一安全边界。
- 单连接空闲 30 分钟断开；单帧 ≤ 1 MiB；同时连接数 ≤ 8。

## 2. 分帧

换行分隔 JSON（NDJSON），UTF-8。一行一个对象，不允许裸字符串。

### 请求

```json
{ "id": "1", "method": "system.status", "params": {} }
```

### 成功响应

```json
{ "id": "1", "ok": true, "result": { } }
```

### 错误响应

```json
{ "id": "1", "ok": false, "error": { "code": "FORBIDDEN", "message": "…" } }
```

### 事件（服务端主动）

```json
{ "event": "pairing.requested", "data": { "requestId": "pair_…", "shortCode": "428193" } }
```

## 3. 握手

```json
{ "id": "1", "method": "hello", "params": { "token": "…", "client": "tui", "pid": 12345 } }
```

成功：

```json
{ "id": "1", "ok": true, "result": { "protocolVersion": 1, "serverVersion": "0.1.0" } }
```

失败码：`INVALID_TOKEN`、`TOO_MANY_CONNECTIONS`、`PROTOCOL_MISMATCH`。

## 4. 方法

| method | 参数 | 返回 | 说明 |
|---|---|---|---|
| `hello` | `token, client, pid` | `protocolVersion, serverVersion` | 必须先调用 |
| `system.status` | — | 见下 | 状态快照 |
| `system.doctor` | — | `checks[]` | 自检 |
| `init.status` | — | `initialized, requiredFields` | 初始化状态 |
| `init.apply` | `host?, port?, publicUrl?, channel?` | `ok, origin, rpId, restartRequired` | 仅未初始化；可选配置补丁，空参数沿用配置；不接收密码；返回有效 origin / RP ID |
| `pairing.list` | `status?` | `requests[]` | 默认 pending；含 shortCode / Origin / UA / 时间 |
| `pairing.approve` | `requestId, decision: allow_once\|trust` | `code, expiresAt` | 生成一次性码；`trust` 仅在 WebAuthn 配置有效且申请 Origin 为 canonical 时可用，且需浏览器注册 Passkey |
| `pairing.deny` | `requestId` | `ok` | 拒绝 |
| `devices.list` | — | `devices[]` | 含 credential、backup 标志、最后使用、状态 |
| `devices.revoke` | `deviceId` | `ok` | 事务作废 credential + 设备 + 会话 + WS |
| `sessions.list` | — | `sessions[]` | 浏览器会话（kind: once / passkey） |
| `sessions.revoke` | `sessionId` | `ok` | 撤销单个会话 |
| `logs.tail` | `lines ≤ 500` | `lines[]` | 脱敏后的最近日志 |
| `audit.tail` | `limit ≤ 200` | `items[]` | 最近审计 |
| `server.shutdown` | `confirm: true` | `ok` | 优雅关闭 |

`system.status` 示例：

```json
{
  "version": "0.1.0",
  "initialized": true,
  "uptimeMs": 12345,
  "listen": { "host": "127.0.0.1", "port": 3210 },
  "db": { "ok": true, "schemaVersion": 3 },
  "ipc": { "ok": true, "clients": 1 },
  "sessions": { "online": 2, "pendingPairings": 1 },
  "publicUrl": "https://larness.example.com",
  "webauthn": { "enabled": true, "rpId": "larness.example.com", "origin": "https://larness.example.com" },
  "warnings": []
}
```

`sessions.online` 是“仍能通过认证校验的浏览器会话数”：未撤销、未绝对过期，且 `last_seen_at` 在 `auth.idleTtlMinutes`（默认 30 分钟）内；一个有效会话行算一个。它不是实时 WebSocket 连接数，关闭浏览器后会在空闲窗口结束后退出计数。

## 5. 事件

| event | data | 触发 |
|---|---|---|
| `pairing.requested` | `requestId, shortCode, createdAt, clientLabel, origin, ip, userAgent` | 新申请 |
| `pairing.decided` | `requestId, status, codeExpiresAt?` | 批准 / 拒绝 |
| `pairing.redeemed` | `requestId, sessionId?` | allow_once 兑换成功；trust 的会话在注册后产生 |
| `pairing.enrollment` | `requestId, expiresAt` | trust 兑换后进入 Passkey 注册窗口 |
| `pairing.enrolled` | `requestId, deviceId, credentialId` | Passkey 注册完成 |
| `device.revoked` | `deviceId` | 设备撤销 |
| `session.revoked` | `sessionId, reason` | 会话撤销 |
| `server.status` | 状态摘要 | 连接数 / 待审批变化 |
| `server.shutting-down` | `reason` | 关闭前 |

事件只是通知；TUI 以方法返回 / 重新查询为准，不依赖事件补全状态。

## 6. 错误码

| code | 含义 |
|---|---|
| `INVALID_TOKEN` | 缺失 / 错误 IPC Token |
| `PROTOCOL_MISMATCH` | 版本不兼容 |
| `METHOD_NOT_FOUND` | 未知方法 |
| `VALIDATION_ERROR` | 参数不合法 |
| `NOT_INITIALIZED` | 未初始化，方法不可用 |
| `ALREADY_INITIALIZED` | 重复初始化 |
| `FORBIDDEN` | 当前状态不允许（如未批准就取码） |
| `NOT_FOUND` | 申请 / 设备 / 会话不存在 |
| `CONFLICT` | 并发状态冲突（已被处理） |
| `RATE_LIMITED` | 操作过于频繁 |
| `INTERNAL` | 未预期错误 |

## 7. 兼容性

- `protocolVersion` 主版本不一致时拒绝连接；新增方法 / 字段视为兼容。
- 开发未发布阶段（ADR-026）允许经人类批准直接修改契约，代码、文档、测试一并更新并重新构建，不因单次字段变化自动升主版本；正式发布后，删除 / 改语义提升主版本。
- 所有方法在服务端重新校验初始化、状态与参数；不信任客户端传入的 ID 归属。

## 8. M0 实现校准（2026-11-01）

- 实现范围：`hello`、`system.status`、`system.doctor`、`init.status`、`init.apply`、`pairing.list/approve/deny`、`devices.list/revoke`、`sessions.list/revoke`、`logs.tail`、`audit.tail`、`server.shutdown`。
- `system.status` 实际返回 `running`、`db {ok, schemaVersion, initialized}`、`ipc {ok, clients}`、`sessions {online, pendingPairings}` 与 `warnings[]`；`system.doctor` 返回 `{version, dataDir, checks[]}`。
- `pairing.list` 返回 `{ requests[] }`，每项含 `requestId / shortCode / status / decision / clientLabel / clientOrigin / userAgent / createdAt / expiresAt / trustAvailable`；`trustAvailable` 表示 WebAuthn 有效且申请 Origin 为 canonical。
- `pairing.approve` 返回 `{ code, expiresAt }`（`code` 为未格式化的一次性码，仅此一次返回）；`pairing.deny` 返回 `{ ok: true }`。
- `devices.list` 返回 `{ devices[] }`，每项含 `id / label / createdAt / lastSeenAt / revokedAt / credentials[]`；`devices.revoke` 返回 `{ ok, revokedCredentials, revokedSessions }`。
- `sessions.list` 返回 `{ sessions[] }`；`sessions.revoke` 返回 `{ ok }` 并在 1 秒内关闭对应 WebSocket。
- `server.shutdown` 需 `confirm: true`；响应返回后延迟触发关闭，以便客户端收到确认。
- M0 尚未通过 IPC 推送 `pairing.*` / `device.*` 事件，TUI 通过轮询 `pairing.list` / `devices.list` 获取状态；会话与设备撤销会通过 `session.revoked` / `device.revoked` 内部事件关闭 WebSocket。
- M0-9 / ADR-023：TUI 是受管前台入口；由 supervisor 启动 Server（开发时另起 Vite），TUI 仍通过本契约连接。TUI 正常退出会经 `server.shutdown` 停止 Server 并终止 Web，不再承诺退出后后台存活。
- `system.ping` 为 TUI 保活方法，返回 `{ ok: true, now }`；TUI 每 5 分钟调用一次，避免 30 分钟 IPC 空闲断开。IPC 意外断开时 TUI 最多重连 2 次。
- 配对 / WebAuthn 的业务错误在 IPC 层映射为 `FORBIDDEN`、`VALIDATION_ERROR`、`NOT_FOUND`、`CONFLICT`、`RATE_LIMITED`，不暴露库内部错误文本。

### 初始化发布恢复（I0-2）

`init.apply` 保留已有 config.json 中未明确修改的字段，环境变量覆盖不会作为整份配置写回。配置发布完成前 `init.status` / `system.status` 的 initialized 为 false；发布失败返回 INTERNAL，提示重启恢复，业务接口保持关闭。数据库已提交的初始化不可再次覆盖；重启先恢复发布，再允许业务访问。

### 初始化向导（I0-4 / ADR-025；协议决定由 ADR-026 校准）

- IPC protocolVersion=1（WebSocket 版本不变）。移除 init.apply.adminPassword，旧字段返回 VALIDATION_ERROR；开发期按当前源码统一构建，不提供旧参数兼容层。
- init.status.requiredFields=[]；必须经本机用户确认才调用 init.apply，空参数不等于自动初始化。host/port/publicUrl/channel 均可省略，省略保留文件值；publicUrl=null 显式清空。
- 不再要求管理员密码；历史哈希保留、新实例 admin_hash 为空字符串，未增加密码认证。
- 默认向导展示有效网络配置，网络进入高级设置；环境覆盖不无意落盘，修改受环境控制字段须先改环境变量。首次 dev 默认 5173 只在没有显式来源配置时持久化。
- restartRequired 按发布后叠加环境变量的有效配置与当前运行配置比较。受管 TUI 在进入仪表盘前关闭旧 IPC、停止旧运行环境、重新启动并连接；失败退出，保留已保存配置。

### 统一入口校准（U0-2 / ADR-028）

- dev 与打包运行都沿用有效 publicUrl / server.port，初始化不再自动持久化 5173 来源；不新增 init.apply 参数或提高协议版本。
- Vite 目标通过 supervisor/子进程私有控制通道传递，不加入本契约的方法，不进入 system.status Web 地址或数据库。
- 初始化需要重启时停止全部旧子进程、连接和开发缓存，再用新一代内部目标启动。既有配置保留与发布恢复规则不变。
