# 任务：M0 工程底座与可信启动

> 规则：一个任务一个提交；开始前更新 `STATUS.md`，完成后勾选本表并同步 `ROADMAP.md`。
> 安全相关任务必须附测试证据（命令、输出、覆盖的失败路径），不接受“手工验证过了”。
> 认证方案以 [ADR-021](../../docs/adr/ADR-021-passkey-v1.md) 为准：Passkey 为可信凭据，`allow_once` 仅短期会话。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M0-1 | Server 与 workspace 扩展 | D0-9 | `done` |
| M0-2 | 配置、数据目录、日志与诊断 | M0-1 | `done` |
| M0-3 | SQLite、迁移与审计 | M0-2 | `done` |
| M0-4 | 本机 IPC 与 TUI 初始化 | M0-3 | `done` |
| M0-5 | 配对申请与准入 | M0-4 | `done` |
| M0-6 | Passkey 注册与登录 | M0-5 | `done` |
| M0-7 | 鉴权与传输安全 | M0-6 | `done` |
| M0-8 | Web 认证集成 | M0-7 | `done` |
| M0-9 | 稳定入口与 M0 验收 | M0-8 | `review` |

## 任务卡

### M0-1 Server 与 workspace 扩展

- 状态：`done`（2026-11-01）
- 依赖：D0-9
- 目标：在现有前端 workspace 中加入 Server、共享契约与工程化检查，跑通最小 API。
- 交付物：
  - `apps/server`（Fastify 5、`createApp()` 工厂、`/api/health`、错误处理器、请求 ID）；
  - `packages/{agent,resources}` 占位包（可编译、无业务）；
  - `packages/shared` 增加 config / errors / domain 基础类型；
  - 根脚本 `dev`（web + server）、`check`、`build` 覆盖三个包；
  - `.github/workflows/ci.yml`：install、biome、typecheck、test、build；
  - 测试工具：临时目录、`fastify.inject`、测试用配置工厂。
- 验收：
  - `pnpm dev` 同时启动 web 与 server；`GET /api/health` 返回 `{status:"ok"}`；
  - `pnpm check` / `pnpm build` 通过；
  - CI 在 Ubuntu 通过，macOS 至少通过构建与测试。
- 测试：health 集成测试；未知路由 404 契约；错误响应不含堆栈。
- 涉及路径：`apps/server/`、`packages/*/src/index.ts`、根脚本、`.github/workflows/ci.yml`。
- 完成记录：
  - `pnpm check` 通过：Biome、6 个 workspace 的 typecheck、web 10 项 + server 6 项测试；
  - `pnpm build` 通过：server 经 tsdown 输出 `apps/server/dist/index.js`（内联 `@larness/shared`），web 经 Vite 构建；
  - `pnpm dev` 同时启动 Vite 5173 与 Server 3210；`GET /api/health` 返回 `{status:"ok",uptimeMs}`，未知路由返回契约 404；
  - 偏差：任务卡中的“临时目录 / 测试用配置工厂”延后到 M0-2 首次出现数据目录与配置时落地，M0-1 不引入未使用代码；
  - 待确认：CI 工作流已加入并通过 YAML 解析；仓库暂无 remote，Ubuntu / macOS 结果在首次 push 后确认。

### M0-2 配置、数据目录、日志与诊断

- 状态：`done`（2026-11-01）
- 依赖：M0-1
- 目标：服务能在正确的位置、以正确权限读写配置与日志，并在异常时明确失败。
- 交付物：
  - `resolveDataDir()` + 目录创建 + POSIX 权限校验；
  - `config.json` Zod schema（含 `webauthn`）、环境变量覆盖、默认值；
  - canonical origin / RP ID 推导与校验工具（拒绝 IP、远程 http）；
  - pino 日志 + 轮转 + 脱敏器；
  - `larness.lock` 单实例锁；
  - `status` / `doctor` CLI（临时经 tsx 调用，M0-9 接入 `app.js`）；
  - 优雅关闭骨架。
- 验收：
  - A14、A15 通过；
  - 端口占用 / 目录不可写 / 配置非法时退出码非 0；
  - 日志中不出现 Cookie / Token / 密码 / 配对码；
  - 第二个实例 3 秒内退出。
- 测试：配置优先级；RP ID / origin 推导；权限错误；锁竞争；脱敏；关闭幂等。
- 涉及路径：`apps/server/src/{bootstrap,cli,security}/`、`packages/shared/src/config.ts`。
- 完成记录：
  - 新增 `platform/paths`（数据目录 + 7 个子目录 0700、宽权限收紧、不可写 / 非目录失败）、`bootstrap/config`（Zod schema、环境变量覆盖、canonical origin / RP ID 推导）、`bootstrap/logger`（pino + pino-roll 100m / 每日轮转、0600、脱敏）、`bootstrap/lock`（`larness.lock`、PID 存活检查、陈旧锁替换）、`bootstrap/shutdown`（幂等、10 秒强退、释放锁）、`status` / `doctor` 与 `cli/{status,doctor}`；
  - `pnpm --filter @larness/server test` 43 项通过（config 11 / paths 6 / lock 6 / redact 2 / shutdown 2 / status 5 / startup 5 / health 3 / errors 3）；
  - 手工证据：`pnpm dev` 同时启动 5173 / 3210；`pnpm run status` 输出 running / pid / listen / webauthn；`pnpm run doctor` 输出 11 项检查；第二个实例 0 秒退出码 1；端口占用退出码 1；非法配置退出码 1；SIGTERM 后锁移除、端口释放、`server.shutdown` 落日志；
  - 日志文件实测 `-rw------- larness.1.log`，脱敏测试覆盖 Cookie / Token / 密码 / 配对码；
  - 偏差：`status.db` / `status.ipc` 暂为 `null` 并给出 M0-3 / M0-4 提示（数据层与 IPC 尚不存在，不伪造状态）；`initialized` 暂以 `config.json` 是否存在为代理，M0-4 改用 `app_meta.initialized_at`；
  - 说明：`pnpm doctor` 会被 pnpm 内置命令抢占，使用 `pnpm run doctor`；`status` / `doctor` 均先经 tsx，M0-9 接入 `app.js`。

### M0-3 SQLite、迁移与审计

- 状态：`done`（2026-11-01）
- 依赖：M0-2
- 目标：建立可信的数据层，保证初始化、配对、Passkey、会话、审计可持久化。
- 交付物：
  - Drizzle schema：`app_meta`、`auth_settings`、`device_requests`（含 enrollment 字段）、`trusted_devices`、`webauthn_credentials`、`webauthn_challenges`、`browser_sessions`、`audit_logs`；
  - `0001_auth` 迁移 + 启动时 migrator + WAL / 外键 / busy_timeout；
  - repository：meta、authSettings、deviceRequests、trustedDevices、webauthnCredentials、webauthnChallenges、browserSessions、audit；
  - 过期清理任务（申请 / 会话 / challenge）；
  - `backupDatabase()` 调用点（M0 可为空实现）。
- 验收：
  - 空库迁移成功；重复启动幂等；迁移失败不监听端口；
  - 审计写入失败时敏感操作失败（fail closed）；
  - 外键 / 唯一索引生效（credential_id、token hash 重复被拒绝）；
  - `trusted_devices` 不存在长期 Token 列。
- 测试：迁移、约束、repository、清理任务、事务回滚。
- 涉及路径：`apps/server/src/db/`、`drizzle/`、`apps/server/test/db/`。
- 完成记录：
  - Drizzle schema + `drizzle/0001_auth.sql`（drizzle-kit 生成，八表、外键、唯一索引、`auth_settings` 单行 CHECK）；启动时 `migrate()`，WAL / `foreign_keys=ON` / `busy_timeout=5000` / `synchronous=NORMAL`；
  - repository：meta（含实例 ID）、authSettings、deviceRequests、trustedDevices、webauthnCredentials、webauthnChallenges（原子消费）、browserSessions、audit（详情脱敏、只追加）；`BEGIN IMMEDIATE` 事务辅助；`VACUUM INTO` 备份；
  - 清理调度：启动即清理 + 每 10 分钟（unref），删除过期 challenge / session / 未完成 request；
  - `status.db` 返回 `{ok, schemaVersion, detail}`（只读 quick_check）；`doctor` 增加 DB 完整性与迁移进度；
  - 测试 62 项：migrations 8、repositories 8、cleanup 1、startup 6、status 6、其余 33；覆盖空库 / 幂等 / 无效迁移目录 / 唯一与 FK 约束 / 无 token 列 / 审计 fail-closed / 事务回滚 / 备份；
  - 手工证据：DB 与 WAL 文件 0600、`status.db.schemaVersion=1`、`doctor` database/migrations ok、重启幂等、SIGTERM 后 WAL checkpoint 并释放锁、损坏 DB 启动失败且不监听；
  - 偏差：`status.ipc` 仍为 `null`（M0-4）；`initialized` 仍以 `config.json` 为代理（M0-4 改用 `app_meta`）；审计 180 天保留策略与清除任务待后续里程碑；依赖 `better-sqlite3@^11`（v12+ 预编译不覆盖当前 Node 20 / macOS，v13 要求 Node 22）。

### M0-4 本机 IPC 与 TUI 初始化

- 状态：`done`（2026-11-01）
- 依赖：M0-3
- 目标：建立本机可信通道，完成首次初始化与日常状态查看。
- 交付物：
  - IPC server：UDS / Named Pipe、0600 权限、Token 握手、Zod 协议、事件推送（按 `docs/contracts/ipc.md`）；
  - `init.status` / `init.apply`：管理员密码（Argon2id）、host、port、publicUrl、更新通道；
  - 初始化时展示并确认 canonical origin / RP ID；IP / 远程 http 明确警告；
  - TUI：初始化向导、仪表盘、状态 / 日志 / 审计查看、退出；
  - `node app.js status` 的底层实现（只读状态）。
- 验收：
  - A2、A3 通过；重复初始化返回 `ALREADY_INITIALIZED`；
  - 未初始化时 Web 无任何可写接口；
  - IPC 无 Token / 错误 Token 被拒绝；socket 权限 0600。
- 测试：IPC 握手、初始化并发、密码策略、socket 权限、RP ID 推导、TUI 冒烟（非交互函数）。
- 涉及路径：`apps/server/src/{ipc,tui,api}/`、`packages/shared/src/config.ts`。

### M0-5 配对申请与准入

- 状态：`done`（2026-11-01）
- 依赖：M0-4
- 目标：实现配对状态机、TUI 审批、`allow_once` 会话与 `trust` enrollment。
- 交付物：
  - 公开接口：创建申请、轮询状态、兑换配对码；记录 Origin，非 canonical 来源只能 allow_once；
  - TUI：待审批列表、批准（允许本次 / 始终允许）、拒绝、展示一次性码；
  - `allow_once`：兑换即签发短期会话（无设备、无 Passkey）；
  - `trust`：兑换后仅签发 5 分钟 enrollment Cookie 与 `passkey_required`；
  - 短编号 / 配对码生成与规范化；原子消费；enrollment Token 哈希存储；
  - 审计：申请 / 批准 / 拒绝 / 兑换 / enrollment。
- 验收：
  - A4、A6、A7、A8、A13 通过；
  - `trust` 仅在 WebAuthn 配置有效时可用；兑换不产生会话与设备，enrollment 过期需重新配对；
  - 并发兑换只有一个成功；
  - 码错误 5 次后作废。
- 测试：状态机、并发、过期、码规范化、enrollment 绑定 / 重放、allow_once 无设备。
- 涉及路径：`apps/server/src/{pairing,auth}/`、`apps/server/src/tui/`、`drizzle/`。
- 完成记录：
  - 配对状态机：申请（10 分钟 TTL、6 位短编号、pollToken 哈希、Origin / UA / IP）、TUI 批准 / 拒绝、一次性码（10 字符 Crockford Base32 ≈50 bit、5 分钟 TTL、5 次尝试、SHA-256 存储）、原子兑换；
  - REST：`POST /api/pairing/requests`、`GET /api/pairing/requests/:id`、`POST /api/pairing/redeem`；`allow_once` 设置 `larness_session`（HttpOnly / SameSite=Lax / Path=/，kind=once，deviceId=null），`trust` 设置 5 分钟 `larness_enrollment`（Path=/api/webauthn/registration）并进入 `enrollment_pending`；
  - 会话 / CSRF 基础：会话 Token 哈希存储、绝对 / 空闲过期校验、HMAC CSRF Token、`GET /api/auth/session`（过期返回 401，无 refresh）；
  - TUI：待审批列表（Origin / UA / 短编号 / 是否可用 trust）、批准（允许本次 / 始终允许）、拒绝、一次性码展示；非 canonical 来源隐藏始终允许；
  - 测试 125 项：pairing code 4、service 12、REST 6、TUI 4、auth / session 3、其余沿用；覆盖状态机、并发兑换、码错误 5 次 / 第 6 次限流、过期、信任限制、enrollment 哈希 / 无会话 / 无设备、审计无明文码、A8 会话过期；
  - 手工证据：真实 HTTP + IPC 完成 申请 → TUI 批准 → 兑换，Set-Cookie 属性正确，`/api/auth/session` 200；DB 中 request=redeemed、session kind=once and device_id=NULL、devices=0，审计含 requested / approved / redeemed；重复兑换 409；
  - 偏差：`/api/pairing/requests` 的每 IP 10/min 限流与全站 Origin / CSRF 中间件留待 M0-7；A5 的 Passkey 注册完成属于 M0-6；enrollment 目前只签发 Cookie 与哈希，注册验证 / 设备创建在 M0-6 实现；IPC 配对事件推送未实现（TUI 轮询），可随 M0-6 补齐。

### M0-6 Passkey 注册与登录

- 状态：`done`（2026-11-01）
- 依赖：M0-5
- 目标：用 `@simplewebauthn/server` 完成 WebAuthn 注册 / 认证、设备与 credential 生命周期。
- 交付物：
  - `webauthn` 模块：RP 配置、challenge 生成 / 消费 / 清理；
  - `POST /api/webauthn/registration/{options,verify}`；
  - `POST /api/webauthn/authentication/{options,verify}`；
  - 注册：residentKey / UV / attestation none；验证 Origin / RP ID / UV；创建设备 + credential + 会话；
  - 认证：discoverable credential、空 allowCredentials、撤销 / 过期 / 未知统一失败；
  - 存储 backup 标志、counter、transports、AAGUID；
  - TUI 设备列表 / 撤销（作废 credential + 设备 + 会话 + WS）；
  - 审计：registered / login / failed / device.revoked。
- 验收：
  - A5、A9、A10、A16、A17、A18 通过；
  - 注册未验证前不创建设备 / 会话；
  - 撤销后 assertion 失败，WS 关闭；
  - IP 来源 / 不支持浏览器返回明确错误。
- 测试：虚拟认证器注册 / 登录、challenge 重放 / 过期、enrollment 跨请求、重复 credential、撤销、计数器 0。
- 涉及路径：`apps/server/src/webauthn/`、`apps/server/src/api/webauthn.ts`、`apps/server/src/tui/`、`drizzle/`。
- 完成记录：
  - `@simplewebauthn/server@14`：registration / authentication options 与 verify；challenge 5 分钟、一次性消费、绑定 enrollment request；attestation none、residentKey / UV required、excludeCredentials；
  - 注册成功创建 device + credential + passkey 会话，配对申请标记 redeemed、清 enrollment Cookie；失败不创建设备 / 会话，challenge 已消费需重新取 options；
  - 存储 credential ID、公钥、counter、transports、AAGUID、backupEligible / backupState；登录允许 counter 0 / 回退仅审计（保留注册时的 eligibility）；
  - `/api/webauthn/{registration,authentication}/{options,verify}`、`/api/auth/session` 返回 passkey 标志；Origin 非 canonical / IP 返回 `ORIGIN_INVALID`，配置无效 `WEBAUTHN_NOT_CONFIGURED`；
  - TUI `devices.list` / `devices.revoke`：设备、凭据类型、backup 标志、创建 / 最后使用、撤销二次确认；撤销事务作废 credential + 设备 + 全部会话并审计；
  - 测试 143 项：新增 webauthn service 12、REST 4、TUI 2（其余沿用）；软件认证器覆盖注册、登录、challenge 重放 / 过期、enrollment 单次 / 跨请求、重复 credential、撤销后登录失败、counter 异常审计；
  - 手工证据：真实 HTTP + IPC 完成 trust 配对 → 注册 201（passkey、backup 标志）→ 登录 200 → 撤销后会话 401；DB device / credential 已撤销、counter=1、审计含 registered / login / device.revoked；
  - 偏差：设备撤销后的 WebSocket 关闭依赖 M0-7（当前无 WS）；浏览器虚拟认证器 E2E 与真实 Touch ID 冒烟在 M0-8 / M0-9；WebAuthn options / verify 限流与全站 Origin 中间件留待 M0-7；未实现 attestation 验证（spec 明确 none）。

### M0-7 鉴权与传输安全

- 状态：`done`（2026-11-01）
- 依赖：M0-6
- 目标：把所有 REST / WS 面收口到统一鉴权与失败关闭。
- 交付物：
  - 会话解析中间件、CSRF、Origin / Host 校验、安全响应头；
  - 限流（IP / Token / 会话 / WebAuthn）与审计；
  - WebSocket 握手鉴权、订阅授权、撤销即断；
  - 统一错误映射（错误码 → HTTP）；
  - 失败关闭矩阵测试。
- 验收：
  - A1、A11、A12 通过；
  - 未认证访问任意业务接口均返回 401 / 409，不泄露资源是否存在；
  - 撤销会话后 1 秒内 WS 关闭；
  - 限流触发 429 并审计。
- 测试：认证矩阵、CSRF / Origin、限流、WS 握手、错误码一致性、IP 来源。
- 涉及路径：`apps/server/src/{auth,ws,api,security}/`。
- 完成记录：
  - 全局 `onRequest` 守卫：`/api` 默认拒绝；公开仅 health / bootstrap / pairing / WebAuthn options / verify；未初始化 409、未认证 401、已认证未知路由 404；Origin 精确 canonical + 同端口 loopback；Host 校验；安全响应头（nosniff / no-referrer / DENY / API CSP）；
  - CSRF：已认证变更请求必须带 `x-csrf-token`；`/api/auth/logout` 撤销会话、清 Cookie、审计、通知 WS；
  - 限流：配对申请 10/min/IP、轮询 60/min/token、兑换 10/min/IP、WebAuthn 10/min/IP、已认证 600/min/session；429 + `security.rate_limited` 审计；
  - WebSocket：Cookie + Origin 握手、`hello`、`system` 订阅、未知主题 FORBIDDEN、25s ping / 60s 超时、8MiB 背压；会话 / 设备撤销后 1008 关闭（<1s）；IPC `sessions.list/revoke`；
  - `/api/bootstrap` 返回 initialized / authenticated / pairingEnabled / passkeyEnabled / passkeyOrigin / passkeyRegistered；
  - 测试 154 项：新增 guard 5、rate limiter 2、WS 4、bootstrap / logout 覆盖于 guard；未认证 / 未初始化 / CSRF / Origin / Host / 限流 / 会话撤销断连均有断言；
  - 手工证据：构建产物 bootstrap 200 + 安全头，未认证 WS 升级 401；真实 WS 会话撤销 / 设备撤销 1008；
  - 偏差：WS 目前只开放 `system` 主题（M1 增加 agent 等）；限流为单进程内存态，重启清零（M0 接受，后续可持久化）；未在 30 秒内未订阅时主动断开（可选项）；静态资源 CSP 与 SPA 托管在 M0-9。

### M0-8 Web 认证集成

- 状态：`done`（2026-11-01）
- 依赖：M0-7
- 目标：S0 壳接入真实 Passkey 登录与配对，完成浏览器端闭环。
- 交付物：
  - `/login`：Passkey 登录、浏览器支持检测、取消 / 失败提示、`returnTo`、跳 `/pair`；
  - `/pair`：申请、短编号、轮询、配对码、allow_once 成功、trust 的 `startRegistration` 注册；
  - `useSession` / `RequireAuth`；401 统一跳登录；
  - 登出、当前设备 / 会话信息；被撤销后的跳转；
  - 空态工作台（不接项目数据）。
- 验收：
  - 未认证 `/` 按 `passkeyEnabled && location.origin === passkeyOrigin && passkeyRegistered` 跳 `/login` 或 `/pair`；
  - 刷新页面保持登录；撤销设备后下一次请求跳登录；
  - IP 来源 / 不支持 WebAuthn 时提示清晰；
  - 开发（Vite 5173）与生产（Server 3210）分别验证 canonical origin；
  - Passkey options 预取，`create/get` 由用户手势直接触发；
  - 无控制台错误、无 Token 写入 localStorage。
- 测试：组件状态机、路由守卫、Playwright 虚拟认证器 E2E（配对 / 登录 / 登出 / 撤销）。
- 涉及路径：`apps/web/src/features/auth/`、`apps/web/src/lib/webauthn.ts`、`apps/web/src/app/routes.tsx`。
- 完成记录：
  - 默认真实模式：`/` 按 bootstrap 决定 `/login` 或 `/pair`；`/login` 预取 authentication options、点击直接 `startAuthentication`、处理取消 / 过期 / 失败 / IP 来源 / 不支持浏览器；`/pair` 自动申请、短编号、轮询、配对码、allow_once 会话、trust 注册（预取 options + 用户手势）、过期与错误提示；刷新时复用 sessionStorage 中未过期的申请，并可恢复 approved / enrollment 阶段；
  - `useSession` / `RequireAuth` / `HomeRoute`；401 统一跳登录并带 `returnTo`；登出、当前会话类型 / 到期 / backup 展示；WS 断开（设备撤销）后跳登录；空态工作台；
  - Vite `/api` / `/ws` 代理到 3210；`VITE_USE_MOCKS=1` 保留 S0 Mock Demo 与既有 15 项 E2E；
  - 测试：web 18 项（路由状态机、RequireAuth、unsupported / NOT_INITIALIZED、配对申请刷新复用、既有主题 / 几何 / 时间线）；Playwright 虚拟认证器 E2E 1 项（trust 配对 → 注册 → 工作台 → 登出 → Passkey 登录 → 撤销 → /login），断言无 pageerror、无 localStorage Token；
  - 手工验证命令：`pnpm test:e2e`（mock）与 `pnpm test:e2e:auth`（真实 server + Vite，端口 3210 / 5173）；
  - 偏差：生产静态托管与 3210 生产 origin 的浏览器验证在 M0-9；真实 Touch ID / Safari 冒烟在 M0-9；allow_once 的浏览器 E2E 未单列（服务端 A4 已覆盖，trust 注册链路已 E2E）；Mock 模式仅用于 Demo 与既有视觉测试。

### M0-9 稳定入口与 M0 验收

- 状态：`review`（实现完成；G0 人工验收待完成）
- 依赖：M0-8
- 目标：交付 `node app.js` 可运行的最小产品，并完成 G0 门禁。
- 交付物：
  - 根 `app.js`：默认 server + web + TUI；status / doctor / `--version`；开发与发布两种解析路径；
  - 生产静态托管、SPA 回退、缓存头；
  - 构建流水线：web `vite build`、server `tsdown`；
  - 优雅关闭全链路（HTTP / WS / IPC / DB / 锁）；
  - `docs/contracts/ipc.md` 校准；
  - G0 验收记录与修复。
- 验收：
  - `node app.js` 在干净数据目录可启动；`tui` 可初始化；`status` / `doctor` 可用；
  - 生产构建后由 Server 托管 Web，刷新任意前端路由不 404；
  - 重启后会话与设备保留；
  - G0 清单（`larness.md` 42.1）全部通过；
  - `pnpm check` / `build` / `test:e2e` 全绿。
- 测试：启动 / 关闭 E2E、静态回退、生产构建冒烟、G0 用例、真实 macOS Passkey 人工冒烟。
- 涉及路径：`app.js`、`apps/server/src/index.ts`、`apps/server/src/api/static.ts`、构建配置。
- 完成记录：
  - TUI 受管入口 + 启动检查；生产静态托管 / SPA 回退；四入口构建；关闭审计；
  - 安全修复：远程明文 HTTP → `HTTPS_REQUIRED`，`trustedProxies` 接入 Fastify `trustProxy`；WS 心跳 / 消息重校验 session；`lastSeenAt` 对非轮询请求节流更新；TUI IPC `system.ping` 5 分钟保活 + 断线重连；
  - server 170 项、web 18 项测试；`pnpm check` / `build` / `test:e2e` / `test:e2e:auth` / `test:e2e:prod` 通过；CI 增加 Playwright；
  - G0 人工项仍待完成；M1 前需解决项目写锁规划冲突。
