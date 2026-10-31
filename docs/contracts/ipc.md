# 本机 IPC 契约（TUI ↔ Server）

> 状态：M0 基线。本机受 OS 权限保护的通道，不监听 TCP、不经公网、不经过 Fastify。  
> 客户端：`node app.js tui`、`node app.js status`、测试用 IPC 客户端。

## 1. 传输与权限

| 平台 | 地址 | 权限 |
|---|---|---|
| macOS / Linux | `<dataDir>/ipc/harness.sock` | socket `0600`；数据目录 `0700` |
| 路径过长 | `<tmpdir>/harness-<sha256(dataDir).slice(0,16)>/harness.sock` | 目录 `0700`，socket `0600` |
| Windows | `\\.\pipe\harness-<sha256(dataDir).slice(0,16)>` | 依赖用户 ACL + Token |

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
| `init.apply` | `adminPassword, host, port, publicUrl?, channel?` | `ok, restartRequired` | 仅未初始化；写配置与密码哈希 |
| `pairing.list` | `status?` | `requests[]` | 默认 pending |
| `pairing.approve` | `requestId, decision: allow_once\|trust` | `code, expiresAt` | 生成一次性码 |
| `pairing.deny` | `requestId` | `ok` | 拒绝 |
| `devices.list` | — | `devices[]` | 含最后活跃、到期、状态 |
| `devices.revoke` | `deviceId` | `ok` | 事务作废会话 |
| `sessions.list` | — | `sessions[]` | 浏览器会话 |
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
  "publicUrl": "https://harness.example.com",
  "warnings": []
}
```

## 5. 事件

| event | data | 触发 |
|---|---|---|
| `pairing.requested` | `requestId, shortCode, createdAt, clientLabel, ip, userAgent` | 新申请 |
| `pairing.decided` | `requestId, status, codeExpiresAt?` | 批准 / 拒绝 |
| `pairing.redeemed` | `requestId, sessionId` | 兑换成功 |
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
- 删除 / 改语义必须提升主版本，并同步 `app.js tui` / `status` 与测试。
- 所有方法在服务端重新校验初始化、状态与参数；不信任客户端传入的 ID 归属。
