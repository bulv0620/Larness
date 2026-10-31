# Harness

单机、单工作空间、AI-first 的 Web IDE 与本机服务运维工作空间。

- 在一台装有 Node.js 的机器上启动，已授权浏览器可安全访问；
- 以对话驱动 Agent 读写项目、运行命令、管理终端 / 服务 / Git；
- 在本机预览、构建、部署并托管 Node.js 项目。

> **当前状态：S0 视觉 Demo 已实现（`D0-1`–`D0-8`），等待 `D0-9` 人类视觉验收。**
> 启动 Demo：`pnpm install && pnpm dev` → <http://localhost:5173>。
> 验收记录与截图：[specs/000-visual-demo/acceptance.md](specs/000-visual-demo/acceptance.md)。
> V1 定位为“可信开发机模式”：不声称对恶意项目脚本或任意 Shell 提供 OS 级沙箱。

## 文档地图

| 文档 | 作用 |
|---|---|
| [CONSTITUTION.md](CONSTITUTION.md) | 不可协商的工程与安全条款；冲突时的最高优先级 |
| [AGENTS.md](AGENTS.md) | 所有编码 Agent 的操作手册与工作循环 |
| [STATUS.md](STATUS.md) | 当前阶段、进行中的任务、最近变更 |
| [specs/ROADMAP.md](specs/ROADMAP.md) | 里程碑、任务依赖、验收门 |
| [larness.md](larness.md) | 产品 / 架构源设计 v3.0（冻结输入，只读参考） |
| [docs/architecture/overview.md](docs/architecture/overview.md) | 系统拓扑、进程边界、模块职责 |
| [docs/architecture/stack.md](docs/architecture/stack.md) | 冻结技术栈与依赖策略 |
| [docs/architecture/security.md](docs/architecture/security.md) | 信任模型、审批分级、失败关闭矩阵 |
| [docs/contracts/rest-api.md](docs/contracts/rest-api.md) | REST 约定与接口清单 |
| [docs/contracts/ws-events.md](docs/contracts/ws-events.md) | WebSocket 包络、序号与重放 |
| [docs/contracts/ipc.md](docs/contracts/ipc.md) | 本机 TUI ↔ Server 的 IPC 协议 |
| [docs/contracts/data-model.md](docs/contracts/data-model.md) | SQLite 表结构、迁移与保留策略 |
| [docs/process/workflow.md](docs/process/workflow.md) | Spec 生命周期、评审门、提交约定 |
| [docs/process/testing.md](docs/process/testing.md) | 测试分层与安全用例要求 |
| [docs/open-questions.md](docs/open-questions.md) | 尚未冻结的边界问题与默认方案 |
| [docs/glossary.md](docs/glossary.md) | 术语表 |

## 快速开始（当前 S0 Demo）

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm check          # Biome + 类型 + 单元测试
pnpm build
pnpm test:e2e
pnpm demo:shots     # 重新生成验收截图
```

Demo 数据来自 `MockGateway`；终端、浏览器预览、文件编辑均为静态 / 只读 Mock。

## 如何使用本仓库

人类：

1. 读 [CONSTITUTION.md](CONSTITUTION.md) 与 [STATUS.md](STATUS.md)。
2. 在 [specs/ROADMAP.md](specs/ROADMAP.md) 中选择下一个未阻塞的任务。
3. 把任务 ID 和对应 spec 路径交给 Agent，要求它按 [AGENTS.md](AGENTS.md) 执行。

Agent 的启动指令示例：

```text
请先完整阅读 AGENTS.md、CONSTITUTION.md、STATUS.md。
当前 S0 已实现，先由人类完成 D0-9 视觉验收；
通过后再按 specs/010-foundation/{spec,plan,tasks}.md 执行 M0-1。
```

## 当前仓库结构

```text
.
├── larness.md                  # 源设计（v3.0，冻结）
├── README.md / AGENTS.md / CONSTITUTION.md / STATUS.md
├── apps/
│   └── web/                    # React + Vite 视觉 Demo
├── packages/
│   ├── ui/                     # Button / Dropdown / Tooltip / Tabs 等原语
│   └── shared/                 # 领域类型、事件、Gateway 契约
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
    ├── 000-visual-demo/        # S0 视觉 Demo（已实现，待验收）
    ├── 010-foundation/         # M0 可信启动与认证
    ├── 020-workspace-agent/    # M1 项目 / 会话 / 最小 Agent
    ├── 030-dev-resources/      # M2 文件 / 终端 / Git / 窗口层（草案）
    ├── 040-services-preview/   # M3 服务与预览（草案）
    ├── 050-deploy/             # M4 部署闭环（草案）
    └── 060-extension/          # M5 多模型 / 自动化 / 更新（草案）
```

当前代码只有 `apps/web`、`packages/ui`、`packages/shared`；Server 与数据库在 M0-1 开始创建。

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

[larness.md](larness.md) 是 2026-10-30 冻结的产品需求、技术架构与边界约束文档（v3.0）。本仓库的 spec 与 ADR 由它派生；若两者冲突，以 [CONSTITUTION.md](CONSTITUTION.md) 与已冻结 ADR 为准，并回写差异。
