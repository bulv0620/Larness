# 系统架构总览

> 状态：已冻结（v1.0）· 来源：`larness.md` 第 10–20、33–41 章
> 本文只描述跨里程碑的稳定结构；具体功能见 `specs/`。

## 1. 定位

Larness 是运行在单台主机上的单工作空间 AI-first Web IDE：

- 一个 Server 进程持有全部业务状态（SQLite）与执行资源（PTY、子进程、PM2、预览代理）；
- 多个已授权浏览器访问同一份工作空间，但各自维护窗口与布局；
- Agent 与人工 UI 走同一套 ResourceManager / 授权 / 审计路径；
- 所有代码、构建、服务都运行在 Larness 主机，不设计远程执行节点。

不可协商的约束见 [CONSTITUTION.md](../../CONSTITUTION.md)。

## 2. 运行拓扑

```text
Remote Browser A ─┐
Remote Browser B ─┼── HTTPS reverse proxy / tunnel ──┐
Local Browser ────┘                                  │
                                                     ▼
                                        Fastify Web + Auth (127.0.0.1:3210)
                                          REST /api + WebSocket /ws + 静态资源
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          ▼                          ▼                          ▼
                   Workspace Domain            EventLog / EventBus        Window UI State
              Project / Session / Turn        SQLite, seq, replay        per browser only
                          │
                 ExecutionOrchestrator
                          │
        ┌─────────────────┼──────────────────┬─────────────────┐
        ▼                 ▼                  ▼                 ▼
   AgentRuntime     ResourceManager       Scheduler      PreviewRegistry
        │          File / PTY / Git /          │              │
   DeepSeek / GLM   Command / Service          │         HTTP/WS proxy
                          │                  │              │
                    Local OS / PM2 ◄─────────┘       127.0.0.1:<port>
                          │
Local Terminal ── protected local IPC (UDS / named pipe) ── Control TUI
Stable Launcher / Updater ── controls ── Server process
```

## 3. 进程与职责边界

| 进程 | 职责 | 明确不负责 |
|---|---|---|
| Launcher（`app.js`） | 稳定入口；选择版本、启动 Server、监控退出、受控重启 | 业务逻辑、数据库访问 |
| Server | Fastify、WS、SQLite、Agent Runtime、资源管理、代理、调度 | 覆盖正在运行的自身二进制 |
| TUI Client | 初始化、设备审批 / 撤销、状态、日志、doctor、关闭 | 绕过 Server 直接操作业务数据 |
| Web Client | 视图、窗口、输入、事件订阅 | 直接操控进程 / 文件 / 端口 |
| User Services | 项目开发进程、PM2 长期服务 | 依赖 Larness 存活 |
| Updater | 下载、验签、切换版本、健康检查、回滚 | 在 Server 内自更新 |

Launcher / Updater 的完整实现属于 M5；M0 只要求 `node app.js` 能启动已构建的 Server，并转发 `tui` / `status` 子命令。

## 4. 服务端模块

| 模块 | 核心职责 | 不负责 |
|---|---|---|
| AuthManager | 初始化、设备配对、Passkey 注册 / 认证、浏览器会话、设备撤销、CSRF / Origin 校验 | Agent 工具授权决策 |
| ControlTUI / LocalIpc | 本机初始化、配对审批、设备管理、状态与日志 | 公网入口 |
| ProjectManager | 目录映射、元数据、路径授权、Git 仓库检测 | PTY 生命周期 |
| SessionManager | Session / Turn 状态、消息索引、事件序号 | 以厂商消息格式作为唯一历史 |
| AgentRuntime | Provider 适配、上下文构建、工具循环、流式事件 | 绕过 ToolRegistry 执行命令 |
| ToolRegistry | 工具 schema、参数校验、审批、执行路由、审计 | 向模型暴露秘密 |
| TerminalManager | PTY 创建 / 写入 / resize / 终止、控制权租约 | 长期服务托管 |
| CommandRunner | 非交互短命令、超时、输出截断、取消 | 为每条命令创建终端 Tab |
| ServiceManager | 服务登记、Runtime Adapter、日志、健康检查、对账 | 把 PM2 当安全沙箱 |
| FileManager | 授权路径读写、版本冲突检测、文件监听 | 对任意 Shell 提供文件隔离 |
| GitManager | status / diff / commit / branch 等结构化操作 | 无审批自动 push |
| PreviewRegistry / Proxy | 登记 loopback 目标、票据、HTTP / WS 转发 | 任意内网 URL 代理 |
| Scheduler | 任务持久化、触发、限流、失败记录 | 继承人工临时审批 |
| EventLog / EventBus | 先持久化后广播、增量重放 | 把 WS 当唯一状态 |
| UpdateManager | 检查版本、验签、协调安全点 | Server 自我覆盖 |

## 5. 关键数据流

### 5.1 启动与初始化

```text
node app.js
  → 解析数据目录 / 配置
  → 打开 SQLite，执行迁移
  → 初始化日志、审计、事件总线
  → 若未初始化：只挂载 /api/health、/api/bootstrap、配对最小面
  → 启动 Fastify（默认 127.0.0.1:3210）
  → 启动本地 IPC（UDS / named pipe）
  → 启动配对、设备、会话清理任务
  → ready

node app.js tui
  → 连接本地 IPC
  → 首次：初始化管理员凭据、监听地址、公网 URL、更新通道
  → 日常：查看状态、审批配对、撤销设备、查看日志、关闭服务
```

未初始化时禁止通过 Web 创建管理员；初始化只能来自本机受 OS 权限保护的通道。

### 5.2 设备配对与 Passkey 登录

```text
浏览器 POST /api/pairing/requests
  → 服务端生成 requestId + 短编号 + pollToken，TTL 10 分钟
  → TUI 显示编号 / 来源 / 时间
  → 操作者选择 拒绝 / 允许本次 / 始终允许
  → 批准后生成一次性高熵配对码，只在 TUI 显示
  → 浏览器提交配对码（原子消费）
  ├─ 允许本次：签发短期会话，不注册 Passkey
  └─ 始终允许：返回 passkey_required + 5 分钟 enrollment Cookie
       → 浏览器注册 Passkey（WebAuthn create）
       → 服务端验证并创建设备 / credential / 会话
  → 浏览器进入唯一 Workspace
```

后续登录：

```text
未认证浏览器 → GET /api/webauthn/authentication/options
  → 浏览器 WebAuthn get（Face ID / 指纹 / PIN）
  → POST /api/webauthn/authentication/verify
  → 服务端验证签名 / challenge / origin → 签发短期会话
```

不签发长期设备 Token，也不使用 refresh token；会话过期后重新用 Passkey 认证。RP ID / Origin 只支持 `localhost` 或 HTTPS 域名，IP 地址不作为 Passkey 来源。

角色与安全细节见 [security.md](security.md)、[ADR-021](../adr/ADR-021-passkey-v1.md) 与 [010-foundation spec](../../specs/010-foundation/spec.md)。

### 5.3 Agent Turn

```text
POST /api/sessions/:id/turns
  → 校验会话、模型、审批策略、幂等键
  → 获取 Session 执行锁 + 项目写锁（会写项目时）
  → 创建 Turn（QUEUED）与 user.message 事件（事务 + seq）
  → Runner：PREPARING → RUNNING
  → Provider 流式输出 → assistant delta 事件（批量）
  → 工具调用：校验 → 审批（如需）→ 执行 → 结果事件
  → 写入文件变更摘要 / 使用量 → COMPLETED / FAILED / CANCELLED
  → 释放锁
```

- 同一 Session 同时最多一个活跃 Turn；同项目写作业串行。
- 关键状态先落库再广播；刷新 / 断线只影响订阅。
- 服务器崩溃后无法证明仍存活的 Turn 标记 `INTERRUPTED`，不假装续跑。

### 5.4 资源与视图

```text
UI 操作 ──REST/WS──► ResourceManager ──► OS / PTY / PM2 / Git
Agent 工具 ──ToolRegistry──► 同一 ResourceManager
```

- 关闭 / 隐藏窗口只改变客户端视图；`terminate` 才是终止资源。
- 同一 Terminal 可被多个客户端观看，交互输入需租约。
- 服务与终端由 Larness 拥有，可带 `projectId`，Session 只是创建来源。
- Tab 身份、来源、项目筛选、分组与去重规则见 [resource-views.md](../contracts/resource-views.md)。

### 5.5 预览

```text
输入 localhost:5173/dashboard
  → normalize → 匹配已登记 Service
  → 校验会话 + 服务权限
  → 签发短期预览票据
  → 独立预览来源加载 iframe
  → Larness 代理 → 127.0.0.1:5173
```

代理只允许已登记 loopback 目标；独立来源不可用时安全降级，不允许同源执行不可信项目代码。

## 6. 安装目录与数据目录

```text
<install>/                      # 发布物，可整体替换
├── app.js                      # 稳定入口
├── current.json                # 当前版本指针（M5）
├── releases/                   # 版本化 server / web 资源（M5）
├── runtime/                    # 平台原生资源（node-pty 等）
└── updater/

<dataDir>/                      # 独立于安装目录，0700
├── config.json
├── larness.db
├── secrets/                    # 加密凭据
├── sessions/<id>/workspace/    # 独立会话工作目录
├── artifacts/<session-id>/
├── logs/
├── backups/
└── tmp/
```

默认数据目录使用 OS 标准用户数据目录（macOS `~/Library/Application Support/Larness`，Linux `$XDG_DATA_HOME/larness`，Windows `%LOCALAPPDATA%\Larness`），可用 `LARNESS_DATA_DIR` 覆盖。项目源码目录永远不放在数据目录内（独立会话除外）。

## 7. 仓库源码布局（目标）

```text
apps/
  web/          # React + Vite，仅依赖 packages/shared 的类型与客户端
  server/       # Fastify、SQLite、认证、资源管理、代理
packages/
  shared/       # Zod DTO、事件类型、错误码、常量
  agent/        # ProviderAdapter、ContextBuilder、工具定义
  resources/    # File / Terminal / Command / Git / Service 抽象
  ui/           # 通用 UI 原语（Radix + Tailwind）
scripts/        # 构建、发布、E2E 辅助
app.js          # 稳定入口（M0-9 创建）
```

约定：Server 不依赖 React；所有 Host / OS 差异收敛到 `platform/` 与 Adapter；DTO 与事件类型只从 `packages/shared` 导出。

## 8. 跨模块约定

| 主题 | 约定 |
|---|---|
| ID | `<prefix>_<uuidv4>`，如 `ses_…`、`trn_…`、`evt_…` |
| 时间 | Unix 毫秒整数，UTC；展示层本地化 |
| 错误 | `{ error: { code, message, details?, requestId } }`，稳定错误码 |
| 配置 | `config.json` + 环境变量覆盖；Zod 校验；启动即失败关闭 |
| 日志 | pino 结构化；`requestId` / `sessionId` / `turnId` 关联；秘密脱敏 |
| 事务 | SQLite WAL；事件写入与 `seq` 递增同事务 |
| 幂等 | 变更类请求支持 `Idempotency-Key`；服务 / 部署 / Turn 必须支持 |
| 锁 | owner、过期、心跳、fencing token；固定获取顺序 |

## 9. 平台策略

- 主开发与验收平台：macOS（当前开发机）。
- CI：Linux 必跑；macOS 跑构建与测试；Windows 在 M5 前完成 PoC 并公开真实支持范围。
- 不假设 PTY、进程统计、PM2、开机自启在三平台一致；每项平台能力都要有单独验收记录。

## 10. 非目标

多租户、远程主机编排、Docker / K8s、Electron 原生窗口、WebRTC、完整第三方网页浏览器、无审批的主机管理员操作、OS 级强沙箱。
