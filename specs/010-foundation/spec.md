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
> 这是第一个涉及真实安全边界的里程碑：认证、配对、会话、审计、稳定入口。**不允许用 Mock 或“临时绕过”交付。**

## 1. 背景与问题

S0 只提供前端外壳与 Mock 数据。M0 要把 Harness 变成一台可以真实部署、真实访问的单机服务：

- `node app.js` 能启动并明确报告状态；
- 首次运行只能在本机 TUI 初始化，公网不能抢占管理员；
- 新浏览器必须经本机 TUI 批准，并输入一次性配对码；
- 之后所有 REST / WS / 静态数据访问都必须经过后端鉴权；
- 认证、配对、撤销、审计必须可测试、可恢复、失败关闭。

本里程碑不实现项目、会话与 Agent；但数据层、鉴权中间件、事件总线与 Web 外壳要为它们留好接口。

## 2. 目标

- G-1：`node app.js`、`node app.js tui`、`node app.js status` 三个入口可用；单实例运行；优雅关闭。
- G-2：数据目录、`config.json`、日志、`doctor` / `status` 可诊断，启动失败有可操作错误。
- G-3：SQLite WAL + 迁移 + 审计表；重启后数据与会话保持。
- G-4：本机 IPC（UDS / Named Pipe）+ TUI 完成初始化与日常管理。
- G-5：设备配对状态机完整：申请、TUI 审批、一次性码、兑换、允许本次 / 始终允许、撤销。
- G-6：REST 与 WS 全量鉴权、Origin / CSRF、限流、失败关闭。
- G-7：S0 的 Web 壳接入真实配对与会话：配对页、路由守卫、刷新、登出、被撤销后的跳转。
- G-8：通过 G0 门禁（`larness.md` 42.1）。

## 3. 非目标

- 项目 / 会话 / Turn / Agent / 终端 / 服务 / 文件 / Git / 预览（M1–M3）。
- WebAuthn / Passkey（P1，见 Q-001）；离线恢复码（M4 前评估）。
- HTTPS 终止、内置隧道、反向代理配置生成（由部署者负责；本里程碑只校验配置与 Headers）。
- 自动更新、Launcher 版本切换（M5）；M0 只做稳定入口。
- 多用户、角色、租户。
- 浏览器指纹识别或“物理设备绑定”承诺。

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
  → 写入 config.json 与 app_meta.initialized_at
  → 审计 auth.init
  → 提示“初始化完成；如修改了监听地址，请重启 server”
```

### 4.2 新设备配对

```text
浏览器打开 / → 未认证 → /pair
  → POST /api/pairing/requests → 显示 6 位短编号
  → TUI 收到事件，显示编号 / 时间 / 来源
  → 操作者选择 拒绝 / 允许本次 / 始终允许
  → TUI 显示一次性配对码（5 分钟）
  → 浏览器输入配对码 → POST /api/pairing/redeem
  → 签发会话（始终允许时另发设备凭据）→ 进入 Workspace
```

### 4.3 后续访问

- 有有效会话：直接进入。
- 会话过期 / 浏览器重启：
  - 有设备凭据 → `POST /api/auth/refresh` 换新会话（轮换凭据）；
  - 无设备凭据 → 回到 `/pair` 重新配对。
- TUI 撤销设备：关联会话与 WebSocket 立即失效；浏览器下次请求收到 401 并跳转配对页。

## 5. 功能需求

### 5.1 入口与生命周期（MUST）

| ID | 需求 |
|---|---|
| R-1 | `node app.js` 启动 Server；`node app.js tui` 连接 TUI；`node app.js status` 输出只读 JSON 状态；`node app.js doctor` 执行自检；`--version` / `--help` 可用。 |
| R-2 | 同一数据目录只允许一个 Server 实例；第二个实例在 3 秒内以非 0 退出并说明原因。 |
| R-3 | 收到 SIGINT / SIGTERM 时停止接受新请求、关闭 WS、释放 IPC / 锁、关闭 DB；10 秒超时强制退出。 |
| R-4 | 端口被占用、数据目录不可写、迁移失败、配置非法时，进程以非 0 退出并输出可操作提示；不得半启动。 |
| R-5 | 生产模式下由 Server 托管 `apps/web/dist`；`/api/*` 与 `/ws` 优先于静态回退；未知前端路由回退 `index.html`。 |

### 5.2 配置与数据目录（MUST）

| ID | 需求 |
|---|---|
| R-6 | 数据目录默认使用 OS 标准目录（`env-paths`），支持 `HARNESS_DATA_DIR`；启动时校验存在 / 可写 / 权限。 |
| R-7 | `config.json` 由 init 生成；读取时用 Zod 校验；非法配置拒绝启动，不静默回退。 |
| R-8 | 环境变量覆盖：`HARNESS_DATA_DIR`、`HARNESS_HOST`、`HARNESS_PORT`、`HARNESS_LOG_LEVEL`、`HARNESS_PUBLIC_URL`。 |
| R-9 | 首次启动创建 `logs/`、`backups/`、`tmp/`、`sessions/`、`artifacts/`、`secrets/`；权限 0700 / 文件 0600。 |
| R-10 | 未初始化时不得写 `initialized_at`；初始化只经 IPC；重复初始化返回 `ALREADY_INITIALIZED`。 |

配置基线：

```json
{
  "version": 1,
  "server": { "host": "127.0.0.1", "port": 3210, "publicUrl": null, "trustedProxies": [] },
  "auth": { "sessionTtlMinutes": 720, "idleTtlMinutes": 30, "requireHttpsForRemote": true },
  "logging": { "level": "info", "retentionDays": 14 },
  "updates": { "channel": "stable", "autoCheck": true, "autoInstall": false },
  "preview": { "enabled": false }
}
```

### 5.3 日志与诊断（MUST）

| ID | 需求 |
|---|---|
| R-11 | pino 结构化日志：`level`、`time`、`msg`、`requestId`、`clientSessionId`、`action`；秘密字段脱敏。 |
| R-12 | 文件日志按天 / 大小轮转，保留 `retentionDays`；同时输出 stderr。 |
| R-13 | `node app.js status` 与 TUI 显示：版本、初始化、监听、DB、IPC、在线会话数、待审批数、磁盘可写。 |
| R-14 | `doctor` 检查：Node 版本、数据目录权限、端口占用、DB 完整性、迁移版本、时钟偏移（> 5 分钟告警）。 |

### 5.4 SQLite 与审计（MUST）

| ID | 需求 |
|---|---|
| R-15 | 启用 WAL、`foreign_keys=ON`、`busy_timeout=5000`；迁移在监听端口前完成。 |
| R-16 | 迁移失败不启动；启动前对结构性变更做一次备份（M0 可为空备份策略，但接口保留）。 |
| R-17 | 审计事件覆盖：`auth.init`、`config.changed`、`pairing.requested/approved/denied/redeemed`、`auth.login/logout/refresh`、`device.revoked`、`session.revoked`、`server.shutdown`、`security.rate_limited`。 |
| R-18 | 审计只追加；`details_json` 脱敏；提供 TUI 查看最近 200 条，不提供 Web 删除接口。 |

### 5.5 本机 IPC 与 TUI（MUST）

| ID | 需求 |
|---|---|
| R-19 | POSIX 使用 Unix Domain Socket（0600）+ 0600 启动 Token 握手；Windows 使用 Named Pipe。可用平台追加 peer uid 校验，但不作为唯一依赖。路径过长时使用 0700 临时目录内的哈希路径。 |
| R-20 | 换行分隔 JSON；请求 / 响应带 `id`；事件带 `event`；单条上限 1 MiB；空闲超时 30 分钟。 |
| R-21 | TUI 方法：`system.status`、`system.doctor`、`init.status`、`init.apply`、`pairing.list`、`pairing.approve`、`pairing.deny`、`devices.list`、`devices.revoke`、`sessions.list`、`sessions.revoke`、`logs.tail`、`server.shutdown`。 |
| R-22 | TUI 不通过公网 HTTP 暴露；IPC 不监听 TCP；所有方法在服务端再次校验初始化状态与参数。 |
| R-23 | TUI 断开不影响 Server；无 TUI 时配对申请挂起，直到有本机审批或过期。 |

### 5.6 配对（MUST）

| ID | 需求 |
|---|---|
| R-24 | 申请：`requestId`、6 位短编号、`pollToken`；TTL 10 分钟；每 IP 10 次 / 分钟。 |
| R-25 | 审批只来自 TUI；批准生成 ≥ 50 bit 配对码，TTL 5 分钟，最多 5 次尝试；哈希存储；原子消费。 |
| R-26 | 短编号在 pending 列表中唯一；TUI 显示来源、时间、UA；不把 IP / UA 当身份。 |
| R-27 | `allow_once` 只发短期会话；`trust` 额外发设备凭据（180 天，使用即轮换）。 |
| R-28 | 并发兑换同一申请只有一个成功；配对码与申请绑定，不能跨申请使用。 |
| R-29 | 拒绝 / 过期 / 超次后申请不可兑换；所有结果写审计。 |

### 5.7 会话与传输安全（MUST）

| ID | 需求 |
|---|---|
| R-30 | 会话 Token 32 字节随机，只存 SHA-256；Cookie `harness_session`：HttpOnly、SameSite=Lax、Path=/、HTTPS 时 Secure。 |
| R-31 | 设备 Token 32 字节随机，只存 SHA-256；Cookie `harness_device`：HttpOnly、SameSite=Lax、Path=/api/auth、Max-Age 180 天、HTTPS 时 Secure；会话 Cookie 的 Max-Age 不超过绝对有效期。 |
| R-32 | 会话绝对 12h、空闲 30min（可配置）；设备凭据 180 天；刷新时轮换设备凭据并撤销旧会话。 |
| R-33 | CSRF Token 由服务器密钥对 `sessionId` 做 HMAC 派生；变更请求必须带 `x-csrf-token`。 |
| R-34 | Origin / Host 校验：允许 `127.0.0.1:<port>`、`localhost:<port>`、`publicUrl`；不信任 `X-Forwarded-*` 除非来源在 `trustedProxies`。 |
| R-35 | 所有业务 REST 默认拒绝未认证；`/api/health`、`/api/bootstrap`、配对申请 / 轮询 / 兑换、刷新为公开（仍限流 / Origin）。 |
| R-36 | WebSocket 升级校验会话、Origin；订阅按资源授权；撤销会话 / 设备后 1 秒内关闭连接（1008）。 |
| R-37 | 限流：配对申请 10/min/IP、轮询 60/min/token、兑换 10/min/IP、其他已认证 600/min/session；超限返回 429 + 审计。 |

### 5.8 Web 集成（MUST）

| ID | 需求 |
|---|---|
| R-38 | `/pair`：展示短编号、等待状态、配对码输入、错误与重试；不泄露申请是否存在。 |
| R-39 | 路由守卫：未认证访问 `/` 跳 `/pair`；已认证访问 `/pair` 跳 `/`。 |
| R-40 | 会话加载：`GET /api/auth/session` → 失败时尝试 `POST /api/auth/refresh` → 再失败跳配对。 |
| R-41 | 登录后展示当前设备信息（名称 / 类型 / 到期），提供登出；设备撤销只经 TUI。 |
| R-42 | 顶部栏 / 侧栏使用 S0 组件；M0 不实现项目 / 会话数据，保留空态。 |

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
When 运行 node app.js tui 并完成管理员密码与监听配置
Then app_meta.initialized_at 写入，config.json 生成且权限受限
And 审计存在 auth.init
And 再次初始化返回 ALREADY_INITIALIZED
```

### A3 初始化只能本机

```gherkin
Given 未初始化
When 从远程浏览器 POST 任意“设置管理员”请求
Then 不存在该接口（404）
And 无法通过 Web 将 initialized 置为 true
```

### A4 配对成功

```gherkin
Given 已初始化且 TUI 在线
When 浏览器申请配对，TUI 选择“始终允许”
Then TUI 显示 6 位短编号与一次性配对码
When 浏览器提交正确配对码
Then 获得 harness_session 与 harness_device Cookie，进入 Workspace
And 申请状态变为 redeemed，配对码不可复用
```

### A5 配对失败与限次

```gherkin
Given 一个已批准、未兑换的申请
When 连续提交错误配对码 5 次
Then 第 6 次返回 RATE_LIMITED，申请作废
And 审计记录失败与限流，不记录配对码明文
```

### A6 并发兑换

```gherkin
Given 同一申请与配对码
When 两个客户端同时兑换
Then 仅一个成功，另一个返回 CONFLICT / CODE_INVALID
And 只签发一个会话
```

### A7 允许本次过期

```gherkin
Given 通过“允许本次”签发的会话
When 会话超过绝对或空闲期限
Then 后续请求返回 UNAUTHENTICATED
And 没有设备凭据可用，必须重新配对
```

### A8 撤销设备

```gherkin
Given 一个“始终允许”的设备及其会话 / WS
When TUI 撤销该设备
Then 其会话立即失效，WS 在 1 秒内关闭
And 用设备凭据刷新返回 UNAUTHENTICATED
And 审计记录 device.revoked
```

### A9 CSRF / Origin

```gherkin
Given 已认证会话
When 发起变更请求但缺少 x-csrf-token
Then 返回 CSRF_INVALID
When 携带合法 CSRF 但 Origin 为恶意站点
Then 返回 ORIGIN_INVALID
```

### A10 WebSocket 鉴权

```gherkin
Given 无 Cookie 或 Origin 非法
When 连接 /ws
Then 握手失败（401 / 403），不进入订阅协议
Given 已认证但订阅未授权资源
When 发送 subscribe
Then 返回 FORBIDDEN，不推送该资源事件
```

### A11 TUI 不在线

```gherkin
Given server 运行但 TUI 已关闭
When 新浏览器申请配对
Then 申请保持 pending 直到过期，不自动批准
And 已有可信设备仍可正常刷新会话
```

### A12 单实例

```gherkin
Given 同一数据目录已有一个 server
When 启动第二个 server
Then 第二个进程以非 0 退出并提示数据目录已被占用
```

### A13 重启与刷新

```gherkin
Given 有效会话与设备凭据
When 重启 server
Then 未过期会话仍可用，WS 重连成功
When 浏览器重启且会话过期
Then 设备凭据可换取新会话，旧 Token 失效
```

### A14 status / doctor

```gherkin
Given server 正在运行
When 运行 node app.js status
Then 输出合法 JSON，包含 initialized、listen、db、ipc、pendingPairings
When 端口被占用后启动
Then 进程退出码非 0，错误信息给出端口与排查建议
```

## 7. 接口与契约

- REST：见 [rest-api.md](../../docs/contracts/rest-api.md) 第 3–5 节；新增 `/api/auth/refresh` 已登记。
- WS：见 [ws-events.md](../../docs/contracts/ws-events.md) 第 1–2 节。
- IPC / TUI：见 [ipc.md](../../docs/contracts/ipc.md)；实现时在 `apps/server/src/tui/protocol.ts` 固化 Zod schema。
- 配置：第 5.2 节；新增键必须向后兼容并提供默认值。
- 错误码：沿用 `docs/contracts/rest-api.md` 第 2 节，不新增同义码。

## 8. 数据与迁移

M0 迁移 `0001_auth`：

- `app_meta`、`auth_settings`、`device_requests`、`trusted_devices`、`browser_sessions`、`audit_logs`；
- 索引：`device_requests(status, expires_at)`、`browser_sessions(device_id)`、`audit_logs(action, created_at)`；
- 迁移在监听前执行；失败回滚并拒绝启动；
- 备份接口在 M0 只创建空备份目录与调用点，M4 完整实现。

## 9. 安全与审计

| 威胁 | 控制 |
|---|---|
| 公网抢占初始化 | 业务 API 在未初始化时全部拒绝；无 Web 注册接口 |
| 配对码暴力破解 | 50 bit 随机、5 次尝试、限流、短 TTL、哈希存储 |
| 配对请求冒领 | requestId + pollToken + TUI 编号核对 + 原子消费 |
| Cookie 窃取 | HttpOnly / SameSite / Secure（HTTPS）、短期会话、设备凭据轮换 |
| CSRF | Origin 精确匹配 + HMAC CSRF Token |
| WS 越权 | 握手鉴权 + 订阅二次授权 + 撤销即断 |
| 本地 IPC 被同账户进程滥用 | OS 权限、peer uid；明确记录残余风险，不宣称硬件隔离 |
| 日志泄密 | 脱敏器覆盖 Cookie / Token / 密码 / 配对码；测试扫描 |
| 反向代理头伪造 | 默认不信任 `X-Forwarded-*`；仅 `trustedProxies` 内生效 |

失败关闭矩阵见 [security.md](../../docs/architecture/security.md) 第 8 节。任何认证异常不得降级为匿名。

## 10. 失败、边界与恢复

| 场景 | 行为 |
|---|---|
| 端口占用 | 启动失败，退出码非 0，提示端口 / 占用进程 / 修改方式 |
| 数据目录不可写 | 启动失败，提示路径与权限 |
| 迁移失败 / DB 损坏 | 拒绝启动；提示备份与 `doctor` |
| 第二个实例 | 退出并提示已有实例 PID |
| 配对过程中 TUI 关闭 | 申请保留至过期；已批准码仍可在 TTL 内兑换 |
| 兑换中途崩溃 | 事务保证“码消费 / 会话创建”原子；不产生半个会话 |
| 时钟回拨 | 有效期以服务端时间为准；偏移 > 5 分钟 `doctor` 告警 |
| 磁盘满 | 写审计 / 日志失败时拒绝敏感操作并告警，不静默吞掉 |
| 反向代理未配置 HTTPS | `requireHttpsForRemote` 生效：非 loopback + 非 https 时拒绝业务请求并提示 |
| Web 刷新 / WS 断开 | 会话保持；重新拉取 bootstrap / session；不影响后台 |

## 11. 可观测性

- 启动日志：版本、数据目录、监听地址、DB 迁移版本、IPC 路径（脱敏）。
- 每个请求：`requestId`、状态码、耗时；认证失败记录原因码（不记录 Token）。
- TUI 状态：初始化、监听、DB、IPC、在线会话、待审批、最近审计。
- 不引入外部遥测。

## 12. 测试计划

- 单元：Token 生成 / 哈希、CSRF 派生、短编号 / 配对码规范化、过期计算、Origin 匹配、锁文件。
- 集成（临时目录 + 临时 DB + Fastify inject）：
  - A1–A14 全部；
  - 迁移空库 / 重复执行 / 失败回滚；
  - 并发兑换（Promise.all）；
  - 撤销设备后 WS 关闭；
  - 单实例锁。
- E2E：配对页 → TUI 批准（测试专用 IPC 客户端）→ 进入 Workspace → 刷新 → 登出。
- 安全：日志 / 响应秘密扫描；Cookie 属性断言；限流；CSRF / Origin。
- 平台：macOS 本地全量；Linux CI 集成；Windows 只做 IPC 路径与构建冒烟（M5 前不承诺）。

## 13. 开放问题

| 问题 | 默认 | 截止 |
|---|---|---|
| WebAuthn 是否进入 V1 | 否，opaque token；公网前复议 | M4 |
| 会话 TTL 具体值 | 12h / 30min；设备 180 天 | M0 实现前 |
| 离线恢复码 | M0 不做，TUI 不可用即拒绝 | M4 |
| 数据目录名 | OS 标准目录下 `Harness` | M0 |
| 是否内置 TLS | 不内置，依赖反代 | M4 |

## 14. 完成定义

- [ ] A1–A14 全部通过；
- [ ] G0 门禁（`larness.md` 42.1）逐条有测试或验收记录；
- [ ] `pnpm check`、`pnpm build`、`pnpm test:e2e` 通过；
- [ ] 无明文秘密进入日志 / 事件 / 响应；
- [ ] 人类完成安全评审与初始化 / 配对手工验收；
- [ ] `STATUS.md`、`ROADMAP.md` 更新。
