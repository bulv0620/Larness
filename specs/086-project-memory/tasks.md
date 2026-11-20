# 任务：项目指令、项目记忆与用户偏好

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> **spec 状态 `ready`；ADR-072 accepted（2026-11-20）。** PM-0 已完成，PM-1 起待开工。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| PM-0 | 规格确认与 ADR | — | `done`（2026-11-20） |
| PM-1 | 指令文件解析与装配 | PM-0 | `todo` |
| PM-2 | 记忆存储、预算与保留期 | PM-0 | `todo` |
| PM-3 | remember/read 工具与自动学习 | PM-2 | `todo` |
| PM-4 | 全局用户偏好与隐私隔离 | PM-2、PM-3 | `todo` |
| PM-5 | 上下文注入与提示 | PM-1、PM-2、PM-3、PM-4 | `todo` |
| PM-6 | REST、WS 与契约 | PM-2 | `todo` |
| PM-7 | 设置页记忆与偏好管理 | PM-6 | `todo` |
| PM-8 | 安全、E2E 与验收 | PM-1～PM-7 | `todo` |

## 任务卡

### PM-0 规格确认与 ADR

- 状态：`done`（2026-11-20）
- 依赖：无
- 目标：把本切片从 `draft` 转 `ready`，冻结范围、自动学习规则与预算默认值。
- 交付物：
  - Q-060～Q-070 的人类确认结果；
  - [ADR-072](../../docs/adr/ADR-072-project-memory.md)：自动学习、证据、预算淘汰、全局偏好与隐私边界；
  - 本 spec 状态、ROADMAP 与 STATUS 更新。
- 验收：
  - D1–D11 全部有明确结论；
  - ADR 记录备选方案、安全影响与回滚；
  - spec 满足 [AGENTS.md §4](../../AGENTS.md) 最小集。
- 测试：无代码测试；文档链接与交叉引用检查。
- 涉及路径：
  - `specs/086-project-memory/spec.md`
  - `docs/adr/ADR-072-project-memory.md`
  - `specs/ROADMAP.md`
  - `STATUS.md`
- 备注：2026-11-20 人类确认按推荐默认实施；spec 转 `ready`，ADR-072 accepted。

### PM-1 指令文件解析与装配

- 状态：`todo`
- 依赖：PM-0
- 目标：项目根目录的 `AGENTS.md` 与 `.larness/instructions.md` 自动加载，与数据库指令合并，且不越出项目根目录。
- 交付物：
  - `resolveProjectInstructions`：来源、顺序、大小/编码/路径校验、优先级截断、警告；
  - `contextAssembler` 接入并保持现有安全标签；
  - `GET /api/projects/:id/instructions` 与项目设置来源展示所需 DTO；
  - 单元与集成测试。
- 验收：
  - A1、A2、A3；
  - 缺失/不可读/二进制/越界链接不终止 Turn；
  - 20k 截断顺序可解释，警告可见；
  - 数据库 instructions 仍生效。
- 测试：
  - 单元：顺序、合并、截断、64 KiB、NUL、symlink、缺失；
  - 集成：system prompt 标签与顺序；越界文件不出现。
- 涉及路径：
  - `apps/server/src/modules/projects/instructions.ts`
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `apps/server/src/api/projects.ts`
  - `apps/server/test/projects/instructions.test.ts`

### PM-2 记忆存储、预算与保留期

- 状态：`todo`
- 依赖：PM-0
- 目标：建立统一记忆存储、状态机、字节预算、淘汰评分、revision 与保留期清理。
- 交付物：
  - Drizzle schema 与 `0034` 迁移：`memories`、`memory_revisions`、`memory_suppressions`；
  - `repository` / `service`：创建、更新、状态转移、忘记、抑制、恢复、过期；
  - `budget`：字节/条数统计、90%/80% 水位、评分与淘汰；
  - `retention`：revision/review/rejected/expired/evicted/suppression 清理；
  - revision 与审计事件；
  - 单元、迁移与预算测试。
- 验收：
  - A6、A10、A11、A12、A15（数据层部分）；
  - active key 唯一；同 key 更新不重复；
  - 固定项不被淘汰；固定项超预算拒绝新写入；
  - active 与总占用（含 revision/review/evicted/suppression）均不超预算；
  - 清理后行数与字节稳定；
  - 迁移在空库与存量库通过。
- 测试：
  - 单元：状态机、key、字节预算、评分顺序、固定项、revision 上限、保留期；
  - 集成：淘汰/恢复、抑制、并发 409、项目删除级联。
- 涉及路径：
  - `apps/server/src/db/schema.ts`
  - `apps/server/drizzle/0034_memory.sql`
  - `apps/server/src/modules/memory/{repository,service,budget,eviction,retention}.ts`
  - `apps/server/src/db/cleanup.ts`
  - `apps/server/test/memory/{repository,service,budget,retention}.test.ts`

### PM-3 remember/read 工具与自动学习

- 状态：`todo`
- 依赖：PM-2
- 目标：Agent 能自动学习有证据的项目事实，且不在同一 Turn 自我强化；工具受 Profile 与项目开关控制。
- 交付物：
  - `remember`、`read_memory`；
  - 证据校验（turn/event/证据类型与 kind 匹配）；
  - 自动 active / review 规则、置信度、限流；
  - 同 Turn 不注入的装配约束；
  - `memory` tool pack，加入 `coding` / `plan`；
  - 工具描述、schema 与 051 契约同步；
  - 工具与装配测试。
- 验收：
  - A4、A7、A13、A14；
  - 成功命令后自动 active；当前 Turn 不出现，下个 Turn 出现；
  - 无效证据/冲突/决策类进入 review；
  - 秘密与高风险内容被拒；
  - 关闭记忆时工具不可用。
- 测试：
  - 单元：参数、证据、scope/kind、置信度、限流、秘密；
  - 集成：Turn 内调用、下个 Turn 注入、同 Turn 隔离、review 可见。
- 涉及路径：
  - `apps/server/src/modules/agent/memoryTool.ts`
  - `apps/server/src/modules/agent/profiles.ts`
  - `packages/agent/src/kernel/profile.ts`
  - `apps/server/src/bootstrap/start.ts`
  - `specs/051-agent-tool-contract/spec.md`
  - `apps/server/test/agent/{memoryTools,memoryContext}.test.ts`

### PM-4 全局用户偏好与隐私隔离

- 状态：`todo`
- 依赖：PM-2、PM-3
- 目标：从用户明确表达中学习少量跨项目偏好，同时不泄漏项目数据。
- 交付物：
  - `scope=global` 只允许 `preference`；
  - 全局写入要求 `user_statement` 证据；
  - 内容过滤：项目路径、代码、项目名、业务数据、秘密；
  - 项目设置 `memory.globalEnabled` 与私有项目行为；
  - 全局偏好列表、编辑、固定、忘记；
  - 单元与集成测试。
- 验收：
  - A8、A9、A13；
  - 用户明确说“以后用 pnpm”后另一项目可见；
  - 项目事实不出现在全局；
  - 私有项目不读写全局偏好；
  - 全局偏好不超 8 KiB / 50 条。
- 测试：
  - 单元：scope/kind 矩阵、证据、内容过滤、预算；
  - 集成：跨项目可见性、私有项目、忘记/抑制。
- 涉及路径：
  - `apps/server/src/modules/memory/service.ts`
  - `apps/server/src/modules/projects/service.ts`
  - `apps/server/src/api/memories.ts`
  - `apps/server/test/memory/global.test.ts`

### PM-5 上下文注入与提示

- 状态：`todo`
- 依赖：PM-1、PM-2、PM-3、PM-4
- 目标：按正确顺序、预算和标记注入指令、全局偏好与项目索引，不污染缓存前缀。
- 交付物：
  - 全局偏好完整注入（≤512 token）；
  - 项目记忆索引（≤1,024 字符）与陈旧标记；
  - `read_memory` 结果上限（5 条 / 1,200 字符）与总量 2,000 token；
  - 注入顺序、稳定排序与省略提示；
  - 系统提示与 `PROMPT_VERSION` bump；
  - 装配与预算测试。
- 验收：
  - A12、A14、A16；
  - 注入顺序正确；
  - 超预算截断有标记；
  - 同一组记忆产生稳定前缀；
  - 会话摘要仍在其后。
- 测试：
  - 单元：全局/项目预算、索引生成、排序、stale/expired；
  - 集成：下个 Turn 注入；关闭后不注入；记忆不能改变工具授权。
- 涉及路径：
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `apps/server/src/modules/agent/tokenEstimator.ts`
  - `apps/server/test/agent/memoryContext.test.ts`

### PM-6 REST、WS 与契约

- 状态：`todo`
- 依赖：PM-2
- 目标：提供记忆与偏好的稳定 API、预算接口与实时事件。
- 交付物：
  - 项目/全局记忆列表、编辑、固定、忘记、恢复、review 接受；
  - 预算接口；
  - `memory.changed` 事件；
  - 错误码、DTO、配置键；
  - `docs/contracts/*` 与 `packages/shared` 同步；
  - API 测试。
- 验收：
  - 认证、CSRF、项目作用域；
  - `expectedUpdatedAt` 并发控制；
  - 事件不含正文；
  - 错误码稳定且不回显秘密；
  - 全局接口只返回 preference。
- 测试：
  - 集成：CRUD、状态转移、409、404、跨项目拒绝、预算；
  - 契约：错误码与事件字段。
- 涉及路径：
  - `apps/server/src/api/memories.ts`
  - `apps/server/src/modules/memory/service.ts`
  - `packages/shared/src/{config,events}.ts`
  - `docs/contracts/{rest-api,ws-events,data-model}.md`
  - `apps/server/test/memory/api.test.ts`

### PM-7 设置页记忆与偏好管理

- 状态：`todo`
- 依赖：PM-6
- 目标：用户能无负担地查看、纠正和管理记忆，而不是逐条审批。
- 交付物：
  - “Larness 记住了什么”：全局偏好 + 当前项目记忆；
  - 预算条、活动记录、review 区、淘汰/恢复；
  - 编辑、固定/取消固定、忘记；
  - 指令来源、截断警告与打开文件入口；
  - `memory.changed` 实时更新；
  - 组件与 E2E 测试。
- 验收：
  - A5、A8、A15（界面部分）；
  - 默认不弹确认、不要求逐条接受；
  - 预算 80%/100% 提示；
  - 忘记有确认与抑制说明；
  - 删除项目显示记忆数量。
- 测试：
  - 组件：列表/筛选/编辑/固定/忘记/恢复/预算；
  - E2E：自动学习 → 下个会话复用；全局偏好跨项目；忘记后不重学。
- 涉及路径：
  - `apps/web/src/features/projects/MemoryPanel.tsx`
  - `apps/web/src/features/projects/MemoryDialog.tsx`
  - `apps/web/src/features/projects/ProjectSettings*.tsx`
  - `apps/web/src/lib/{queries,workspaceApi}.ts`
  - `apps/web/src/lib/eventReducer.ts`
  - `apps/web/src/features/projects/MemoryPanel.test.tsx`

### PM-8 安全、E2E 与验收

- 状态：`todo`
- 依赖：PM-1～PM-7
- 目标：完成跨切面安全验证、长期预算验证与文档收口。
- 交付物：
  - 项目隔离、私有项目、抑制、级联、prompt injection 反例；
  - 秘密写入/注入双向扫描测试；
  - 30 天模拟/加速的预算、保留期与注入量稳定性测试；
  - 真实 server 的自动学习闭环 E2E；
  - 验收记录、ROADMAP/STATUS/契约回填。
- 验收：
  - A1–A16 全部通过；
  - 定向测试、`pnpm check`、`pnpm build` 通过；
  - 工具契约矩阵通过；
  - 未运行项如实记录。
- 测试：
  - 安全：越权、跨项目、私有项目、秘密、注入文本、禁用工具；
  - E2E：AGENTS.md 生效；自动学习/复用；全局偏好；忘记；
  - 长期：模拟 30 天写入/更新/淘汰，断言字节与注入 token 稳定；
  - 手动：设置面板、预算条与陈旧提示视觉检查。
- 涉及路径：
  - `apps/server/test/memory/security.test.ts`
  - `apps/server/test/memory/longRun.test.ts`
  - `apps/web/e2e/**`（按现有 E2E 结构）
  - `specs/086-project-memory/acceptance.md`
  - `specs/ROADMAP.md`
  - `STATUS.md`
