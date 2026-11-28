# 架构决策记录（ADR）

> 已冻结决策不可静默修改。需要变更时新增 ADR，说明背景、替代方案、风险、迁移与回滚，经人类批准后生效。
> 格式参考文末模板；新 ADR 文件放在本目录，命名 `ADR-0xx-<slug>.md`，并更新本索引。

## 1. 产品与边界（冻结）

| ID | 决策 | 理由 / 后果 |
|---|---|---|
| ADR-001 | 单实例、单工作空间、多授权客户端 | 不做多租户；所有客户端共享业务数据，仅视图状态独立 |
| ADR-002 | 可信开发机模式：项目内常规操作允许，越界与敏感操作审批 | 不声称沙箱；恶意 Shell 仍是残余风险 |
| ADR-003 | 同项目写任务串行，跨项目可并发 | 同会话单 Turn；资源级锁协调共享目标 |
| ADR-004 | 临时 PTY 不跨 Larness 重启恢复 | 重启后标记中断；PM2 服务独立持久化 |
| ADR-005 | 统一构建 → 策略授权 → PM2 部署 → 健康检查 → 记录 | 依ADR-042补充：人工审批为条件分支，autonomous免人工；授权/审计不可绕过 |
| ADR-006 | 设备准入只经本机 TUI 或预置离线恢复码 | Web 设备不能批准新设备；TUI 不可用则拒绝 |
| ADR-007 | 自动检查更新，手动安装，等待任务安全点 | 原决策；更新器、锁与回滚要求由 [ADR-055](ADR-055-npm-update-security.md) 替代 |
| ADR-008 | DeepSeek / GLM 优先，每 Turn 固定模型 | 多 Key Profile；切模型只影响下一轮 |
| ADR-009 | 所有代码与服务运行在 Larness 本机 | 不设计 SSH / Docker / 远程节点 |
| ADR-010 | 三栏 Chat-first + 顶部入口 + 全局悬浮多 Tab | 右栏四分区可同时展开；无底部 Dock |
| ADR-011 | 内嵌预览仅限本机已登记 Web 服务 | 地址栏可输 `localhost:5173`；不做 Electron 窗口远控 |
| ADR-012 | 开发服务 Native、长期服务 PM2 | Larness 自身由 OS 服务管理器 / Launcher 守护 |

- [ADR-031 项目窗口与终端交互](ADR-031-project-resource-windows.md)：accepted（2026-11-04 人类直接指定），项目浮栏 / 窗口归属 / 手动 Shell AI 交接。

- [ADR-032 共享默认工作区](ADR-032-shared-default-workspace.md)：accepted（2026-11-04 人类确认），新未关联会话共享目录、旧独立目录不变。
- [ADR-033 纯终端体验](ADR-033-terminal-experience.md)：accepted（2026-11-04 人类要求继续优化）；Tab 控制菜单、空闲人工 Shell 直接输入、本机账户默认 Shell。
- [ADR-034 固定默认项目](ADR-034-default-system-project.md)：accepted（2026-11-04 人类明确要求）；默认工作区进入项目树，服务端禁止修改 / 删除，保留旧资源域。



- [ADR-035 紧凑对话流与底部审批](ADR-035-conversation-presentation.md)：accepted（2026-11-04 用户审批预览并要求重构）；真实任务计划、过程折叠、底部审批和小型资源浮栏。

- [ADR-036 对话区复用外围视觉语言](ADR-036-conversation-theme.md)：accepted（2026-11-04 用户直接要求）；保持结构，统一主题色/状态/按钮/阴影。

- [ADR-037 回复消息框与紧凑审批](ADR-037-message-bubbles.md)：accepted（2026-11-04 用户直接要求）；消息框、回复时间、紧凑审批与隐藏记录。

- [ADR-038 Agent 终端的 Shell 生命周期](ADR-038-agent-terminal-shell.md)：accepted（2026-11-04 用户明确要求）；初始命令退出/中断后保留交互 Shell，显式关闭才终止终端。

## 2. 实现决策（本仓库冻结）

| ID | 决策 | 说明 |
|---|---|---|
| ADR-013 | 轻量自定义 spec 工作流 | `specs/<slice>/{spec,plan,tasks}.md` + 根宪法 + 模板；不引入 spec-kit 工具链 |
| ADR-014 | pnpm workspace + TypeScript strict + Fastify 5 + React/Vite | 详见 [stack.md](../architecture/stack.md)；单体优先 |
| ADR-015 | SQLite 使用 better-sqlite3 + Drizzle ORM | 同步 API 简单、迁移可审查；不引入 Prisma / TypeORM |
| ADR-016 | V1 设备凭据使用 opaque token，WebAuthn 作为 P1 | **已由 ADR-021 替代**（2026-10-31）；保留原文作为历史 |
| ADR-017 | 视觉 Demo 使用 MockGateway，不造假后端 | 同一客户端接口，M1 替换为真实 API；禁止把 mock 当完成证据 |
| ADR-018 | 事件序号按 Session 递增，而非按 Turn | UI 重放与排序更简单；`turnId` 仍记录在事件上；与源文档的差异在此登记 |
| ADR-019 | ID / 时间 / 错误码统一约定 | `<prefix>_<uuid>`、Unix ms、稳定错误码；见 `docs/contracts/rest-api.md` |
| ADR-020 | 文档与 UI 中文优先，代码标识符英文 | 降低沟通成本；字符串集中管理，后续可国际化 |
| ADR-021 | V1 使用 Passkey / WebAuthn 作为可信凭据，不签发长期设备 Token | 见 [ADR-021](ADR-021-passkey-v1.md)；`allow_once` 仍保留为临时访问 |
| ADR-022 | 产品名与内部命名空间统一为 Larness | 见 [ADR-022](ADR-022-product-name-larness.md)；M0 前完成，无兼容别名 |
| ADR-023 | TUI 作为受管前台入口，关闭即停止全部，不提供 headless | 见 [ADR-023](ADR-023-tui-as-managed-entry.md)；替代 R-23 的常驻语义 |

## 初始化修复补充决策

- [ADR-024 初始化恢复与主密钥完整性](ADR-024-initialization-recovery.md)：accepted，2026-11-02 人类批准。

- [ADR-025 取消未接入使用流程的初始化密码](ADR-025-remove-unused-init-password.md)：accepted，2026-11-02 人类明确批准取消密码、保留历史哈希；补充 ADR-024。

- [ADR-026 开发期直接调整契约，撤回 IPC v2](ADR-026-development-contract-reset.md)：accepted，2026-11-02 人类明确批准；替代 ADR-025 的 v2 升级条款，授权本次本地数据清理。

## TUI 交互补充决策

- [ADR-027 TUI 独立屏幕与单一输入所有者](ADR-027-tui-screen-and-input.md)：accepted；2026-11-02 人类确认开始实现，G-Spec-TUI 通过，T0-1 → T0-2 → T0-3 先于 M2。

## 统一入口补充决策（待评审）

- [ADR-028 开发与打包运行共用入口和实例配置](ADR-028-unified-dev-entry.md)：accepted；2026-11-02 文档完成后人类明确“开始实现”，批准 G-Spec-U 和 U0-1→U0-2→U0-3 先于 M2。原 ADR-023/025 原文保留，接线完成前不宣称入口已切换。

## M2 开发资源补充决策（待评审）

- [ADR-029 开发资源的执行、审批与锁边界](ADR-029-development-resource-execution.md)：accepted（2026-11-02 人类要求开始 M2，并明确按最新 spec）；含完整 AI 终端交互、并发写边界、人工 Git 审批与回放限额，先 M2-0，G-PoC-M2 待人类确认。

## 资源生命周期与服务分工补充决策

- [ADR-030 窗口、终端 Tab 与两类服务的生命周期](ADR-030-resource-lifecycle-and-services.md)：accepted（2026-11-02 人类明确产品规则并要求补齐文档）。替代 resource-views 的终端 Tab 纯视图关闭与服务 Tab 设计，补充宪法第八条 / ADR-012；临时服务由 Terminal 控制、服务模块只登记展示与转发，持久服务由 PM2 管理；服务窗口无 Tab。原 ADR 条目保留，具体差异以 ADR-030 为准。此接受不等于 M2/M3 技术规格或 ADR-029 全部批准。

## 3. 变更流程

1. 复制模板生成新 ADR，状态 `proposed`。
2. 描述：背景、当前决策、问题、备选方案、影响面（PRD / API / DB / 安全 / 迁移）、验证方式、回滚。
3. 更新本文件索引，并在 `STATUS.md` 标记“等待决策”。
4. 人类批准后改为 `accepted`；同步修改宪法 / spec / 契约 / 代码。
5. 被替代的 ADR 标记 `superseded by ADR-0xx`，保留原文。

## 4. 模板

```md
# ADR-0xx: <标题>

- 状态：proposed | accepted | superseded by ADR-0yy
- 日期：YYYY-MM-DD
- 决策者：<人类负责人>
- 关联：<spec / issue / PR>

## 背景
## 决策
## 备选方案
## 影响
- 产品 / UI：
- API / 契约：
- 数据 / 迁移：
- 安全 / 权限：
- 兼容性：

## 验证与回滚
## 后续
```

- [ADR-039 文档窗口关闭与最小化](ADR-039-window-close.md)：accepted，按用户直接指定调整三种文档窗口关闭，终端/服务生命周期不变。

- [ADR-040 完全自主审批策略](ADR-040-autonomous-policy.md)：accepted，用户明确要求免人工工具审批并风险确认；保持执行授权/范围/锁/审计。

- [ADR-041 Git 逐文件放弃与取消暂存](ADR-041-git-file-actions.md)：accepted（2026-11-05用户直接要求）；确认后放弃未暂存内容、取消暂存保留磁盘文件，不扩展为全仓/自动清理。

- [ADR-042 开发运行/正式发布边界与策略化部署授权](ADR-042-service-deploy-boundary.md)：accepted（2026-11-05用户明确决定）；M3开发预览、M4全部PM2/持久发布；自主含部署完全免人工，旧005/030/040原文由此补充，不代表G-Spec/实现通过。

- [ADR-043 开发预览来源、票据与服务执行身份](ADR-043-development-preview-authorization.md)：accepted（2026-11-05 人类按 M3 评审包推荐批准，仅先做 M3-0）；独立来源、凭据交换、执行身份/失效和 PoC 门禁。第 5 条的通配监听限制由 [ADR-044](ADR-044-preview-binding-simplification.md) 修订；远程 HTTPS 实测仍未完成。

- [ADR-044 服务登记不再限制绑定地址，预览按已核验本地地址拨号](ADR-044-preview-binding-simplification.md)：accepted（2026-11-05 人类要求简化）；修订 ADR-043 第 5 条，身份/票据/隔离约束继续有效。

- [ADR-045 临时服务可独立停止或删除](ADR-045-independent-service-stop-delete.md)：accepted（2026-11-05 人类要求“服务本身可以被终止删除”）；服务停止保留 Shell，删除退登卡片，见 ADR-030。

- [ADR-046 PM2 交付与正式服务退出边界](ADR-046-pm2-delivery-and-lifecycle.md)：accepted（2026-11-06）。TUI 检查全局 PM2 并在缺失时补装；管理进程异常退出或正常退出 TUI 时正式服务继续运行，重开后对账并展示实际状态。补充 ADR-023，安装与接入细节待 M4-0。

- [ADR-047 正式服务的服务运维入口](ADR-047-service-operations-entry.md)：accepted（2026-11-06）。正式 PM2 服务通过左侧「服务运维」管理，聊天服务浮窗仅显示临时开发服务。补充 ADR-030/042 的展示规则，按 M4-3b 交付。
- [ADR-049 服务运维改为弹窗](ADR-049-service-ops-dialog.md)：accepted（2026-11-06，用户直接要求）。左侧入口打开弹窗，不新增 `/service-ops` 路由；ADR-047 的“独立页面”展示条款由本 ADR 替代。

- [ADR-048 会话开发服务与正式服务运维分域](ADR-048-service-domain-separation.md)：accepted（2026-11-06）。分离资源、数据、REST、事件、Agent 工具与执行上下文。鉴权、策略等基础设施可复用，正式部署保留来源追溯。补充 ADR-030/042/047。

- [ADR-050 Agent 通过命令行部署 PM2 服务](ADR-050-pm2-cli-deployment.md)，accepted（2026-11-07，用户明确要求）。复用普通会话命令工具，注入真实 PM2 环境，通过稳定命名关联服务与项目。替代 ADR-042/046/048 的专用流水线和模型工具入口条款，原文保留。

## ADR-051 · 服务运维人工启停（2026-11-07）

accepted，用户明确要求。服务运维与项目服务窗视觉一致，认证人类按准确服务执行启停/重启，独立人工接口保留认证/CSRF、归属、锁/fencing、幂等和审计；Agent 保持通用命令。见 [ADR-051](ADR-051-human-pm2-service-control.md)。

## ADR-052 · 所属项目 PM2 日志读取（2026-11-07）

accepted，用户明确批准。允许精确 PM2 登记且属于本项目的普通日志，保留 canonical 边界/身份/脱敏/限额；历史项目路径不授予权限。同次修复前端 CSRF/JSON，并展示私有实例查询命令。[ADR-052](ADR-052-project-pm2-log-reading.md)。

## ADR-053 · DeepSeek 官方模型目录与思考档位（2026-11-07）

accepted，用户直接指定方向。旧模型 Profile 全部忽略（保留数据不删除），改为官方目录驱动的模型选择；思考默认开启，档位随 Turn 固定；推理数据先实测、暂不落库；圆环改为单次请求口径；输入框按 Codex 风格提供模型 / 档位浮层。见 [ADR-053](ADR-053-model-catalog-thinking.md) 与 [061 spec](../../specs/061-deepseek-integration/spec.md)。

## ADR-054 · 定时任务的执行、权限与恢复边界（2026-11-07）

accepted，用户确认 D1–D4。单进程 SQLite 调度；5 字段 Cron + `cron-parser`，任务显式时区，错过默认 skip / 可选 run_once；同任务不重叠、全局并发 2；脚本以 `node` 子进程在项目根目录执行，非沙箱、环境白名单、输出有界脱敏；Agent 任务只允许 `readonly` / `autonomous`，专用隐藏会话；仅应用内通知；重启不自动重跑。见 [ADR-054](ADR-054-scheduler-execution.md) 与 [064 spec](../../specs/064-scheduler/spec.md)。

## ADR-055 · npm 手动更新与数据库恢复（2026-11-09）

accepted，2026-11-09 人类明确确认。对齐 M5-3 的 npm 分发、手动更新和迁移前备份，明确更新信任边界与人工恢复要求。见 [ADR-055](ADR-055-npm-update-security.md)。

## ADR-056 · 依赖主版本与工具链分批升级（2026-11-09）

accepted，2026-11-09 人类明确批准。为 AI SDK、SQLite 原生模块、Web 与构建工具链列出独立升级和验收批次。见 [ADR-056](ADR-056-dependency-major-upgrades.md)。

## ADR-057 · 运行时效率：稳定前缀、预算终态与长 Turn 检查点（2026-11-11）

accepted，2026-11-11 人类直接确认 D1–D7 全部采用推荐方案。system 只放 Turn 起点快照以保证续步前缀稳定，资源观察改为显式刷新（替换 [命令上下文契约](../contracts/agent-command-context.md) 的每步刷新条款）；预算与输出截断用 `terminal_reason` 表达，自动化不再记成功；截止时间贯穿模型、摘要与工具；长 Turn 检查点复用摘要表并只以已持久化事件为事实来源。见 [ADR-057](ADR-057-runtime-efficiency.md) 与 [070 spec](../../specs/070-runtime-efficiency/spec.md)。

## ADR-058 · 中断 Turn 的接手恢复与事件保留策略（2026-11-11）

accepted，2026-11-12 人类直接确认 D1–D4 全部采用推荐方案。恢复通过新建 Turn 接手、旧 Turn 不可变且不自动续跑（避免重复副作用）；清理默认 dry-run 不删数据，开启后按会话整段删除并要求先备份与审计。见 [ADR-058](ADR-058-turn-recovery-retention.md) 与 [071 spec](../../specs/071-turn-recovery/spec.md)。

## ADR-059 · 长任务的分片预算与自动接续（2026-11-12）

accepted，用户在三档中明确选择激进档：任务级 token 预算、自动接续与接续深度上限。**任务级默认值部分已由 [ADR-071](ADR-071-long-task-continuity.md)（2026-11-19）取代**：默认不再设任务级 token 上限，改为 24h / 1000 步紧急兜底与 85% 上下文换页；接续事件、检查点、usage 与安全约束保留。见 [ADR-059](ADR-059-long-task-budget-and-continuation.md)。

## ADR-060 · 本机预览默认开启（2026-11-13）

accepted，用户直接确认。`preview.enabled` 缺省为 `true`，显式关闭继续生效。见 [ADR-060](ADR-060-local-preview-default.md)。

## ADR-061 · Windows 交互终端默认 Shell（2026-11-13）

accepted，用户确认 PowerShell 7 → Windows PowerShell 5.1 → CMD 的选择顺序并授权实施。见 [ADR-061](ADR-061-windows-terminal-shell.md)。

## ADR-062 · 模型连接与能力目录（2026-11-14）

accepted，2026-11-14 用户要求按方案实施。连接预设及版本管理、会话按模型选择、目录数据独立更新与可追踪的字段来源。见 [ADR-062](ADR-062-model-connections-and-capabilities.md) 和 [077 规格](../../specs/077-model-connections/spec.md)。

## ADR-063 · 模型管理与选择按 Key 分组（2026-11-15）

accepted，用户明确指定并授权实施。设置与会话模型选择按 Key 展开，会话按钮只显示模型名和可用的思考档位。部分替代 ADR-062 的界面决策。见 [ADR-063](ADR-063-key-first-model-ui.md)。

## ADR-064 · 会话两级模型菜单与模型行右键操作（2026-11-15）

accepted，用户明确指定四项调整。恢复会话两级菜单、设置模型行右键操作、兼容平台末尾和测试调用反馈。见 [ADR-064](ADR-064-model-menu-refinements.md)。

## ADR-065 · 模型行内操作（2026-11-15）

accepted，按用户要求单击展开模型操作、隐藏行置灰。替代 ADR-064 的模型行右键交互。见 [ADR-065](ADR-065-inline-model-actions.md)。

## ADR-066 · 人工 Git 拉取与推送（2026-11-15）

accepted，人工 Git 面板显式发起的推拉直接按项目、快照和客户端授权。见 [ADR-066](ADR-066-human-git-remote-actions.md)。

## ADR-067 · Agent 内核轻量化（2026-11-16）

accepted，用户要求「把应该优化的都一步步优化」。运行时观察移出缓存前缀、作为尾部独立消息；服务生命周期文案只写一份；纯只读批次并发预取但事件与消息顺序不变；单批结果 12 000 token 预算从最旧折叠；system 增加精炼输出约束（`PROMPT_VERSION` → `m6-3`）。REST / WS / 数据库零变更。见 [ADR-067](ADR-067-lean-agent-context.md) 与 [081 规格](../../specs/081-agent-lean/spec.md)。

## ADR-068 · Agent 内核与人类操作面分离（2026-11-18）

accepted，2026-11-18 人类确认 082 spec、本 ADR 与 Q-042～Q-050 全部推荐默认；内测允许破坏性重构，存量会话不保留旧能力。单循环、无 subagent；新增 coding/plan/workspace Profile；模型移除 Git 与交互终端工具，Git/终端/PM2/预览保留为人类操作面；Agent 使用后台进程与命名服务；计划降级为 plan Profile；锁域收敛为 ProjectLease + ServiceLease；审计分级为安全关键/资源操作/调试；命令采用 run_command 结构化 + run_shell 平台 shell 双路径。替代 ADR-030 的 Agent 终端服务模型与 ADR-038 的 Agent 终端交互规则；ADR-048/059/060 不替代。见 [ADR-068](ADR-068-agent-kernel.md)、[K-1 基线](../../specs/082-agent-kernel/baseline.md) 与 [082 规格](../../specs/082-agent-kernel/spec.md)。

## ADR-069 · 项目开发服务与全局 PM2 运维分离（2026-11-18）

accepted，人类明确要求 coding 直接启动项目后台开发服务、项目服务显示这些任务、预览手动点击才注册、终端纯人类、workspace 改为服务运维并管理 Larness 隔离 PM2。见 [ADR-069](ADR-069-project-services-and-service-ops.md) 与 [083 规格](../../specs/083-service-model/spec.md)。

## ADR-070 · Agent Profile 收敛与会话用量统计（2026-11-18）

accepted，2026-11-18 人类审核通过 084 spec 并指示开始实施。Profile 只保留 `coding` / `plan`（旧 `service-ops` 迁移为 `coding`），两者共享完整工具面，`plan` 仅额外拥有 `update_plan` 与计划提示；输入框下方给出会话累计 Token 与最后一步实测输出速度。前端呈现措辞由文末 2026-11-24 修订收窄，聚合与接口语义不变。见 [ADR-070](ADR-070-agent-profiles-and-usage.md) 与 [084 规格](../../specs/084-agent-profiles-and-usage/spec.md)。

## ADR-071 · 长任务连续执行（2026-11-19）

accepted，2026-11-19 人类确认 085 全部推荐默认：默认关闭任务级 token 上限，紧急兜底改为 24h / 1000 步；输入窗口 85% 触发上下文换页，新增 `terminalReason=continued`；无工具事实时使用最近消息 + 摘要承接；单次请求、命令、锁与审批超时保留；无进展 10 分钟暂停。取代 ADR-059 的任务级默认值，保留接续事件、检查点、usage 统计与安全约束。见 [ADR-071](ADR-071-long-task-continuity.md) 与 [085 规格](../../specs/085-long-task-continuity/spec.md)。

## ADR-072 · 项目记忆与用户偏好（2026-11-20）

accepted，2026-11-20 人类确认按 086 推荐默认实施：只加载 `AGENTS.md` + `.larness/instructions.md`；项目 fact/command/gotcha 证据有效且置信度 ≥0.6 自动 active，decision 默认 review，全局 preference 仅用户明确表达且 ≥0.9 自动 active；硬字节预算、评分淘汰与保留期；记忆作为不可信事实注入，不参与授权。见 [ADR-072](ADR-072-project-memory.md) 与 [086 规格](../../specs/086-project-memory/spec.md)。

## ADR-073 · 联网搜索：普通 Agent 工具、独立搜索连接与默认关闭（2026-11-20）

accepted，2026-11-20 人类确认 087 决策：默认关闭、会话级地球开关显式开启；先支持 DeepSeek 与 GLM，Provider 层保持通用；搜索 Key 与模型 Key 完全隔离；`web_search` L0、`fetch_url` L1，配合每 Turn 配额、结果上限、秘密扫描与 URL 白名单；不使用厂商内置 server-side 搜索。输入框加号按钮改为地球按钮。见 [ADR-073](ADR-073-web-search.md) 与 [087 规格](../../specs/087-web-search/spec.md)。

## ADR-074 · 文档与图片附件：适配器抽取、能力路由与按需读取（2026-11-23）

accepted，2026-11-23 人类确认 088 方案、气泡外附件布局与 Q-071～Q-076 全部推荐默认：格式矩阵 PDF/DOCX/PPTX/XLSX/HTML/CSV/TXT/MD/PNG/JPEG/WebP；`auto-local` 只使用本机 OCR，云端视觉默认关闭；20 MiB/文件、8 个/轮、200 个/会话、400 页、单文件 8k token、附件总预算 15%；v1 用 JSON Base64 上传；纯 JS 解析依赖，不引入原生 canvas；扫描 PDF 首版不渲染。统一 `AttachmentArtifact` 契约；文档走本地可插拔抽取器，图片按模型能力原图透传或 OCR/视觉降级；大文档只注入目录并用 `read_attachment` / `search_attachment` / `list_attachments` 按需读取；附件正文为不可信数据；新文件落盘，旧截图行兼容；附件区位于消息气泡之外。`doc-extract` 黑盒只作为适配器，不作为唯一实现。见 [ADR-074](ADR-074-document-attachments.md) 与 [088 规格](../../specs/088-document-attachments/spec.md)。

## ADR-075 · 单一 Agent 模式、plan 常驻与项目指令层级（2026-11-27）

accepted，2026-11-27 人类确认移除 coding/plan 切换：保留一个通用模式，`update_plan` 常驻并按“3+ 步”提示使用；旧 `plan` 作为行为一致的兼容别名，不删 `agent_profile` 列、不做破坏性迁移。当前计划注入 tail，模型在当前 Turn 计划仍有 pending/running 步骤却停止时 nudge 一次；上一 Turn 旧计划不触发。项目指令改为“可遵循的项目约定，但不能授权/批准/覆盖安全”，并允许项目指令提高验证门禁（如提交前 `pnpm check`）。`PROMPT_VERSION` 升为 `095-1`。见 [ADR-075](ADR-075-single-agent-mode.md) 与 [095 规格](../../specs/095-single-agent-mode/spec.md)。

## ADR-076 · 命令 allowlist 与本轮审批复用（2026-11-27）

accepted，2026-11-27 人类选择「allowlist + 本轮批量」：默认仍 `standard`；`git status/diff/log/show/rev-parse/ls-files`、受限 `git branch`、`pnpm/npm/yarn` 的 `test|check|typecheck|lint|build|verify` 脚本、`rg/ls/pwd`、`node --version` 等只读/验证命令降为 L1 自动放行；`run_shell` 只接受无元字符/引号/绝对或 `..` 路径的同一组简单命令。用户批准一次后，同一 Turn 内相同 `toolName + 规范化参数哈希` 不再询问；不跨 Turn、不持久化。L3 在 standard/strict 仍 deny；`autonomous` 既有语义不改；allowlist 不是沙箱。见 [ADR-076](ADR-076-command-allowlist-and-turn-approvals.md) 与 [096 规格](../../specs/096-command-approvals/spec.md)。

## ADR-077 · 服务生命周期命令与 TUI 附加模式（2026-11-28）

accepted，2026-11-28 用户确认恢复「服务与 TUI 分离」：`start` 以 detached 子进程后台启动打包管理面并写 `daemon.log`；`stop` 经 IPC `server.shutdown` 优雅关闭并等待锁 / 端口 / IPC 释放，未运行幂等成功；`tui` 只附加，`q` / Ctrl+C 只退出面板；`status` 默认人读、`--json` 保留；`logs` 只读当前数据目录的 `larness.log` / `daemon.log`，支持 `--lines 1–1000`、`--daemon`、`--follow`；新增 `restart`，对 dev 实例拒绝；裸 `larness` 只打印帮助。`pnpm dev` 保持前台受管（Vite + 源码 Server，退出即停止），`start` 只运行构建产物。替代 ADR-023 的前台单入口 / 退出停全部条款，补充 ADR-028 / ADR-046；PM2 守护与正式服务不被 `stop` 触碰。见 [ADR-077](ADR-077-service-lifecycle-commands.md) 与 [112 spec](../../specs/112-lifecycle-commands/spec.md)。
