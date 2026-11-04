# Larness

单机、单工作空间、AI-first 的 Web IDE 与本机服务运维工作空间。

- 在一台装有 Node.js 的机器上启动，已授权浏览器可安全访问；
- 以对话驱动 Agent 读写项目、运行命令、管理终端 / 服务 / Git；
- 在本机预览、构建、部署并托管 Node.js 项目。

> **当前状态：S0、M0（macOS 范围）与 M1 已验收；M2 功能已实现，G2 候选待人类验收，当前进入问题修复阶段。M3 仍为草案。**
> 启动开发环境：`pnpm install && pnpm dev` → Server <http://127.0.0.1:3210/api/health> + Web <http://localhost:3210>，并直接进入 TUI。
> 当前进度见 [STATUS.md](STATUS.md)；M2 验收结果与已知问题见 [验收记录](specs/030-dev-resources/acceptance.md)。
> V1 定位为“可信开发机模式”：不声称对恶意项目脚本或任意 Shell 提供 OS 级沙箱。

## 文档地图

| 文档 | 作用 |
|---|---|
| [CONSTITUTION.md](CONSTITUTION.md) | 不可协商的工程与安全条款；冲突时的最高优先级 |
| [AGENTS.md](AGENTS.md) | 所有编码 Agent 的操作手册与工作循环 |
| [STATUS.md](STATUS.md) | 当前阶段、进行中的任务、最近变更 |
| [specs/ROADMAP.md](specs/ROADMAP.md) | 里程碑、任务依赖、验收门 |
| [larness.md](larness.md) | 产品 / 架构源设计 v3.0（架构冻结；产品名已统一为 Larness） |
| [docs/architecture/overview.md](docs/architecture/overview.md) | 系统拓扑、进程边界、模块职责 |
| [docs/architecture/stack.md](docs/architecture/stack.md) | 冻结技术栈与依赖策略 |
| [docs/architecture/security.md](docs/architecture/security.md) | 信任模型、审批分级、失败关闭矩阵 |
| [docs/contracts/rest-api.md](docs/contracts/rest-api.md) | REST 约定与接口清单 |
| [docs/contracts/ws-events.md](docs/contracts/ws-events.md) | WebSocket 包络、序号与重放 |
| [docs/contracts/ipc.md](docs/contracts/ipc.md) | 本机 TUI ↔ Server 的 IPC 协议 |
| [docs/contracts/resource-views.md](docs/contracts/resource-views.md) | 全局资源、Tab 归属、项目筛选与去重 |
| [docs/contracts/data-model.md](docs/contracts/data-model.md) | SQLite 表结构、迁移与保留策略 |
| [docs/process/workflow.md](docs/process/workflow.md) | Spec 生命周期、评审门、提交约定 |
| [docs/process/testing.md](docs/process/testing.md) | 测试分层与安全用例要求 |
| [docs/open-questions.md](docs/open-questions.md) | 尚未冻结的边界问题与默认方案 |
| [docs/glossary.md](docs/glossary.md) | 术语表 |

## 快速开始

```bash
pnpm install
pnpm dev            # 启动 Server（默认 3210，页面/API/WS）+ 内部 Vite，然后进入 TUI
pnpm check          # Biome + 类型 + 单元测试
pnpm build
pnpm test:e2e       # S0 Mock Demo E2E
pnpm test:e2e:auth  # 真实 server + 虚拟认证器：配对 / 注册 / 登录 / 撤销
pnpm test:e2e:prod  # 构建后由 Server 3210 托管 Web 的生产形态 E2E
pnpm test:smoke:init # 需先 build：临时目录/随机端口验证初始化重启与恢复
pnpm test:smoke:unified # 需先 build、Chromium 和 openssl：真实模式切换 / Passkey / HMR / HTTPS
pnpm demo:shots     # 重新生成验收截图
```

`pnpm dev` 的体验（ADR-023）：

```text
Larness · 控制面板      # 首次运行先进入初始化向导
状态：运行中
Web：http://localhost:3210
待配对 0 · 在线会话 0

› 配对
  设备
  日志
  审计
  退出并停止服务

↑↓ 选择 · Enter 打开 · p/d/l/a · r 刷新 · q 退出
```

- **TUI 是唯一前台入口**：Server / Vite 由 TUI supervisor 拉起；`q` 打开默认取消的退出确认，确认后停止全部；Ctrl+C、SIGTERM/SIGHUP 直接清理。退出恢复原终端画面和输入模式。
- 首次运行展示有效配置，确认后初始化；不设置管理员密码、不询问更新通道。需要改监听或访问地址时选择高级设置；环境变量控制的字段需修改环境变量。两种模式默认来源均为 `http://localhost:3210`，显式 `LARNESS_PUBLIC_URL` 会被沿用。
- 初始化保留已有配置；有效配置变化后 TUI 自动停止并重新启动受管服务，再进入仪表盘。中断恢复在下次启动监听前完成，失败则拒绝启动。
- 旧实例的历史密码哈希保留，但没有密码登录/恢复入口。开发期 IPC 保持协议号 1，参数变更直接更新源码与测试后统一构建（ADR-026）。
- 已有初始化数据时直接进入独立屏幕概览；`l` 打开日志，←/→ 切换 Server/子进程来源，↑/↓、PageUp/Down、Home/End 阅读，`r` 手动刷新，Esc 返回。`a` 打开审计；页面不会被后台输出顶走。
- 配对码仅在专用页面显示，Enter 返回概览、Esc 返回申请列表；设备撤销二次确认，结果停留在详情页。交互需 TTY 且 TERM 非 dumb，完整布局至少 80×24。
- `status` / `doctor` 仍可在 TUI 运行时从另一个终端执行：`node app.js status`、`node app.js doctor`。
- dev 与打包运行默认共用同一个数据目录、配置、模型凭据和设备记录；先退出当前 TUI，再切换模式，同一目录不能并发运行。`LARNESS_DATA_DIR` 仍可显式选择其他实例，程序不会自动合并数据目录。
- 两种模式都从配置的 Server 端口提供页面、API 和业务 WS；dev 在内部接入受管 Vite，内部端口自动分配且不写入配置；打包模式提供静态文件。HMR 需登录后才能连接。见 [017 spec](specs/017-unified-entry/spec.md)。
- 旧 dev 配置若为 `server.port=3210`、`publicUrl=http://localhost:5173`，关闭实例后一次性把原 config.json 的 `server.port` 改为 `5173`，保留其余字段与所有数据。以后两种模式都访问 `http://localhost:5173`；无需重初始化、重新配对或每次覆盖端口。若监听端口受环境变量控制，请对齐该环境变量。已一致的配置无需调整。
- 远程访问必须使用 HTTPS；反向代理需配置 `server.trustedProxies`，非 loopback 的明文 HTTP / WS 会返回 `HTTPS_REQUIRED`。

数据目录默认使用 OS 标准位置，可用 `LARNESS_DATA_DIR` 覆盖；`LARNESS_HOST` / `LARNESS_PORT` / `LARNESS_PUBLIC_URL` / `LARNESS_LOG_LEVEL` 覆盖配置。首次启动会在数据目录创建 `larness.db` 并执行迁移（WAL）；初始化只经本机 TUI / IPC，Web 不提供初始化入口。Web 默认使用真实本机 API（`/login`、`/pair`、工作台空态）。仅做 S0 Mock Demo 时使用 `VITE_USE_MOCKS=1 pnpm --filter @larness/web dev`，不是产品入口。

未选择项目时进入左侧“默认工作区”，可直接聊天、访问文件和使用终端。新建的未关联项目会话共享 `数据目录/sessions/global-terminal/workspace`；窗口和终端在切换默认会话、切项目后返回及刷新时保留。旧独立会话继续使用原目录，不自动搬移文件。

空闲的手动终端打开即可输入，优先使用本机账户默认 Shell；Tab 右侧菜单可交给 AI 或接管控制，双击 / F2 改名，＋新建，× 关闭并终止终端。关闭或最小化窗口保留终端；AI 输入审批保持不变。

真实模型 Key 在左侧“设置与模型”中添加，密文保存在 SQLite，AES-256-GCM 主密钥为数据目录 `secrets/master.key`（权限 0600），接口、日志与事件只返回掩码。已有密文时主密钥缺失或不匹配会拒绝启动，不自动重建；恢复时须使用匹配的数据库与原密钥。

构建后运行完整产品：

```bash
pnpm build
node app.js            # 启动 Server + 静态 Web，并进入 TUI
node app.js status     # 只读状态（TUI 运行时可另开终端）
node app.js doctor     # 自检
```

生产启动页显示 `Server http://localhost:3210` / `Web http://localhost:3210`；关闭 TUI 同样停止全部。生产形态认证 E2E：`pnpm test:e2e:prod`（需先 `pnpm build`）。

## 如何使用本仓库

人类：

1. 读 [CONSTITUTION.md](CONSTITUTION.md) 与 [STATUS.md](STATUS.md)。
2. 在 [specs/ROADMAP.md](specs/ROADMAP.md) 中选择下一个未阻塞的任务。
3. 把任务 ID 和对应 spec 路径交给 Agent，要求它按 [AGENTS.md](AGENTS.md) 执行。

Agent 的启动指令示例：

```text
请先完整阅读 AGENTS.md、CONSTITUTION.md、STATUS.md。
S0、M0（macOS 范围）与 M1 已验收；M2 处于问题修复与 G2 待验收阶段。
请以 STATUS.md、specs/ROADMAP.md 和当前任务卡为准，一次只处理一个任务。
```

## 当前仓库结构

```text
.
├── larness.md                  # 源设计（v3.0，冻结）
├── app.js                      # 稳定入口：启动 Server + Web 并进入 TUI；status / doctor
├── README.md / AGENTS.md / CONSTITUTION.md / STATUS.md
├── apps/
│   ├── server/                 # Fastify 5 Server、认证 / IPC、Agent 与资源管理
│   └── web/                    # React + Vite 工作台与 Mock Demo
├── packages/
│   ├── agent/                  # Agent 运行时、Provider、工具与审批
│   ├── resources/              # 文件 / 命令 / 终端 / Git 资源能力
│   ├── ui/                     # Button / Dropdown / Tooltip / Tabs 等原语
│   └── shared/                 # 领域类型、事件、错误码、配置与 Gateway 契约
├── e2e/                        # Playwright 验收用例
├── scripts/                    # 截图等开发脚本
├── docs/
│   ├── architecture/           # 拓扑、技术栈、安全基线
│   ├── contracts/              # REST / WS / IPC / 数据模型
│   ├── adr/                    # 冻结决策与新增 ADR 流程
│   ├── process/                # 工作流、测试策略
│   ├── open-questions.md
│   └── glossary.md
└── specs/
    ├── ROADMAP.md              # 全部里程碑与任务
    ├── README.md               # spec 编写规则
    ├── _templates/             # spec / plan / tasks 模板
    ├── 000-visual-demo/        # S0 视觉 Demo（已验收）
    ├── 010-foundation/         # M0 可信启动与认证
    ├── 020-workspace-agent/    # M1 项目 / 会话 / 最小 Agent
    ├── 030-dev-resources/      # M2 文件 / 终端 / Git / 窗口层（G2 待验收）
    ├── 040-services-preview/   # M3 服务与预览（草案）
    ├── 050-deploy/             # M4 部署闭环（草案）
    └── 060-extension/          # M5 多模型 / 自动化 / 更新（草案）
```

当前代码已包含数据库、认证、IPC、项目 / 会话 / Agent，以及文件编辑、命令执行、真实终端与 Git 管理。服务登记、隔离预览与 PM2 持久服务规划在 M3，尚未交付。

## 冻结技术栈（摘要）

pnpm workspace · Node.js ≥ 20.19 · TypeScript strict · React + Vite · Tailwind CSS · Zustand + TanStack Query · Fastify 5 · Zod · SQLite（better-sqlite3 + Drizzle）· Passkey / WebAuthn · WebSocket · node-pty + xterm.js · Monaco · PM2 · Vitest + Playwright · Biome。

完整说明与版本策略见 [docs/architecture/stack.md](docs/architecture/stack.md)。

## 明确非目标

- 业务多用户、角色、租户隔离；
- SSH 远程主机、Docker / Kubernetes 集群部署；
- Electron 原生窗口、WebRTC 远程桌面；
- 任意第三方网页的完整浏览器能力；
- 无审批的主机管理员操作；
- 对恶意 Shell / 项目脚本的 OS 级强隔离承诺。

## 源设计

[larness.md](larness.md) 是 2026-10-30 冻结的产品需求、技术架构与边界约束文档（v3.0）。本仓库的 spec 与 ADR 由它派生；若两者冲突，以 [CONSTITUTION.md](CONSTITUTION.md) 与已冻结 ADR 为准，并回写差异。2026-11-01 仅将产品名统一为 Larness（ADR-022），架构语义未修改。

E2E 默认端口被占用时，可设置 `LARNESS_E2E_PORT`（auth/prod）与 `LARNESS_E2E_WEB_PORT`（auth/demo）使用独立端口；测试仍使用临时数据目录。
