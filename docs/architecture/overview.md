# 系统架构总览

> 当前实现总览，2026-11-09。G4 已通过，G5 已按 macOS 范围条件通过。PM2 部署按 [ADR-050](../adr/ADR-050-pm2-cli-deployment.md)，M5 已交付多模型、调度和 npm 分发。更新安全规范见 [ADR-055](../adr/ADR-055-npm-update-security.md)。

## 1. 定位

Larness 是运行在单台主机上的单工作空间 AI-first Web IDE：

- 一个 Server 进程维护业务状态（SQLite）、Agent 执行和资源观察，正式服务由独立 PM2 守护进程托管；
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
   AgentRuntime     ResourceManager       Scheduler     PreviewRegistry
        │          File / PTY / Git /          │              │
   DeepSeek / GLM   Command / Service          │         HTTP/WS proxy
                          │                  │              │
                    Local OS / PM2 ◄─────────┘       127.0.0.1:<port>
                          │
Local Terminal ── protected local IPC (UDS / named pipe) ── Control TUI
TUI Supervisor ── manages ── Server + Web
```

## 3. 进程与职责边界

| 进程 | 职责 | 明确不负责 |
|---|---|---|
| 入口（`app.js`） | 启动受管 TUI，分派 `status`、`doctor` 和版本查询 | 业务逻辑、数据库访问 |
| Server | Fastify、WS、SQLite、Agent Runtime、资源管理、代理、调度 | 覆盖正在运行的自身二进制 |
| TUI Client | 初始化、设备审批 / 撤销、状态、日志、doctor、关闭 | 绕过 Server 直接操作业务数据 |
| Web Client | 视图、窗口、输入、事件订阅 | 直接操控进程 / 文件 / 端口 |
| User Services | 开发进程（M3登记）、PM2持久进程（M4） | 管理端鉴权；正式服务在TUI退出后继续运行（ADR-046） |
| npm CLI | 用户手动安装、升级或降级发布包 | 管理运行中的任务或恢复数据库 |

`node app.js` 以 TUI 为受管前台入口，启动 Server + Web，关闭 TUI 时停止管理面与临时开发资源，已运行正式服务按 ADR-046 保留；`status` / `doctor` 仍为只读子命令。

## 4. 服务端模块

| 模块 | 核心职责 | 不负责 |
|---|---|---|
| AuthManager | 初始化、设备配对、Passkey 注册 / 认证、浏览器会话、设备撤销、CSRF / Origin 校验 | Agent 工具授权决策 |
| ControlTUI / LocalIpc | 本机初始化、配对审批、设备管理、状态与日志 | 公网入口 |
| ProjectManager | 目录映射、元数据、路径授权、Git 仓库检测 | PTY 生命周期 |
| SessionManager | Session / Turn 状态、消息索引、事件序号 | 以厂商消息格式作为唯一历史 |
| AgentRuntime | Provider 适配、上下文构建、工具循环、流式事件 | 绕过 ToolRegistry 执行命令 |
| ToolRegistry / ToolExecutor | Registry 注册名称/schema/handler，Executor 按策略校验、审批和审计后调用 handler | 向模型暴露秘密 |
| TerminalManager | PTY 创建 / 写入 / resize / 终止、控制权租约 | 长期服务托管 |
| CommandRunner | 非交互短命令、超时、输出截断、取消 | 为每条命令创建终端 Tab |
| ServiceManager / Registry | 会话开发服务的终端绑定登记、关联日志及预览资格 | 正式服务发布、PM2 进程管理 |
| 服务运维模块（M4） | PM2 实例检查、服务/项目关系、状态投影与日志；旧发布接口保留兼容 | 把 online 自动当业务健康 |
| FileManager | 授权路径读写、版本冲突检测、文件监听 | 对任意 Shell 提供文件隔离 |
| GitManager | status / diff / commit / branch 等结构化操作 | 绕过后端策略/快照/审计自动push |
| PreviewRegistry / Proxy | 登记 loopback 目标、票据、HTTP / WS 转发 | 任意内网 URL 代理 |
| Scheduler（M5） | 任务持久化、触发、限流、失败记录 | 继承人工临时审批 |
| EventLog / EventBus | 先持久化后广播、增量重放 | 把 WS 当唯一状态 |
| npm 更新检查 | TUI 查询 registry 并提示新版本；Server 迁移前备份数据库 | 安装、重启和程序版本切换 |

## 5. 关键数据流

### 5.1 启动与初始化

```text
node app.js / node app.js tui
  → 启动受管 TUI，读取数据目录与配置
  → 启动 Server；开发模式另启动受管 Vite
  → 如需迁移已有数据库，先备份；打开业务库并执行迁移
  → 启动 Fastify（默认 127.0.0.1:3210）和本机 IPC
  → TUI 连接 IPC；未初始化时走本机向导
  → 首次沿用有效网络配置，可在高级设置修改监听地址和公网 URL
  → 日常查看状态、审批配对、撤销设备、查看日志、关闭服务
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
未认证浏览器 → POST /api/webauthn/authentication/options
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
普通项目会话 ──文件 / run_command──► CommandManager ──► 项目脚本 / PM2 CLI
聊天开发浮窗 ──开发 API──► 临时服务登记 ──► PTY / 隔离预览
服务运维弹窗 ◄──正式服务 API / 事件── PM2 观察与项目关联
通用的鉴权、策略、项目锁和审计在执行和资源访问时校验
```

- 关闭 / 最小化窗口只隐藏视图；主动关闭终端 Tab 经后端 `terminate` 终止资源，失败保留 Tab；文件 / Browser Tab 关闭不影响源资源。服务窗口无服务Tab，采用当前项目卡片/详情（ADR-031/042）。
- 同一 Terminal 可被多个客户端观看，交互输入需租约。
- 开发服务绑定终端执行，按项目或工作区核验。正式服务可由普通项目会话中的 PM2 命令建立，服务名含稳定项目 ID，正式进程的生命周期由守护进程管理。
- Tab 身份、来源、项目筛选、分组与去重规则见 [resource-views.md](../contracts/resource-views.md)。

### 5.5 临时服务、持久服务与结果入口

终端启动 dev → 核验该次执行与 loopback endpoint → 登记临时服务 → 服务窗口卡片 → 目标 ready 后 AI 预览卡片 → 点击打开隔离预览。终端源命令退出 / PTY 结束自动退登并撤销代理；ServiceRegistry 不另 spawn、不接管进程、不交 PM2。

M4 普通项目会话 → 文件工具读取项目脚本 → 通用命令构建和准备运行目录 → PM2 CLI 启动或更新 → 有限日志与实际访问核验。后端向模型提供同源 PM2 环境，并把实际服务状态和项目关系投影给「服务运维」。新服务使用 `namespace=larness` 和 `larness:<projectId>:<serviceKey>`，旧名称按原目标记录识别。正式与临时服务继续使用各自的资源、REST、事件和预览边界。见 [ADR-050](../adr/ADR-050-pm2-cli-deployment.md)。

文件工具结果附 scope / path 卡片，点击打开文件 Tab；可预览服务结果附 serviceId / 相对页面路径卡片，点击解析当前授权后打开 Browser Tab。卡片只打开视图，不重新执行工具、启动资源或自动开放端口。详细契约见 [services-preview.md](../contracts/services-preview.md)。

### 5.6 预览

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
├── apps/server/dist/           # Server、TUI、status、doctor
├── apps/server/drizzle/        # SQLite 迁移
├── apps/web/dist/              # Web 静态资源
└── node_modules/               # npm 安装的依赖

<dataDir>/                      # 独立于安装目录，0700
├── config.json
├── larness.db
├── secrets/                    # 加密凭据
├── sessions/                   # 保留旧独立工作区
│   └── global-terminal/workspace/  # 新会话的共享默认工作区
├── artifacts/<session-id>/
├── logs/
├── backups/
└── tmp/
```

默认数据目录使用 OS 标准用户数据目录（macOS `~/Library/Application Support/larness`，Linux `$XDG_DATA_HOME/larness`，Windows `%LOCALAPPDATA%\larness\Data`），可用 `LARNESS_DATA_DIR` 覆盖。关联的项目目录保留在原位置。共享默认工作区和历史独立工作区由 Larness 管理。

## 7. 仓库源码布局

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
- 验证在本地执行。macOS Apple Silicon 已验证，Windows / Ubuntu 待实机，见 [支持矩阵](../known-limitations.md)。
- 不假设 PTY、进程统计、PM2、开机自启在三平台一致；每项平台能力都要有单独验收记录。

## 10. 非目标

多租户、远程主机编排、Docker / K8s、Electron 原生窗口、WebRTC、完整第三方网页浏览器、无审批的主机管理员操作、OS 级强沙箱。

## 当前 Agent 执行结构

生产入口在 bootstrap 注册 26 个工具，注册表只向模型提供当前会话适用的工具。文件 4、计划 1、命令 1、终端 7、Git 10、临时开发服务 3。专用正式服务构建、发布和启停工具已撤回。

服务运维的人工启动/停止/重启按 [ADR-051](../adr/ADR-051-human-pm2-service-control.md) 经独立 REST 调用 ServiceOpsRuntime，在项目→服务锁内复核身份并控制已有 PM2 应用，使用资源操作表持久化幂等意图。该入口不依赖当前聊天，不增加模型工具；Agent 继续使用 run_command。

TurnQueue 默认最多同时执行两个不同会话，同一会话保持单个活跃 Turn。TurnRunner 组装系统约束、会话历史、项目指令、工具 schema、终端与 PM2 信息，调用 Provider，再把工具调用交给 ToolExecutor 和各资源 Manager。工具结果回填模型，直到返回答复、失败、取消或达到预算。默认预算为 30 步、50 次工具调用、10 分钟，上下文按估算 token 和窗口比例裁剪较旧消息。

模型请求和流式协议经 ProviderAdapter 适配，生产 resolver 接入 DeepSeek、GLM 和 OpenAI 兼容端点，测试使用 FakeProvider。上下文构建支持摘要压缩，模型和凭据在 Turn 创建时固定。

关键状态和事件在 SQLite 中持久化后通过 WebSocket 通知。浏览器负责服务端查询与窗口、导航、草稿等视图状态。命令按主机账户执行，文件工具的项目路径检查和命令策略不会构成 OS 沙箱。秘密由 SecretStore 管理并在受控执行层按需使用。

| 类别 | 模型工具 |
|---|---|
| 文件 | list_files、read_file、search_code、apply_patch |
| 任务计划 | update_plan |
| 通用命令 | run_command |
| 终端生命周期 | start_project_terminal、read_terminal_output、stop_project_terminal |
| 终端控制 | acquire_terminal_control、send_terminal_input、interrupt_terminal、release_terminal_control |
| Git 读取 | git_status、git_diff、git_log、git_branches |
| Git 修改 | git_add、git_commit、git_create_branch、git_switch_branch、git_pull、git_push |
| 临时服务与预览 | register_temporary_service、list_services、resolve_service_preview |

实际注册以 `apps/server/src/bootstrap/start.ts` 为准。命令与 PM2 的具体字段见 [命令上下文契约](../contracts/agent-command-context.md)，当前验证范围见 [M4-R0 验收](../../specs/050-deploy/acceptance-cli.md)。
