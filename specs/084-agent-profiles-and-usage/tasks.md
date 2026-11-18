# 任务：Agent Profile 收敛与会话 Token 统计

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| AP-1 | 规格决议、ADR、计划与任务卡 | — | `done` |
| AP-2 | Profile 收敛、提示、迁移与选择器 | AP-1 | `done` |
| AP-3 | 会话用量 API 与步骤耗时 | AP-1 | `done` |
| AP-4 | 输入框下方用量与最后一步速度 | AP-3 | `in_progress` |
| AP-5 | 过程呈现收敛（状态行、波形、思考） | AP-1 | `todo` |
| AP-6 | 全量验证、契约与状态回填 | AP-2～AP-5 | `todo` |

## 任务卡

### AP-1 规格决议、ADR、计划与任务卡

- 状态：`in_progress`
- 依赖：无
- 目标：把 2026-11-18 的审核结论固化为 spec 决议、ADR-070、实施计划与可执行任务卡。
- 交付物：
  - `spec.md` 状态 `active`，§12 改为已确认决议；
  - `docs/adr/ADR-070-agent-profiles-and-usage.md`（accepted）；
  - `plan.md`、`tasks.md`；
  - ROADMAP §8.10 任务行、STATUS「当前进行中」。
- 验收：
  - Profile、`plan` 语义、PM2 观察、usage 显示与旧会话处理都有明确决议；
  - ADR-070 明确取代 ADR-069 的独立 Service Ops Profile 决策。
- 测试：仅文档；链接与状态一致性检查。
- 涉及路径：`specs/084-agent-profiles-and-usage/*`、`docs/adr/ADR-070-agent-profiles-and-usage.md`、`specs/ROADMAP.md`、`STATUS.md`。
- 备注：不写产品代码。

### AP-2 Profile 收敛、提示、迁移与选择器

- 状态：`todo`
- 依赖：AP-1
- 目标：Profile 只剩 `coding` / `plan`，两者共享完整工具面，`plan` 仅多计划能力；旧 `service-ops` 会话迁移为 `coding`。
- 交付物：
  - `AgentProfileId` 与数据库类型收敛；
  - `TOOL_PACK_CATALOG`：`coding` = read/write/command/process/serviceOps，`plan` = 同前 + plan；
  - 系统提示：两者都有后台任务与 PM2 契约，`plan` 加计划策略；Coding 加验证比例原则；
  - 不再注入 PM2 观察快照；`refresh_observations` 退出模型面；
  - REST 枚举、Web 选择器、脚本与测试夹具更新；
  - 迁移 `0034` 与 schemaVersion 断言。
- 验收：A1、A2、A3、A7。
- 测试：Profile catalog 正反例、旧值归一、迁移、上下文组装、Web 选择器。
- 涉及路径：`packages/agent/src/kernel/profile.ts`、`apps/server/src/modules/agent/{profiles,contextAssembler,turnRunner}.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/modules/sessions/*`、`apps/server/src/api/sessions.ts`、`apps/web/src/features/chat/Composer.tsx`、`apps/web/src/lib/workspaceApi.ts`、`apps/server/drizzle/*`。
- 备注：不改审批策略语义；`plan` 不是权限边界。

### AP-3 会话用量 API 与步骤耗时

- 状态：`todo`
- 依赖：AP-1
- 目标：提供会话级 usage 聚合与模型步骤耗时，供前端诚实展示。
- 交付物：
  - `GET /api/sessions/:id/usage`，返回 input/output/total/cache 已知值、缺失 Turn 数、partial 标记与更新时间；
  - 聚合纯函数：只统计终态 Turn，解析 `usage_json`，缺失不补零；
  - `model.usage` 增加 `durationMs`；
  - 契约文档同步（REST、WS 事件、数据模型、051）。
- 验收：A4、A5、A6 的服务端部分。
- 测试：多 Turn 聚合、缺失 usage、无 Turn、404；`model.usage` 正反例。
- 涉及路径：`apps/server/src/modules/sessions/{usage,service}.ts`、`apps/server/src/api/sessions.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`docs/contracts/*`。
- 备注：不新增表；不记录消息内容。

### AP-4 输入框下方用量与最后一步速度

- 状态：`todo`
- 依赖：AP-3
- 目标：输入框下方常驻会话累计 Token，进行中显示最后一步实测速度；缺失时明确标注。
- 交付物：
  - `SessionUsageLine` 组件与格式化函数；
  - 会话用量查询与终态失效接线；
  - 速度从 `model.usage.outputTokens / durationMs` 计算，只在 streaming 时显示；
  - 缺失 usage 显示 `≥` 与“部分统计”提示。
- 验收：A4、A5、A6。
- 测试：格式化、部分统计、无 usage 隐藏、速度正反例、会话切换。
- 涉及路径：`apps/web/src/features/chat/{Composer,SessionUsageLine}.tsx`、`apps/web/src/lib/{queries,workspaceApi,eventReducer}.ts`、`apps/web/src/stores/timelineStore.ts`。
- 备注：不做字符估算与逐字速度。

### AP-5 过程呈现收敛（状态行、波形、思考）

- 状态：`todo`
- 依赖：AP-1
- 目标：删除底部独立状态栏，把执行状态收敛到过程折叠标题行；reasoning 只显示 `Thinking...` 状态。
- 交付物：
  - `TurnView` 标题行：左侧波形、`Thinking...` / `Generating...` / `Running...` / `Waiting for approval...` / `Starting...` / `Completed · 100s` / `Failed · 100s` / `Stopped · 100s`；右侧展开箭头；
  - 流动背景与 `prefers-reduced-motion` 静态回退；
  - reasoning 文本不渲染、不触发自动滚动；
  - 完成态默认折叠，计划卡在上、过程行在下；
  - 删除 `Timeline` 底部状态栏及旧 spinner。
- 验收：A8、A9。
- 测试：状态派生、思考文本隐藏、完成/失败/停止耗时、展开、滚动不因 reasoning 触发。
- 涉及路径：`apps/web/src/features/chat/{Timeline,TimelineItemView}.tsx`、相关 CSS 与测试。
- 备注：不新增后端事件或 API。

### AP-6 全量验证、契约与状态回填

- 状态：`todo`
- 依赖：AP-2～AP-5
- 目标：完成门禁、文档与切片收口。
- 交付物：
  - `pnpm check`、`pnpm build`、Mock / 认证 / 生产 E2E（按环境实际执行并如实记录）；
  - 契约与 051 工具说明同步；
  - ROADMAP、STATUS、tasks 收口；遗留问题如有新增则登记。
- 验收：A1～A9 的自动化覆盖；未运行项如实标注。
- 测试：整仓门禁与 E2E。
- 涉及路径：全仓与状态文档。
- 备注：失败项定点复跑，不冒充全绿。
