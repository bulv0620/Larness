# 实施计划：长任务连续执行

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。spec 仍为 `draft`，以下方案待人类确认与新 ADR 批准后执行。

## 1. 技术方案

把“任务是否应该继续”和“单次操作是否卡死”拆成两层：

- **任务层**：默认没有总 token、总墙钟或固定接续深度；由用户取消、真正完成或紧急兜底结束。
- **操作层**：模型请求、命令、锁和审批各自保留超时；超时只失败当前操作，结果返回模型。
- **上下文层**：接近模型窗口时，先保存检查点，再以 `resumedFromTurnId` 创建接续 Turn；换页是正常路径，不产生 `terminalReason=budget`。
- **健康层**：无进展检测替代总墙钟；长时间无输出、无文件变更、无计划更新时暂停/询问，不默认杀任务。

核心改动集中在 `TurnRunner` 的预算判定、`continueBudgetedTurn` 的触发条件，以及 `contextAssembler` / `contextCompressor` 的阈值。不改变工具授权、锁、审批和审计。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持 ADR-059 默认值，只调大数值 | 改动最小 | 仍是任务级上限，长任务仍会在某个固定点截断 | 不采用 |
| 完全移除所有限制 | 长任务最自由 | 挂起命令/请求会永久占住队列；物理窗口仍会失败 | 不采用 |
| 任务层默认不设预算 + 操作级超时 + 上下文换页 | 完成优先，异常仍可控 | 需要改接续语义、终端原因和 UI 文案 | 采用 |
| 用金额预算替代 token 预算 | 更贴近成本 | 用户不关心成本；引入价格目录与换算复杂度 | 本切片不做 |
| 单 Turn 无限上下文 | 无需换页 | 物理上不可行 | 不采用 |

## 3. 目录与文件变更

```text
新增：
  specs/085-long-task-continuity/{spec,plan,tasks}.md
  apps/server/test/agent/longTaskContinuity.test.ts（暂定名）
  apps/server/test/agent/contextRollover.test.ts（暂定名）
  apps/server/test/agent/stallDetection.test.ts（暂定名）

修改：
  apps/server/src/modules/agent/turn/budget.ts
  apps/server/src/modules/agent/turnRunner.ts
  apps/server/src/modules/agent/recovery/continue.ts
  apps/server/src/modules/agent/events.ts
  apps/server/src/modules/jobs/agentRunner.ts
  apps/server/src/modules/agent/contextAssembler.ts
  apps/server/src/modules/agent/contextCompressor.ts
  apps/server/src/modules/agent/tokenEstimator.ts
  apps/server/src/modules/agent/turn/chain.ts（仅链深/花费统计的语义调整）
  apps/server/src/bootstrap/start.ts
  apps/server/test/agent/turnRunner.test.ts
  apps/server/test/agent/continuation.test.ts
  apps/server/test/agent/spendCap.test.ts
  apps/server/test/agent/context*.test.ts
  packages/shared/src/events.ts
  apps/web/src/lib/eventReducer.ts（如终态文案需要区分）
  apps/web/src/features/**（仅“自动继续”与终态文案）
  docs/contracts/ws-events.md（仅在事件字段变化时）
  docs/adr/ADR-071-*.md（新建，supersede ADR-059 的任务级默认值）
```

## 4. 实施步骤

1. **先写失败测试**：
   - 超过旧 `contextWindow × 30` 后任务仍继续；
   - 上下文达到换页阈值时创建接续 Turn，终态不是 `budget`；
   - 无工具事实时仍换页；
   - 单次请求/命令超时只失败当前操作；
   - 用户取消优先于换页；
   - 接续仍走授权、锁、审批与审计。
2. **预算默认值**：关闭任务级 token 上限；保留 24h / 1000 步紧急兜底，明确 `maxDurationMs=0` 会立即超时的语义，避免误配置。
3. **上下文换页**：在 `TurnRunner` 输入窗口 85% 前触发检查点与接续；把 `continueBudgetedTurn` 泛化为按原因接续，正常换页使用 `terminalReason=continued`。
4. **无事实接续**：`factsAreEmpty` 不再直接阻止；用最近 assistant 消息/摘要生成承接输入，并标记为降级。
5. **操作级超时**：保留请求、命令、锁、审批超时；单次请求上限 600s，Turn 的 24h 墙钟只作紧急兜底。
6. **无进展检测**：记录最近一次模型输出、工具输出、文件变更和计划更新时间；超过 10 分钟进入 `INTERRUPTED` / 恢复入口，不默认无限重试。
7. **上下文阈值**：装配保持 80%，压缩阈值 80%，输入窗口 85% 换页；历史加载改为 token 预算，保留 400 条扫描上限。
8. **终态与 UI**：正常换页使用 `continued`，Job 判为未完成；保留 `output_truncated` 独立提示；界面显示“自动继续”。
9. **验证与文档**：按第 7 节运行检查，更新 ADR、契约、ROADMAP、STATUS 与任务卡。

## 5. 数据与迁移

- schema：无新增表/列，复用 `resumed_from_turn_id`、检查点和摘要表。
- 兼容：旧 Turn 的 `terminalReason` / `budgetCause` 记录保持可读；旧事件的 `turn.continued` 不受影响。
- 回滚：恢复 `DEFAULT_BUDGET` 的任务级上限和 `DEFAULT_MAX_CONTINUATIONS`，并恢复 80% 收尾提示；已产生的接续 Turn 保留。

## 6. 回滚策略

- 首选按配置/常量回滚：恢复任务级 token 上限、Turn 总墙钟和接续深度。
- 不删除已产生的检查点、摘要、接续 Turn 或事件；回滚只影响新 Turn 的行为。
- 若换页导致事实丢失或重复执行，先关闭自动换页并回到单 Turn 上下文压缩路径，再排查检查点与恢复逻辑。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
# 定向验证
pnpm --filter @larness/server exec vitest run test/agent/contextRollover.test.ts
pnpm --filter @larness/web test:file src/features/chat/TimelineContinuation.test.tsx
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 无任务级上限导致异常任务长期占用队列 | 其他会话等待 | 无进展检测 + 用户取消 + 紧急兜底 |
| 换页频繁导致重复执行/工具副作用 | 数据不一致 | 检查点只携带已验证事实；工具幂等与锁不变；E2E 覆盖 |
| 无事实换页丢失推理上下文 | 答案质量下降 | 最近消息 + 摘要 + 原始目标；降级标记 |
| 80% 收尾提示删除后模型不收尾 | 任务过长 | 只在紧急兜底/用户要求时提示；正常完成由模型判断 |
| 上下文阈值提高导致请求过大 | Provider 拒绝 | 保留窗口硬检查与输出预留；换页先于硬限制 |
| 定时 Job 语义被误改 | 调度超时失控 | 明确 Job `timeoutSeconds` 不变，单独测试 |
| ADR-059 与新 ADR 冲突 | 决策不可追溯 | 新 ADR 明确 supersede 范围；保留操作级约束 |

## 9. 未决事项

- [Q-052～Q-059](../../docs/open-questions.md#待决)：任务级上限、换页阈值、配置面、定时任务、输出上限、ADR 编号、正常换页终态与无进展阈值（Q-058 已确认）。
