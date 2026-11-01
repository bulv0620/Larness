---
id: 010-foundation
title: M0 工程底座与可信启动
milestone: M0
status: ready
depends_on: [000-visual-demo]
owners: [human]
created: 2026-10-31
updated: 2026-10-31
---

# M0 工程底座与可信启动

> 源设计：`larness.md` 第 10–17、22–23、29–31、33–35、41–42 章。
> 认证决策：[ADR-021](../../docs/adr/ADR-021-passkey-v1.md) 已替代 ADR-016：**V1 使用 Passkey / WebAuthn，不签发长期设备 Token**。
> 这是第一个涉及真实安全边界的里程碑：初始化、配对、Passkey、会话、审计、稳定入口。不允许用 Mock 或“临时绕过”交付。

## 1. 背景与问题

S0 只提供前端外壳与 Mock 数据。M0 要把 Larness 变成一台可以真实部署、真实访问的单机服务：

- `node app.js` 能启动并明确报告状态；
- 首次运行只能在本机 TUI 初始化，公网不能抢占管理员；
- 新浏览器必须经本机 TUI 批准；
- `允许本次` 只给短期会话；`始终允许` 必须注册 Passkey，之后用 Face ID / 指纹 / PIN 登录；
- 所有 REST / WS / 静态数据访问都经过后端鉴权；
- 认证、配对、撤销、审计必须可测试、可恢复、失败关闭。

本里程碑不实现项目、会话与 Agent；但数据层、鉴权中间件、事件总线与 Web 外壳要为它们留好接口。

## 2. 目标

- G-1：`node app.js`、`node app.js tui`、`node app.js status`、`node app.js doctor` 可用；单实例；优雅关闭。
- G-2：数据目录、`config.json`、日志、诊断可操作，启动失败有明确错误。
- G-3：SQLite WAL + 迁移 + 审计；重启后会话与设备保持。
- G-4：本机 IPC（UDS / Named Pipe）+ TUI 完成初始化与日常管理。
- G-5：配对状态机完整：申请、TUI 审批、一次性码、`allow_once` 会话、`trust` enrollment。
- G-6：Passkey 注册与认证完整：challenge、验证、设备 / credential、撤销、同步标志。
- G-7：REST / WS 全量鉴权、Origin / CSRF、限流、失败关闭。
- G-8：S0 壳接入真实认证：`/login`（Passkey）、`/pair`、路由守卫、登出、撤销后跳转。
- G-9：通过 G0 门禁（`larness.md` 42.1）。

## 3. 非目标

- 项目 / 会话 / Turn / Agent / 终端 / 服务 / 文件 / Git / 预览（M1–M3）。
- 多 RP ID / 多域名 / 多 canonical origin；V1 一个工作空间只有一个来源。
- 硬件密钥强制、attestation 验证、设备证明（device attestation）。
- 通过 `127.0.0.1` 或局域网 IP 使用 Passkey（RP ID 不支持 IP；改用 `localhost` / HTTPS 域名）。
- Web 侧找回 Passkey / 自助恢复；离线恢复码仍为 P1。
- HTTPS 终止、内置隧道、反向代理配置生成（部署者负责；本里程碑校验配置与 Headers）。
- 自动更新、Launcher 版本切换（M5）；M0 只做稳定入口。
- 多用户、角色、租户；浏览器指纹识别或“物理设备绑定”承诺。

## 4. 用户与流程

### 4.1 首次运行

```text
node app.js
  → 创建 / 校验数据目录（0700）
  → 打开 SQLite，执行迁移
  → 获取单实例锁
  → 启动本地 IPC
  → 未初始化：只提供 /api/health、/api/bootstrap，控制台提示运行 tui
  → 启动 Fastify（默认 127.0.0.1:3210）

node app.js tui
  → 连接 IPC
  → 设置管理员恢复凭据（≥ 12 字符，二次确认）
  → 确认监听地址 / 端口 / 公网 URL / 更新通道
  → 推导并校验 canonical origin / RP ID
  → 写入 config.json 与 app_meta.initialized_at
  → 审计 auth.init
  → 提示“初始化完成；如修改了监听地址，请重启 server”
```

### 4.2 允许本次（allow_once）

```text
浏览器打开 http://localhost:3210 → 无会话
  → /pair → POST /api/pairing/requests → 显示 6 位短编号
  → TUI 审批：允许本次
  → TUI 显示一次性配对码（5 分钟）
  → 浏览器输入配对码 → POST /api/pairing/redeem
  → 签发短期会话（kind=once，deviceId=null）→ 进入 Workspace
```

- 不创建 `trusted_devices`，不注册 Passkey。
- 会话到期后需重新配对；不存在 refresh。

### 4.3 始终允许 + Passkey 注册

```text
浏览器 /pair → 申请 → TUI 审批：始终允许
  → TUI 显示一次性配对码
  → 浏览器输入配对码 → POST /api/pairing/redeem
  → 200 passkey_required + Set-Cookie larness_enrollment（5 分钟）
  → 浏览器预取 POST /api/webauthn/registration/options（enrollment Cookie）
  → 显示“创建 Passkey”按钮
  → 用户点击 → navigator.credentials.create（保留用户手势）
  → POST /api/webauthn/registration/verify
  → 服务端验证 challenge / Origin / RP ID / UV
  → 创建 trusted_device + webauthn_credential + 会话
  → 配对申请标记 redeemed → 进入 Workspace
```

- 注册未完成前不创建会话、不创建设备；页面关闭后可重试直到 enrollment 过期。
- 浏览器不支持 WebAuthn、或当前来源不是 canonical origin：提示改用 `允许本次` 或换用 `localhost` / HTTPS 域名。

### 4.4 日常登录

```text
未认证 → /login
  → 页面加载预取 POST /api/webauthn/authentication/options → challenge
  → 用户点击“使用 Passkey 登录”
  → navigator.credentials.get（Face ID / 指纹 / PIN，保留用户手势）
  → POST /api/webauthn/authentication/verify
  → 验证签名 / challenge / Origin / RP ID / UV / credential 状态
  → 签发新的短期会话 → 进入 Workspace
```

- 会话过期 / 浏览器重启：回到 `/login`，用 Passkey 再认证；无 refresh token。
- 没有任何有效 Passkey 时，`/login` 引导到 `/pair`。

### 4.5 撤销与失效

- TUI 撤销设备：作废 credential + 设备 + 全部会话，断开 WS；浏览器下一次请求 401 → `/login`。
- Passkey 丢失：TUI 撤销旧设备后重新配对注册；TUI 不可用时无法恢复（Q-016）。
- 会话过期：DB 记录保留，但不再授权；`last_seen_at` 只做节流更新。

## 5. 功能需求

### 5.1 入口与生命周期（MUST）

| ID | 需求 |
|---|---|
| R-1 | `pnpm dev` / `node app.js` 启动 Server 与 Web 并进入 TUI；`status` 输出只读 JSON；`doctor` 自检；`--version` / `--help` 可用。TUI 关闭即停止全部（ADR-023）。 |
| R-2 | 同一数据目录只允许一个 Server；第二个实例 3 秒内以非 0 退出并说明原因。 |
| R-3 | SIGINT / SIGTERM：停止接收新请求、关 WS、释放 IPC / 锁、关 DB；10 秒超时强制退出。 |
| R-4 | 端口占用、目录不可写、迁移失败、配置非法：非 0 退出并输出可操作提示；不得半启动。 |
| R-5 | 生产模式由 Server 托管 `apps/web/dist`；`/api/*` 与 `/ws` 优先于静态回退；未知前端路由回退 `index.html`。 |

### 5.2 配置与数据目录（MUST）

| ID | 需求 |
|---|---|
| R-6 | 数据目录默认使用 OS 标准目录（`env-paths`），支持 `LARNESS_DATA_DIR`；校验存在 / 可写 / 权限。 |
| R-7 | `config.json` 由 init 生成；Zod 校验；非法配置拒绝启动，不静默回退。 |
| R-8 | 环境变量覆盖：`LARNESS_DATA_DIR`、`LARNESS_HOST`、`LARNESS_PORT`、`LARNESS_LOG_LEVEL`、`LARNESS_PUBLIC_URL`。 |
| R-9 | 创建 `logs/`、`backups/`、`tmp/`、`sessions/`、`artifacts/`、`secrets/`、`ipc/`；目录 0700 / 文件 0600。 |
| R-10 | 初始化只经 IPC；重复初始化返回 `ALREADY_INITIALIZED`；未初始化不得写 `initialized_at`。 |

配置基线：

```json
{
  "version": 1,
  "server": { "host": "127.0.0.1", "port": 3210, "publicUrl": null, "trustedProxies": [] },
  "auth": { "sessionTtlMinutes": 720, "idleTtlMinutes": 30, "requireHttpsForRemote": true },
  "webauthn": {
    "rpId": "localhost",
    "rpName": "Larness",
    "origin": "http://localhost:3210"
  },
  "logging": { "level": "info", "retentionDays": 14 },
  "updates": { "channel": "stable", "autoCheck": true, "autoInstall": false },
  "preview": { "enabled": false }
}
```

Canonical origin / RP ID 规则：

- 有 `publicUrl`：`origin` 必须与它完全一致，`rpId` 取其 hostname；`publicUrl` 必须为 HTTPS，除非 hostname 是 `localhost`。
- 无 `publicUrl`：`origin = http://localhost:<port>`，`rpId = localhost`。
- 禁止 IP 作为 `rpId`；配置本身无效（IP / 远程 http）时 `passkeyEnabled=false`。通过 `127.0.0.1` 等非 canonical 来源访问时是 origin 不匹配，Passkey 不可用。
- 只支持一个 origin；修改需重新初始化或经 TUI + 重启，并提示旧 Passkey 可能失效。
- 开发期 Web 由 Vite（默认 5173）提供、API 经代理访问时，canonical origin 必须设为 `http://localhost:5173`（`LARNESS_PUBLIC_URL`），RP ID 仍为 `localhost`；生产由 Server 托管，origin 为 `http://localhost:<port>` 或 `publicUrl`。

### 5.3 日志与诊断（MUST）

| ID | 需求 |
|---|---|
| R-11 | pino 结构化日志：`level`、`time`、`msg`、`requestId`、`clientSessionId`、`action`；秘密脱敏。 |
| R-12 | 文件日志按天 / 大小轮转，保留 `retentionDays`；非 TUI 模式同时输出 stderr，TUI 模式由 supervisor 捕获并在日志模块展示。 |
| R-13 | `status` 与 TUI 显示：版本、初始化、监听、DB、IPC、在线会话数、待审批数、磁盘可写。 |
| R-14 | `doctor` 检查：Node 版本、数据目录权限、端口、DB 完整性、迁移版本、时钟偏移（>5 分钟告警）、canonical origin、RP ID、HTTPS 配置。 |

### 5.4 SQLite 与审计（MUST）

| ID | 需求 |
|---|---|
| R-15 | WAL、`foreign_keys=ON`、`busy_timeout=5000`；迁移在监听端口前完成。 |
| R-16 | 迁移失败不启动；破坏性变更前备份（M0 保留调用点）。 |
| R-17 | 审计覆盖：`auth.init`、`config.changed`、`pairing.requested/approved/denied/redeemed`、`auth.passkey.registered/login/failed`、`auth.login/logout`、`device.revoked`、`session.revoked`、`server.shutdown`、`security.rate_limited`。 |
| R-18 | 审计只追加；`details_json` 脱敏；TUI 可查看最近 200 条，无 Web 删除接口。 |

### 5.5 本机 IPC 与 TUI（MUST）

| ID | 需求 |
|---|---|
| R-19 | POSIX 使用 UDS（0600）+ 0600 启动 Token 握手；Windows 使用 Named Pipe；可用平台追加 peer uid。 |
| R-20 | NDJSON；请求 / 响应带 `id`；事件带 `event`；单帧 ≤ 1 MiB；空闲 30 分钟断开。 |
| R-21 | 方法：`system.status`、`system.doctor`、`init.status`、`init.apply`、`pairing.list/approve/deny`、`devices.list/revoke`、`sessions.list/revoke`、`logs.tail`、`audit.tail`、`server.shutdown`。 |
| R-22 | IPC 不监听 TCP；所有方法服务端再次校验状态与参数；TUI 不通过公网路由。 |
| R-23 | TUI 是受管前台入口；正常退出会优雅停止 Server 与 Web；无 headless 产品模式。异常断开尽力清理但可能残留子进程（ADR-023）。 |
| R-24 | TUI 设备列表显示：标签、凭据类型、`backupEligible/backupState`、创建时间、最后使用、状态；待审批列表显示 Origin，非 canonical 来源只提供 allow_once；撤销需二次确认。 |

### 5.6 配对与 enrollment（MUST）

| ID | 需求 |
|---|---|
| R-25 | 申请：`requestId`、6 位短编号、`pollToken`；记录 Origin / UA / IP；TTL 10 分钟；每 IP 10 次 / 分钟。 |
| R-26 | 审批只来自 TUI；显示短编号、时间、来源、UA；拒绝 / 过期不可兑换。 |
| R-27 | 批准生成 ≥ 50 bit 配对码，仅 TUI 展示；TTL 5 分钟；最多 5 次尝试；哈希存储；原子消费。 |
| R-28 | `allow_once`：兑换后签发 `kind=once` 会话，不创建设备，不注册 Passkey。 |
| R-29 | `trust` 仅在 WebAuthn 配置有效且申请 Origin 等于 canonical 时可用；兑换后不签发会话，仅签发 5 分钟 enrollment Cookie 与 `passkey_required`；注册成功后创建设备 / 会话并标记 `redeemed`；否则 TUI 不提供该选项。 |
| R-30 | enrollment Token 32 字节随机，只存 SHA-256，绑定 request；仅允许一次成功注册，失败可重试；Cookie Path=`/api/webauthn/registration`；过期后重新配对。 |
| R-31 | 并发兑换同一申请只有一个成功；配对码与申请绑定，不跨申请使用。 |

### 5.7 Passkey / WebAuthn（MUST）

| ID | 需求 |
|---|---|
| R-32 | 仅支持 canonical origin / RP ID；Origin 不匹配返回 `ORIGIN_INVALID`，RP ID / Origin 配置无效返回 `WEBAUTHN_NOT_CONFIGURED`；UI 提示改用 `localhost` / HTTPS。 |
| R-33 | 注册：`residentKey=required`、`userVerification=required`、`attestation=none`；`excludeCredentials` 防止重复。 |
| R-34 | 注册验证：challenge、Origin、RP ID、UV、credential 唯一性；通过后才创建设备 / credential / 会话。 |
| R-35 | 存储：credential ID、公钥、counter、transports、AAGUID、`backupEligible`、`backupState`、创建 / 最后使用时间。 |
| R-36 | 认证：`allowCredentials=[]`（discoverable）、UV required；按 credential ID 查找；撤销 / 过期 / 未知统一失败。 |
| R-37 | Challenge：32 字节随机，TTL 5 分钟，一次性消费，绑定 ceremony 类型与 request / device；定时清理。 |
| R-38 | 计数器：允许 0（同步 Passkey），异常回退只审计不硬拒绝；不宣称物理设备绑定。 |
| R-39 | 失败统一为 `PASSKEY_REGISTRATION_FAILED`（注册）/ `PASSKEY_AUTH_FAILED`（认证），不泄漏 credential 是否存在。 |
| R-40 | 撤销只能经 TUI：事务作废 credential + device + sessions + WS；审计。 |
| R-41 | Passkey 注册 / 登录依赖 `@simplewebauthn/server`；浏览器端使用 `@simplewebauthn/browser`；版本锁定并记录。 |

### 5.8 会话与传输安全（MUST）

| ID | 需求 |
|---|---|
| R-42 | 会话 Token 32 字节随机，只存 SHA-256；Cookie `larness_session`：HttpOnly、SameSite=Lax、Path=/、Max-Age ≤ 12h、HTTPS 时 Secure。 |
| R-43 | 会话绝对 12h、空闲 30min（可配置）；无 refresh token；过期走 Passkey 登录。 |
| R-44 | CSRF Token 由服务器密钥对 `sessionId` 做 HMAC 派生；已认证变更请求必须带 `x-csrf-token`。 |
| R-45 | Origin / Host 精确校验 canonical origin；非 WebAuthn API 额外允许 loopback 来源（`localhost` / `127.0.0.1` / `[::1]` 同端口），WebAuthn 仍只接受 canonical；不信任 `X-Forwarded-*`，除非来源 IP 在 `trustedProxies`。 |
| R-46 | 所有业务 REST 默认拒绝；公开仅 `/api/health`、`/api/bootstrap`、配对、Passkey options / verify。 |
| R-47 | WebSocket 升级校验会话、Origin；订阅按资源授权；撤销会话 / 设备后 1 秒内关闭（1008）。 |
| R-48 | 限流：配对申请 10/min/IP；轮询 60/min/token；兑换 10/min/IP + 5 次尝试；WebAuthn options / verify 10/min；已认证 600/min/session。 |

### 5.9 Web 集成（MUST）

| ID | 需求 |
|---|---|
| R-49 | 未认证 `/`：`passkeyEnabled && location.origin === passkeyOrigin && passkeyRegistered` → `/login`；否则 `/pair`。 |
| R-50 | `/login`：Passkey 登录按钮、浏览器不支持 / IP 来源 / 取消 / 失败的明确提示、`returnTo`、跳转 `/pair`；options 预取，`get` 由点击直接触发。 |
| R-51 | `/pair`：申请、短编号、等待、配对码、allow_once 成功、trust 的 Passkey 注册、失败重试 / 过期；Passkey options 预取，`create/get` 必须由用户手势直接触发，避免长 await 后丢失 activation。 |
| R-52 | 认证后展示当前会话设备 / 类型 / 到期；登出；401 统一跳 `/login?returnTo=…`；设备撤销只经 TUI。 |
| R-53 | 不把 CSRF / 会话 Token 写入 localStorage；Passkey 注册取消不产生半成品设备。 |

## 6. 验收场景

### A1 未初始化

```gherkin
Given 数据目录为空
When 启动 server 并访问 /api/bootstrap
Then initialized=false、pairingEnabled=false
And 访问 /api/projects 返回 NOT_INITIALIZED
And 访问 /api/pairing/requests 返回 NOT_INITIALIZED
```

### A2 TUI 初始化

```gherkin
Given 未初始化且 server 已启动
When 运行 node app.js tui 并完成管理员密码、监听与 canonical origin 配置
Then config.json 生成且权限受限，app_meta.initialized_at 写入
And 审计存在 auth.init
And 再次初始化返回 ALREADY_INITIALIZED
```

### A3 初始化只能本机

```gherkin
Given 未初始化
When 从远程浏览器 POST 任意“设置管理员 / 初始化”请求
Then 不存在该接口（404），initialized 保持 false
```

### A4 允许本次配对

```gherkin
Given 已初始化且 TUI 在线
When 浏览器申请配对，TUI 选择“允许本次”
Then TUI 显示短编号与一次性配对码
When 浏览器提交正确配对码
Then 获得 larness_session（kind=once，deviceId=null），进入 Workspace
And 不创建 trusted_devices / webauthn_credentials
And 申请标记 redeemed，配对码不可复用
```

### A5 始终允许 + Passkey 注册

```gherkin
Given 已初始化且 TUI 在线
When 浏览器申请配对，TUI 选择“始终允许”
Then 浏览器兑换配对码后得到 passkey_required 与 larness_enrollment Cookie
And 未获得会话，未创建设备
When 浏览器完成 WebAuthn 注册并 POST registration/verify
Then 创建 trusted_device 与 webauthn_credential
And 签发 larness_session（kind=passkey），申请标记 redeemed
And 审计包含 auth.passkey.registered
```

### A6 配对码错误与限次

```gherkin
Given 一个已批准、未兑换的申请
When 连续提交错误配对码 5 次
Then 第 6 次返回 RATE_LIMITED，申请作废
And 审计记录失败与限流，不记录配对码明文
```

### A7 并发兑换

```gherkin
Given 同一申请与配对码
When 两个客户端同时兑换
Then 仅一个成功，另一个返回 CONFLICT / CODE_INVALID
And 只产生一个会话或一个 enrollment
```

### A8 允许本次过期

```gherkin
Given 通过“允许本次”签发的会话
When 会话超过绝对或空闲期限
Then 后续请求返回 UNAUTHENTICATED
And 不存在 refresh / 长期凭据，必须重新配对
```

### A9 Passkey 登录

```gherkin
Given 已完成 A5 的设备
When 清除会话 Cookie（或会话过期）后重新打开 /login
Then 可发起 WebAuthn authentication 并成功登录
And 新会话 kind=passkey
When 会话过期后再次访问
Then 仍需 Passkey 认证，不自动续期
```

### A10 撤销设备

```gherkin
Given 一个已注册 Passkey 的设备及其会话 / WS
When TUI 撤销该设备
Then credential / 设备 / 会话立即失效，WS 在 1 秒内关闭
And 再次 authentication 返回 PASSKEY_AUTH_FAILED
And 审计记录 device.revoked
```

### A11 CSRF / Origin

```gherkin
Given 已认证会话
When 发起变更请求但缺少 x-csrf-token
Then 返回 CSRF_INVALID
When 携带合法 CSRF 但 Origin 为恶意站点
Then 返回 ORIGIN_INVALID
And Passkey options / verify 在错误 Origin 下也被拒绝
```

### A12 WebSocket 鉴权

```gherkin
Given 无 Cookie 或 Origin 非法
When 连接 /ws
Then 握手失败（401 / 403），不进入订阅协议
Given 已认证但订阅未授权资源
When 发送 subscribe
Then 返回 FORBIDDEN，不推送该资源事件
```

### A13 TUI 不在线

```gherkin
Given server 运行但 TUI 已关闭
When 新浏览器申请配对
Then 申请保持 pending 直到过期，不自动批准
And 已有 Passkey 仍可正常登录
```

### A14 单实例

```gherkin
Given 同一数据目录已有一个 server
When 启动第二个 server
Then 第二个进程以非 0 退出并提示数据目录已被占用
```

### A15 status / doctor

```gherkin
Given server 正在运行
When 运行 node app.js status
Then 输出合法 JSON，包含 initialized、listen、db、ipc、pendingPairings
When 运行 node app.js doctor
Then 检查 Node、数据目录、端口、DB、迁移、时钟、RP ID / Origin
```

### A16 不支持的来源 / 浏览器

```gherkin
Given canonical origin 为 http://localhost:3210
When 通过 http://127.0.0.1:3210 申请配对
Then TUI 只提供“允许本次”，不提供“始终允许”
When 强制提交 trust 兑换
Then 返回 ORIGIN_INVALID（配置无效时为 WEBAUTHN_NOT_CONFIGURED）
And UI 提示改用 localhost / HTTPS，或选择“允许本次”
And 浏览器不支持 WebAuthn 时 UI 显示 PASSKEY_UNSUPPORTED 并阻止注册
```

### A17 Challenge 重放 / 过期

```gherkin
Given 一个已消费或过期的 challengeId
When 再次提交 registration/verify 或 authentication/verify
Then 返回 CHALLENGE_EXPIRED / PASSKEY_AUTH_FAILED / PASSKEY_REGISTRATION_FAILED
And 不创建会话 / 设备
```

### A18 Enrollment 滥用

```gherkin
Given 没有 enrollment Cookie
When 调用 registration/options
Then 返回 UNAUTHENTICATED / ENROLLMENT_EXPIRED
Given enrollment 已绑定 request A
When 用 request B 的 challenge 注册
Then 验证失败，不创建设备
Given enrollment 过期
When 重试注册
Then 返回 ENROLLMENT_EXPIRED，需重新配对
```

## 7. 接口与契约

- REST：见 [rest-api.md](../../docs/contracts/rest-api.md) 第 3–5 节；已包含 pairing / enrollment / WebAuthn / session。
- WS：见 [ws-events.md](../../docs/contracts/ws-events.md) 第 1–2 节。
- IPC / TUI：见 [ipc.md](../../docs/contracts/ipc.md)；`devices.list` 含 Passkey 元数据。
- 配置：第 5.2 节；新增键必须向后兼容并提供默认值。
- 错误码：沿用 `docs/contracts/rest-api.md` 第 2 节；Passkey 专用码不得复用为其他语义。

## 8. 数据与迁移

M0 迁移 `0001_auth`：

- `app_meta`、`auth_settings`、`device_requests`（含 enrollment 字段）、`trusted_devices`、`webauthn_credentials`、`webauthn_challenges`、`browser_sessions`、`audit_logs`；
- 索引：`device_requests(status, expires_at)`、`browser_sessions(device_id)`、`webauthn_credentials(device_id)`、`webauthn_challenges(expires_at)`、`audit_logs(action, created_at)`；
- 不存长期设备 Token；`trusted_devices` 无 token 列；
- 迁移在监听前执行；失败拒绝启动。

## 9. 安全与审计

| 威胁 | 控制 |
|---|---|
| 公网抢占初始化 | 未初始化时业务 API 全拒绝；无 Web 注册接口 |
| 配对码暴力破解 | 50 bit 随机、5 次尝试、限流、短 TTL、哈希存储 |
| 配对请求冒领 | requestId + pollToken + TUI 编号核对 + 原子消费 |
| Passkey 钓鱼 | RP ID / Origin 绑定；challenge 一次性 |
| Challenge 重放 | 5 分钟 TTL、消费标记、类型 / request 绑定 |
| Enrollment 冒用 | HttpOnly Cookie、单次、绑定 request、5 分钟 |
| 会话窃取 | HttpOnly / SameSite / Secure（HTTPS）、短期、无 refresh、服务端撤销 |
| CSRF | Origin 精确匹配 + HMAC CSRF Token |
| WS 越权 | 握手鉴权 + 订阅二次授权 + 撤销即断 |
| 本地 IPC 被同账户进程滥用 | OS 权限 + 0600 Token；明确残余风险 |
| 日志泄密 | 脱敏器覆盖 Cookie / Token / 密码 / 配对码；测试扫描 |
| 反向代理头伪造 | 默认不信任 `X-Forwarded-*`；仅 `trustedProxies` 内生效 |

失败关闭矩阵见 [security.md](../../docs/architecture/security.md) 第 8 节。任何认证异常不得降级为匿名。

## 10. 失败、边界与恢复

| 场景 | 行为 |
|---|---|
| 端口占用 | 启动失败，退出码非 0，提示端口 / 处理方式 |
| 数据目录不可写 | 启动失败，提示路径与权限 |
| 迁移失败 / DB 损坏 | 拒绝启动；提示备份与 `doctor` |
| 第二个实例 | 退出并提示已有实例 PID |
| 配对过程中 TUI 关闭 | 申请保留至过期；已批准码仍可在 TTL 内兑换 |
| 浏览器取消 Passkey | 停留注册页，可重试；enrollment 到期后重新配对 |
| 浏览器不支持 WebAuthn | trust 注册失败并提示；allow_once 仍可用 |
| 通过 IP / 非 canonical 来源访问 | 前端判断 origin 与 passkeyOrigin 不匹配；提示改用 localhost / HTTPS |
| 兑换中途崩溃 | 事务保证码消费 / enrollment 原子；不产生半个会话 |
| 注册验证失败 | 不创建设备 / 会话；challenge 作废；重新获取 options 后可重试 |
| Passkey challenge 过期 | 返回 `CHALLENGE_EXPIRED`；前端重新获取 options 并再次点击 |
| 时钟回拨 | 有效期以服务端时间为准；偏移 >5 分钟 doctor 告警 |
| 磁盘满 | 写审计 / 日志失败时拒绝敏感操作并告警 |
| 反向代理未配置 HTTPS | `requireHttpsForRemote` 生效：非 loopback + 非 https 拒绝业务 |
| Web 刷新 / WS 断开 | 会话保持；重新拉取 bootstrap / session；不影响后台 |

## 11. 可观测性

- 启动日志：版本、数据目录、监听地址、DB 迁移版本、IPC 路径（脱敏）、RP ID / Origin。
- 每个请求：`requestId`、状态码、耗时；认证失败记录原因码（不记录 Token / challenge / credential 公钥）。
- TUI 状态：初始化、监听、DB、IPC、在线会话、待审批、最近审计、Passkey 凭据状态。
- 不引入外部遥测。

## 12. 测试计划

- 单元：Token / 哈希、CSRF 派生、短编号 / 配对码规范化、过期计算、Origin / RP ID 匹配、challenge 生命周期。
- 集成（临时目录 + 临时 DB + Fastify inject）：
  - A1–A18 全部；
  - 迁移空库 / 重复执行 / 失败回滚；
  - 并发兑换（Promise.all）；
  - 撤销设备后 WS 关闭；
  - 单实例锁；
  - enrollment 过期 / 重放 / 跨 request；
  - 错误 Origin / IP 来源。
- WebAuthn 自动化：
  - Playwright Chromium 使用 CDP `WebAuthn.addVirtualAuthenticator`（`protocol: "ctap2"`、`transport: "internal"`、`hasResidentKey: true`、`hasUserVerification: true`、`isUserVerified: true`、`automaticPresenceSimulation: true`）完成注册 / 登录 / 撤销；
  - 真实 macOS Touch ID / 指纹做人工冒烟，记录在验收文档。
- E2E：`/pair` → TUI 批准（测试 IPC 客户端）→ Passkey 注册 → Workspace → 登出 → `/login` Passkey → 刷新；allow_once 分支；IP 来源不可用。
- 安全：日志 / 响应秘密扫描；Cookie 属性断言；限流；CSRF / Origin；challenge 重放。
- 平台：macOS 本地全量；Linux CI 集成；Windows 只做 IPC 路径、构建与 WebAuthn 虚拟认证器冒烟（M5 前不承诺真实平台认证器）。

## 13. 开放问题

| 问题 | 默认 | 截止 |
|---|---|---|
| `127.0.0.1` / 局域网 IP 不可用 Passkey 的引导 | 只支持 localhost / HTTPS；UI 明确提示 | M0-6 |
| 所有 Passkey 丢失 / TUI 不可用 | 无 Web 恢复；TUI 撤销后重新配对 | M4 |
| 可同步 Passkey | 允许；展示 backup 标志，不承诺物理绑定 | M0-6 |
| 是否保留 allow_once | 保留，作为不支持 WebAuthn 时的临时访问 | M0-5 |
| RP ID 是否允许父域 | V1 只允许 origin hostname 精确匹配 | M0-6 |

## 14. 完成定义

- [ ] A1–A18 全部通过；
- [ ] G0 门禁（`larness.md` 42.1）逐条有测试或验收记录；
- [ ] `pnpm check`、`pnpm build`、`pnpm test:e2e` 通过；
- [ ] 无明文秘密进入日志 / 事件 / 响应；
- [ ] 虚拟认证器 E2E + 真实 macOS Passkey 人工冒烟通过；
- [ ] 人类完成安全评审与初始化 / 配对 / 登录 / 撤销手工验收；
- [ ] `STATUS.md`、`ROADMAP.md` 更新。
