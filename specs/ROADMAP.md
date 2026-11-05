# 路线图与任务总表

> 状态：2026-10-31 初始化。任务状态：`todo | in_progress | blocked | review | done`。  
> 规则：只执行依赖全部 `done` 的最小任务；一次一个任务；里程碑门禁未过不进入下一阶段（人类明确并行除外）。

## 1. 里程碑

| 阶段 | 名称 | spec | 状态 | 门禁 |
|---|---|---|---|---|
| S0 | 视觉 Demo（纯前端 + Mock） | [000](000-visual-demo/spec.md) | `done` | G-S0 通过（2026-11-01） |
| M0 | 工程底座与可信启动 | [010](010-foundation/spec.md) | `done` | G0 通过（macOS 范围，2026-11-01）；Linux / Windows / CI 后续 |
| M1 | 项目、会话与最小 Agent | [020](020-workspace-agent/spec.md) | `done` | G1 通过（2026-11-01，人类验收） |
| M2 | 开发资源与窗口层 | [030](030-dev-resources/spec.md) | `done` | G2 于2026-11-05通过人类整体验收；范围与边界见030/closure.md |
| M3 | 开发服务与隔离预览 | [040](040-services-preview/spec.md) | `in_progress` | G-Spec-M3 通过（2026-11-05）；M3-0 进行中，G3 待验收 |
| M4 | 持久运行与版本发布 | [050](050-deploy/spec.md) | `draft` | G4 |
| M5 | 多模型、自动化与更新 | [060](060-extension/spec.md) | `draft` | G5 |

关键路径：

```text
D0-1 → … → D0-9 → M0-1 → … → M0-9 → M1-1 → … → M1-15
→ G-Spec-M2 → M2-0 → G-PoC-M2 → M2-1 → … → M2-8 → G-Spec-M3 → M3-0 → G-PoC-M3 → M3-1 → … → M3-6 → G-Spec-M4 → M4-0 → … → M4-4
→ M5-1 → … → M5-5
```

## 2. S0 视觉 Demo

目标：用真实前端栈构建可交互、可验收的视觉基线；数据全部来自 MockGateway，不实现后端。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| D0-1 | Web 工作区脚手架 | pnpm workspace、`apps/web`、`packages/ui`、`packages/shared`、Tailwind、Biome、Vitest、Playwright、MockGateway 骨架 | — | `done` |
| D0-2 | 应用外壳与三栏布局 | AppShell、TopBar、左侧栏、中央会话区、右侧资源栏骨架、窗口层挂载点 | D0-1 | `done` |
| D0-3 | 主题与视觉系统 | 语义 token、浅 / 深 / 跟随系统、字体层级、图标、菜单层级 | D0-2 | `done` |
| D0-4 | 对话时间线与输入区 | 消息、计划、工具卡片、产物卡片、审批卡片、Composer（上下文 / 模型 / 审批策略） | D0-2 | `done` |
| D0-5 | 右侧资源分区 | 文件 / 服务 / 终端 / Git 四分区、全部 / 单项 Tabs、独立折叠滚动、拖分隔线、双击均分、键盘调整 | D0-2 | `done` |
| D0-6 | 窗口层 | WindowManager、拖动 / 缩放 / 层级 / 置顶 / 最小化 / 最大化 / 关闭、顶部入口恢复 | D0-2 | `done` |
| D0-7 | 资源窗口内容 | 文件（Monaco 只读）、终端（fake 输出）、服务（状态 / 日志）、浏览器（iframe 占位）、Git Diff | D0-6 | `done` |
| D0-8 | 响应式、键盘与可访问性 | 窄屏降级、Ctrl+K / Ctrl+B / Esc、焦点可见、ARIA、无遮挡菜单 | D0-3 ~ D0-7 | `done` |
| D0-9 | Demo 验收与视觉基线 | Playwright 冒烟与截图、验收清单、人类验收记录 | D0-8 | `done` |

## 3. M0 工程底座与可信启动

目标：`node app.js` 可启动；本机 TUI 初始化；浏览器经 TUI 配对准入；`允许本次` 得短期会话，`始终允许` 必须注册 Passkey；所有业务接口默认拒绝。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| M0-1 | Server 与 workspace 扩展 | `apps/server`、`packages/{shared,agent,resources}` 占位、Fastify、统一脚本、CI、`/api/health` | D0-9 | `done` |
| M0-2 | 配置、数据目录与日志 | 数据目录解析、`config.json` + Zod、canonical origin / RP ID 推导、pino、`doctor` / `status` | M0-1 | `done` |
| M0-3 | SQLite、迁移与审计 | Drizzle schema、迁移器、WAL / 外键、审计、Passkey 表、repository 基类 | M0-2 | `done` |
| M0-4 | 本机 IPC 与 TUI 初始化 | UDS / Named Pipe、JSON 协议、init 流程、管理员凭据、TUI 骨架 | M0-3 | `done` |
| M0-5 | 配对申请与准入 | 配对状态机、TUI 审批、一次性码、allow_once 会话、trust enrollment | M0-4 | `done` |
| M0-6 | Passkey 注册与登录 | WebAuthn options / verify、challenge、设备 / credential、TUI 撤销 | M0-5 | `done` |
| M0-7 | 鉴权与传输安全 | Session / CSRF / Origin、限流、WS 鉴权、错误码、失败关闭用例 | M0-6 | `done` |
| M0-8 | Web 认证集成 | `/login`、`/pair`、Passkey 注册 / 登录、路由守卫、登出、撤销跳转 | M0-7 | `done` |
| M0-9 | 稳定入口与 M0 验收 | `app.js`、静态托管、优雅关闭、构建、M0 门禁测试 | M0-8 | `done` |

## 4. M1 项目、会话与最小 Agent

目标：登记项目、创建会话、发送任务，Agent 用文件工具读写项目并流式返回；刷新 / 重连恢复；切模型只影响下一轮。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| M1-1 | 项目登记与路径授权 | projects 表 / API、realpath 校验、Git 检测、删除仅解除关联 | G0 | `done` |
| M1-2 | 会话、Turn 与事件存储 | sessions / turns / agent_events、seq、重放 API、崩溃标记 | M1-1 | `done` |
| M1-3 | Provider 适配与 FakeProvider | ProviderAdapter、能力声明、FakeProvider、DeepSeek 适配 | G0 | `done` |
| M1-4 | 工具注册与审批引擎 | ToolRegistry、list / read / search / patch、L0–L2、项目写锁、审计 | M1-1, M1-2 | `done` |
| M1-5 | Turn Runner 与状态机 | QUEUED→…→COMPLETED、预算、取消、项目锁续租、事件写入 | M1-2, M1-3, M1-4 | `done` |
| M1-6 | 实时对话 UI | Query + WS、乐观 / 重放、工具卡片、审批卡片、错误态 | M1-5, M0-8 | `done` |
| M1-7 | 模型 Profile 与 SecretStore | 凭据加密、模型配置、下一轮切换、密钥脱敏 | M1-3 | `done` |
| M1-8 | M1 验收与 E2E | 项目 → 任务 → 刷新恢复 → 切模型 → 取消；G1 门禁 | M1-6, M1-7 | `done` |
| M1-9 | 项目目录选择器 | 本机只读目录浏览 API + 项目对话框目录树 | M1-1 | `done` |
| M1-10 | 流式对话与 Markdown | assistant.delta 广播、进行中状态、GFM 渲染 | M1-6, M1-7 | `done` |
| M1-11 | 工作区布局与工具分组 | header 品牌、侧栏重排、工具折叠、资源栏折叠、上下文用量 | M1-6, M1-7 | `done` |
| M1-12 | 自动会话标题 | 首条消息生成标题，保留手动重命名 | M1-2 | `done` |
| M1-13 | 侧栏右键操作 | 项目 / 会话右键重命名、归档 / 移除 | M1-2, M1-9 | `done` |
| M1-14 | 仅展示最终答复 | 中间助手段落折叠隐藏，只保留每 Turn 最终文本 | M1-6, M1-10 | `done` |
| M1-15 | 草稿会话 | 新建先显示本地草稿，首条消息后才创建后端会话 | M1-2, M1-6 | `done` |

## 4.1 G1 后初始化修复（2026-11-02）

按人类要求在 M2 前顺序执行 [015](015-initialization-hardening/spec.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| I0-1 | 日志真实按天保留 | G1 | `done` |
| I0-2 | 初始化配置保留与崩溃恢复 | I0-1、ADR-024 accepted | `done` |
| I0-3 | 已有凭据的主密钥启动校验 | I0-2、ADR-024 accepted | `done` |
| I0-4 | 向导简化、取消密码与配置自动应用 | I0-3、ADR-024/025 accepted | `done` |
| I0-5 | 日志清理与写入启动顺序 | I0-4 | `done` |
| I0-6 | 撤回 IPC v2 与开发数据重置 | I0-5、ADR-026 accepted | `done` |
| I0-7 | 配对码显示后回车返回 | I0-6 | `done` |

## 4.2 TUI 页面与交互统一（2026-11-02）

[016 spec](016-tui-experience/spec.md) / ADR-027 已于 2026-11-02 随人类“开始实现”指令通过 G-Spec-TUI，按 T0-1 → T0-2 → T0-3 在 M2 前顺序执行。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| T0-1 | 页面容器、输入所有权、概览与退出恢复 | I0-7 done；G-Spec-TUI / ADR-027 accepted | `done` |
| T0-2 | 配对与设备页面统一 | T0-1 | `done` |
| T0-3 | 日志/审计阅读页与整体验收 | T0-2 | `done`（2026-11-02 人类验收通过） |
| T0-4 | 初始化页文案清理（人类直接指定） | T0-3 | `done` |

## 4.3 统一开发/打包入口（已验收）

[017 spec](017-unified-entry/spec.md) / [ADR-028](../docs/adr/ADR-028-unified-dev-entry.md) 已获人类批准并按 U0-1→U0-2→U0-3 先于 M2 实施；2026-11-02 人类明确“验收通过”，切片关闭。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| U0-0 | 统一入口 ADR/spec/契约与评审包 | T0-3 done；人类授权文档 | `done`（仅文档） |
| U0-1 | 受管 Vite 与限定 HTTP/HMR 转发基础 | U0-0 done；G-Spec-U / ADR-028 accepted | `done`（基础模块；默认接线属 U0-2） |
| U0-2 | supervisor 接线与共享配置/统一初始化 | U0-1 | `done` |
| U0-3 | 同目录模式切换、真实 HMR 与整体交付 | U0-2 | `done`（2026-11-02 人类验收通过） |

## 5. M2 开发资源与窗口层（G2 已通过）

2026-11-05 人类已统一通过 M2 与全部纠错；下段为历史实施顺序，当前以done表格和[最终收尾](030-dev-resources/closure.md)为准。

2026-11-02 人类要求开始 M2，并确认按最新 spec；[spec](030-dev-resources/spec.md) / [plan](030-dev-resources/plan.md) / [tasks](030-dev-resources/tasks.md) / [ADR-029](../docs/adr/ADR-029-development-resource-execution.md) 已通过 G-Spec-M2。2026-11-03 人类在阅读 [PoC 证据](030-dev-resources/poc.md) 后明确开始 M2-1，G-PoC-M2 通过；M2-1 / M2-1b / M2-2 已获人类“下一步”或“继续”确认并标 done；人类“下一步”确认 M2-3 done；人类“下一步”确认 M2-3b done；人类明确开始 M2-4b，确认 M2-4 done；M2-4b 已验收 done；人类要求开始 M2-4c；M2-4c 已验收 done；人类确认继续 M2-4d；M2-4d 已验收 done；人类确认继续 M2-5；M2-5 已验收 done；M2-5b / M2-6 / M2-7 已完成，2026-11-03 M2-8曾为G2候选；2026-11-05全部后续纠错已统一验收，M2 / G2 done。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M2-P | M2 评审草案（仅文档） | 人类起草指令 | `done`（不代表门禁通过） |
| M2-0 | 原生 PTY、进程清理、文件与锁边界 PoC | G1 / 015 / 016 / 017 done；G-Spec-M2 / ADR-029 | `done` |
| M2-1 | FileManager、写锁与资源持久化底座 | M2-0；G-PoC-M2 | `done` |
| M2-1b | 文件监听与资源事件补拉 | M2-1 | `done` |
| M2-2 | Monaco 编辑、多 Tab 与冲突恢复 | M2-1b | `done` |
| M2-3 | CommandRunner 与受管进程协调 | M2-2 | `done` |
| M2-3b | Agent 命令工具、预算、取消与输出 UI | M2-3 | `done` |
| M2-4 | TerminalManager、PTY 与输入租约 | M2-3b | `done` |
| M2-4b | xterm 真实交互与双客户端观察 | M2-4 | `done` |
| M2-4c | Agent 项目开发终端工具、用途去重与生命周期 | M2-4b | `done` |
| M2-4d | AI 终端输入、中断、统一租约与人工接管 | M2-4c | `done` |
| M2-5 | GitManager、资源动作审批与 Agent 工具 | M2-4d | `done` |
| M2-5b | Git 资源区、Diff 与审批 UI | M2-5 | `done` |
| M2-6 | 真实资源窗口、来源/项目筛选、分组与布局恢复 | M2-2, M2-4b, M2-5b | `done` |
| M2-7 | 跨资源项目锁、fencing、并发与恢复验收 | M2-6 | `done` |
| M2-8 | M2 整体验收与 G2 | M2-7 | `done`（2026-11-05人类验收） |

## M2 纠错

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M2-9 | [项目窗口、浮栏与终端交互修正](031-project-windows/spec.md) | M2-7 done；人类直接指令 | `done`（2026-11-04） |
| M2-10 | [共享默认工作区](032-default-workspace/spec.md) | M2-9 done；人类确认共享目录 | `done`（2026-11-04） |
| M2-11 | [纯终端体验](033-terminal-experience/spec.md) | M2-10 done；人类要求继续优化 | `done`（2026-11-04） |
| M2-12 | [右侧资源区简化](034-resource-sidebar/spec.md) | M2-11 done；人类直接要求 | `done`（2026-11-04） |
| M2-13 | [固定默认项目](035-default-project/spec.md) | M2-12 done；人类直接要求 | `done`（2026-11-04） |

| M2-14 | [真实任务计划](036-conversation-experience/spec.md) | M2-13 done；用户批准 | `done` |
| M2-15 | [紧凑对话区重构](036-conversation-experience/spec.md) | M2-14 | `done`（2026-11-04） |

| M2-16 | [对话区主题统一](037-conversation-theme/spec.md) | M2-15 done；用户直接要求 | `done`（2026-11-04） |

| M2-17 | [消息框与紧凑审批](038-message-bubbles/spec.md) | M2-16 done；用户直接要求 | `done`（2026-11-05人类验收） |

| M2-18 | [消息边缘模糊过渡](039-chat-edge-blur/spec.md) | M2-17 done；用户截图指定 | `done`（2026-11-05人类验收） |

| M2-19 | [审批盾牌与上下文圆环](041-composer-controls/spec.md) | M2-18 done；用户直接要求 | `done`（2026-11-05人类验收） |

| M2-20 | [终端空态与历史入口](042-terminal-entry/spec.md) | M2-19 done；用户确认 | `done`（2026-11-05人类验收） |

| M2-21 | [Agent 关闭终端同步 Tab](043-agent-terminal-close/spec.md) | M2-20 done；用户直接要求 | `done`（2026-11-05人类验收） |

| M2-22 | [Agent 终端保留 Shell](044-agent-shell/spec.md) | M2-21 done；用户直接要求 | `done`（2026-11-05人类验收） |

| M2-23 | [欢迎区与建议](045-workspace-polish/spec.md) | M2-22 done | `done`（2026-11-05统一验收） |
| M2-24 | 窗口关闭与动画 | M2-23 | `done`（2026-11-05统一验收） |
| M2-25 | 完全自主策略 | M2-24 | `done`（2026-11-05统一验收） |
| M2-26 | 互斥侧栏与 Git 精简 | M2-25 | `done`（2026-11-05统一验收） |

| M2-27 | [Git 文件行动作](046-git-file-actions/spec.md) | M2-26 / M2-24b done；用户直接要求 | `done`（2026-11-05统一验收） |

| M2-28 | [Git 刷新反馈收敛](047-git-feedback/spec.md) | M2-27 done；用户直接要求 | `done`（2026-11-05统一验收） |

| M2-24b | 最小化位移/取消竞态修正 | M2-26 | `done`（2026-11-05统一验收） |
| M2-29 | [M2文档收尾与合并发布](030-dev-resources/closure.md) | M2-28；人类通过G2并授权发布 | `done`（仅文档/交付） |

## 5.1 资源生命周期与阶段边界文档任务

2026-11-02 人类明确产品规则并要求补文档；ADR-030 accepted，R0-0 为单个文档任务。新增 / 同步资源视图、临时 / 持久服务契约、M2/M3 spec / plan / tasks / review 与历史设计修订入口。仅文档完成，不启动功能实现、不宣称 G-Spec / G2 / G3 通过。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| R0-0 | 资源生命周期、两类服务与结果入口文档同步 | 人类明确规则及文档指令 | `done`（仅文档） |
| R0-1 | [M3/M4边界与自主部署文档](048-service-deploy-boundary/spec.md) | G2 done；用户明确决定 | `done`（仅文档；M3/M4仍draft） |

## 6. M3 开发服务与隔离预览（实施中）

2026-11-05 人类按[评审包](040-services-preview/review.md)推荐批准 G-Spec-M3：040 spec `ready`、[ADR-043](../docs/adr/ADR-043-development-preview-authorization.md) `accepted`、Q-002/Q-026 方案确认；仅授权先做 M3-0，G-PoC-M3 通过后才 M3-1。远程独立注册域 HTTPS 实测延后至后续上线实验，本阶段标未验证。M3 不含 PM2 或正式运行，不依赖 Q-003/Q-027。详 [spec](040-services-preview/spec.md)/[plan](040-services-preview/plan.md)/[tasks](040-services-preview/tasks.md)/[review](040-services-preview/review.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M3-0 | 开发执行身份与隔离预览PoC | G2；G-Spec-M3；Q-002/Q-026方案 | `in_progress` |
| M3-1 | 临时登记/源退出退登/日志与事件 | M3-0；G-PoC-M3 | `todo` |
| M3-2 | 当前项目服务卡片/详情/关联日志 | M3-1 | `todo` |
| M3-3 | PreviewRegistry/HTTP/WS固定上游 | M3-1 | `todo` |
| M3-3b | 预览隔离与生命周期安全矩阵 | M3-3 | `todo` |
| M3-4 | Browser/Agent卡片/HMR/开发API | M3-2/M3-3b | `todo` |
| M3-6 | 开发预览整体验收与G3 | M3-4 | `todo` |

编号迁移（非活动任务，不计完成）：旧M3-5的PM2 PoC/持久运行移至M4-0/M4-3；旧M3-5b的人/AI动作移至M4-3b。M3-6不再依赖迁出项，旧S10/S11移至M4 D9/D10。

## 7. M4 持久运行与版本发布（草案）

全部PM2交付/持久服务/构建发布在一个阶段闭环；autonomous从登记、构建、部署到启停/支持的恢复均无人工步骤，计划完整性/真实授权/审计仍必须。详[spec](050-deploy/spec.md)/[plan](050-deploy/plan.md)/[tasks](050-deploy/tasks.md)/[review](050-deploy/review.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M4-0 | PM2交付/命名空间/退出恢复PoC | G3；G-Spec-M4；Q-003/Q-027 | `todo` |
| M4-1 | Validate/Build/Artifact/Plan | M4-0 | `todo` |
| M4-2 | 策略授权与条件人工审批 | M4-1 | `todo` |
| M4-3 | PM2持久运行/Apply/健康/版本/对账 | M4-2 | `todo` |
| M4-3b | 持久服务人/AI动作与卡片日志 | M4-3 | `todo` |
| M4-4 | 正式发布/恢复/策略整体验收G4 | M4-3b | `todo` |

## 8. M5 扩展与加固（草案）

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-1 | GLM / 多 Provider、能力矩阵、上下文压缩 | G4 | `todo` |
| M5-2 | Scheduler：Cron、JS / Agent Job、JobRun、限流 | G4 | `todo` |
| M5-3 | Launcher / Updater、签名、UpdateLock、回滚 | G4 | `todo` |
| M5-4 | Windows / Linux PoC、打包与安装说明 | M5-1 ~ M5-3 | `todo` |
| M5-5 | 安全加固、发布验收清单、文档定稿 | M5-4 | `todo` |

## 9. 门禁

### G-S0 视觉 Demo

- 对齐 `larness.md` 7.1 六条：三栏 / 主题 / 右栏分区 / 红黄绿浮窗 / 输入框聚焦 / Mock 对话与审批；
- 无底部 Dock、无模拟系统标题栏、无最左侧活动栏；
- 桌面 1440×900 与窄屏各有一组截图；人类确认。
- **状态：通过（2026-11-01）**。

### G0 可信启动与认证

对应 `larness.md` 42.1：

- 未初始化时业务 API 不开放；初始化只经本机通道；
- 未授权客户端只能访问配对页；REST / WS / 静态资源均无法读取数据；
- 配对码绑定申请、限时、限次、一次消费；并发兑换只有一个成功；
- `允许本次` 过期不可重用；`始终允许` 必须完成 Passkey 注册，未完成不创建设备 / 会话；
- Passkey 登录、撤销、challenge 重放 / 过期、错误 Origin、IP 来源均有测试；
- 不签发长期设备 Token / refresh token；
- TUI 关闭、页面刷新、断网不影响后台 Agent / 服务；
- TLS / Cookie / CSRF / Origin / WS 鉴权安全用例通过。

### G1 工作区与 Agent

对应 42.2 前半：

- DeepSeek 至少一个可用的流式工具调用场景；FakeProvider 覆盖状态机；
- 同会话并发 Turn 被拒绝或排队；
- 文件版本冲突不静默覆盖；
- 断线重放无缺口、无重复；
- 取消后不再产生新工具调用；
- 切模型只影响下一 Turn。

**状态：通过（2026-11-01，人类验收）。** 记录见 [M1 acceptance](../specs/020-workspace-agent/acceptance.md)。

### G-Spec-M2 / G-PoC-M2 已通过（2026-11-03）

- 先人类确认 030 spec / plan / tasks、资源契约和 ADR-029，含 Agent 项目 dev 终端、开发进程与源码写锁保证边界、Git 操作范围及回放限额，才能启动 M2-0；
- M2-0 提供真实 PTY / built 寻址、进程树清理、锁失效 / 重启、文件竞争 / 监听、重叠根冲突域证据；人类确认 G-PoC-M2 后才能启动 M2-1；
- PoC 失败不得静默改用非交互输出冒充终端，范围变更回到评审。

### G2 开发资源（细化草案）

- A1–A31 自动化与真实资源证据齐全；文件树 / Monaco 编辑 / Git Diff 可用，版本冲突保留草稿且不静默覆盖；
- Agent 真实执行测试命令，输出有界、超时 / 取消停止受管进程；模型离线时资源操作可用；
- 终端多 Tab / 项目筛选 / 窗口关闭或最小化 / 刷新恢复不重建 PTY；主动关闭终端 Tab 则真实终止，失败保留、其他客户端同步终态；两独立认证客户端观察同一终端，只有当前租约可输入 / resize；
- Agent / 文件 / Git 受管源码写作业从首次接入即执行共同项目锁；dev / 交互终端的非串行写边界按 ADR-029 明确；同根 / 重叠根受保护，无重叠的跨项目可并发；旧 fencing 不可续租 / 写 / 释放新锁；
- Agent 为前后端分别创建项目终端 Tab，用途去重、有界读取 / 显式停止；已交付终端与 Turn 生命周期独立，运行时可继续编辑，不宣称服务 ready；
- Git 远端动作逐次审批、参数 / 仓库快照绑定、幂等不重复副作用；
- 重启标原 PTY / 命令中断，未知旧进程未清理前不允许冲突写；TUI 退出清理受管进程；
- check / build / Demo / auth / prod / 初始化 / 统一入口 / TUI 回归通过，真实 macOS dev / built 冒烟及人类 UI / 安全验收通过；其他平台仅据实记录。

**状态：G2 已于2026-11-05通过人类整体验收；M2-0～28及M2-24b均done。已知边界保留，见[最终收尾](030-dev-resources/closure.md)。**

### G-Spec-M3 已通过 / G-PoC-M3（待确认）

- G-Spec-M3（2026-11-05）：人类按 040 评审包推荐批准 ADR-043、来源/票据/执行身份/loopback 范围及残余风险与 PoC 证据标准；仅允许 M3-0。
- 远程独立注册域 HTTPS 实测延后至后续上线实验（人类决定）；G-PoC 按已确认范围评审，远程项明确标未验证，不得宣称已支持。
- G-PoC：M3-0提供真实资源与安全矩阵证据，冻结精确身份适配/Cookie协议/时限/平台支持；获人类确认后才能M3-1。
- 失败/新依赖/范围变化回评审，不能用文档完成代替批准。

### G3 开发服务与隔离预览

- S1–S9/S12–S18真实证据：已启动开发进程登记/日志/卡片、HTTP/WS/HMR与开发API；Ctrl+C后Shell仍活但服务退登，旧流失效，端口复用不串绑；
- 独立来源/Cookie/CSP/票据/SSRF/未知状态失败关闭；当前项目卡片/详情无服务Tab/项目切换，窗口隐藏无启停；
- 自主合法登记/预览无人工停等，未鉴权/非法目标仍拒绝，关键事件/审计真实；
- 不含PM2；Q-003/Q-027在M4解决，不以正式部署未交付阻塞G3。

### G4 持久运行与版本发布

- D1–D12：隔离PM2交付/运行/日志/实际对账、首次部署/版本替换/健康/记录/支持的恢复完整闭环；
- 计划/产物/目标/时效/锁fencing不可篡改，失败/取消/未知状态不伪报成功，不重复spawn或误操作无关应用；
- 标准/严格按风险审批，只读拒绝写；autonomous全流程无人工审批/确认，记录策略授权、不伪造人工批准；
- Q-003/Q-027明确且真实验证，其他平台按证据披露。

### G5 发布候选

- 自动检查 / 手动安装更新；任务运行中不强制更新；
- 签名校验、失败回滚、备份恢复演练；
- 三平台 PoC 结果与支持范围公开；
- `larness.md` 31 / 42.3 清单通过。

## 10. 任务卡维护

- 开始任务：`todo → in_progress`，在 `STATUS.md` 登记。
- 完成：更新 `tasks.md`、本节状态、`STATUS.md`，提交。
- 阻塞：`blocked` + 原因 + 需要谁决策；解除后回到 `todo`。
- 新增 / 拆分任务：先改本表与对应 `tasks.md`，保持 ID 稳定；不使用“临时任务”绕过依赖。
