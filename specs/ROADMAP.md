# 路线图与任务总表

> 导航见 [规格与工程入口](README.md)。任务状态：`todo | in_progress | blocked | review | done | dropped`；`dropped` 表示经人类确认不再执行，保留任务 ID 与原因。
>
> 规则：只执行依赖全部 `done` 的最小任务；一次一个任务；里程碑门禁未过不进入下一阶段（人类明确并行除外）。

## 1. 里程碑

| 阶段 | 名称 | spec | 状态 | 门禁 |
|---|---|---|---|---|
| S0 | 视觉 Demo（纯前端 + Mock） | [000](000-visual-demo/spec.md) | `done` | G-S0 通过（2026-11-01） |
| M0 | 工程底座与可信启动 | [010](010-foundation/spec.md) | `done` | G0 通过（macOS 范围，2026-11-01）；其他平台见发布后跟踪 |
| M1 | 项目、会话与最小 Agent | [020](020-workspace-agent/spec.md) | `done` | G1 通过（2026-11-01，人类验收） |
| M2 | 开发资源与窗口层 | [030](030-dev-resources/spec.md) | `done` | G2 于2026-11-05通过人类整体验收；范围与边界见030/closure.md |
| M3 | 开发服务与隔离预览 | [040](040-services-preview/spec.md) | `done` | G3 人类验收通过（2026-11-05）；M3-0～M3-6 全部 done；远程 HTTPS 延后并标未验证 |
| M4 | 持久运行与版本发布 | [050](050-deploy/spec.md) | `done` | G4 于 2026-11-07 通过人类验收，见 [M4 收尾](050-deploy/closure.md) |
| M5 | 多模型、自动化与更新 | [060](060-extension/spec.md) | `done` | G5 条件通过（2026-11-08） |
| M6 | 运行时效率与上下文预算 | [070](070-runtime-efficiency/spec.md) | `ready` | G-Spec-M6 通过（2026-11-11，D1–D7 确认、ADR-057 accepted）；G-M6 待实现验收 |

关键路径：

```text
D0-1 → … → D0-9 → M0-1 → … → M0-9 → M1-1 → … → M1-15
→ G-Spec-M2 → M2-0 → G-PoC-M2 → M2-1 → … → M2-8 → G-Spec-M3 → M3-0 → G-PoC-M3 → M3-1 → … → M3-6 → … → M3-11 → M4-P → G-Spec-M4 → M4-0 → G-PoC-M4 → M4-1 → … → M4-4
→ M5-1a → M5-1b → M5-1c → M5-1e → M5-1d → M5-2-1 → M5-2-2 → M5-2-3 → M5-2-4 → M5-3-1 → M5-3-2 → M5-3-3 → M5-3-4 → M5-4-1 → M5-5 → M5-F1 / M5-F2 / M5-F3
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

## 6. M3 开发服务与隔离预览（已验收）

2026-11-05 人类按[评审包](040-services-preview/review.md)推荐批准 G-Spec-M3：040 spec `ready`、[ADR-043](../docs/adr/ADR-043-development-preview-authorization.md) `accepted`、Q-002/Q-026 方案确认；仅授权先做 M3-0，G-PoC-M3 通过后才 M3-1。远程独立注册域 HTTPS 实测延后至后续上线实验，本阶段标未验证。M3 不含 PM2 或正式运行，不依赖 Q-003/Q-027。详 [spec](040-services-preview/spec.md)/[plan](040-services-preview/plan.md)/[tasks](040-services-preview/tasks.md)/[review](040-services-preview/review.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M3-0 | 开发执行身份与隔离预览PoC | G2；G-Spec-M3；Q-002/Q-026方案 | `done`（G-PoC 2026-11-05） |
| M3-1 | 临时登记/源退出退登/日志与事件 | M3-0；G-PoC-M3 | `done`（2026-11-05） |
| M3-2 | 当前项目服务卡片/详情/关联日志 | M3-1 | `done`（2026-11-05） |
| M3-3 | PreviewRegistry/HTTP/WS固定上游 | M3-1 | `done`（2026-11-05） |
| M3-3b | 预览隔离与生命周期安全矩阵 | M3-3 | `done`（2026-11-05） |
| M3-4 | Browser/Agent卡片/HMR/开发API | M3-2/M3-3b | `done`（2026-11-05） |
| M3-6 | 开发预览整体验收与G3 | M3-4 | `done`（G3 2026-11-05） |

编号迁移（非活动任务，不计完成）：旧M3-5的PM2 PoC/持久运行移至M4-0/M4-3；旧M3-5b的人/AI动作移至M4-3b。M3-6不再依赖迁出项，旧S10/S11移至M4 D9/D10。

## 6.1 G3 后纠错与工作区交互修正

2026-11-06 用户确认 M3-7～M3-11 已验收。 [M3 收尾记录](040-services-preview/closure.md#g3-后工作区优化验收)

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M3-7 | [项目会话状态、折叠与浮栏层级](049-workspace-sidebar/spec.md) | G3 done，用户直接指令 | `done` |
| M3-8 | [任务结束后停止计划动画](036-conversation-experience/spec.md#m3-8-任务结束后的计划显示) | M2-14、M3-7 done，用户直接反馈 | `done` |
| M3-9 | [任务结束后显示成果](036-conversation-experience/spec.md#m3-9-任务结束后显示成果) | M2-15、M3-8 done，用户直接指令 | `done` |
| M3-10 | [Agent 工具描述与执行契约](051-agent-tool-contract/spec.md) | G3 done，用户直接指令 | `done` |
| M3-11 | [工作区前端交互优化](052-workspace-polish/spec.md) | M3-10 done，用户直接指令 | `done` |
| M3-12 | [本机预览默认开启](040-services-preview/spec.md#m3-12-本机预览默认开启) | M3-6 done，用户直接确认 | `done`（2026-11-13 用户验收） |

## 7. M4 持久运行与版本发布

当前按 ADR-050 通过普通会话命令完成 PM2 构建、部署和运维，系统提供环境与项目关联。autonomous 对已授权命令免人工步骤，命令授权、项目锁和审计继续执行。M4-1～M4-3b 保留为旧方案记录。详[spec](050-deploy/spec.md)/[plan](050-deploy/plan.md)/[tasks](050-deploy/tasks.md)/[review](050-deploy/review.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M4-P | [技术评审材料](050-deploy/review.md) | G3、M3-11 完成；用户要求开启 M4 | `done`（仅材料） |
| M4-0 | PM2全局初始化/命名空间/退出恢复PoC | M4-P；G-Spec-M4 | `done`（G-PoC-M4 2026-11-06），见[实测](050-deploy/poc.md) |
| M4-1 | Validate/Build/Artifact/Plan | M4-0；G-PoC-M4 | `done`（2026-11-06，见[验收](050-deploy/acceptance-m4-1.md)） |
| M4-2 | 策略授权与条件人工审批 | M4-1 | `done`（2026-11-06，见[验收](050-deploy/acceptance-m4-2.md)） |
| M4-3 | PM2持久运行/Apply/健康/版本/对账 | M4-2 | `done`（2026-11-06，见[验收](050-deploy/acceptance-m4-3.md)） |
| M4-3b | 服务运维页与独立运维 Agent 工具 | M4-3 | `done`（2026-11-06，见[验收](050-deploy/acceptance-m4-3b.md)） |
| M4-R0 | [PM2 命令部署与项目关联](050-deploy/spec.md) | M4-3b done；用户直接指令 | `done` |
| M4-R1 | 服务运维 UI 一致性与人工启停 | M4-R0 已实现；用户直接指令 | `done`（见[验收](050-deploy/acceptance-ui-control.md)） |
| M4-R2 | 人工控制 HTTP、项目日志与实例说明纠错 | M4-R1 人工验收反馈；用户直接指令 | `done`（见[验收](050-deploy/acceptance-service-fixes.md)） |
| M4-R3 | 系统服务生命周期契约 | M4-R2 已实现；用户直接指令 | `done`（见[验收](050-deploy/acceptance-lifecycle-contract.md)） |
| M4-R4 | 已删除 PM2 服务退出当前列表 | M4-R3 已实现；人类验收反馈 | `done`（见[验收](050-deploy/acceptance-deleted-service-list.md)） |
| M4-4 | 正式发布/恢复/策略整体验收G4 | M4-R0～R4 | `done`（G4 通过，见[收尾](050-deploy/closure.md)） |

## 8. M5 扩展与加固

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-1a | [DeepSeek 官方目录、模型与档位选择](061-deepseek-integration/spec.md)（A1–A4、A8–A10） | G4；061 spec ready | `done`（2026-11-07 人类验收） |
| M5-1b | 思考模式工具续跑与推理数据 PoC 门禁（A5、A11） | M5-1a | `done`（2026-11-07 人类验收） |
| M5-1c | 单次请求用量与上下文圆环（A6、A7） | M5-1a | `done`（2026-11-07 人类验收，随 M5-1d 关闭） |
| M5-1e | 思考过程与统一执行过程区（A12） | M5-1b | `done`（2026-11-07 人类验收） |
| M5-1d | [多 Provider、能力矩阵与上下文压缩](063-multi-provider/spec.md) | M5-1a；G-Spec | `done`（2026-11-07 人类验收） |
| M5-1d-1 | Provider 注册表、GLM / 兼容适配器与端点安全 | M5-1d ready | `done`（2026-11-07 人类验收） |
| M5-1d-2a | 目录分组与凭据绑定（服务端） | M5-1d-1 | `done`（2026-11-07 人类验收） |
| M5-1d-2b | 多 Key / Provider 选择 UI | M5-1d-2a | `done`（2026-11-07 人类验收） |
| M5-1d-2d | GLM 思考模式 | M5-1d-2b | `done`（2026-11-07 人类验收） |
| M5-1d-2c | 自定义兼容端点 | M5-1d-2d | `done`（2026-11-07 人类验收） |
| M5-2 | [Scheduler：Cron、JS / Agent Job、JobRun、限流](064-scheduler/spec.md) | G4；064 spec ready | `done`（2026-11-08 当前范围） |
| M5-2-1 | 调度核心、数据模型、脚本任务与 REST | 064 ready | `done` |
| M5-2-2 | Agent 定时任务与策略快照 | M5-2-1 | `done` |
| M5-2-3 | 自动化任务 UI、通知与运行历史 | M5-2-2 | `done` |
| M5-2-4 | 调度整体验收（时区 / 恢复 / 安全） | M5-2-3 | `done`（2026-11-08 当前范围） |
| M5-3 | [npm 分发、TUI 版本提示与升级备份](065-launcher-updater/spec.md) | G4；065 spec ready | `done`（2026-11-08 首次 npm 发布） |
| M5-3-1 | npm 包、发布模式与安装冒烟 | 065 ready | `done` |
| M5-3-2 | TUI 新版本提示 | M5-3-1 | `done` |
| M5-3-3 | 升级前数据库备份与降级保护 | M5-3-1 | `done` |
| M5-3-4 | 发布文档与整体验收 | M5-3-2、M5-3-3 | `done` |
| M5-4 | [跨平台安装与运行 PoC](066-cross-platform/spec.md) | M5-1a ~ M5-1c、M5-2、M5-3 | `done`（人类确认 macOS 当前范围；Windows/Ubuntu 承诺保留，发布后跟踪） |
| M5-4-1 | 本地冒烟与三端验收表 | 066 ready | `done`（CI 已删除；本地 macOS 通过） |
| M5-5 | [安全复核、发布清单与文档定稿](067-release-hardening/spec.md) | M5-4 | `done`（G5 条件通过） |
| M5-5-1 | 安全复核清单与残余风险 | 067 spec ready | `done` |
| M5-5-2 | 人工发布 / 升级 / 回滚清单 | M5-5-1 | `done` |
| M5-5-3 | 支持矩阵、已知限制与安装文档定稿 | M5-5-1 | `done` |
| M5-5-4 | G5 验收记录与索引同步 | M5-5-2、M5-5-3 | `done` |

### 文档整理

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| DOCS-1 | [产品门户、规格导航与对齐复核](067-release-hardening/tasks.md#docs-1-产品门户规格导航与对齐复核) | M5-5-4；用户直接要求 | `done`（仅文档） |
| DOCS-2 | [Node.js 支持说明与依赖盘点](067-release-hardening/tasks.md#docs-2-nodejs-支持说明与依赖盘点) | DOCS-1；用户直接要求 | `done`（仅文档） |
| DOCS-3 | [现行文档与 Node.js 检查对齐](067-release-hardening/tasks.md#docs-3-现行文档与-nodejs-检查对齐) | DOCS-2；用户直接要求 | `done` |
| DOCS-4 | [落实 ADR-055 更新安全规范](067-release-hardening/tasks.md#docs-4-落实-adr-055-更新安全规范) | DOCS-3；用户确认 ADR-055 | `done`（仅文档） |

### 依赖维护

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| DEPS-1 | [兼容范围内的依赖升级](067-release-hardening/tasks.md#deps-1-兼容范围内的依赖升级) | DOCS-4；用户要求全面升级 | `done` |
| DEPS-2 | [AI SDK 7 与 Provider](067-release-hardening/tasks.md#deps-2-ai-sdk-7-与-provider) | DEPS-1；ADR-056 accepted | `done` |
| DEPS-3 | [SQLite 原生模块升级](067-release-hardening/tasks.md#deps-3-sqlite-原生模块升级) | DEPS-2；ADR-056 accepted | `done` |
| DEPS-4 | [Vite 8 与 React 插件](067-release-hardening/tasks.md#deps-4-vite-8-与-react-插件) | DEPS-3；ADR-056 accepted | `done` |
| DEPS-5 | [React Router 8](067-release-hardening/tasks.md#deps-5-react-router-8) | DEPS-4；ADR-056 accepted | `done` |
| DEPS-6 | [TypeScript 7 与测试构建工具](067-release-hardening/tasks.md#deps-6-typescript-7-与测试构建工具) | DEPS-5；ADR-056 accepted | `done` |
| DEPS-7 | [pnpm 包管理器升级](067-release-hardening/tasks.md#deps-7-pnpm-包管理器升级) | DEPS-6；ADR-056 accepted | `done` |

### 发布后跟踪（不计入 M5 / G5 完成条件）

验收证据与其他遗留项见 [遗留问题](../docs/open-questions.md)。

| ID | 任务 | 说明 | 状态 |
|---|---|---|---|
| M5-F1 | Windows 终端、命令、PM2 实现与 Windows 11 实机验证 | Windows 11 实机通过：check 549/31、build、platform-smoke、pack 安装、TUI、ConPTY、命令、服务/预览、PM2 生命周期 | `done` |
| M5-F1-R1 | [Windows 部署产物原子提交纠错](066-cross-platform/tasks.md#发布后跟踪-m5-f1-r1windows-部署产物提交) | M5-F1；用户授权排查 UI-F1 检查阻塞 | `done` |
| M5-F1-SHELL | [Windows 交互终端自动选择 Shell](075-windows-terminal-shell/tasks.md) | M5-F1；用户确认回退顺序 | `done`（用户验收通过，整仓检查未通过） |
| M5-F1-W10 | Windows 10 x64 1809+ 实机复测 | 同一实现；ConPTY/CIM/taskkill/Get-NetTCPConnection 均为 Windows 10 自带能力 | `done`（2026-11-18 用户实机验证通过；版本/日志未回填） |
| M5-F2 | Ubuntu 22.04 / 24.04 实机验证与修复 | node-pty 编译回退、路径/锁/PM2 | `todo`（待实机） |
| M5-F3 | 三端结果补齐后的支持矩阵与验收更新 | 未验证项不标通过 | `todo`（仅剩 Ubuntu；Windows 10 已验证） |

[061 DeepSeek 官方接入、模型与思考档位](061-deepseek-integration/spec.md) 于 2026-11-07 按用户确认的三项决策（旧档案忽略、思考默认开启、推理数据先实测）由 `draft` 转 `ready`，[ADR-053](../docs/adr/ADR-053-model-catalog-thinking.md) accepted。M5-1a 已交付：目录同步与缓存、模型 / 档位选择与 Turn 快照、Provider 参数、Composer 浮层与设置页；后续工具续跑与单次圆环分别由 M5-1b / M5-1c 交付。GLM、通用兼容端点、上下文压缩与跨模型迁移见 [063 规格](063-multi-provider/spec.md)（`done`，2026-11-07 人类验收）。Scheduler 见 [064 规格](064-scheduler/spec.md)（`done`，2026-11-08 当前范围验收）。

## 8.1 M6 运行时效率（ready，未开工）

目标：让普通续步的请求体成为上一次的严格超集（由 Provider 前缀缓存承担重复成本），让长 Turn 在预算内完成或**诚实停止**。来源为仓库外的方案稿，已按当前代码复核并收敛为 [070 规格](070-runtime-efficiency/spec.md)；行为与契约变更见 [ADR-057](../docs/adr/ADR-057-runtime-efficiency.md)（`accepted`，2026-11-11）。

门禁：G-Spec-M6 于 2026-11-11 通过（D1–D7 全部采用推荐方案）。HX-5 改变资源观察语义、HX-8 的只读并发默认不做，两者仍各自需要实现验收。G-M6 = A1–A8 通过且真实 Provider 基线有记录。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| HX-0 | [规格、ADR 与契约草案](070-runtime-efficiency/tasks.md#hx-0-规格adr-与契约草案) | — | `done` |
| HX-1 | [用量细分与阶段耗时基线](070-runtime-efficiency/tasks.md#hx-1-用量细分与阶段耗时基线) | HX-0 | `done`（用量细分；耗时并入 HX-2） |
| HX-2 | [截止时间与请求级约束](070-runtime-efficiency/tasks.md#hx-2-截止时间与请求级约束) | HX-0 | `done` |
| HX-3 | [终态原因落库与 Job 判定](070-runtime-efficiency/tasks.md#hx-3-终态原因落库与-job-判定) | HX-2 | `done` |
| HX-4 | [工具结果结构裁剪](070-runtime-efficiency/tasks.md#hx-4-工具结果结构裁剪) | HX-0 | `done`（批次级预算待 HX-6） |
| HX-5 | [稳定前缀与资源观察移位](070-runtime-efficiency/tasks.md#hx-5-稳定前缀与资源观察移位) | HX-1 | `done` |
| HX-6 | [每步预算预检与估算校准](070-runtime-efficiency/tasks.md#hx-6-每步预算预检与估算校准) | HX-1 | `done` |
| HX-7 | [长 Turn 检查点与有界降级](070-runtime-efficiency/tasks.md#hx-7-长-turn-检查点与有界降级) | HX-6、HX-4 | `done` |
| HX-8 | [编码工具效率与只读并发](070-runtime-efficiency/tasks.md#hx-8-编码工具效率与只读并发) | HX-4 | `done`（搜索效率；并发不做） |
| HX-9 | [工具参数校验的秘密查询收敛](070-runtime-efficiency/tasks.md#hx-9-工具参数校验的秘密查询收敛卫生项) | HX-0 | `done` |
| HX-10 | [重复失败调用的循环干预](070-runtime-efficiency/tasks.md#hx-10-重复失败调用的循环干预) | HX-0 | `done` |
| HX-11 | [Turn 级 token 消耗上限](070-runtime-efficiency/tasks.md#hx-11-turn-级-token-消耗上限) | HX-1 | `done`（默认关闭，待 D10） |
| HX-12 | [turnRunner 机械拆分](070-runtime-efficiency/tasks.md#hx-12-turnrunner-机械拆分前置工程动作) | HX-0 | `done`（纯函数层；循环体见 HX-12b） |
| HX-12b | [turnRunner 循环体拆分](070-runtime-efficiency/tasks.md#hx-12b-turnrunner-循环体拆分) | HX-12 | `dropped`（2026-11-18 用户决定；082/083 后维持单循环，不再机械拆分） |

### 8.2 M6 后续：Turn 恢复与数据保留（071，ready）

目标：让被中断的长 Turn 由新 Turn 接手（复用 070 HX-7 的事实），并给事件、Turn、摘要明确寿命。行为与破坏性操作见 [ADR-058](../docs/adr/ADR-058-turn-recovery-retention.md)（`proposed`）。清理默认关闭，只做 dry-run。

门禁：G-Spec-M6-R = 071 的 D1–D4 确认且 ADR-058 accepted；TR-4（删除）还需 TR-1 体积报告完成。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| TR-0 | [规格与 ADR 草案](071-turn-recovery/tasks.md#tr-0-规格与-adr-草案) | — | `done` |
| TR-1 | [数据体积诊断（只读）](071-turn-recovery/tasks.md#tr-1-数据体积诊断只读) | TR-0 | `done` |
| TR-2 | [中断 Turn 恢复](071-turn-recovery/tasks.md#tr-2-中断-turn-恢复新-turn-接手) | TR-0、070 HX-7 | `done` |
| TR-3 | [恢复入口与确认交互](071-turn-recovery/tasks.md#tr-3-恢复入口与确认交互) | TR-2 | `done`（视觉待确认） |
| TR-4 | [保留策略与清理执行](071-turn-recovery/tasks.md#tr-4-保留策略与清理执行) | TR-1、TR-0 | `done`（默认关闭） |

### 8.3 M6 后续：工具调用错误预算（072，done）

目标：把“模型形状不对 → 工具拒收 → 再烧一个步进重发”的可工程消除部分压掉。审查数据与诱因见 [072 spec](072-agent-error-budget/spec.md#1-背景与问题数据审查)；2026-11-12 用户授权“从工程化角度降低大模型错误的都要做”。

门禁：G-072 = A1–A8 通过，且 `toolContract` 矩阵、biome、各包 typecheck 不回归。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| EB-1 | [补丁信封修复](072-agent-error-budget/tasks.md) | — | `done` |
| EB-2 | [参数修复层与状态别名](072-agent-error-budget/tasks.md) | — | `done` |
| EB-3 | [命令用法与脚本](072-agent-error-budget/tasks.md) | — | `done` |
| EB-4 | [审查结论与状态回填](072-agent-error-budget/tasks.md) | EB-1～EB-3 | `done` |
| EB-5 | [失败呈现与重试语义](072-agent-error-budget/tasks.md) | EB-4 | `done` |

### 8.4 M6 后续：上下文预算（073，done）

目标：修掉“读一次看不到全文 → 再读一次”的重复读根因，并让命令输出保留尾部诊断。审查数据与验收见 [073 spec](073-context-budget/spec.md#1-背景与问题数据审查)。

门禁：G-073 = A1–A4 通过，`packages/agent`、`test/agent`、`apps/web` 不回归，typecheck 与 biome 通过。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| RB-1 | [结果预算按总量分配](073-context-budget/tasks.md) | — | `done` |
| RB-2 | [读文件字符分页](073-context-budget/tasks.md) | — | `done` |
| RB-3 | [命令输出头尾保留](073-context-budget/tasks.md) | — | `done` |
| RB-4 | [审查与状态回填](073-context-budget/tasks.md) | RB-1～RB-3 | `done` |

### 8.5 发布后：模型连接与平台接入（077，active）

目标：以连接预设和独立能力目录支撑模型选择，接入 OpenCode Go、百炼、Kimi、MiniMax。验收按 [077 规格](077-model-connections/spec.md) 与 [任务卡](077-model-connections/tasks.md)。

首批平台接入已交付。真实账号验收与全套浏览器回归见[验收记录](077-model-connections/acceptance.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| MC-0 | 规格、计划、ADR 与契约草案 | 061、063、UI-F18 | `done` |
| MC-1 | 官方预设、凭据版本和存量迁移 | MC-0、077 实施获准、ADR-062 accepted | `done` |
| MC-2 | 能力来源、目录同步与预算接线 | MC-1 | `done` |
| MC-3 | 设置与会话选择器 | MC-2 | `done` |
| MC-4 | OpenCode Go | MC-3 | `done` |
| MC-5 | 阿里云百炼 | MC-4 | `done` |
| MC-6 | Kimi | MC-5 | `done` |
| MC-7 | MiniMax | MC-6 | `done` |
| MC-8 | 截图输入与能力校验 | MC-7 | `done` |
| MC-9 | 以 Key 为入口的设置和会话选择器 | MC-8、ADR-063 accepted | `done` |
| MC-10 | 会话两级菜单和设置列表精简 | MC-9、ADR-064 accepted | `done` |
| MC-11 | 能力标签和 Key 弹窗 | MC-10 | `done` |
| MC-12 | 内置平台目录与推理能力校准 | MC-11 | `done` |
| MC-13 | 模型行内操作与隐藏样式 | MC-12、ADR-065 accepted | `done` |
| MC-14 | 管理 Key 弹窗布局 | MC-13 | `done`（用户自行验收） |

### 8.6 发布后 Git 日常操作（078）

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| GX-1 | [人工一键拉取与推送](078-git-workflow/tasks.md) | M2-5b、ADR-066 | `done` |
| GX-2 | [目录行批量暂存和取消暂存](078-git-workflow/tasks.md) | GX-1 | `done` |
| GX-3 | [差异树缩进对齐](078-git-workflow/tasks.md) | GX-2 | `done` |
| GX-4 | [提交输入框图标按钮](078-git-workflow/tasks.md) | GX-3 | `done` |

### 8.7 发布后：Agent 内核轻量化（081，done）

目标：按「轻、快、省」重测内核后，修掉四处与目标直接冲突的问题——观察快照占据缓存前缀、生命周期文案三处重复、批内串行、单步可吞掉整个窗口；同时把「回复精炼」变成工程约束。决策见 [ADR-067](../docs/adr/ADR-067-lean-agent-context.md)，验收见 [081 任务卡](081-agent-lean/tasks.md#验收记录)。

门禁：G-081 = A1–A9 通过；`test/agent` 全量绿；类型与规范通过；全量并行失败的每一项都有结论。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| LE-1 | [观察块移出缓存前缀](081-agent-lean/spec.md#6-功能需求) | 070 HX-5 done | `done` |
| LE-2 | [精炼输出约束](081-agent-lean/spec.md#6-功能需求) | LE-1 | `done` |
| LE-3 | [文案只写一份](081-agent-lean/spec.md#6-功能需求) | LE-2 | `done` |
| LE-4 | [纯读批次并发](081-agent-lean/spec.md#6-功能需求) | LE-3 | `done` |
| LE-5 | [每批结果预算](081-agent-lean/spec.md#6-功能需求) | LE-4 | `done` |
| LE-6 | [验证](081-agent-lean/tasks.md#验收记录) | LE-5 | `done` |
| LE-7 | [文档与状态回填](081-agent-lean/tasks.md#验收记录) | LE-6 | `done` |

### 8.8 发布后：Agent 内核重构（082，done）

目标：在保留人类终端、Git、服务与 PM2 操作面的前提下，把 Agent 内核收成单循环 + core 工具 + 可选能力包；模型移除 Git 与交互终端工具，计划降级为 plan Profile，Agent 长任务使用后台进程/命名服务，锁收敛为 ProjectLease + ServiceLease，审计按安全关键/资源操作/调试分级。网络搜索与 subagent 不在本切片。规格见 [082](082-agent-kernel/spec.md)，基线见 [K-1](082-agent-kernel/baseline.md)，决策见 [ADR-068](../docs/adr/ADR-068-agent-kernel.md)。

门禁：G-082-Spec 于 2026-11-18 通过（spec `ready`、ADR-068 `accepted`、Q-042～Q-050 全部确认；内测允许破坏性重构，存量会话不保留旧能力）；G-082 = K-1～K-12 完成且 A1–A14 通过。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| K-1 | [ADR-068、基线、锁/审计与契约盘点](082-agent-kernel/tasks.md#k-1-adr-068基线锁审计与契约盘点) | — | `done`（2026-11-18） |
| K-2 | [Profile / ToolPack 抽象](082-agent-kernel/tasks.md#k-2-profile--toolpack-抽象) | K-1 | `done`（2026-11-18） |
| K-3 | [coding Profile 与核心提示](082-agent-kernel/tasks.md#k-3-coding-profile-与核心提示) | K-2 | `done`（2026-11-18） |
| K-12 | [run_command/run_shell 跨平台执行](082-agent-kernel/tasks.md#k-12-run_commandrun_shell-跨平台执行) | K-3 | `done`（2026-11-18） |
| K-4 | [Git 模型工具移除与人类 UI 分面](082-agent-kernel/tasks.md#k-4-git-模型工具移除与人类-ui-分面) | K-3 | `done`（2026-11-18） |
| K-5 | [终端与 Agent 模型面分离](082-agent-kernel/tasks.md#k-5-终端与-agent-模型面分离) | K-3 | `done`（2026-11-18） |
| K-6 | [后台进程能力包](082-agent-kernel/tasks.md#k-6-后台进程能力包) | K-5 | `done`（2026-11-18） |
| K-7 | [命名服务与可选预览](082-agent-kernel/tasks.md#k-7-命名服务与可选预览) | K-6 | `done`（2026-11-18） |
| K-8 | [计划可选化](082-agent-kernel/tasks.md#k-8-计划可选化) | K-3 | `done`（2026-11-18） |
| K-11 | [锁与审计契约收敛](082-agent-kernel/tasks.md#k-11-锁与审计契约收敛) | K-2 | `done`（2026-11-18） |
| K-9 | [workspace Profile、迁移与 UI](082-agent-kernel/tasks.md#k-9-workspace-profile迁移与-ui) | K-4、K-7、K-8、K-11、K-12 | `done`（2026-11-18） |
| K-10 | [A/B 验证、全量检查与文档回填](082-agent-kernel/tasks.md#k-10-ab-验证全量检查与文档回填) | K-9 | `done`（限定范围；真实模型 A/B 未运行） |

### 8.9 项目开发服务与全局 PM2 运维（083，done）

修正 082 的 Profile 与服务边界：coding 直接管理项目后台开发任务；项目服务显示真实后台进程并删除手动登记；预览按需生成；workspace 改为 service-ops 管理 Larness 隔离 PM2；旧命令不再永久锁项目。2026-11-18 自动门禁通过（check/build、Mock 24/24、Prod 20/20）；人类视觉与用户实机 PM2/旧数据未验证。规格见 [083](083-service-model/spec.md)，决策见 [ADR-069](../docs/adr/ADR-069-project-services-and-service-ops.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| S-1 | [合同、ADR、Profile 与迁移](083-service-model/tasks.md#s-1) | — | `done`（2026-11-18） |
| S-2 | [后台进程模型与 coding 工具面](083-service-model/tasks.md#s-2) | S-1 | `done`（2026-11-18） |
| S-3 | [项目服务窗口与侧栏计数](083-service-model/tasks.md#s-3) | S-2 | `done`（2026-11-18） |
| S-4 | [按需预览](083-service-model/tasks.md#s-4) | S-2 | `done`（2026-11-18） |
| S-5 | [服务运维 Profile 与 PM2 投影](083-service-model/tasks.md#s-5) | S-1、S-4 | `done`（2026-11-18） |
| S-6 | [旧命令锁恢复](083-service-model/tasks.md#s-6) | S-2 | `done`（2026-11-18） |
| S-7 | [全量验证与收口](083-service-model/tasks.md#s-7) | S-1～S-6 | `done`（2026-11-18） |

### 8.10 Agent Profile 收敛与会话 Token 统计（084，done）

把 Profile 收敛为 `coding`（完整工具、无 `update_plan`）与 `plan`（相同工具 + `update_plan`），将 Service Ops 工具合并进两者；旧 `service-ops` 会话迁移为 `coding`。同时在输入框下方增加会话累计 Token 与最后一步实测输出速度，不做不可精确的逐字实时 speed。2026-11-18 人类审核通过 spec 与 §12 决议，实施见 [ADR-070](../docs/adr/ADR-070-agent-profiles-and-usage.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| AP-1 | [规格决议、ADR、计划与任务卡](084-agent-profiles-and-usage/tasks.md#ap-1-规格决议adr计划与任务卡) | — | `done` |
| AP-2 | [Profile 收敛、提示、迁移与选择器](084-agent-profiles-and-usage/tasks.md#ap-2-profile-收敛提示迁移与选择器) | AP-1 | `done` |
| AP-3 | [会话用量 API 与步骤耗时](084-agent-profiles-and-usage/tasks.md#ap-3-会话用量-api-与步骤耗时) | AP-1 | `done` |
| AP-4 | [输入框下方用量与最后一步速度](084-agent-profiles-and-usage/tasks.md#ap-4-输入框下方用量与最后一步速度) | AP-3 | `done` |
| AP-5 | [过程呈现收敛（状态行、波形、思考）](084-agent-profiles-and-usage/tasks.md#ap-5-过程呈现收敛状态行波形思考) | AP-1 | `done` |
| AP-6 | [全量验证、契约与状态回填](084-agent-profiles-and-usage/tasks.md#ap-6-全量验证契约与状态回填) | AP-2～AP-5 | `done` |
| AP-7 | [过程标题行视觉细化（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-7-过程标题行视觉细化用户反馈) | AP-5 | `done` |
| AP-8 | [星光图标与灰底黑扫文字（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-8-星光图标与灰底黑扫文字用户反馈) | AP-7 | `done` |
| AP-9 | [动画同步为 1 秒一轮（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-9-动画同步为-1-秒一轮用户反馈) | AP-8 | `done` |
| AP-10 | [过程动画降速（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-10-过程动画降速用户反馈) | AP-9 | `done` |
| AP-11 | [会话缓存命中率（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-11-会话缓存命中率用户反馈) | AP-3、AP-4 | `done` |
| AP-12 | [Token 行在会话页常驻（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-12-token-行在会话页常驻用户反馈) | AP-4、AP-11 | `done` |
| AP-13 | [过程标题行只显示步数（用户反馈）](084-agent-profiles-and-usage/tasks.md#ap-13-过程标题行只显示步数用户反馈) | AP-5 | `done` |

### 8.11 发布后：长任务连续执行（085，done）

目标：按用户“成本不敏感、长任务必须完成”的要求，取消任务级 token / 总墙钟 / 固定接续深度限制，改为操作级超时 + 上下文自动换页 + 无进展检测。规格见 [085](085-long-task-continuity/spec.md)，决策见 [ADR-071](../docs/adr/ADR-071-long-task-continuity.md)（accepted）。2026-11-19 人类验收通过，自动门禁与未验证边界见 [acceptance](085-long-task-continuity/acceptance.md)。

门禁：G-085 = A1–A11 通过；正常长任务不因任务级预算被截断；操作级超时、安全授权、锁、审批与审计不回归。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| LC-1 | [关闭任务级预算与收尾提示](085-long-task-continuity/tasks.md#lc-1-关闭任务级预算与收尾提示) | — | `done` |
| LC-2 | [上下文换页与无事实接续](085-long-task-continuity/tasks.md#lc-2-上下文换页与无事实接续) | LC-1 | `done` |
| LC-3 | [操作级超时与无进展检测](085-long-task-continuity/tasks.md#lc-3-操作级超时与无进展检测) | LC-1 | `done` |
| LC-4 | [上下文阈值与历史加载校准](085-long-task-continuity/tasks.md#lc-4-上下文阈值与历史加载校准) | LC-2 | `done` |
| LC-5 | [终态、UI 与可观测性](085-long-task-continuity/tasks.md#lc-5-终态ui-与可观测性) | LC-2、LC-3 | `done` |
| LC-6 | [全量验证、契约与状态回填](085-long-task-continuity/tasks.md#lc-6-全量验证契约与状态回填) | LC-1～LC-5 | `done` |

### 8.12 发布后：项目指令、项目记忆与用户偏好（086，done）

目标：自动加载项目根目录的 `AGENTS.md` 与 `.larness/instructions.md`；建立“证据驱动、默认自动生效”的项目记忆与跨项目用户偏好；用硬字节预算、评分淘汰和保留期保证长期不膨胀。记忆只作为不可信事实注入，不参与授权。规格见 [086](086-project-memory/spec.md)，方案见 [plan](086-project-memory/plan.md)。

门禁：G-086 通过（2026-11-20）——Q-060～Q-070 已确认、ADR-072 accepted、A1–A16 自动验证通过、人类审核通过；后续真实 Provider 与长期使用边界见 [acceptance](086-project-memory/acceptance.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| PM-0 | [规格确认与 ADR](086-project-memory/tasks.md#pm-0-规格确认与-adr) | — | `done`（2026-11-20） |
| PM-1 | [指令文件解析与装配](086-project-memory/tasks.md#pm-1-指令文件解析与装配) | PM-0 | `done`（2026-11-20） |
| PM-2 | [记忆存储、预算与保留期](086-project-memory/tasks.md#pm-2-记忆存储预算与保留期) | PM-0 | `done`（2026-11-20） |
| PM-3 | [remember/read 工具与自动学习](086-project-memory/tasks.md#pm-3-rememberread-工具与自动学习) | PM-2 | `done`（2026-11-20） |
| PM-4 | [全局用户偏好与隐私隔离](086-project-memory/tasks.md#pm-4-全局用户偏好与隐私隔离) | PM-2、PM-3 | `done`（2026-11-20） |
| PM-5 | [上下文注入与提示](086-project-memory/tasks.md#pm-5-上下文注入与提示) | PM-1、PM-2、PM-3、PM-4 | `done`（2026-11-20） |
| PM-6 | [REST、WS 与契约](086-project-memory/tasks.md#pm-6-restws-与契约) | PM-2 | `done`（2026-11-20） |
| PM-7 | [设置页记忆与偏好管理](086-project-memory/tasks.md#pm-7-设置页记忆与偏好管理) | PM-6 | `done`（2026-11-20） |
| PM-8 | [安全、E2E 与验收](086-project-memory/tasks.md#pm-8-安全e2e-与验收) | PM-1～PM-7 | `done`（2026-11-20） |

### 8.13 发布后：联网搜索工具与独立搜索连接（087，done）

目标：新增 `web_search` / `fetch_url` 普通 Agent 工具，默认关闭、会话级地球按钮显式开启；搜索 Key 与模型 Key 完全隔离；首版支持 DeepSeek 与 GLM 国内/国际，Provider 层保持通用。不使用厂商内置 server-side 搜索。规格见 [087](087-web-search/spec.md)，方案见 [plan](087-web-search/plan.md)，决策见 [ADR-073](../docs/adr/ADR-073-web-search.md)（accepted）。

门禁：G-087 通过（2026-11-20，人类验收）——A1–A9 通过；默认关闭、Key 隔离、未配置失败关闭、秘密/URL 防护、配额与结果上限、DeepSeek + GLM 映射、地球开关切换生效；真实 Key 由用户验收确认。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| WS-0 | [规格确认与 ADR](087-web-search/tasks.md#ws-0-规格确认与-adr) | — | `done`（2026-11-20） |
| WS-1 | [Provider 层：DeepSeek / GLM 适配器](087-web-search/tasks.md#ws-1-provider-层deepseek--glm-适配器) | WS-0 | `done`（2026-11-20） |
| WS-2 | [搜索连接存储、REST 与审计](087-web-search/tasks.md#ws-2-搜索连接存储rest-与审计) | WS-0 | `done`（2026-11-20） |
| WS-3 | [Agent 工具、会话开关与上下文](087-web-search/tasks.md#ws-3-agent-工具会话开关与上下文) | WS-1、WS-2 | `done`（2026-11-20） |
| WS-4 | [设置弹窗、侧栏入口与地球按钮](087-web-search/tasks.md#ws-4-设置弹窗侧栏入口与地球按钮) | WS-2、WS-3 | `done`（2026-11-20） |
| WS-5 | [契约、E2E、真实 Key 验证与收口](087-web-search/tasks.md#ws-5-契约e2e真实-key-验证与收口) | WS-1～WS-4 | `done`（2026-11-20，人类验收通过） |
| WS-6 | [交互收敛：地球禁用、列表弹窗与统一命名](087-web-search/tasks.md#ws-6-交互收敛地球禁用列表弹窗与统一命名用户反馈) | WS-4 | `done`（2026-11-20） |

### 8.14 发布后：文档与图片附件解析、能力路由与会话外呈现（088，done）

目标：统一附件 `AttachmentArtifact` 契约；文档走本地可插拔抽取器，图片在模型支持视觉时原图透传、否则 OCR/视觉降级；长文档只注入目录并用 `read_attachment` / `search_attachment` 按需读取；附件与图片在会话气泡之外呈现。规格见 [088](088-document-attachments/spec.md)，方案见 [plan](088-document-attachments/plan.md)，决策见 [ADR-074](../docs/adr/ADR-074-document-attachments.md)（accepted）。

门禁：G-088 通过（2026-11-24 人类实机验收）。自动化部分：Q-071～Q-076 已确认，A1–A11 按自动化覆盖通过，A12–A13（多视图/HTML 保真/文本矩阵/凭据拒绝）于 2026-11-24 按自动化覆盖；格式 fixture 与路由矩阵、气泡外布局、安全与脱敏测试通过；2026-11-23 跑过 `pnpm check` 与 server build，2026-11-24 复跑 server/web 全量测试与两端 typecheck。2026-11-24 用户实机验证原文预览与端到端附件链路，spec 转 `done`。仍未逐项验证：真实大样本（300 页 PDF、加密 PDF、中文扫描件）、云端视觉外发、Mock E2E；解析未放入 worker（Q-077）、视觉连接未接线（Q-078），详见 [acceptance](088-document-attachments/acceptance.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| DA-0 | [规格确认与 ADR](088-document-attachments/tasks.md#da-0-规格确认与-adr-074) | — | `done`（2026-11-23） |
| DA-1 | [数据模型、存储与迁移 0038](088-document-attachments/tasks.md#da-1-数据模型存储与迁移-0038) | DA-0 | `done`（2026-11-23） |
| DA-2 | [上传、状态事件与删除](088-document-attachments/tasks.md#da-2-上传状态事件与删除) | DA-1 | `done`（2026-11-23） |
| DA-3 | [抽取内核与文本类格式](088-document-attachments/tasks.md#da-3-抽取内核与文本类格式) | DA-1 | `done`（2026-11-23，worker 隔离见 Q-077） |
| DA-4 | [PDF、DOCX、PPTX、XLSX 抽取](088-document-attachments/tasks.md#da-4-pdfdocxpptx-xlsx-抽取) | DA-3 | `done`（2026-11-23） |
| DA-5 | [图片能力路由与 OCR/视觉降级](088-document-attachments/tasks.md#da-5-图片能力路由与-ocr视觉降级) | DA-2、DA-3 | `done`（2026-11-23，视觉接线见 Q-078） |
| DA-6 | [上下文预算与附件工具](088-document-attachments/tasks.md#da-6-上下文预算与附件工具) | DA-2、DA-3 | `done`（2026-11-23） |
| DA-7 | [气泡外附件、草稿托盘与预览](088-document-attachments/tasks.md#da-7-气泡外附件草稿托盘与预览) | DA-2、DA-6 | `done`（2026-11-23） |
| DA-8 | [安全、E2E 与验收](088-document-attachments/tasks.md#da-8-安全e2e-与验收) | DA-4、DA-5、DA-7 | `done`（2026-11-23，自动化范围） |
| DA-9 | [附件标签化与重复渲染修复](088-document-attachments/tasks.md#da-9-附件标签化与重复渲染修复) | DA-7 | `done`（2026-11-23） |
| DA-10 | [多视图：source 视图、文本矩阵与跨附件检索](088-document-attachments/tasks.md#da-10-多视图source-视图文本矩阵与跨附件检索2026-11-24) | DA-9 | `done`（2026-11-24） |
| DA-11 | [HTML 结构化](088-document-attachments/tasks.md#da-11-html-结构化2026-11-24) | DA-10 | `done`（2026-11-24） |
| DA-13 | [预览解析/原文视图切换](088-document-attachments/tasks.md#da-13-预览解析原文视图切换2026-11-24) | DA-10 | `done`（2026-11-24） |
| DA-12 | 附件导入项目目录 | DA-10 | `todo`（Q-080 未批准） |

### 8.15 发布后：会话级前缀缓存与压缩可达（089，done）

目标：070 已保证 Turn 内前缀逐字节稳定；本切片处理跨 Turn 的剩余漏损——把日期、联网策略、记忆索引、会话摘要、附件声明移出 system，改为当前请求的尾部消息；给每个请求一线前缀指纹与断裂归因；让会话级压缩阈值低于装配裁剪预算，消除「每轮静默丢最老历史」；附件工具改为常驻。规格见 [089](089-session-prefix-cache/spec.md)，方案见 [plan](089-session-prefix-cache/plan.md)。

门禁：G-089 = spec 第 13 节 D1–D5 确认、ADR-057 修订段落定稿、spec 转 `ready`。**已于 2026-11-24 通过**（用户确认全部推荐方案）。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| PA-0 | [确认 D1–D5 并补 ADR 修订草案](089-session-prefix-cache/tasks.md#pa-0-确认-d1d5-并补-adr-修订草案) | — | `done`（2026-11-24） |
| PA-1 | [稳定/易变分层装配](089-session-prefix-cache/tasks.md#pa-1-稳定易变分层装配) | PA-0 | `done`（2026-11-24） |
| PA-2 | [前缀指纹与断裂归因](089-session-prefix-cache/tasks.md#pa-2-前缀指纹与断裂归因) | PA-1 | `done`（2026-11-24） |
| PA-3 | [用量契约与按原因汇总](089-session-prefix-cache/tasks.md#pa-3-用量契约与按原因汇总) | PA-2 | `done`（2026-11-24） |
| PA-4 | [压缩可达与裁剪滞回](089-session-prefix-cache/tasks.md#pa-4-压缩可达与裁剪滞回) | PA-1 | `done`（2026-11-24） |
| PA-5 | [工具数组会话内稳定](089-session-prefix-cache/tasks.md#pa-5-工具数组会话内稳定) | PA-1 | `done`（2026-11-24） |
| PA-6 | [回归、真实 Provider 基线与验收](089-session-prefix-cache/tasks.md#pa-6-回归真实-provider-基线与验收) | PA-2, PA-3, PA-4, PA-5 | `done`（2026-11-24） |
| PA-7 | [文档与状态收口](089-session-prefix-cache/tasks.md#pa-7-文档与状态收口) | PA-6 | `done`（2026-11-24） |

### 8.16 发布后：Provider 失败重试、诊断与标题超时（090，done）

用户报告 `PROVIDER_UNAVAILABLE` / `PROVIDER_UNKNOWN` 经常让整轮 Turn 失败，且会话标题频繁不生成。诊断：内核只在 SDK 内层对 5xx/429/网络错误重试 1 次，流中断、超时与 `PROVIDER_UNKNOWN` 不重试；`statusCode` 未进日志；标题被 20 秒硬超时打断。规格见 [090](090-provider-retry/spec.md)，方案见 [plan](090-provider-retry/plan.md)。

门禁：用户 2026-11-24 直接要求“开个任务完成修改”，批准 D1–D4 推荐方案（共 3 次尝试、1s/2s 退避；`PROVIDER_UNKNOWN` 仅无状态码或 ≥500/408/409 重试；单次 >60s 不重试；标题 60s + `maxRetries: 0`）。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| PR-1 | [失败测试：重试判定与 TurnRunner 行为](090-provider-retry/tasks.md#pr-1-失败测试重试判定与-turnrunner-行为) | — | `done`（2026-11-24） |
| PR-2 | [步骤级重试与结构化失败日志](090-provider-retry/tasks.md#pr-2-步骤级重试与结构化失败日志) | PR-1 | `done`（2026-11-24） |
| PR-3 | [标题超时/诊断与压缩显式重试预算](090-provider-retry/tasks.md#pr-3-标题超时诊断与压缩显式重试预算) | PR-1 | `done`（2026-11-24） |
| PR-4 | [验证、文档与状态回填](090-provider-retry/tasks.md#pr-4-验证文档与状态回填) | PR-2, PR-3 | `done`（2026-11-24） |

### 8.17 发布后：跨 Turn 工具结果回放（091，done）

跨 Turn 历史此前只重放 user/assistant 文本，上一轮工具结果不进入下一轮，上下文占用因此呈锯齿。用户 2026-11-25 直接要求实施「① 保留最近 N token 工具结果原文 + ② 旧结果按预算 prune + ③ 用量口径」。规格见 [091](091-cross-turn-tool-replay/spec.md)。

门禁：只回放 L0 只读结果；内部 `tool.replay` 不广播；预算 `clamp(window×0.05, 2k, 32k)`；超预算先折叠再省略并显式提示；089 的 NG-3/R-4 已加日期修订段。

### 8.18 发布后：搜索与目录列表默认忽略构建产物（092，done）

根目录 `search_code` 在含 `.pnpm-store` / 构建产物的仓库中会被 `maxFiles` 预算耗尽并返回 0 匹配；`list_files` 也会把构建目录暴露给模型。本切片把常见包存储与构建目录加入默认忽略，补根搜索预算与显式路径回归；完整 `.gitignore` / ripgrep 另开切片。规格见 [092](092-search-ignore/spec.md)，方案见 [plan](092-search-ignore/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| SI-1 | [默认忽略与回归测试](092-search-ignore/tasks.md#si-1-默认忽略与回归测试) | 051、082 | `done`（2026-11-27） |

### 8.19 发布后：工具面与结果预算（093，done）

模型工具面与 coding 习惯不一致：read 无行号且只有 12k 字符、没有 `edit`、`write_file` 只能新建、命令输出约 6k、结果统一 JSON 且 16k 字符上限会把放大后的页面再次截断。本切片把 read 行号/50KB、`edit`、`write_file` 覆盖、命令 32KB、`modelText` 纯文本结果与结果/批预算一起改到位。规格见 [093](093-tool-interface/spec.md)，方案见 [plan](093-tool-interface/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| TI-1 | [资源层 write/edit 与测试](093-tool-interface/tasks.md#ti-1-资源层-writeedit-与测试) | 092 | `done`（2026-11-27） |
| TI-2 | [modelText、预算与 read/search/command](093-tool-interface/tasks.md#ti-2-modeltext预算与-readsearchcommand) | TI-1 | `done`（2026-11-27） |
| TI-3 | [edit 工具、write 覆盖、Profile/契约](093-tool-interface/tasks.md#ti-3-edit-工具write-覆盖profile契约) | TI-2 | `done`（2026-11-27） |
| TI-4 | [turnRunner 事件、验证与收口](093-tool-interface/tasks.md#ti-4-turnrunner-事件验证与收口) | TI-3 | `done`（2026-11-27） |

### 8.20 发布后：跨 Turn 操作日志（094，done）

091 只回放 L0 只读结果，L1+ 命令/文件操作仍不进入下一轮。本切片用内部 `tool.operation` 记录有界的命令 exit+尾部、文件路径/版本/统计与失败摘要，并通过当前 user 消息 tail 注入下一 Turn；不改变 system/history，不广播内部事件。规格见 [094](094-operation-log/spec.md)，方案见 [plan](094-operation-log/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| OL-1 | [operationLog 模块与单测](094-operation-log/tasks.md#ol-1-operationlog-模块与单测) | 093 | `done`（2026-11-27） |
| OL-2 | [TurnRunner 写入 `tool.operation`](094-operation-log/tasks.md#ol-2-turnrunner-写入-tooloperation) | OL-1 | `done`（2026-11-27） |
| OL-3 | [ContextAssembler tail 注入](094-operation-log/tasks.md#ol-3-contextassembler-tail-注入) | OL-2 | `done`（2026-11-27） |
| OL-4 | [事件过滤、全量验证与收口](094-operation-log/tasks.md#ol-4-事件过滤全量验证与收口) | OL-3 | `done`（2026-11-27） |

### 8.21 发布后：单一 Agent 模式（095，done）

移除 coding/plan 切换，保留一个通用模式；`update_plan` 常驻并始终注入计划策略；旧 `plan` 作为行为一致的兼容别名，不删 `agent_profile` 列。最近计划注入 tail，当前 Turn 计划仍有 pending/running 却纯文本停止时 nudge 一次；项目指令改为“可遵循的约定，但不能授权”，并允许项目指令提高验证门禁。决策见 [ADR-075](../docs/adr/ADR-075-single-agent-mode.md)，规格见 [095](095-single-agent-mode/spec.md)，方案见 [plan](095-single-agent-mode/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| SM-1 | [Profile 合并与计划策略](095-single-agent-mode/tasks.md#sm-1-profile-合并与计划策略) | 094 | `done`（2026-11-27） |
| SM-2 | [planState、tail 与 nudge](095-single-agent-mode/tasks.md#sm-2-planstatetail-与-nudge) | SM-1 | `done`（2026-11-27） |
| SM-3 | [项目指令/验证措辞与测试](095-single-agent-mode/tasks.md#sm-3-项目指令验证措辞与测试) | SM-2 | `done`（2026-11-27） |
| SM-4 | [Composer 移除 Profile 切换](095-single-agent-mode/tasks.md#sm-4-composer-移除-profile-切换) | SM-3 | `done`（2026-11-27） |
| SM-5 | [全量验证、文档与收口](095-single-agent-mode/tasks.md#sm-5-全量验证文档与收口) | SM-4 | `done`（2026-11-27） |

### 8.22 发布后：命令 allowlist 与本轮审批复用（096，done）

标准审批下常见只读/验证命令逐条询问；同一 Turn 重复命令也重复批准。本切片把 `git status/diff/log`、`pnpm test/check/typecheck`、`rg/ls/pwd` 等保守 allowlist 降为 L1，并让同一 Turn 内相同工具+参数的调用复用一次批准；L3 仍 deny，默认仍 standard。决策见 [ADR-076](../docs/adr/ADR-076-command-allowlist-and-turn-approvals.md)，规格见 [096](096-command-approvals/spec.md)，方案见 [plan](096-command-approvals/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| CA-1 | [allowlist 分类与测试](096-command-approvals/tasks.md#ca-1-allowlist-分类与测试) | 095 | `done`（2026-11-27） |
| CA-2 | [本 Turn 审批复用](096-command-approvals/tasks.md#ca-2-本-turn-审批复用) | CA-1 | `done`（2026-11-27） |
| CA-3 | [契约/描述、全量验证与收口](096-command-approvals/tasks.md#ca-3-契约描述全量验证与收口) | CA-2 | `done`（2026-11-27） |

### 8.23 发布后：流式启动 L0 只读工具（097，done）

当前 step 结束后才执行工具；081 的纯读并发也在结束后。本切片把 L0、无锁、策略 allow 的调用在 `tool-call` 事件到达时启动，最多 8 个，结果仍按 call 顺序消费；写/锁/审批与混合批次中的非 L0 调用保持串行。三个 L0 文件工具显式 `requiresProjectLock:false`。规格见 [097](097-streaming-reads/spec.md)，方案见 [plan](097-streaming-reads/plan.md)。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| SR-1 | [流内预取与 L0 元数据](097-streaming-reads/tasks.md#sr-1-流内预取与-l0-元数据) | 096 | `done`（2026-11-27） |
| SR-2 | [验证、081 修订与收口](097-streaming-reads/tasks.md#sr-2-验证081-修订与收口) | SR-1 | `done`（2026-11-27） |

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
- 页面刷新或断网只影响浏览器订阅；退出受管 TUI 停止管理面、Agent 和临时开发资源，独立 PM2 正式服务继续运行；
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

### G-Spec-M3 / G-PoC-M3（已通过）

- G-Spec-M3（2026-11-05）：人类按 040 评审包推荐批准 ADR-043、来源/票据/执行身份/loopback 范围及残余风险与 PoC 证据标准；仅允许 M3-0。
- 远程独立注册域 HTTPS 实测延后至后续上线实验（人类决定）；G-PoC 按已确认范围评审，远程项明确标未验证，不得宣称已支持。
- G-PoC-M3：2026-11-05 人类确认 M3-0 证据，允许开始 M3-1；远程 HTTPS 仍为未验证项，上线实验补齐。
- 失败/新依赖/范围变化回评审，不能用文档完成代替批准。

### G3 开发服务与隔离预览

- S1–S9/S12–S18真实证据：已启动开发进程登记/日志/卡片、HTTP/WS/HMR与开发API；Ctrl+C后Shell仍活但服务退登，旧流失效，端口复用不串绑；
- 独立来源/Cookie/CSP/票据/SSRF/未知状态失败关闭；当前项目卡片/详情无服务Tab/项目切换，窗口隐藏无启停；
- 自主合法登记/预览无人工停等，未鉴权/非法目标仍拒绝，关键事件/审计真实；
- 不含PM2；Q-003/Q-027在M4解决，不以正式部署未交付阻塞G3。
- **2026-11-05 人类验收通过**：M3-6 标 done，M3 关闭；远程 HTTPS 验证见 [遗留问题](../docs/open-questions.md)。

### G-Spec-M4 / G-PoC-M4（已通过）

- 2026-11-06 用户确认正常退出 TUI 后正式服务继续运行，重开可查看实际状态。G-Spec-M4 通过，先执行 [M4-0 隔离实验](050-deploy/review.md)。
- G-PoC-M4 审阅 [M4-0 的 P1–P5 真实证据](050-deploy/poc.md)，确认交付与退出边界后才能开始 M4-1。产品验收仍按 G4 执行。
- **2026-11-06 用户确认 G-PoC-M4 通过**：接受 P1–P5 证据与已记录边界，M4-0 标 `done`，允许开始 M4-1。

### G4 持久运行与版本发布（已通过）

- 当前验收按 [050 spec 的 C1–C13](050-deploy/spec.md#验收场景)，包含实际模型上下文、命令执行与 PM2 环境同源、服务项目关联、真实构建/运行/日志/退出和四策略。
- 服务观察、事件持久化和预览资源继续分域，命令超时/取消/未知不能伪报运行健康，不能依据命令返回码重复启动。
- 2026-11-07 用户确认 M4 与 M4-R0～R4 全部验收通过。原 D1–D16 记录保留为历史，自动化与平台范围见 [M4 收尾](050-deploy/closure.md)。

### G5 发布候选（2026-11-08 按 M5-3 方案更新）

- npm 更新提示、用户手动安装；不自动更新、不自动重启；
- 升级前自动备份数据库；降级用 `npm install -g larness@<version>`；不再要求签名发布包或自动回滚；
- macOS Apple Silicon 已验证；Windows 11 / Ubuntu 结果由人类实机提供，未验证不得标通过；
- [安全复核](../docs/security/review.md)、[发布清单](../docs/process/release.md)、[已知限制](../docs/known-limitations.md) 完成；
- 历史清单与现行门禁对照见 [G5 验收](067-release-hardening/acceptance.md#历史发布清单对照)；
- **G5 条件通过（2026-11-08）**：人类确认当前 macOS 范围；Windows / Ubuntu 支持承诺保留，实机与 Windows 终端/命令实现为发布后跟踪，未验证项不标通过。

## 10. 任务卡维护

### 2026-11-11 界面与输出纠错

[068 规格](068-ui-fixes/spec.md) 的 UI-F1～UI-F7 均为 done（2026-11-11）。七项依次处理 Key 刷新、确认按钮、服务终端输出、Header 版本、自动化空态、表单组件和错误 message。[任务清单与验收](068-ui-fixes/tasks.md)

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| UI-F8 | [对话执行展示](068-ui-fixes/spec.md#ui-f8-对话执行展示) | UI-F7 done | `done` |
| UI-F9 | [新对话布局与输入框过渡](068-ui-fixes/spec.md#ui-f9-新对话布局与输入框过渡) | UI-F8 done | `done` |
| UI-F10 | [最终答复气泡](068-ui-fixes/spec.md#ui-f10-最终答复气泡) | UI-F9 done | `done` |
| UI-F11 | [本机执行提示](068-ui-fixes/spec.md#ui-f11-本机执行提示) | UI-F10 done | `done` |
| UI-F12 | [对话布局稳定性](068-ui-fixes/spec.md#ui-f12-对话布局稳定性) | UI-F11 done | `done` |
| UI-F13 | [右侧资源区 Tab](068-ui-fixes/spec.md#ui-f13-右侧资源区-tab-切换) | UI-F12 done | `done` |
| UI-F14 | [Header 服务端资源占用](068-ui-fixes/spec.md#ui-f14-header-服务端资源占用) | UI-F13 done | `done` |
| UI-F15 | [项目列表拖拽排序](068-ui-fixes/spec.md#ui-f15-项目列表拖拽排序) | UI-F14 done；用户直接要求 | `done` |
| UI-F16 | [默认工作区点击不创建会话](068-ui-fixes/spec.md#ui-f16-默认工作区点击不创建会话) | UI-F15 done；用户直接反馈 | `done` |
| UI-F17 | [首屏波浪加载](068-ui-fixes/spec.md#ui-f17-首屏波浪加载) | UI-F16 done；用户直接要求 | `done`（用户验收通过，整仓检查有既有失败） |
| UI-F18 | [会话模型与全局默认](068-ui-fixes/spec.md#ui-f18-会话模型与全局默认) | UI-F17 done；用户要求 | `done`（用户验收通过，整仓检查有既有失败） |
| UI-F19 | [会话审批策略恢复](068-ui-fixes/spec.md#ui-f19-会话审批策略恢复) | UI-F18 done；用户反馈 | `done`（用户验收通过，整仓检查有既有失败） |
| UI-F20 | [新会话圆形背景](068-ui-fixes/spec.md#ui-f20-新会话圆形背景) | UI-F19、UI-F9 done；用户要求 | `done` |
| UI-F21 | [新会话动效调整](068-ui-fixes/spec.md#ui-f21-新会话动效调整) | UI-F20、M2-18 done；用户验收 | `done` |
| UI-F22 | [添加项目目录选择](068-ui-fixes/spec.md#ui-f22-添加项目目录选择) | M1-9 done；用户要求 | `done` |

### 2026-11-14 资源恢复回归

- **M2-R1** [保留未核实进程的写入屏障](030-dev-resources/tasks.md#m2-r1-保留未核实进程的写入屏障)（`done`，依赖 M2-7，2026-11-14）。

### 2026-11-12 成果展示与临时文件折叠（074，done）

用户确认「临时脚本折叠进过程」方向，[074 规格](074-result-presentation/spec.md) 已按 D-1～D-5 实现并验证（2026-11-12）。验收记录见 [任务清单](074-result-presentation/tasks.md#验收记录)；真实数据浏览器视觉验收待用户确认。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| RS-1 | [服务端成果分类与终态 `fileResults`](074-result-presentation/spec.md#7-接口与契约变更) | — | `done` |
| RS-2 | [write_file 统一文件结果卡](074-result-presentation/spec.md#7-接口与契约变更) | — | `done` |
| RS-3 | [成果区与过程行渲染](074-result-presentation/spec.md#5-验收场景) | RS-1、RS-2 | `done` |
| RS-4 | [契约与文档同步](074-result-presentation/spec.md#7-接口与契约变更) | RS-1～RS-3 | `done` |
| RS-5 | [验收与状态回填](074-result-presentation/spec.md#11-测试计划) | RS-4 | `done` |

### 2026-11-14 项目资源文件管理器

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| FR-1 | [文件树与编辑器联动](076-file-explorer/tasks.md#fr-1) | M2-2、UI-F13、M2-R1 | `done` |
| FR-2 | [文件名与路径快速打开](076-file-explorer/tasks.md) | FR-1 | `done` |
| FR-3 | [新建、重命名与移动](076-file-explorer/tasks.md) | FR-2 | `done` |
| FR-4 | [文件行仅保留右键菜单](076-file-explorer/tasks.md#fr-4) | FR-3 | `done` |
| FR-5 | [会话快捷键与聚焦搜索](076-file-explorer/tasks.md#fr-5) | FR-2、FR-4 | `done` |
| FR-6 | 快速打开结果列表留白 | FR-5 | `done` |
| FR-7 | Material 文件类型图标 | FR-6 | `done` |
| FR-7-R1 | 统一入口加载文件图标 | FR-7、U0-3 | `done` |
| FR-8 | 文件树工具栏吸顶与磨砂 | FR-7-R1 | `done` |
| FR-9 | 文件工具栏局部磨砂 | FR-8 | `done` |
| FR-10 | 单文件删除与确认 | FR-9 | `done` |
| FR-11 | 公共确认弹窗与危险按钮悬停 | FR-10 | `done` |
| FR-12 | 文件树新建输入与失焦提交 | FR-11 | `done` |
| FR-13 | 目录递归删除与确认 | FR-12 | `done` |
| FR-14 | 文件与目录统一右键操作 | FR-13 | `done` |
| FR-15 | 文件树重命名失焦提交 | FR-14 | `done` |

### 2026-11-16 计划步骤即时更新（079，done）

用户报告「计划不会一步步勾下去，等全部完成才一次性全勾」。诊断确认链路（持久化 / 广播 / 重放 / 渲染）逐条生效，问题在模型行为：提示只有软约束且没有步骤级运行时机制。按用户确认的方向实施 A（提示层加硬）+ B（运行时陈旧提醒）。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| PG-1 | [计划更新行为诊断复核](079-plan-progress/tasks.md#pg-1-计划更新行为诊断复核) | 036 done | `done` |
| PG-2 | [系统提示与工具描述要求同批更新](079-plan-progress/spec.md#7-接口与契约变更) | PG-1 | `done` |
| PG-3 | [运行时计划陈旧提醒](079-plan-progress/spec.md#6-功能需求) | PG-2 | `done` |
| PG-4 | [验证、文档与状态回填](079-plan-progress/tasks.md#验收记录) | PG-3 | `done` |

### 2026-11-16 计划终态呈现（080，done）

079 的附带缺陷：7/18 个有计划的 Turn 计划终态与执行事实不一致（3 个停在 running/pending 被渲染成红叉「未完成」，4 个完成后仍留 pending）。服务端不得改写步骤状态（036），因此单开呈现切片：用回合结局解释未结束的步骤，并如实报出剩余步数。

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| PT-1 | [终态呈现红测试](080-plan-terminal-state/tasks.md#pt-1-终态呈现红测试) | 079 done | `done` |
| PT-2 | [计划终态派生与摘要](080-plan-terminal-state/spec.md#6-功能需求) | PT-1 | `done` |
| PT-3 | [验证](080-plan-terminal-state/tasks.md#pt-3-验证) | PT-2 | `done` |
| PT-4 | [文档与状态回填](080-plan-terminal-state/tasks.md#验收记录) | PT-3 | `done` |

- 开始任务：`todo → in_progress`，在 `STATUS.md` 的「当前进行中」登记。
- 完成：更新 `tasks.md` 与本节状态，把该任务移入 `STATUS.md` 的「最近收口」，提交。
- 阻塞：`blocked` + 原因 + 需要谁决策；解除后回到 `todo`。
- 新增 / 拆分任务：先改本表与对应 `tasks.md`，保持 ID 稳定；不使用“临时任务”绕过依赖。
