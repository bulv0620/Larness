# 安全模型

> 状态：已冻结（v1.0）· 配套：[CONSTITUTION.md](../../CONSTITUTION.md)、[REST 契约](../contracts/rest-api.md)、[M0 spec](../../specs/010-foundation/spec.md)

## 1. 身份与信任边界

| 身份 | 定义 | 权限来源 | 不是 |
|---|---|---|---|
| Client（客户端） | 已配对并持有有效会话的浏览器实例 | 配对 + 会话 Cookie | 业务用户 / 角色 |
| Operator（本机操作者） | 能访问本机 TUI / IPC 的 OS 账户使用者 | OS 文件 / 管道权限 | Web 管理员 |
| Agent（模型调用者） | 提出工具调用的模型运行时 | 后端 ToolPermissionEngine 逐次裁决 | Client / Operator 的继承者 |
| Execution Identity | 执行 PTY、构建、PM2 的 OS 账户 | OS 账户权限 | 应用层可降权的沙箱 |
| Preview Origin | 运行项目代码的预览页面 | 短期预览票据 | 管理站点的同源页面 |

关键边界：**应用层路径白名单只约束 Harness 自己的文件工具**。一旦允许未隔离的 Shell、npm lifecycle script 或 Node 脚本，代码就拥有 Harness 运行账户的权限。

## 2. 认证与准入

### 2.1 初始化

- 首次启动只创建数据目录、SQLite 与最小公开接口；业务 API 全部返回 `NOT_INITIALIZED`。
- 管理员恢复凭据、监听地址、公网 URL、更新通道只能经本机 IPC / TUI 设置。
- 管理员密码使用 Argon2id 哈希；不得明文落盘。
- Web 端不存在“首次访问创建管理员”的路径。

### 2.2 设备配对状态机

```text
REQUESTED → (TUI) APPROVED_ONCE | APPROVED_TRUST → CODE_ISSUED
          → REDEEMED → ACTIVE
     └── DENIED / EXPIRED
ACTIVE → REVOKED
```

落库时 `CODE_ISSUED` 表示为 `status=approved` 且 `code_hash` 非空；浏览器轮询看到 `approved` 后输入配对码。

- 申请：`requestId`（服务端随机）、6 位短编号、`pollToken`（仅浏览器持有）；TTL 10 分钟。
- 审批：只在本机 TUI 进行；TUI 显示短编号、时间、来源、User-Agent。
- 配对码：批准后生成 ≥ 50 bit 随机码，仅 TUI 展示；TTL 5 分钟；最多 5 次尝试；原子消费。
- `允许本次`：只签发短期会话；`始终允许`：额外签发长期设备凭据。
- 设备凭据只能换取短期会话，不直接作为长期访问 Cookie。
- TUI 撤销设备时，事务性作废其会话并断开关联 WebSocket。

### 2.3 会话与 Cookie

| Cookie | 内容 | 作用域 | 属性 |
|---|---|---|---|
| `harness_session` | 32 字节随机 Token | 管理站点 | HttpOnly、SameSite=Lax、Secure（HTTPS 时）、Path=/ |
| `harness_device` | 32 字节随机 Token | 管理站点 | HttpOnly、SameSite=Lax、Secure、Path=/api/auth |

- 数据库只存 Token 的 SHA-256；比较使用恒定时间。
- 会话：绝对有效期 12 小时、空闲 30 分钟（可配置）；设备凭据：180 天，使用即轮换。
- 退出登录撤销当前会话；撤销设备撤销其全部会话与设备凭据。

### 2.4 CSRF 与 Origin

- 所有非 GET / HEAD 请求必须携带 `Origin`（或 `Referer` 回退），并与允许来源精确匹配（协议 + 主机 + 端口）。
- 已认证的变更请求还必须携带 `x-csrf-token`，值来自 `GET /api/auth/session`；服务端与会话绑定校验。
- 允许来源：`http://127.0.0.1:<port>`、`http://localhost:<port>`、配置的 `publicUrl`；不信任 `X-Forwarded-*`，除非来源 IP 在 `trustedProxies`。
- 配对申请与兑换是公开接口，但仍校验 Origin / 速率，不豁免 CSRF 之外的鉴权。

### 2.5 WebSocket

- 升级请求校验会话 Cookie、Origin、Host；失败直接 401，不进入协议。
- 不接受 URL 中的 Token；不在日志中记录 Cookie。
- 订阅每个 topic 时再次校验资源授权（会话 / 项目 / 服务）。
- 撤销会话或设备后，服务端主动关闭关联连接（1008）。

### 2.6 速率限制

| 接口 | 限制 |
|---|---|
| `POST /api/pairing/requests` | 每 IP 10 次 / 分钟，每 IP 30 次 / 小时 |
| `GET /api/pairing/requests/:id` | 每 pollToken 60 次 / 分钟 |
| `POST /api/pairing/redeem` | 每 IP 10 次 / 分钟；每 request 5 次尝试 |
| 登录 / 恢复（后续） | 每 IP 5 次 / 分钟，指数退避 |
| 其他已认证 API | 每会话 600 次 / 分钟（可配置） |

限流状态可存内存（单进程）；重启后允许重置，但必须写审计。

## 3. 审批分级（ToolPermissionEngine）

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

必须记录：初始化、配置变更、配对申请 / 批准 / 拒绝 / 兑换、登录 / 登出、设备撤销、权限审批与拒绝、文件写入、命令执行、服务启停 / 部署、代理拒绝、更新操作、TUI 管理动作。

字段：`id`、`client_session_id`、`session_id`、`action`、`resource_type`、`resource_id`、`decision`、`details_json`（脱敏）、`created_at`。审计只追加，不提供普通删除接口。

## 8. 失败关闭矩阵

| 条件 | 行为 | 错误码 |
|---|---|---|
| 未初始化访问业务 API | 拒绝 | `NOT_INITIALIZED` |
| 无 / 过期 / 已撤销会话 | 拒绝并清 Cookie | `UNAUTHENTICATED` |
| Origin 不匹配 | 拒绝 | `ORIGIN_INVALID` |
| CSRF 缺失 / 不匹配 | 拒绝 | `CSRF_INVALID` |
| 配对码错误 / 过期 / 超次 | 拒绝，记录尝试 | `CODE_INVALID` / `PAIRING_EXPIRED` / `RATE_LIMITED` |
| 路径越界 / 符号链接逃逸 | 拒绝 | `PATH_OUTSIDE_PROJECT` |
| 文件版本冲突 | 拒绝并返回当前版本 | `VERSION_CONFLICT` |
| 锁被占用 / 过期不明 | 拒绝或排队，不并发执行 | `RESOURCE_LOCKED` |
| 代理目标未登记 | 拒绝并审计 | `PREVIEW_TARGET_INVALID` |
| 审批过期 / 参数不一致 | 拒绝，作废审批 | `APPROVAL_INVALID` |
| 数据库写失败 / 事件序号冲突 | 回滚，不广播成功 | `INTERNAL` |
| 模型不可用 | 标记 Turn `FAILED`，保留可重试信息 | `PROVIDER_UNAVAILABLE` |

## 9. 明确不保证

- 不保证隔离恶意项目脚本、npm lifecycle、任意 Shell 对主机文件的访问；
- 不保证物理设备不可复制；Passkey 也可能同步；
- 不保证反向代理配置正确、TLS 终止安全由部署者负责；
- 不保证第三方网页可被 iframe 嵌入；
- 不保证 Harness 崩溃后 PTY / 子进程 / 未完成 Turn 原状态恢复。

## 10. 安全测试要求

- 认证绕过、配对竞态 / 重放、会话固定、CSRF、Origin、限流、WebSocket 未授权订阅；
- 路径穿越、符号链接、大小写 / Unicode 归一化、Windows 路径；
- 秘密泄漏扫描（日志、事件、API 响应、错误、快照）；
- 代理 SSRF、未登记端口、重定向、Host 注入、管理端口访问；
- 审批参数替换、审批过期、跨项目越权；
- 锁崩溃恢复、fencing token 失效、重复 requestId 幂等。

具体用例矩阵见 [testing.md](../process/testing.md)。
