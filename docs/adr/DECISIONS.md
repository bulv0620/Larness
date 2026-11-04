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
| ADR-005 | 统一构建 → 审批 → PM2 部署 → 健康检查 → 记录 | 生产变更不可绕过审批与审计 |
| ADR-006 | 设备准入只经本机 TUI 或预置离线恢复码 | Web 设备不能批准新设备；TUI 不可用则拒绝 |
| ADR-007 | 自动检查更新，手动安装，等待任务安全点 | 外部 Updater 执行，不强杀执行中的任务 |
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
