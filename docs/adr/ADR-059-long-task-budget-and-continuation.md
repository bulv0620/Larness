# ADR-059 长任务的分片预算与自动接续

- 状态 accepted（2026-11-12，用户在「保守 / 推荐 / 激进」三档中明确选择激进档）。
- 关联：[070 运行时效率](../../specs/070-runtime-efficiency/spec.md)、[071 Turn 恢复](../../specs/071-turn-recovery/spec.md)、[ADR-057](ADR-057-runtime-efficiency.md)、[ADR-058](ADR-058-turn-recovery-retention.md)。
- 实施状态：已实现并验证（见「验证」）。

## 背景

一轮真实的 UI 重构任务用了 **30 次模型请求，正好撞上 `maxSteps: 30`** 被切断：39 个工具调用、194 秒、累计输入 112.6 万 token（其中 110.3 万命中前缀缓存）。终态是 `budget`，答案停在半句话，计划里仍有未完成步骤。

对照其他 harness：Codex CLI 的 `codex exec` **没有** turn 上限（加 `--max-turns` 的请求被 closed as not planned）；Claude Code 只在 headless 模式提供 `--max-turns` 与 `--max-budget-usd`；OpenHands 的 `MAX_ITERATIONS` 默认 100 且可配置。步数是成本的劣质代理——同样 30 步可能是几千 token，也可能是上百万。

## 决策

1. **取消步数与工具数上限**。`maxSteps` / `maxToolCalls` 默认 `0`（不限制），保留字段以便按需收紧。
2. **预算改为「花费为主、时长为兜底」**（2026-11-12 二次确认，选项 A）：
   - 花费上限是**主约束**，默认按模型窗口自适应：`maxTotalTokens = 0` 时取 `contextWindow × 30`（`SPEND_CAP_CONTEXTS`），显式配置的正数则原样生效（含输入与输出；摘要调用暂不计入）；
   - 2026-11-12 修订：固定 200 万在 2026-11 的实测中过早触顶（每步都重发全文，同样的 200 万在大窗口模型上只够十余步），改为随窗口缩放的倍数上限，使**步数**大致恒定而不是随窗口变小；
   - 上限是**整个任务**的额度，不是每一片的额度：接续轮沿 `resumedFromTurnId` 累加前序切片已花的 token（`chain.ts` 的 `carriedSpendTokens`），所有切片共用同一份预算；否则每片各领一份满额，真实上限会被放大成「4 × 30 窗口」；
   - 挂钟只做**卡死检测**，默认放宽到 60 分钟，不按 10 分钟切片；
   - 2026-11-16 修订：挂钟默认值 60 → **180 分钟**，与 `run_command` 上限（120s → 300s 默认 / 600s → 1800s 上限）同步。实测中花费上限才是真正的约束：一次对话密集的 Turn 在一小时内就用完 `contextWindow × 30`，而被切断的多是"长时间等待"型 Turn（install / build / e2e，上下文很小但墙钟很长）。因此本次只放宽挂钟与单命令时长，**不动 `SPEND_CAP_CONTEXTS`**——否则成本会随时长线性放大。代价是接续链最长可达 4 × 180 分钟，由花费上限与深度上限 3 共同兜底。
   - 触顶以 `terminalReason=budget` 结束本轮，并记录 `budgetCause`（`tokens` / `context` / `duration` / `steps` / `tool_calls`）。
3. **自动接续只发生在花费或上下文触顶时**（`budgetCause` 为 `tokens` / `context`）。`duration` 等属于卡死兜底，不自动接续。接续时用检查点事实（已改文件与版本、命令摘要、失败诊断、未完成计划步骤、资源 ID）创建**新 Turn** 接着做：
   - 新 Turn 记录 `resumedFromTurnId`，发 `turn.continued` 事件并写审计；
   - 链路深度上限 `maxContinuations` 默认 3，防止无人看守时无限接续；
   - 只对 `origin=user` 的会话生效，定时任务不自动接续（它们有自己的超时语义）；
   - 事实为空时不接续（没有可承接的进度）。
4. **收尾提示**：接近分片预算（时长或花费达 80%）时，在请求尾部追加一次提示，要求完成当前操作、更新计划并总结，避免在下一轮承接前留下半句话。
5. **界面无感**：接续的 Turn 合并进被接续任务的时间线分组，不出现额外轮次或机器事实；只有时间线第一条就是接续轮（无前序任务）时，才退化为「自动继续上一轮的未完成工作」标记 + 可展开的核对事实。

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
- **成本**：一个任务（原始 Turn + 至多 3 次接续）**合计**上限为 30 个上下文窗口的累计 token（200k 模型约 600 万、128k 模型约 384 万），接续轮继承前序花费而非重新领满额。上限随窗口缩放，可按实际使用再调 `spendCapContexts`；设为 `0` 关闭该上限。

## 验证与回滚

- 验证：`test/agent/continuation.test.ts` 5 个用例（接续生成新 Turn 与事件、深度上限、定时会话与非预算 Turn 不接续、空事实不接续、零花费的 `tokens` 切片不接续）；`test/agent/spendCap.test.ts` 8 个用例（自适应上限的纯函数边界、200k 模型在 250 万花费下不再于第 1 步误停、显式上限仍立刻生效、`spendCapContexts: 0` 关闭上限）；`test/agent/chainSpend.test.ts` 4 个用例（链式累加、`usage_json` 缺失或非法时回落到 0、前片已花 500 万且上限 600 万时接续片不得发起第 2 次模型调用）。`maxSteps: 0` 与 `maxToolCalls: 0` 的无限语义由既有 Turn 用例覆盖；收尾提示用例覆盖时长与花费压力。web 侧 `TimelineContinuation.test.tsx` 覆盖接续合并、成果区累加、`budgetCause` 文案与「已自动继续」计数，`eventReducerBudgetCause.test.ts` 覆盖 `budgetCause` 白名单落库与跨轮不串味。
- 回滚：把 `DEFAULT_BUDGET.maxSteps` / `maxToolCalls` 恢复为非零、`spendCapContexts` 设为 `0`（关闭花费上限），并在 `TurnQueueOptions.onSettled` 中断开 `continueBudgetedTurn` 即可回到「单轮硬上限」行为；要恢复固定上限则直接给 `maxTotalTokens` 赋正数。已产生的接续 Turn 保留，不影响历史。
