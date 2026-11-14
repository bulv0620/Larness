# 安全模型

> 状态：已冻结（v1.0）· 配套：[CONSTITUTION.md](../../CONSTITUTION.md)、[REST 契约](../contracts/rest-api.md)、[ADR-021](../adr/ADR-021-passkey-v1.md)、[M0 spec](../../specs/010-foundation/spec.md)

## 1. 身份与信任边界

| 身份 | 定义 | 权限来源 | 不是 |
|---|---|---|---|
| Client（客户端） | 已配对并持有有效会话的浏览器实例 | 配对 + 会话 Cookie | 业务用户 / 角色 |
| Operator（本机操作者） | 能访问本机 TUI / IPC 的 OS 账户使用者 | OS 文件 / 管道权限 | Web 管理员 |
| Agent（模型调用者） | 提出工具调用的模型运行时 | 后端 ToolPermissionEngine 逐次裁决 | Client / Operator 的继承者 |
| Execution Identity | 执行 PTY、构建、PM2 的 OS 账户 | OS 账户权限 | 应用层可降权的沙箱 |
| Preview Origin | 运行项目代码的预览页面 | 短期预览票据 | 管理站点的同源页面 |

关键边界：**应用层路径白名单只约束 Larness 自己的文件工具**。一旦允许未隔离的 Shell、npm lifecycle script 或 Node 脚本，代码就拥有 Larness 运行账户的权限。

## 2. 认证与准入

### 2.1 初始化

- 首次启动只创建数据目录、SQLite 与最小公开接口；业务 API 全部返回 `NOT_INITIALIZED`。
- 初始化与网络设置只能经本机 IPC / TUI 确认；更新通道沿用配置，不在首次向导单独询问。
- ADR-025：不设置管理员密码，不提供密码认证/恢复；OS 文件权限与 IPC Token 是本机信任边界。历史 admin_hash 原样保留，新实例旧列为空字符串兼容标记，不可用于认证。
- Web 端不存在“首次访问创建管理员”的路径。
- ADR-024：初始化事务同时提交待发布配置和初始化/审计记录；文件发布完成前业务失败关闭，重启在监听前恢复发布，记录非法或恢复失败拒绝启动。

### 2.2 设备配对与 Passkey 注册

```text
REQUESTED → (TUI) APPROVED_ONCE | APPROVED_TRUST
  allow_once → CODE_ISSUED → REDEEMED → SESSION_ONLY
  trust      → CODE_ISSUED → REDEEMED → ENROLLMENT_PENDING
             → PASSKEY_REGISTERED → ACTIVE
  └── DENIED / EXPIRED
ACTIVE → REVOKED
```

落库时 `CODE_ISSUED` 表示为 `status=approved` 且 `code_hash` 非空；`ENROLLMENT_PENDING` 表示为 `status=enrollment_pending`。浏览器轮询看到 `approved` 后输入配对码。

- 申请：`requestId`（服务端随机）、6 位短编号、`pollToken`（仅浏览器持有）；TTL 10 分钟。
- 审批：只在本机 TUI 进行；TUI 显示短编号、时间、Origin、User-Agent；IP / UA 只用于辨认，不是身份。非 canonical Origin 的申请不能选择“始终允许”。
- 配对码：批准后生成 ≥ 50 bit 随机码，仅 TUI 展示；TTL 5 分钟；最多 5 次尝试；原子消费。
- `允许本次`：兑换后只签发短期会话，不注册 Passkey，不产生设备记录。
- `始终允许`：仅在 WebAuthn 配置有效时提供；兑换后不签发会话，只返回 5 分钟 enrollment Cookie；完成 Passkey 注册验证后才创建设备 / credential / 会话。
- 不签发长期设备 Token / Cookie；不存在 refresh token。
- TUI 撤销设备时，事务性作废 credential、设备与会话，并断开关联 WebSocket。

### 2.3 会话、Cookie 与 Passkey 登录

| Cookie | 内容 | 作用域 | 属性 |
|---|---|---|---|
| `larness_session` | 32 字节随机 Token | 管理站点 | HttpOnly、SameSite=Lax、Secure（HTTPS 时）、Path=/、Max-Age ≤ 12h |
| `larness_enrollment` | 32 字节随机 Token | `/api/webauthn/registration` | HttpOnly、SameSite=Lax、Secure（HTTPS 时）、Path=/api/webauthn/registration、Max-Age 5min |

- 数据库只存 Token 的 SHA-256；比较使用恒定时间。
- 会话：绝对 12 小时、空闲 30 分钟（可配置）；非轮询的已认证请求会节流更新 `lastSeenAt`，`/api/auth/session` / `/api/bootstrap` 轮询不计入活跃；过期后通过 Passkey assertion 重新认证，不使用 refresh token。
- 退出登录撤销当前会话；设备撤销撤销其 credential、全部会话与 WS。
- Passkey 私钥永不离开认证器 / 密码管理器；服务端只存公钥、credential ID、计数器与备份标志。

### 2.4 WebAuthn 安全约束

- **RP ID / Origin canonical**：一个工作空间只支持一个来源；开发 `http://localhost:<port>`，生产 HTTPS 域名。RP ID 必须等于 origin hostname；IP 地址不能作为 RP ID，通过 `127.0.0.1` / 局域网 IP 访问时 Passkey 不可用，`allow_once` 仍可用。
- 注册：`residentKey: required`、`userVerification: required`、`attestation: none`；验证 origin、RP ID、UV、challenge；`excludeCredentials` 防止重复注册。
- 认证：`allowCredentials` 为空（discoverable credential），`userVerification: required`；服务端按返回的 credential ID 查找，验证签名、challenge、origin、RP ID、计数器。
- Challenge：32 字节随机，TTL 5 分钟，一次性消费，绑定 ceremony 类型与 pairing request / device。
- 失败统一返回 `PASSKEY_AUTH_FAILED` / `PASSKEY_REGISTRATION_FAILED`，不泄漏 credential 是否存在。
- 计数器：同步型 Passkey 常为 0；允许 0，异常回退只审计不硬拒绝，避免误锁。
- 可同步 Passkey 的 `backupEligible` / `backupState` 必须存储并在 TUI 展示；不得宣称物理设备绑定。
- Enrollment Cookie 仅允许一次成功注册、绑定 pairing request；失败可重试，验证成功即清除，过期后重新配对。

### 2.5 CSRF 与 Origin

- 所有非 GET / HEAD 请求必须携带 `Origin`（或 `Referer` 回退），并与 canonical origin 精确匹配（协议 + 主机 + 端口）。
- 已认证的变更请求还必须携带 `x-csrf-token`，值来自 `GET /api/auth/session`；服务端与会话绑定校验。
- Passkey 注册 / 认证端点无会话（或仅 enrollment Cookie），不要求 CSRF Token，但必须校验 Origin；enrollment Cookie 为 SameSite=Lax。
- 允许来源：canonical `origin`；非 WebAuthn API 额外允许 loopback 来源 `http://localhost:<port>`、`http://127.0.0.1:<port>`、`http://[::1]:<port>`；WebAuthn options / verify 仍只接受 canonical。不信任 `X-Forwarded-*`，除非来源 IP 在 `trustedProxies`（已接入 Fastify `trustProxy`）。
- 传输：`requireHttpsForRemote` 为 true 时，非 loopback 请求必须使用 HTTPS；HTTP / WS 升级返回 `HTTPS_REQUIRED`。
- WebSocket：握手校验 session；心跳与每条消息重新校验绝对 / 空闲期限，过期以 1008 关闭。
- TUI IPC：TUI 每 5 分钟发送 `system.ping` 保活；IPC 意外断开时最多重连 2 次，避免空闲 30 分钟后误停 Server。
- 配对申请 / 兑换、Passkey options / verify 都是公开接口，但仍限流并校验 Origin。

### 2.6 WebSocket

- 升级请求校验会话 Cookie、Origin、Host；失败直接 401，不进入协议。
- 不接受 URL 中的 Token；不在日志中记录 Cookie。
- 订阅每个 topic 时再次校验资源授权（会话 / 项目 / 服务）。
- 撤销会话或设备后，服务端主动关闭关联连接（1008）。

### 2.7 速率限制

| 接口 | 限制 |
|---|---|
| `POST /api/pairing/requests` | 每 IP 10 次 / 分钟，每 IP 30 次 / 小时 |
| `GET /api/pairing/requests/:id` | 每 pollToken 60 次 / 分钟 |
| `POST /api/pairing/redeem` | 每 IP 10 次 / 分钟；每 request 5 次尝试 |
| `POST /api/webauthn/registration/options` | 每 enrollment 10 次 / 分钟 |
| `POST /api/webauthn/registration/verify` | 每 enrollment 10 次 / 分钟 |
| `POST /api/webauthn/authentication/options` | 每 IP 10 次 / 分钟 |
| `POST /api/webauthn/authentication/verify` | 每 IP 10 次 / 分钟 |
| 其他已认证 API | 每会话 600 次 / 分钟（可配置） |

限流状态可存内存（单进程）；重启后允许重置，但必须写审计。

## 3. 审批分级（ToolPermissionEngine）

> 当前策略解释（ADR-040/042）：下表描述普通策略的风险基线，autonomous对全部已授权Agent业务能力免人工审批/确认（含服务/首次部署/替换/恢复），不新增未授权能力。仍执行所有鉴权、范围、计划/产物哈希、锁/幂等/预算/审计和秘密保护。


| 级别 | 典型操作 | V1 行为 | 可记忆 |
|---|---|---|---|
| L0 阅读 | 项目内读文件、Git status/diff、查看服务状态 | 默认允许 | 无需 |
| L1 常规开发 | 项目内文件编辑、测试、构建、安装项目依赖、启动受控开发服务 | 默认允许，但有超时 / 输出上限 / 审计摘要 | 仅可信项目策略 |
| L2 高权限 | 项目外路径、Git push、服务新增 / 重启 / 部署、环境变量修改、暴露网络服务 | 逐次审批；可授予窄作用域、限时的本会话 / 本项目权限 | 可选、可撤销、有有效期 |
| L3 极高风险 | 系统账户 / 权限、防火墙、敏感凭据、删除关键数据、OS 特权命令 | 默认拒绝；需本机侧再次确认 + 受限 helper | 不可永久记忆 |

审批记录必须绑定：能力、资源范围、参数摘要、作用域、过期时间、审批人（客户端会话）、Turn / ToolCall。执行前把最终参数与审批参数做规范化比对；不一致则拒绝并审计。

## 4. 路径与文件授权

- 项目根路径在登记时解析为 `realpath` 并保存；所有文件工具对目标做 `realpath` 后校验 `target === root || target.startsWith(root + sep)`。
- 拒绝 `..`、NUL、Windows 保留名、ADS、UNC 越界；符号链接指向根外一律拒绝；对 TOCTOU 采用“打开后校验 fd / 再校验 realpath”策略。
- 独立会话的 workspace 在 `<dataDir>/sessions/<id>/workspace`，同样按根目录授权。
- 文件写入携带 `expectedVersion`（内容 SHA-256 或版本号）；不匹配返回 `VERSION_CONFLICT` 与 Diff，不静默覆盖。
- 删除项目只删元数据；不提供“删除磁盘目录”的普通接口。

## 5. 秘密管理

- `SecretStore` 使用 AES-256-GCM；主密钥 32 字节，存于 `<dataDir>/secrets/master.key`，权限 `0600`，不进版本库。
- 数据库中只存 `secretRef`（如 `sec_…`）与元数据；明文只在执行瞬间注入受控子进程环境或 SDK 参数。
- 模型上下文、Agent 事件、工具结果、日志、审计、REST 响应不得出现明文；统一脱敏器覆盖 `Authorization`、`apiKey`、`token`、`cookie` 等键。
- 子进程环境变量白名单；不把完整 `process.env` 传给项目命令。
- 日志与错误上报前执行秘密扫描；测试用固定假 Key，禁止真实 Key 进测试。

## 6. 预览隔离

- 目标只能是 `ServiceRegistry` 中已登记、允许预览、绑定 `127.0.0.1` / `::1` 的服务；禁止任意 upstream、端口扫描、DNS rebinding、重定向漂移。
- 代理转发 HTTP / WS，限制方法、头、超时、连接数与响应大小；剥离管理站点的 Cookie 与认证头。
- 预览来源独立于管理站点（优先独立注册域）；预览票据短期、绑定服务与会话，不放主账户凭据。
- 无独立来源时：禁用公网内嵌预览，提供“外部打开 / 仅本机”降级；不得静默同源 iframe。
- `frame-ancestors` / CSP / sandbox 按兼容性配置；不得通过无条件删除安全响应头来修复预览。

## 7. 审计

必须记录：初始化、配置变更、配对申请 / 批准 / 拒绝 / 兑换、Passkey 注册 / 登录 / 失败、登录 / 登出、设备撤销、权限审批与拒绝、文件写入、命令执行、服务启停 / 部署、代理拒绝、更新操作、TUI 管理动作。

字段：`id`、`client_session_id`、`session_id`、`action`、`resource_type`、`resource_id`、`decision`、`details_json`（脱敏）、`created_at`。审计只追加，不提供普通删除接口。

## 8. 失败关闭矩阵

| 条件 | 行为 | 错误码 |
|---|---|---|
| 未初始化访问业务 API | 拒绝 | `NOT_INITIALIZED` |
| 无 / 过期 / 已撤销会话 | 拒绝并清 Cookie | `UNAUTHENTICATED` |
| Origin 不匹配 | 拒绝 | `ORIGIN_INVALID` |
| CSRF 缺失 / 不匹配 | 拒绝 | `CSRF_INVALID` |
| 配对码错误 / 过期 / 超次 | 拒绝，记录尝试 | `CODE_INVALID` / `PAIRING_EXPIRED` / `RATE_LIMITED` |
| enrollment Cookie 缺失 / 过期 | 拒绝，要求重新配对 | `ENROLLMENT_EXPIRED` / `UNAUTHENTICATED` |
| WebAuthn challenge 过期 / 重放 / 不匹配 | 拒绝并作废 challenge | `CHALLENGE_EXPIRED` / `PASSKEY_AUTH_FAILED` |
| 浏览器不支持 WebAuthn | Web 端提示，不发起注册；trust 不可用，allow_once 可用 | 客户端 `PASSKEY_UNSUPPORTED` |
| Passkey 验证失败（签名 / UV / RP ID / Origin） | 拒绝，统一错误，不泄漏原因 | `PASSKEY_AUTH_FAILED` / `PASSKEY_REGISTRATION_FAILED` / `ORIGIN_INVALID` |
| WebAuthn 配置无效（RP ID 为 IP 等） | 拒绝注册 / 认证 | `WEBAUTHN_NOT_CONFIGURED` |
| 路径越界 / 符号链接逃逸 | 拒绝 | `PATH_OUTSIDE_PROJECT` |
| 文件版本冲突 | 拒绝并返回当前版本 | `VERSION_CONFLICT` |
| 锁被占用 / 过期不明 | 拒绝或排队，不并发执行 | `RESOURCE_LOCKED` |
| 代理目标未登记 | 拒绝并审计 | `PREVIEW_TARGET_INVALID` |
| 审批过期 / 参数不一致 | 拒绝，作废审批 | `APPROVAL_INVALID` |
| 数据库写失败 / 事件序号冲突 | 回滚，不广播成功 | `INTERNAL` |
| 模型不可用 | 标记 Turn `FAILED`，保留可重试信息 | `PROVIDER_UNAVAILABLE` |

## 9. 明确不保证

- 不保证隔离恶意项目脚本、npm lifecycle、任意 Shell 对主机文件的访问；
- 不保证物理设备不可复制；Passkey 可能通过 iCloud / Google 等同步到其他设备，只能称“可信凭据 / 浏览器授权”；
- 不保证所有浏览器 / 平台支持 WebAuthn；不支持时只能 `允许本次`；
- 不保证 `127.0.0.1` 或局域网 IP 可使用 Passkey（RP ID 不支持 IP）；
- 不保证 TUI 不可用时能恢复访问；V1 没有 Web 侧的“忘记 Passkey”流程；
- 不保证反向代理配置正确、TLS 终止安全由部署者负责；
- 不保证第三方网页可被 iframe 嵌入；
- 不保证 Larness 崩溃后 PTY / 子进程 / 未完成 Turn 原状态恢复。

## 10. 安全测试要求

- 认证绕过、配对竞态 / 重放、会话固定、CSRF、Origin、限流、WebSocket 未授权订阅；
- Passkey 注册 / 认证：challenge 过期与重放、错误 Origin / RP ID、UV 不足、重复 credential、撤销后 assertion、enrollment 过期、IP 来源不可用；
- 路径穿越、符号链接、大小写 / Unicode 归一化、Windows 路径；
- 秘密泄漏扫描（日志、事件、API 响应、错误、快照）；
- 代理 SSRF、未登记端口、重定向、Host 注入、管理端口访问；
- 审批参数替换、审批过期、跨项目越权；
- 锁崩溃恢复、fencing token 失效、重复 requestId 幂等。

具体用例矩阵见 [testing.md](../process/testing.md)。

## 主密钥启动校验（I0-3 / ADR-024）

启动在 IPC/HTTP 监听前读取所有持久化 secret，校验其可用当前 master.key 解密；明文不输出、不返回或持久化。已有 secret 时 master.key 缺失不得重建；格式错误、密钥不匹配、密文损坏均拒绝启动，保留原记录，要求恢复正确密钥及匹配备份。不提供自动清空/重置。secret 表为空时允许首次创建密钥。

## 资源关闭、临时绑定与服务动作（ADR-030）

主动关闭终端 Tab 是已认证 terminate 操作，必须鉴权 / CSRF / 幂等 / 审计并等待实际退出；不能用本地移除 Tab 代替。窗口关闭、最小化、组件卸载 / 网络断开不 terminate。临时服务仅验证、登记与展示其 Terminal 源执行，源退出或身份不明立即撤销预览资格，不允许日志 URL / 客户端 PID 自动授权。持久 PM2 操作对人工与 Agent 采用同一权限、审批、服务锁和审计；新增部署 / 产物变更仍经 M4。详细产品规则见 [ADR-030](../adr/ADR-030-resource-lifecycle-and-services.md)，预览身份与票据见 ADR-043/044，正式 PM2 服务的退出行为见 ADR-046/050。审批用词按ADR-042解释为策略授权，autonomous不加入人工等待。

## 项目终端交接修正（ADR-031 / M2-9）

人类明确要求 AI 可接管项目内手动终端。Agent 控制 / 读取 scope 从 Agent dev 扩展至同项目 Shell，不扩展到全局或其他项目；输入与中断仍 L2 逐次审批，持有人工租约时不抢占，用户释放后才可获取。名称独立校验 / 秘密扫描，审计不保存标题；上下文只传有界 ID / 标签 / mode 并视作不可信元数据。资源关闭 / 并发 / fencing 规则不变。

## 默认工作区（ADR-032 / M2-10）

默认工作区只授权 dataDir/sessions/global-terminal/workspace 的精确根，绝不授权它的 sessions 父目录或其他配置 / 密钥 / 日志目录。创建和访问逐级拒绝目录符号链接，文件路径仍做根内 realpath 校验；相同 scope 的缓存 / 事件 / 项目写锁按共同根处理。默认会话与 Shell 的 Agent 交接必须比较真实会话的授权根和终端操作根，不能只检查 projectId=null。历史独立目录只由原会话 scope 访问，禁止静默搬移。Shell 仍为可信开发机执行模式，应用文件授权不是 OS 沙箱。

## 固定默认项目（ADR-034 / M2-13）
prj_default 是固定系统项目描述，服务层拒绝更新 / 删除并审计，不只依赖前端菜单隐藏。默认项目文件 / 终端别名归一至现有精确 workspace:default 授权，仍逐级拒绝目录 symlink，禁止穿越运行数据目录；不为整个 dataDir 授权。历史 session / terminal / file stream 身份保留，无数据迁移，普通项目、租约与 AI 输入审批不变。

## 对话元数据（M2-14 / M2-15）
计划工具只记录当前鉴权Turn的元数据，不能代替授权或验证证据，取消后拒绝更新。命令详情在Manager完成参数/凭据检查后才写Agent事件，展示字段继续脱敏，敏感选项值隐藏，不包含环境。审批UI在后端确认前保持待处理，过期禁用；会话切换不应用旧异步响应，原参数绑定/审计/租约/锁规则不变。

## Agent 初始命令与交互 Shell（ADR-038 / M2-22）

Windows 按 [ADR-061](../adr/ADR-061-windows-terminal-shell.md) 从 Larness 进程的绝对 PATH 目录和系统路径选择交互 Shell。启动探测和实际 Shell 都使用白名单环境。PowerShell 禁用 profile 和历史保存，执行策略由主机控制。
初始 dev 命令从批准的 argv 进入固定 Shell 引导的外部 exec，不拼脚本或从键盘注入，不更改模型对程序/参数的审批绑定。父 Shell 的 INT 处理只维持终端，子命令仍接收 SIGINT；后续所有人工/AI输入继续校验租约及审批。默认 Shell 校验、白名单环境/历史禁写、输出脱敏、受管子进程清理、未知状态隔离沿用。RUNNING 只证明终端存活，不能证明初始服务存在或 ready；M3 必须核对实际源进程。已有资源不重建。

## M2-25 完全自主策略（ADR-040）
现有 Session PATCH approvalPolicyId 与 Turn executionContext.policy 枚举增加 autonomous；新 Turn 持久化选择时的快照，运行中更改只影响下一轮。明确选择该策略时已登记 Agent 工具 L0–L3 均无需人工逐次审批，执行仍校验参数、客户端/资源范围、锁/fencing/幂等/预算/取消/租约/秘密保护，仍有审计与持久事件。其他策略与人工 Git 资源审批保持。客户端选择前风险弹窗确认，取消不更改，危险色盾牌持续可见；这不是沙箱，不扩大工具能力或授权管理接口。未鉴权/非法枚举拒绝，无 DB列/迁移/新 REST路径。

## Git 文件放弃（ADR-041 / M2-27）
放弃仅为用户确认的单文件动作，confirmed:true、字面路径、逐级非symlink普通文件检查、目标内容哈希与仓库状态重验，沿用CSRF/鉴权/锁/审计/幂等。tracked恢复index版本，untracked仅删除明确普通文件；无递归/全仓reset，取消暂存只写index不动worktree，未向Agent注册新能力。外部编辑并非OS隔离，不能保证跨进程原子性。

## 部署免人工与安全边界（ADR-042，2026-11-05）
M3只开发登记/隔离预览；M4完整持久/正式发布。autonomous首次部署/产物替换/启停/支持的恢复没有额外人类审批/确认，不可硬编码“生产必须人工”。后端用真实actor/scope/policySnapshotId及计划哈希/时效授权，不接受未授权调用者自报模式；只有需要人工的策略分支才有approvalId，自主不得伪造人工审批记录。篡改/过期/撤销/未知状态/锁失效仍拒绝；自主重新规划/授权也不转为强制人工等待。普通策略、M2人工Git独立资源动作、本机设备配对/初始化/凭据通道不因本次文档扩权；规格/PoC的人类评审门禁仍独立于业务审批。

按 [ADR-048](../adr/ADR-048-service-domain-separation.md)，运维资源授权与开发会话授权分别校验，动作快照和审批绑定所属领域。后端解析的运维上下文须绑定真实项目、目标范围及会话/Turn，工具装配与执行器分别校验该上下文。开发 Turn 直调运维 handler、伪造领域或持开发 ID 访问运维 API、日志、订阅与补拉均拒绝，反向同理。自主策略只改变合法操作是否需要人工批准。

## 开发预览授权与隔离（ADR-043）
[ADR-043](../adr/ADR-043-development-preview-authorization.md)和[m3-preview](../contracts/m3-preview.md)定义独立来源、一次性bootstrap换限时grant、会话/源失效断流、监听身份核验和连接预算。不得只换端口或信任随机host；PID加ps出生文本不是强句柄，connect竞态/跨站Cookie必须实测，不宣称绝对进程绑定/OS沙箱。预览解析使用 POST 并校验 CSRF，凭据不交模型/事件/上游，不放宽管理认证/CORS。G3 已验收本机隔离预览；远程独立域 HTTPS 见 [遗留问题](../open-questions.md)。

## PM2 命令执行（ADR-050，2026-11-07）

[ADR-050](../adr/ADR-050-pm2-cli-deployment.md) 替代专用部署流水线与独立模型工具入口。普通项目会话可以通过已授权的通用命令构建和管理 PM2，执行器注入实例环境，继续实施活动客户端、参数审批、项目锁/fencing、命令幂等、预算、取消、输出脱敏和审计。专用计划/grant 退出新 Agent 主线，旧 REST 兼容层维持其授权。

PM2 名称关联项目用于准确识别和展示。Shell 的宿主机权限依宪法第四条说明，名称约定和提示词不构成 OS 隔离。后端正式服务 API、开发预览与终端继续分别校验资源身份。模型只收到 PM2 的非秘密环境和服务摘要。原始环境与 dump 不返回，日志只允许读取实例受控日志目录并脱敏。

### 人工 PM2 控制（ADR-051）

人工服务控制不读取当前聊天策略，认证人类点击启动或确认停止/重启即授权该次精确服务操作。严格 body 不允许脚本/环境；CSRF、活动客户端复核、已登记项目/namespace/完整名称、项目→服务租约/fencing、配置身份校验、持久意图/幂等与审计仍保留。PM2 配置与环境不替换，日志不回传原始 env。未知、丢失应用和不确定结果失败关闭，不自动重试。见 [ADR-051](../adr/ADR-051-human-pm2-service-control.md)。

### 所属项目 PM2 日志（ADR-052）

按用户确认，精确实际 PM2 登记日志额外允许位于所属 canonical 项目根；需要唯一应用/完整名称/namespace/登记项目一致。客户端不能指定路径，未知实例/历史项目路径不扩权。普通文件与最终 symlink 拒绝、O_NOFOLLOW、文件身份/规范路径重验，保持 1 MiB 与脱敏。参见 [ADR-052](../adr/ADR-052-project-pm2-log-reading.md)。
