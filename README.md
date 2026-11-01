# Larness

单机、单工作空间、AI-first 的 Web IDE 与本机服务运维工作空间。

- 在一台装有 Node.js 的机器上启动，已授权浏览器可安全访问；
- 以对话驱动 Agent 读写项目、运行命令、管理终端 / 服务 / Git；
- 在本机预览、构建、部署并托管 Node.js 项目。

> **当前状态：S0 视觉 Demo 已验收（G-S0 通过）；M0-1 ~ M0-9 实现完成，G0 自动化通过，等待人工安全评审与真机验收。**
> 启动开发环境：`pnpm install && pnpm dev` → Server <http://127.0.0.1:3210/api/health> + Web <http://localhost:5173>，并直接进入 TUI。
> 验收记录与截图：[specs/000-visual-demo/acceptance.md](specs/000-visual-demo/acceptance.md)。
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

## 快速开始（S0 已验收，M0 进行中）

```bash
pnpm install
pnpm dev            # 启动 Server(3210，仅 API/WS) + Vite(5173，前端)，然后进入 TUI
pnpm check          # Biome + 类型 + 单元测试
pnpm build
pnpm test:e2e       # S0 Mock Demo E2E
pnpm test:e2e:auth  # 真实 server + 虚拟认证器：配对 / 注册 / 登录 / 撤销
pnpm test:e2e:prod  # 构建后由 Server 3210 托管 Web 的生产形态 E2E
pnpm demo:shots     # 重新生成验收截图
```

`pnpm dev` 的体验（ADR-023）：

```text
Larness
✓ 数据目录 /path/to/data
✓ Server  http://localhost:3210
✓ Web     http://localhost:5173
✓ IPC     /path/to/data/ipc

Larness 初始化          # 首次运行进入向导
...
? Enter 刷新 / p 配对 / d 设备 / l 日志 / q 退出（停止服务） / s 关闭 server:
```

- **TUI 是唯一前台入口**：Server / Vite 由 TUI supervisor 拉起；关闭 TUI（`q`、Ctrl-C、SIGTERM）会优雅停止全部，不留后台进程。
- 首次运行按向导初始化；开发模式 `publicUrl` 默认 `http://localhost:5173`，直接接受即可让 Passkey 正常工作。
- 已有初始化数据时直接进入仪表盘；`l` 查看 Server 日志与 Vite 输出。
- `status` / `doctor` 仍可在 TUI 运行时从另一个终端执行：`node app.js status`、`node app.js doctor`。
- 开发与生产请使用不同的 `LARNESS_DATA_DIR`，避免 canonical origin 混用。
- 开发模式下 3210 只提供 API / WS，前端只在 5173；构建后的生产模式才由 3210 同时托管前端。
- 常见错误：开发时用 5173 初始化，之后直接 `node app.js`，数据目录里的 `publicUrl` 仍是 5173，而生产静态 Web 在 3210。TUI 会拒绝启动并提示 origin 不一致。解决方式：用独立的生产数据目录（初始化时 publicUrl 留空），或设置 `LARNESS_PORT=5173` 让生产 Web 也监听 5173。
- 远程访问必须使用 HTTPS；反向代理需配置 `server.trustedProxies`，非 loopback 的明文 HTTP / WS 会返回 `HTTPS_REQUIRED`。

数据目录默认使用 OS 标准位置，可用 `LARNESS_DATA_DIR` 覆盖；`LARNESS_HOST` / `LARNESS_PORT` / `LARNESS_PUBLIC_URL` / `LARNESS_LOG_LEVEL` 覆盖配置。首次启动会在数据目录创建 `larness.db` 并执行迁移（WAL）；初始化只经本机 TUI / IPC，Web 不提供初始化入口。Web 默认使用真实本机 API（`/login`、`/pair`、工作台空态）。仅做 S0 Mock Demo 时使用 `VITE_USE_MOCKS=1 pnpm --filter @larness/web dev`，不是产品入口。

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
S0 已验收，M0-1 ~ M0-9 实现完成；G0 人工验收见 specs/010-foundation/acceptance.md。
```

## 当前仓库结构

```text
.
├── larness.md                  # 源设计（v3.0，冻结）
├── app.js                      # 稳定入口：启动 Server + Web 并进入 TUI；status / doctor
├── README.md / AGENTS.md / CONSTITUTION.md / STATUS.md
├── apps/
│   ├── server/                 # Fastify 5 Server（M0-1：health / 错误契约 / 请求 ID）
│   └── web/                    # React + Vite 视觉 Demo
├── packages/
│   ├── agent/                  # Agent 运行时占位（M1）
│   ├── resources/              # 文件 / 终端 / Git / 服务占位（M2）
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
    ├── 030-dev-resources/      # M2 文件 / 终端 / Git / 窗口层（草案）
    ├── 040-services-preview/   # M3 服务与预览（草案）
    ├── 050-deploy/             # M4 部署闭环（草案）
    └── 060-extension/          # M5 多模型 / 自动化 / 更新（草案）
```

当前代码包含 `apps/web`、`apps/server`、`packages/{shared,ui,agent,resources}`；数据库、认证与 IPC 随 M0 后续任务创建。

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
