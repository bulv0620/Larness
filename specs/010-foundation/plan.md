# 实施计划：M0 工程底座与可信启动

> 对应 [spec.md](spec.md) 与 [ADR-021](../../docs/adr/ADR-021-passkey-v1.md)。安全相关实现以本文件为准；与 spec 冲突时先停。

## 1. 技术方案

```text
node app.js
  └─ apps/server/dist/index.js
       ├─ bootstrap: paths → config → logger → lock → db/migrate → ipc → http
       ├─ apps/server/src/api/*        REST
       ├─ apps/server/src/ws/*         WebSocket
       ├─ apps/server/src/pairing/*    配对 / enrollment
       ├─ apps/server/src/webauthn/*   Passkey 注册 / 认证
       ├─ apps/server/src/auth/*       Session / CSRF / Origin / 限流
       ├─ apps/server/src/ipc/*        UDS / Named Pipe
       └─ apps/server/src/tui/*        初始化 / 审批 / 设备管理
```

- 使用 `@simplewebauthn/server` 生成 options / 验证响应；浏览器使用 `@simplewebauthn/browser`。
- 不签发长期设备 Token，也不使用 refresh token；会话过期后用 Passkey 重新认证。
- 配对与注册写入使用 `BEGIN IMMEDIATE` 事务，保证“消费码 / 建 enrollment / 建设备 / 建会话 / 审计”一致。
- 鉴权按路由组挂载（公开 / 已认证），不做全局“默认放行再补检查”。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 长期 opaque device token（ADR-016） | 简单、兼容性最好 | 可重放、可钓鱼、需轮换 | 不采用 |
| JWT 会话 | 无状态 | 撤销困难、易误用 | 不采用 |
| Passkey + 长期 token fallback | 兼容旧浏览器 | fallback 削弱安全目标 | 不采用；用 allow_once 覆盖 |
| 仅硬件安全密钥 | 强绑定 | 门槛高 | 不采用；允许平台认证器 |
| 强制 attestation | 可校验设备 | 生态复杂、隐私差 | 不采用；attestation none |
| IPC 使用 TCP | 跨平台简单 | 暴露网络面 | 不采用；UDS / Named Pipe |
| TUI 使用 Web 页面 | 复用 UI | 初始化前无认证，风险高 | 不采用 |

## 3. 目录与文件变更

```text
新增：
app.js                                   # M0-9
apps/server/
  src/index.ts                           # 进程入口
  src/app.ts                             # createApp
  src/cli/{status,doctor}.ts
  src/bootstrap/{paths,config,logger,lock,shutdown}.ts
  src/db/{client,migrate,schema/*,repositories/*}.ts
  src/auth/{tokens,password,csrf,origin,session,rateLimit,middleware}.ts
  src/pairing/{service,repository,shortCode,enrollment}.ts
  src/webauthn/{service,challenges,credentials,rpConfig}.ts
  src/ipc/{server,protocol,client}.ts
  src/tui/{index,views,approve}.ts
  src/api/{health,bootstrap,pairing,auth,webauthn,system,index}.ts
  src/ws/{server,handshake,subscriptions}.ts
  src/security/{audit,redact,headers}.ts
  src/platform/{socket,paths,instance}.ts
  drizzle/0001_auth.sql
  test/**/*.test.ts
packages/shared/src/{config,errors,domain}.ts
packages/agent/src/index.ts              # 占位
packages/resources/src/index.ts          # 占位
apps/web/src/features/auth/{LoginPage,PairPage,PasskeyButton,RequireAuth,useSession}.tsx
apps/web/src/lib/webauthn.ts
apps/web/src/app/routes.tsx              # 增加 /login、/pair
.github/workflows/ci.yml

修改：
package.json / pnpm-workspace.yaml / tsconfig / biome
apps/web/src/app/App.tsx
docs/contracts/ipc.md（校准）
```

## 4. 启动顺序（严格）

1. 解析 `argv`（`tui` / `status` / `doctor` / 默认 server）。
2. `resolveDataDir()`：`LARNESS_DATA_DIR` > 默认 OS 目录；创建并校验权限（POSIX 0700）。
3. `loadConfig()`：`config.json` Zod 校验；环境变量覆盖；推导 / 校验 `webauthn.rpId` / `origin`。
4. `initLogger()`：pino + 轮转；安装 `uncaughtException` / `unhandledRejection`。
5. `acquireInstanceLock()`：`larness.lock` 写 PID / 启动时间；冲突时检查 PID 存活。
6. `openDatabase()`：WAL / 外键 / busy_timeout；执行迁移；失败退出。
7. `startIpc()`：创建 socket / pipe，写 0600 Token 文件。
8. `createApp()`：公开路由、鉴权路由、静态资源。
9. `listen()`：绑定 host / port；失败清理锁与 IPC。
10. 输出 ready 日志；注册信号处理；启动清理任务（会话、配对、challenge、限流）。

关闭顺序反向：停止接收 → 关 WS → 关 HTTP → 关 IPC → 释放锁 → 关 DB。

## 5. 关键实现

### 5.1 配置 / canonical origin / RP ID

```ts
interface WebAuthnConfig {
  rpId: string;      // 必须等于 origin hostname；拒绝 IP
  rpName: string;    // "Larness"
  origin: string;    // 精确比较，不带尾斜杠
}
```

- 有 `publicUrl`：`origin=publicUrl`，`rpId=new URL(publicUrl).hostname`；非 localhost 必须 https。
- 无 `publicUrl`：`origin=http://localhost:<port>`，`rpId=localhost`。
- `rpId` 为 IP、`origin` 配置本身无效、或远程 http：`passkeyEnabled=false`，业务仍可用 allow_once，doctor 告警；通过 IP 访问属于当前 origin 不匹配，不是配置无效。
- 初始化向导展示推导结果并要求确认；修改后提示旧 Passkey 可能失效。
- Vite 开发（5173）与生产（3210 / publicUrl）的浏览器 origin 不同：dev 用 `LARNESS_PUBLIC_URL=http://localhost:5173`，否则 Origin 校验会拒绝 Passkey；E2E 优先用 Server 托管的构建产物。

### 5.2 单实例锁

```json
{ "pid": 1234, "startedAt": 1761900000000, "version": "0.1.0" }
```

- `open(path, 'wx')` 成功即持有；`EEXIST` 读取 PID，`process.kill(pid, 0)` 判断。
- 存活 → 退出码 1；不存活 → 删除后重试一次。
- 退出 / 信号处理释放；异常崩溃留下的锁由下次启动判定。

### 5.3 IPC

- POSIX：`<dataDir>/ipc/larness.sock` 0600；路径 > 100 字节时用 `os.tmpdir()/larness-<hash>/larness.sock`（0700）。
- Windows：`\\.\pipe\larness-<sha256(dataDir).slice(0,16)>`。
- IPC Token 32 字节，写 `<dataDir>/ipc/token` 0600；首帧 `hello` 校验。
- NDJSON；单帧 ≤ 1 MiB；空闲 30 分钟断开；Zod 判别联合。
- 安全边界：文件权限 + Token；可用平台追加 peer uid。

### 5.4 Token、Cookie、CSRF

```text
会话 Token：32 字节 CSPRNG → base64url；DB 存 SHA-256；Cookie HttpOnly/SameSite=Lax/Path=/
Enrollment Token：32 字节 → base64url；DB 存 SHA-256；Cookie Path=/api/webauthn/registration；TTL 5 分钟
CSRF：HMAC-SHA256(csrfKey, sessionId) → base64url；csrfKey 32 字节，secrets/csrf.key 0600
配对码：10 字符 Crockford Base32（约 50 bit），显示 XXXXX-XXXXX；DB 存 SHA-256
```

- 比较 Token / CSRF 使用 `crypto.timingSafeEqual`。
- Cookie 仅在请求 HTTPS 或 `origin` 为 https 时加 `Secure`。
- 会话查询校验 `revoked_at IS NULL`、`expires_at > now`、空闲期限；`last_seen_at` 最多每 60 秒更新。
- **没有** `larness_device` Cookie、`/api/auth/refresh`、设备 Token 轮换。

### 5.5 配对与 enrollment

```text
allow_once:
  BEGIN IMMEDIATE
    校验 request / code / attempts / expiry
    UPDATE request SET status='redeemed', redeemed_at=now
    INSERT browser_session(kind='once', device_id=NULL)
    INSERT audit_logs
  COMMIT

trust:
  BEGIN IMMEDIATE
    校验并消费 code
    INSERT enrollment token hash（绑定 request，5 分钟）
    UPDATE request SET status='enrollment_pending'
    INSERT audit_logs
  COMMIT
  → Set-Cookie larness_enrollment
```

- 配对码失败 `attempts += 1`；达到 5 次作废申请。
- 短编号 / 配对码输入去空格、去 `-`、大小写归一化。
- TUI 批准时再次确认申请仍为 `pending`。
- enrollment 只允许一次成功注册；失败可重试，过期需重新配对。

### 5.6 WebAuthn 注册

```text
POST registration/options（enrollment Cookie + Origin）
  → 校验 enrollment hash / expiry / request
  → 生成 challenge（32B，5 分钟，type=registration，request_id）
  → generateRegistrationOptions({
       rpID, rpName, userID: sha256(instance_id) (Uint8Array, 32B),
       userName: 'operator', userDisplayName: 'Larness Operator',
       attestationType: 'none',
       authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
       excludeCredentials: 现有有效 credential
     })
  → { challengeId, options }
```

```text
POST registration/verify（enrollment Cookie + Origin）
  → 原子消费 challenge（UPDATE ... WHERE consumed_at IS NULL）
  → verifyRegistrationResponse({ expectedChallenge, expectedOrigin, expectedRPID, requireUserVerification: true })
  → 校验 credentialId 未存在
  → 事务：INSERT device + credential；UPDATE request status='redeemed'
  → 创建会话（kind='passkey'）、清 enrollment Cookie、审计
```

- `credential.publicKey`、counter、transports、AAGUID、backup 标志入库。
- 验证失败不创建设备；challenge 已消费，客户端重新取 options。

### 5.7 WebAuthn 认证

```text
POST authentication/options（公开 + Origin）
  → 生成 challenge（type=authentication）
  → generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: 'required' })
  → { challengeId, options }
```

```text
POST authentication/verify（公开 + Origin）
  → 原子消费 challenge
  → verifyAuthenticationResponse({
       credential: { id, publicKey, counter, transports },
       expectedChallenge, expectedOrigin, expectedRPID,
       requireUserVerification: true
     })
  → 校验 device / credential 未撤销
  → 更新 counter / last_used；创建会话；审计
  → 失败统一 401 PASSKEY_AUTH_FAILED
```

- 同步 Passkey 的 counter 常为 0：允许；异常回退只审计。
- credential 不存在 / 已撤销 / 签名错误对外统一错误，避免枚举。

### 5.8 中间件顺序

```text
onRequest: requestId → 安全响应头 → 记录开始
preHandler（已认证组）: 会话解析 → Origin（变更） → CSRF（变更） → 限流
公开路由: 配对 / WebAuthn 仍执行 Origin + 限流
handler
onError: 统一错误码 + requestId；5xx 记录堆栈，4xx 不记录堆栈
```

- 静态资源：`/assets/*` 公开；`/` 回退 `index.html`；`/api/*` 不落入静态。
- Origin 允许列表：canonical + loopback 来源 `localhost` / `127.0.0.1` / `[::1]` 同端口；WebAuthn 端点只接受 canonical。
- 安全头：`nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`（管理端）；CSP 允许自身脚本 / 样式。
- `trustProxy` 只对 `server.trustedProxies` 生效；默认 `false`。

### 5.9 WebSocket

- `@fastify/websocket` 的 `preValidation` 解析 Cookie、校验会话与 Origin。
- 连接记录 `clientSessionId`；撤销时按 ID `close(1008)`。
- 订阅校验 topic / resourceId；未实现主题返回 `FORBIDDEN`。
- 心跳 25s / 60s 超时；发送队列上限 8 MiB。

### 5.10 TUI

- `tui` → IPC → 未初始化进入 init 向导；否则仪表盘。
- 初始化：管理员密码、监听、publicUrl、更新通道；展示推导的 canonical origin / RP ID。
- 配对审批：`允许本次` / `始终允许（注册 Passkey）` / 拒绝；批准后展示配对码。
- 设备列表：标签、credential 类型、backup 标志、最后使用、状态；`r` 撤销（二次确认）。
- 退出 TUI 不停止 Server；`server.shutdown` 二次确认。

### 5.11 Web

- `useSession()`：`GET /api/auth/session`；401 → 跳 `/login`（不自动触发 WebAuthn）。
- `/login`：`browserSupportsWebAuthn()` 检查；页面加载预取 authentication options；点击按钮后直接 `startAuthentication`（保留用户手势），再 verify；取消 / 失败提示；`returnTo`。
- `/pair`：申请 → 等待 → 配对码 → redeem；`passkey_required` 时预取 registration options，显示“创建 Passkey”按钮，点击后直接 `startRegistration`；allow_once 直接进入。
- 首页守卫：`passkeyUsable = bootstrap.passkeyEnabled && window.location.origin === bootstrap.passkeyOrigin && browserSupportsWebAuthn()`；`passkeyUsable && passkeyRegistered` → `/login`，否则 `/pair`。
- 设备撤销只经 TUI；Web 只展示当前会话信息。

## 6. 数据与迁移

- Drizzle schema 与 `drizzle/0001_auth.sql` 同步；启动时 migrator。
- 新增表：`webauthn_credentials`、`webauthn_challenges`；`device_requests` 增加 enrollment 字段；`trusted_devices` 移除 token 列。
- 测试：空库迁移、重复迁移幂等、迁移失败回滚、外键开启、credential 唯一。
- 清理任务：过期 challenge / 申请 / 会话。
- 备份：M0 提供 `backupDatabase()` 调用点与 `backups/` 目录；完整策略 M4。

## 7. 回滚

- 新增代码，回滚即回退任务提交；已初始化数据目录无法自动降级。
- 迁移只前进；开发环境可删除空数据目录重新初始化，生产需备份恢复。
- 若 Passkey 方案被平台阻塞，必须新增 ADR 才能回到 opaque token（见 ADR-021）。

## 8. 验证命令

```bash
pnpm check
pnpm build
pnpm test
pnpm test:e2e
node app.js status
node app.js doctor
```

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| RP ID / Origin 配置错误 | 注册 / 登录全部失败 | 初始化推导 + doctor + 明确错误；单测覆盖 |
| `127.0.0.1` / IP 访问 | WebAuthn 不可用 | 明确提示改用 localhost / HTTPS；allow_once 保底 |
| 浏览器 / 平台差异 | Face ID 行为不一致 | Chromium 虚拟认证器 + macOS 真机冒烟；Safari 手动覆盖 |
| 用户取消 / 超时 | 注册半途 | enrollment 保留 5 分钟；可重试；过期重新配对 |
| 同步 Passkey | 跨设备可用 | 展示 backup 标志；撤销；不承诺物理绑定 |
| SimpleWebAuthn 升级 | 验证行为变化 | 锁定版本；契约测试；升级走 ADR |
| Enrollment Cookie 被窃 | 冒名注册 | HttpOnly / SameSite / 5 分钟 / 绑定 request / 单次 |
| 多标签并发认证 | challenge 冲突 | 每次 options 新建 challenge；前端串行化登录点击 |
| 迁移与 schema 漂移 | 启动失败 | 单测对比 schema / SQL；CI 空库迁移 |
| 限流内存态重启重置 | 暴力破解窗口 | 配对码 TTL 短 + 尝试次数持久化 |

## 10. 未决事项

- Q-015 IP 引导、Q-016 恢复、Q-017 同步 Passkey、Q-018 allow_once：按 spec 默认实现，变更需 ADR。
- 真实 Safari / Firefox 的 Passkey 行为在 M0-9 验收中记录；未实测不得宣称支持。
