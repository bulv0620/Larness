# 实施计划：M0 工程底座与可信启动

> 对应 [spec.md](spec.md)。安全相关的实现细节以本文件为准；与 spec 冲突时先停。

## 1. 技术方案

```text
node app.js
  └─ apps/server/dist/index.js
       ├─ bootstrap: paths → config → logger → lock → db/migrate → ipc → http
       ├─ apps/server/src/api/*        REST
       ├─ apps/server/src/ws/*         WebSocket
       ├─ apps/server/src/pairing/*    配对状态机
       ├─ apps/server/src/auth/*       Token / CSRF / Origin / 限流
       ├─ apps/server/src/ipc/*        UDS / Named Pipe
       └─ apps/server/src/tui/*        初始化 / 审批 / 设备管理
```

- Fastify 5 应用工厂 `createApp(deps)`：测试可注入临时目录、时钟、DB。
- 鉴权按路由组挂载（公开 / 已认证），不做全局“默认放行再补检查”。
- 配对与会话写入使用 `BEGIN IMMEDIATE` 事务，保证“消费码 + 建会话 + 审计”原子。
- 前端在 S0 壳上增加 `/pair` 与 `RequireAuth`，其余页面保留空态。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| JWT 会话 | 无状态 | 撤销困难、易误用 | 不采用；opaque token + DB |
| 密码登录远程 | 简单 | 违反“Web 不能自我注册 / 仅 TUI 准入” | 不采用 |
| 仅 localhost 信任 | 无配置 | 无法远程、可被本机恶意进程利用 | 不采用 |
| IPC 使用 TCP | 跨平台简单 | 暴露网络面 | 不采用；UDS / Named Pipe |
| TUI 使用 Web 页面 | 复用 UI | 初始化前无认证，风险高 | 不采用；本机终端 |
| 自己实现密码哈希 | 依赖少 | 易错 | 不采用；`@node-rs/argon2` |
| 配对码存明文 | 简单 | DB 泄漏即失守 | 不采用；SHA-256 |

## 3. 目录与文件变更

```text
新增：
app.js                                   # M0-8
apps/server/
  src/index.ts                           # 进程入口
  src/app.ts                             # createApp
  src/cli/{status,doctor}.ts
  src/bootstrap/{paths,config,logger,lock,shutdown}.ts
  src/db/{client,migrate,schema/*,repositories/*}.ts
  src/auth/{tokens,password,csrf,origin,session,rateLimit,middleware}.ts
  src/pairing/{service,repository,shortCode}.ts
  src/ipc/{server,protocol,client}.ts
  src/tui/{index,views,approve}.ts
  src/api/{health,bootstrap,pairing,auth,system,index}.ts
  src/ws/{server,handshake,subscriptions}.ts
  src/security/{audit,redact,headers}.ts
  src/platform/{socket,paths,instance}.ts
  drizzle/0001_auth.sql
  test/**/*.test.ts
packages/shared/src/{config,errors,domain}.ts
packages/agent/src/index.ts              # 占位
packages/resources/src/index.ts          # 占位
apps/web/src/features/auth/{PairingPage,RequireAuth,useSession}.tsx
apps/web/src/app/routes.tsx              # 增加 /pair
.github/workflows/ci.yml

修改：
package.json / pnpm-workspace.yaml / tsconfig / biome
apps/web/src/app/App.tsx
docs/contracts/ipc.md（新增）
```

## 4. 启动顺序（严格）

1. 解析 `argv`（`tui` / `status` / 默认 server）。
2. `resolveDataDir()`：`HARNESS_DATA_DIR` > 默认 OS 目录；`mkdir -p`；校验权限（POSIX 0700）。
3. `loadConfig()`：`config.json` 存在则 Zod 校验；环境变量覆盖；缺失时使用安全默认（未初始化）。
4. `initLogger()`：pino + 轮转；安装 `uncaughtException` / `unhandledRejection`（记录后退出）。
5. `acquireInstanceLock()`：`harness.lock` 写入 PID / 启动时间；冲突时检查 PID 存活。
6. `openDatabase()`：WAL / 外键 / busy_timeout；执行迁移；失败则退出。
7. `startIpc()`：创建 socket / pipe，写 0600 令牌文件。
8. `createApp()`：注册插件、公开路由、鉴权路由、静态资源。
9. `listen()`：绑定 host / port；失败则清理锁与 IPC 后退出。
10. 输出 ready 日志；注册信号处理；启动过期清理定时任务（会话、配对、限流）。

关闭顺序反向：停止接收 → 关 WS → 关 HTTP → 关 IPC → 释放锁 → 关 DB。

## 5. 关键实现

### 5.1 配置与数据目录

- 数据目录：`env-paths('Harness', { suffix: '' }).data`；Windows / macOS / Linux 各自标准路径。
- 目录结构：`config.json`、`harness.db`、`secrets/`、`logs/`、`backups/`、`tmp/`、`sessions/`、`artifacts/`、`ipc/`。
- 初始化前 `config.json` 不存在时使用内存默认（host `127.0.0.1`、port `3210`），不写盘。
- `HARNESS_HOST` / `HARNESS_PORT` 只影响监听，不回写配置。
- 非 loopback + 非 https 公网 URL：`requireHttpsForRemote` 时拒绝启动业务（bootstrap 仍可访问并提示）。

### 5.2 单实例锁

```ts
// <dataDir>/harness.lock
{ "pid": 1234, "startedAt": 1761900000000, "version": "0.1.0" }
```

- `open(path, 'wx')` 成功即持有；`EEXIST` 时读取 PID，`process.kill(pid, 0)` 判断存活。
- 存活 → 退出码 1，提示 PID；不存活 → 删除后重试一次。
- 退出 / 信号处理中释放；异常崩溃留下的锁由下次启动判定。

### 5.3 IPC

- POSIX：`<dataDir>/ipc/harness.sock`，`chmod 0600`；路径 > 100 字节时改用 `os.tmpdir()/harness-<sha256(dataDir).slice(0,16)>/harness.sock`（目录 0700）。
- Windows：`\\.\pipe\harness-<sha256(dataDir).slice(0,16)>`。
- 启动时生成 32 字节 IPC Token，写入 `<dataDir>/ipc/token`（0600）；客户端首帧必须 `hello`：
  ```json
  { "id": "1", "method": "hello", "params": { "token": "…", "client": "tui", "pid": 123 } }
  ```
- 帧格式：换行分隔 JSON；单帧 ≤ 1 MiB；30 分钟空闲断开。
- 协议用 Zod 判别联合；未知方法返回 `METHOD_NOT_FOUND`。
- 安全边界：文件权限 + Token；在可用平台可追加 peer uid 校验，但不作为唯一依赖。

### 5.4 密码、Token、CSRF

```text
管理员密码：Argon2id（m=19456, t=2, p=1），32 字节 salt，PHC 字符串存储
会话 Token：32 字节 CSPRNG → base64url（43 字符）；DB 存 SHA-256
设备 Token：同上；Cookie Path=/api/auth
配对码：10 字符 Crockford Base32（约 50 bit），显示为 XXXXX-XXXXX；DB 存 SHA-256
CSRF：HMAC-SHA256(csrfKey, sessionId) → base64url；csrfKey 为 32 字节随机，存 secrets/csrf.key（0600）
```

- 比较 Token / CSRF 使用 `crypto.timingSafeEqual`。
- Cookie：`HttpOnly; SameSite=Lax; Path=/`；仅当请求为 HTTPS 或 `publicUrl` 为 https 时加 `Secure`。
- 会话查询先校验 `revoked_at IS NULL`、`expires_at > now`、空闲期限；`last_seen_at` 最多每 60 秒更新一次。
- 刷新：校验设备 Cookie → 轮换设备 Token → 撤销旧会话 → 建新会话；事务内完成。
- 多标签并发刷新：设备表保留“当前 + 前一个”Token 哈希，前一个保留 60 秒宽限，避免互相踢出；宽限后旧值失效。

### 5.5 配对事务

```text
BEGIN IMMEDIATE
  SELECT request WHERE id=? AND status='approved'
  校验 expires_at / code_expires_at / attempts < 5 / sha256(code) 匹配
  UPDATE request SET status='redeemed', redeemed_at=now
  INSERT browser_session (hash(token), kind, expires_at)
  如 trust：INSERT trusted_device + 轮换设备 Token
  INSERT audit_logs
COMMIT
```

- 失败尝试 `attempts += 1`，达到 5 次把状态置 `expired`（或 `denied`），返回 `RATE_LIMITED`。
- 短编号 / 配对码输入做去空格、去 `-`、大小写归一化。
- TUI 批准时必须再次确认申请仍在 `pending`，避免重复批准。

### 5.6 HTTP 中间件顺序

```text
onRequest: requestId → 安全响应头 → 记录开始
preHandler（已认证组）: 会话解析 → Origin（变更） → CSRF（变更） → 限流
handler
onError: 统一错误码 + requestId；5xx 记录堆栈，4xx 不记录堆栈
```

- 公开路由单独注册，避免误挂鉴权；但配对接口仍执行 Origin / 限流。
- 静态资源：`/assets/*` 公开；`/` 回退 `index.html`；`/api/*` 不落入静态。
- 安全头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`（管理端）；CSP 在 M0 先允许自身脚本 / 样式，禁用内联（Vite 生产资源带 hash）。
- `trustProxy` 只对 `server.trustedProxies` 生效；默认 `false`。

### 5.7 WebSocket

- `@fastify/websocket` 的 `preValidation` 中解析 Cookie、校验会话与 Origin；失败直接 401 / 403。
- 连接对象记录 `clientSessionId`；会话撤销时按 ID 查找并 `close(1008)`。
- 订阅处理：校验 topic / resourceId（M0 只有 `system` 与 `session` 级通知），未实现主题返回 `FORBIDDEN` / `UNSUPPORTED`。
- 心跳 25s / 60s 超时；发送队列上限 8 MiB。

### 5.8 TUI

- `node app.js tui` → 连接 IPC → 若未初始化进入 init 向导；否则进入仪表盘。
- 仪表盘：状态区块、待审批列表、最近审计、设备列表；快捷键 `a` 批准、`d` 拒绝、`r` 撤销、`q` 退出。
- 退出 TUI 不停止 Server；`server.shutdown` 需二次确认。
- TUI 输出不包含 Token / 配对码以外的秘密；配对码只在批准后的一次性界面展示。

### 5.9 Web 接入

- `useSession()`：查询 session → 401 时调用 refresh → 仍失败跳 `/pair`。
- `RequireAuth`：加载态显示骨架；失败重定向；保留 `returnTo`。
- 配对页状态：`idle → requesting → pending → approved → redeeming → success | denied | expired | error`。
- 轮询 2s（带抖动），页面隐藏时暂停；兑换成功后失效 Query 并 `navigate('/')`。
- 登出后清空 Query 缓存并跳 `/pair`。

## 6. 数据与迁移

- Drizzle schema 与 `drizzle/0001_auth.sql` 同步；启动时用 drizzle migrator。
- `app_meta` 键：`schema_version`、`initialized_at`、`instance_id`、`csrf_key_created_at`。
- 测试：空库迁移、重复迁移幂等、迁移失败回滚、外键开启。
- 备份：M0 提供 `backupDatabase()` 调用点与 `backups/` 目录；完整策略在 M4。

## 7. 回滚

- 新增代码，回滚即回退任务提交；已初始化数据目录无法自动降级。
- 迁移只前进；若 M0 迁移失败，删除空数据目录重新初始化（开发环境），生产环境需备份恢复。

## 8. 验证命令

```bash
pnpm check
pnpm build
pnpm test
pnpm test:e2e
node app.js status
node app.js doctor      # 或 pnpm --filter @harness/server doctor
```

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `@node-rs/argon2` 预编译不匹配 | 无法启动认证 | M0-1 先做安装 / 哈希冒烟；失败则锁定可用版本 |
| Cookie 在 http localhost 被 Secure 丢弃 | 无法登录 | 仅在 https 时加 Secure；E2E 覆盖 |
| UDS 路径超长 | IPC 失败 | 哈希短路径 + 0700 临时目录；测试长路径 |
| Windows Named Pipe 权限 | 本地安全边界弱 | 依赖 OS ACL + Token；M5 PoC 明确限制 |
| 反向代理 Headers 处理错误 | Origin 校验误判 | 默认不信任转发头；配置化 + 测试 |
| 迁移与 schema 漂移 | 启动失败 | 单测对比 schema / SQL；CI 空库迁移 |
| 并发兑换竞态 | 双发会话 | `BEGIN IMMEDIATE` + 条件更新；并发测试 |
| 限流内存态重启重置 | 暴力破解窗口 | 配对码 TTL 短 + 尝试次数持久化 |

## 10. 未决事项

- Q-001 WebAuthn、Q-007 数据目录、Q-008 TTL：按 spec 默认实现，变更需 ADR。
- 离线恢复码：M0 不做，记录在 `docs/open-questions.md`。
