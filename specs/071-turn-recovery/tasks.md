# 任务：Turn 恢复与数据保留

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 依赖顺序：TR-0 → TR-1 → TR-2 → TR-3 → TR-4。**破坏性清理（TR-4）放最后**，前三项只有新增接口与只读逻辑。
> 本切片依赖 070 的 HX-7（检查点事实）与 HX-1（用量口径）；两者未交付时 TR-2 只能基于事件直接提取事实。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| TR-0 | 规格与 ADR 草案 | — | `review` |
| TR-1 | 数据体积诊断（只读） | TR-0 | `done` |
| TR-2 | 中断 Turn 恢复（新 Turn 接手） | TR-0、070 HX-7 | `done` |
| TR-3 | 恢复入口与确认交互 | TR-2 | `todo` |
| TR-4 | 保留策略与清理执行 | TR-1、TR-0 | `todo` |

## 任务卡

### TR-0 规格与 ADR 草案

- 状态：`review`（2026-11-11 草案提交，待人类确认 D1–D4）
- 依赖：无
- 目标：明确恢复语义与保留边界；把「删除数据」这类破坏性操作前置到人工批准。
- 交付物：
  - `specs/071-turn-recovery/{spec,plan,tasks}.md`
  - `docs/adr/ADR-058-turn-recovery-retention.md`（`proposed`）
  - 路线图、切片索引、`docs/open-questions.md` 登记
- 验收：spec 满足 AGENTS.md §4 最小集；D1–D4 有推荐方案与影响说明。
- 测试：文档相对链接与锚点校验。
- 涉及路径：`specs/071-turn-recovery/`、`docs/adr/`
- 备注：D1（新建 Turn vs 原地复活）、D3（清理默认关闭）未确认前，TR-4 不得开工。

### TR-1 数据体积诊断（只读）

- 状态：`done`（2026-11-12）
- 依赖：TR-0
- 目标：让"数据库有多大、哪些会话最占空间、清理会删多少"可观测，为 D2 提供真实数据。
- 交付物：
  - 各表行数、字节、最旧/最新时间；数据目录占用；
  - 候选清理集合的条数与预计释放字节（**只计算，不删除**）；
  - 已认证只读接口（并入 system 或独立），doctor 输出复用同一函数。
- 验收：构造已知数据后统计值与实际一致；接口需认证；不写任何库。
- 测试：`storage.test.ts` 单元测试；认证/E2E 只读性断言。
- 涉及路径：`apps/server/src/modules/system/`、`apps/server/test/system/storage.test.ts`
- 实现要点：`modules/system/storage.ts` 的 `storageReport` 返回三类表的行数、最旧/最新时间、保留期与 dry-run 候选条数，另报数据库文件与 WAL 字节、活跃会话数；候选集合排除存在活跃 Turn 的会话。REST 增加已认证只读 `GET /api/system/storage`，`policy` 恒为 `dry_run`，不写库。
- 验证：新增 2 个单测（固定时钟下三类表的行数/保留期/候选数、活跃会话豁免与文件字节 > 0）；契约写入 `docs/contracts/rest-api.md`。
- 备注：`sessions.pinned_at`（用户显式保留）随 TR-4 的迁移引入；`doctor` 复用同一函数待后续接入。这是 TR-4 的前置证据，没有它不应开启任何删除。

### TR-2 中断 Turn 恢复（新 Turn 接手）

- 状态：`done`（2026-11-12）
- 依赖：TR-0、070 HX-7（事实提取器）
- 目标：被中断的 Turn 能在用户确认后由新 Turn 接手，不重跑已完成步骤。
- 交付物：
  - 事实提取（文件版本、命令与退出码、失败诊断、未完成步骤、资源 ID），复用 070 的提取器；
  - `POST /api/turns/:id/resume`：校验状态/事实/模型可用性 → 创建新 Turn（`resumedFromTurnId`）→ 入队；
  - 旧 Turn 不可变；新 Turn 的授权、锁、预算、幂等按新 Turn 建立；
  - `turn.resumed` 事件与 `TurnDto.resumedFromTurnId`。
- 验收：A1–A3 通过；不可恢复时稳定错误码且不发模型请求；审计含 from/to Turn。
- 测试：`recovery.test.ts`（无事实、模型不可用、非 INTERRUPTED 三种拒绝；成功路径断言旧 Turn 未变）。
- 涉及路径：`apps/server/src/modules/agent/recovery/`、`sessions/{turns,service}.ts`、`http/routes/sessions.ts`、`db/schema.ts`、`drizzle/0024_turn_recovery.sql`、`docs/contracts/{rest-api,ws-events,data-model}.md`
- 实现要点：迁移 `0025` 给 `turns` 加 `resumed_from_turn_id`；`turnCheckpoint.ts` 增加 `extractFactsFromEvents` / `loadTurnFacts`（与 Turn 内检查点共用 `CheckpointFacts` 形状，从 `agent_events` 反读文件版本、命令摘要、失败诊断、计划步骤、资源 ID）；`modules/agent/recovery/resume.ts` 校验 `INTERRUPTED` + 事实非空 → 复用 `createTurn`（显式带原 `model` / `thinking` / `credentialProfileId`）→ 写 `resumedFromTurnId` + `turn.resumed` 事件 + 审计。用 `idempotencyKey = resume:<原TurnId>` 保证重复调用返回同一个新 Turn。REST 增加 `POST /api/turns/:id/resume`（202）。
- 契约：`rest-api.md`（新路由与 DTO 字段）、`ws-events.md`（`turn.resumed`）、`data-model.md`（新列）。
- 验证：新增 `recovery.test.ts` 4 个用例——成功接手（事实注入、原 Turn 不变、事件存在、重复调用幂等）、非中断拒绝、无事实拒绝、Turn 不存在；迁移计数与 `schemaVersion` 同步到 25；`test/agent` 91 通过 / 9 个既有环境性失败；biome 与 typecheck 通过。
- 备注：不接受客户端覆盖模型/凭据；沿用原 Turn 快照，不可用即拒绝（映射为 `RESOURCE_UNAVAILABLE`）。错误码复用既有集合（`NOT_FOUND` / `CONFLICT` / `RESOURCE_UNAVAILABLE`），未扩展 `ErrorCode`。

### TR-3 恢复入口与确认交互

- 状态：`todo`
- 依赖：TR-2
- 目标：让"继续被中断任务"可发现、可确认、不会被误解为任务已完成。
- 交付物：
  - 对话时间线在中断 Turn 上显示「中断于第 N 步」与恢复按钮；
  - 二次确认文案说明"会新建一轮并沿用已完成事实"；
  - 不可恢复时展示具体原因，并提供"新建会话"引导。
- 验收：Mock 场景"中断 → 继续"链路可用；窄屏与键盘可达；错误态可见。
- 测试：组件测试 + Mock Chromium E2E。
- 涉及路径：`apps/web/src/features/chat/`、`apps/web/src/lib/workspaceApi.ts`
- 备注：入口只对具备事实且模型可用的 Turn 显示；不得在自动化任务界面提供自动恢复。

### TR-4 保留策略与清理执行

- 状态：`todo`
- 依赖：TR-1、TR-0
- 目标：给历史数据明确寿命，同时保证默认不删、删除可审计、失败整体回滚。
- 交付物：
  - 配置：`cleanup.enabled`（默认 false）、`retentionDays.{events,turns,summaries}`、`maxBytes`、`keepPinned`；
  - dry-run 报告与真实执行两条路径共用同一候选集合函数；
  - 按会话整段删除，跳过活跃 Turn 与 pinned；
  - 事务内整体成功或整体不删；审计记录策略版本、候选/删除条数、耗时、备份位置；
  - 开启前的强制备份（复用 ADR-055 路径）。
- 验收：A4、A5 通过；默认配置下不删除任何行；活跃会话被跳过；注入失败时零删除。
- 测试：dry-run 不写库；候选集合边界（保留期边界、pinned、活跃）；事务回滚；审计字段。
- 涉及路径：`apps/server/src/db/cleanup.ts`、`apps/server/src/modules/system/`、`packages/shared/src/config.ts`、`apps/server/drizzle/0024_turn_recovery.sql`、`docs/contracts/data-model.md`
- 备注：破坏性任务，最后实施；D2/D3 未确认不动。默认值与开关必须在 spec 与配置示例中同时写明。

## 验收记录

（待任务完成后追加。）
