# ADR-059 长任务的分片预算与自动接续

- 状态 accepted（2026-11-12，用户在「保守 / 推荐 / 激进」三档中明确选择激进档）。
- 关联：[070 运行时效率](../../specs/070-runtime-efficiency/spec.md)、[071 Turn 恢复](../../specs/071-turn-recovery/spec.md)、[ADR-057](ADR-057-runtime-efficiency.md)、[ADR-058](ADR-058-turn-recovery-retention.md)。
- 实施状态：已实现并验证（见「验证」）。

## 背景

一轮真实的 UI 重构任务用了 **30 次模型请求，正好撞上 `maxSteps: 30`** 被切断：39 个工具调用、194 秒、累计输入 112.6 万 token（其中 110.3 万命中前缀缓存）。终态是 `budget`，答案停在半句话，计划里仍有未完成步骤。

对照其他 harness：Codex CLI 的 `codex exec` **没有** turn 上限（加 `--max-turns` 的请求被 closed as not planned）；Claude Code 只在 headless 模式提供 `--max-turns` 与 `--max-budget-usd`；OpenHands 的 `MAX_ITERATIONS` 默认 100 且可配置。步数是成本的劣质代理——同样 30 步可能是几千 token，也可能是上百万。

## 决策

1. **取消步数与工具数上限**。`maxSteps` / `maxToolCalls` 默认 `0`（不限制），保留字段以便按需收紧。
2. **预算改为「分片」**：一轮 Turn 受两项预算约束——
   - 挂钟分片 `maxDurationMs`（默认 10 分钟），用于发现卡死；
   - 花费上限 `maxTotalTokens`（默认 200 万，含输入与输出；摘要调用暂不计入）。
   任一触顶都以 `terminalReason=budget` 结束**本轮**，而不是让任务失败。
3. **自动接续**：当一轮以 `budget` 结束时，自动用检查点事实（已改文件与版本、命令摘要、失败诊断、未完成计划步骤、资源 ID）创建**新 Turn** 接着做：
   - 新 Turn 记录 `resumedFromTurnId`，发 `turn.continued` 事件并写审计；
   - 链路深度上限 `maxContinuations` 默认 3，防止无人看守时无限接续；
   - 只对 `origin=user` 的会话生效，定时任务不自动接续（它们有自己的超时语义）；
   - 事实为空时不接续（没有可承接的进度）。
4. **收尾提示**：接近分片预算（时长或花费达 80%）时，在请求尾部追加一次提示，要求完成当前操作、更新计划并总结，避免在下一轮承接前留下半句话。
5. **界面**：自动接续的 Turn 以「自动继续上一轮的未完成工作」呈现，核对事实默认收起，可展开查看；不把机器事实直接铺在对话里。

## 备选方案

- **保持 30/50 步硬上限**：实现最简单，但会在合法的长任务中途切断，且与主流 harness 的做法相反。
- **完全不设任何预算**：Codex 采用，但它依赖外部 `timeout` 与沙箱；Larness 是常驻本机应用，没有外部看门狗，必须有内部兜底。
- **只提高步数上限到 200**：仍是劣质代理，且对「少数步数烧掉大量 token」无约束。
- **自动接续不设深度上限**：可能整夜循环，成本不可预期。
- **把接续做成新会话**：丢失上下文与连续性；复用同一会话 + 事实更接近人类「继续做」。

## 影响

- **产品 / UI**：长任务可能跨越多个 Turn；时间线出现「自动继续」标记；预算停不再等于任务失败。需要用户在界面确认体验（视觉验收）。
- **API / 契约**：新增 `turn.continued` 事件；`turns.resumed_from_turn_id` 同时表示「恢复」与「接续」；`user.message` 的正文可能是一段检查点事实（界面按前缀识别并折叠）。
- **数据 / 迁移**：无新增列（复用 `0025` 的 `resumed_from_turn_id`）。
- **安全 / 权限**：接续是新 Turn，走完整授权、锁、审批与审计；不绕过任何执行约束。
- **成本**：单轮上限 200 万 token × 最多 4 轮（原始 + 3 次接续）。默认值可按实际使用再调。

## 验证与回滚

- 验证：`test/agent/continuation.test.ts` 3 个用例（接续生成新 Turn 与事件、深度上限、定时会话与非预算 Turn 不接续、空事实不接续）；`maxSteps: 0` 与 `maxToolCalls: 0` 的无限语义由既有 Turn 用例覆盖；收尾提示用例覆盖时长与花费压力；web 用例覆盖接续标记与事实折叠。
- 回滚：把 `DEFAULT_BUDGET.maxSteps` / `maxToolCalls` 恢复为非零、`maxTotalTokens` 设为 `0`，并在 `TurnQueueOptions.onSettled` 中断开 `continueBudgetedTurn` 即可回到「单轮硬上限」行为；已产生的接续 Turn 保留，不影响历史。
