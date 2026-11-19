# 任务：长任务连续执行

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> **当前 spec 为 `draft`，以下任务仅作为拆分草案，不能开始实现；** 新 ADR 批准、spec 转 `ready` 后才按依赖执行。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| LC-1 | 关闭任务级预算与收尾提示 | — | `done` |
| LC-2 | 上下文换页与无事实接续 | LC-1 | `done` |
| LC-3 | 操作级超时与无进展检测 | LC-1 | `done` |
| LC-4 | 上下文阈值与历史加载校准 | LC-2 | `done` |
| LC-5 | 终态、UI 与可观测性 | LC-2、LC-3 | `done` |
| LC-6 | 全量验证、契约与状态回填 | LC-1～LC-5 | `review` |

## 任务卡

### LC-1 关闭任务级预算与收尾提示

- 状态：`todo`
- 依赖：无（需 spec `ready` + 新 ADR accepted）
- 目标：默认不再以累计 token、Turn 总墙钟或固定接续深度终止正常长任务；删除 80% 收尾提示。
- 交付物：
  - `DEFAULT_BUDGET` / `DEFAULT_MAX_CONTINUATIONS` 默认值调整与关闭语义；
  - `#shouldRequestWrapUp` 删除或仅保留紧急路径；
  - 终态原因测试；
  - 回滚开关说明。
- 验收：
  - 超过旧 `contextWindow × 30` 的任务继续；
  - 超过旧 180 分钟的任务不被总墙钟终止；
  - 不再因 80% 提示要求模型停止探索；
  - `maxSteps` / `maxToolCalls` 保持 0。
- 测试：
  - 单元：默认值、终态映射；
  - 集成：长任务超过旧 token/时长阈值仍继续。
- 涉及路径：
  - `apps/server/src/modules/agent/turn/budget.ts`
  - `apps/server/src/modules/agent/turnRunner.ts`
  - `apps/server/src/modules/agent/recovery/continue.ts`
  - `apps/server/test/agent/spendCap.test.ts`
  - `apps/server/test/agent/turnRunner.test.ts`
- 备注：`maxDurationMs=0` 当前会立即超时，必须先定义“关闭”语义或用极大值，不能直接设为 0。2026-11-19 完成：默认 token 上限关闭，紧急兜底 24h / 1000 步，删除 80% 收尾提示；`spendCap` 与 `turnRunner` 定向 61 项通过，server typecheck 与 biome 通过。

### LC-2 上下文换页与无事实接续

- 状态：`done`
- 依赖：LC-1
- 目标：接近上下文窗口时自动保存检查点并创建接续 Turn；正常换页不产生 `terminalReason=budget`；无工具事实也能接续。
- 交付物：
  - 换页触发条件与阈值；
  - `continueBudgetedTurn` 泛化为按原因接续；
  - 无事实时的最近消息/摘要承接；
  - 接续深度取消/可配置；
  - `turn.continued` 与检查点测试。
- 验收：
  - A2、A3、A7、A8；
  - 换页后任务连续，UI 不显示预算耗尽；
  - 接续仍走完整授权、锁、审批、审计。
- 测试：
  - 集成：上下文换页、无事实换页、检查点失败、窗口无法容纳；
  - 安全：接续写文件/执行命令仍受策略约束。
- 涉及路径：
  - `apps/server/src/modules/agent/turnRunner.ts`
  - `apps/server/src/modules/agent/recovery/continue.ts`
  - `apps/server/src/modules/agent/turnCheckpoint.ts`
  - `apps/server/src/modules/agent/contextCompressor.ts`
  - `apps/server/test/agent/continuation.test.ts`
  - `apps/server/test/agent/turnRunner.test.ts`
- 备注：保持 `resumed_from_turn_id` 与现有事件；不新增 schema。2026-11-19 完成：85% 输入窗口换页、`continued` 终态、无事实 fallback、默认接续深度取消、整链 24h 紧急墙钟；定向 77 项通过。

### LC-3 操作级超时与无进展检测

- 状态：`done`
- 依赖：LC-1
- 目标：移除 Turn 总墙钟对在途操作的统一 abort，保留请求/命令/锁/审批超时；增加无进展暂停。
- 交付物：
  - 模型请求与命令的独立超时；
  - 命令超时返回结构化结果，任务可继续；
  - 无进展维度、阈值、暂停/恢复语义；
  - 日志与测试。
- 验收：
  - A4、A5、A6；
  - 超时只失败当前操作；
  - 无进展暂停而非默认终止；
  - 用户取消立即生效。
- 测试：
  - 集成：Provider 挂起、命令超时、无进展、取消；
  - 单元：进展时间戳/阈值。
- 涉及路径：
  - `apps/server/src/modules/agent/turnRunner.ts`
  - `apps/server/src/modules/commands/manager.ts`
  - `apps/server/src/modules/agent/toolExecutor.ts`
  - `apps/server/test/agent/commands.test.ts`
  - `apps/server/test/agent/turnRunner.test.ts`
- 备注：定时 Job 的 `timeoutSeconds` 不变；Job 超时不触发用户会话换页。2026-11-19 完成：模型请求 600s 上限、命令/锁/审批超时保留、`isStalled` 10 分钟无进展暂停；定向测试通过。

### LC-4 上下文阈值与历史加载校准

- 状态：`done`
- 依赖：LC-2
- 目标：减少正常长任务过早压缩/丢历史，提升换页前可用上下文。
- 交付物：
  - `contextRatio` 与压缩阈值调整；
  - `HISTORY_LIMIT` 从固定条数改为 token 预算；
  - 摘要分块/超时按长任务评估；
  - 测试与基线记录。
- 验收：
  - 长窗口模型不因 0.8/0.7 过早摘要；
  - 历史加载按 token 控制，不因固定 40 条丢失必要上下文；
  - 请求仍不超过窗口。
- 测试：
  - 单元：装配/压缩阈值、历史预算；
  - 集成：长历史换页前保留关键事实。
- 涉及路径：
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `apps/server/src/modules/agent/contextCompressor.ts`
  - `apps/server/src/modules/agent/tokenEstimator.ts`
  - 对应测试。
- 备注：具体阈值见 Q-053；不得用提高阈值绕过窗口硬检查。2026-11-19 完成：装配 80%、压缩 80%、水位 80/90、历史按 token 预算裁剪（扫描上限 400 条）；定向测试通过。

### LC-5 终态、UI 与可观测性

- 状态：`done`
- 依赖：LC-2、LC-3
- 目标：正常换页与预算/输出截断在终态、事件和界面上可区分；补充诊断信息。
- 交付物：
  - 终态/原因映射；
  - 新增 `TurnTerminalReason=continued` 与 Job 判定；
  - “自动继续”与“长时间无进展”界面文案；
  - 日志字段：换页原因、before/after tokens、facts、depth、stall；
  - 必要时更新 `docs/contracts/ws-events.md`。
- 验收：
  - A10、A11；
  - 正常换页显示为 `continued`，不显示“预算耗尽”或“任务完成”；
  - 输出截断单独提示；
  - 诊断可定位。
- 测试：
  - Web 单测/组件测试；
  - E2E 时间线连续与标记；
  - 日志字段断言。
- 涉及路径：
  - `packages/shared/src/events.ts`
  - `apps/server/src/modules/jobs/agentRunner.ts`
  - `apps/web/src/lib/eventReducer.ts`
  - `apps/web/src/features/**`
  - `apps/server/src/modules/agent/events.ts`
  - `docs/contracts/ws-events.md`
- 备注：不重做时间线视觉；只增加必要标记和文案。2026-11-19 完成：`continued` 终态、Job 未完成判定、Timeline “Continuing...” 与最终答案抑制、REST/WS/data-model 契约同步。

### LC-6 全量验证、契约与状态回填

- 状态：`review`
- 依赖：LC-1～LC-5
- 目标：完成验收、文档与状态同步。
- 交付物：
  - 全量检查与构建结果；
  - 长任务真实 Provider 验证记录；
  - `ROADMAP.md`、`STATUS.md`、`tasks.md`、`acceptance.md` 更新；
  - ADR-071 与新默认值说明。
- 验收：
  - A1–A11 全部有证据；
  - 无未解释回归；
  - 回滚路径可用。
- 测试：
  - `pnpm check`、`pnpm build`、必要的 E2E；
  - 定向长任务集成测试。
- 涉及路径：
  - 本切片文档
  - 根 `STATUS.md`
  - `specs/ROADMAP.md`
- 备注：一个任务一个提交；全量失败必须逐项给出结论。2026-11-19 自动门禁：`pnpm check` 通过（Web 265 / Agent 63+1 skip / Server 743+14 skip）、`pnpm build` 通过、`pnpm test:e2e` 24/24；真实 Provider 长任务与视觉验收待人类执行，见 [acceptance](acceptance.md)。
