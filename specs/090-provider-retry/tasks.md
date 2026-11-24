# 任务：Provider 失败重试、诊断与标题超时

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| PR-1 | 失败测试：重试判定与 TurnRunner 行为 | — | `done` |
| PR-2 | 步骤级重试与结构化失败日志 | PR-1 | `done` |
| PR-3 | 标题超时/诊断与压缩显式重试预算 | PR-1 | `done` |
| PR-4 | 验证、文档与状态回填 | PR-2, PR-3 | `done` |

## 任务卡

### PR-1 失败测试：重试判定与 TurnRunner 行为

- 状态：`done`
- 依赖：无
- 目标：用会失败的测试固定 D1–D4 的行为边界。
- 交付物：
  - `apps/server/test/agent/providerRetry.test.ts`：可重试类别、4xx `PROVIDER_UNKNOWN`、有产出、耗尽、60s 窗口、剩余预算；
  - `turnRunner.test.ts`：无产出重试成功、重试耗尽、有产出不重试、终止类不重试；
  - `titleSummarizer.test.ts`：失败原因回调、`maxRetries: 0`；
  - `contextCompressor.test.ts`：摘要请求携带 `maxRetries`。
- 验收：新测试在实现前按预期失败（模块缺失 / 无重试 / 无字段），失败原因正确。
- 涉及路径：
  - `apps/server/test/agent/{providerRetry,turnRunner,titleSummarizer,contextCompressor}.test.ts`

### PR-2 步骤级重试与结构化失败日志

- 状态：`done`
- 依赖：PR-1
- 目标：实现 G-1～G-4。
- 交付物：
  - `turn/providerRetry.ts`：`PROVIDER_STEP_MAX_ATTEMPTS`、`shouldRetryProviderStep`、`providerRetryDelayMs`；
  - `turnRunner.ts`：内层尝试循环、`maxRetries: 2`、`statusCode` 保留、`provider step retry` / `provider step failed` 日志；
  - `TurnRunnerOptions.providerRetryDelayMs`（测试注入，默认 1000）。
- 验收：`providerRetry.test.ts` 与 `turnRunner.test.ts` 通过；取消、预算、有产出路径无回归。
- 涉及路径：
  - `apps/server/src/modules/agent/turn/providerRetry.ts`
  - `apps/server/src/modules/agent/turnRunner.ts`

### PR-3 标题超时/诊断与压缩显式重试预算

- 状态：`done`
- 依赖：PR-1
- 目标：实现 G-5 与标题诊断。
- 交付物：
  - `titleSummarizer.ts`：`TITLE_TIMEOUT_MS = 60_000`、`maxRetries: 0`、`onFailure` 回调与 `timedOut` / `finishReason` / `sawReasoning` 日志字段；
  - `contextCompressor.ts`：摘要请求 `maxRetries: 1`。
- 验收：标题与压缩测试通过；标题失败日志能区分 timeout / provider_error / empty_text。
- 涉及路径：
  - `apps/server/src/modules/agent/titleSummarizer.ts`
  - `apps/server/src/modules/agent/contextCompressor.ts`

### PR-4 验证、文档与状态回填

- 状态：`done`
- 依赖：PR-2、PR-3
- 目标：跑门禁并收口。
- 交付物：
  - `pnpm check`（Windows `VITEST_MAX_WORKERS=2`）结果；
  - `specs/README.md`、`ROADMAP.md`、`STATUS.md` 回填；
  - 本文件与 spec 状态改为 `done`。
- 验收：check 通过；未运行项如实记录在备注。
- 涉及路径：
  - `specs/README.md`、`specs/ROADMAP.md`、`STATUS.md`

## 验收记录（2026-11-24，macOS）

- `pnpm check`（Windows 用 `VITEST_MAX_WORKERS=2`）通过：server **175 文件 / 935 项通过、31 跳过**（另 8 个文件整组跳过），web 与 `biome ci` / `tsc` 同批通过。
- 定点：`test/agent/{providerRetry,providerStepRetry,turnRunner,titleSummarizer,contextCompressor}.test.ts` 共 **81 项通过**。
- 新增覆盖：无产出时重试成功 / 重试耗尽（attempts=3）/ 有产出不重试 / 终止类不重试 / `PROVIDER_UNKNOWN` 5xx 重试 / 标题 `maxRetries=0` 与失败原因回调 / 标题超时日志 / 压缩 `maxRetries=1`。
- 未运行：`pnpm build`、E2E、真实 Provider 抖动复现（无法在自动化中构造）。真实故障恢复只能按 `provider step retry` / `provider step failed` 日志字段核对。
- 行为变化：既有用例 `maps provider failures to FAILED with a stable code` 改为脚本化 3 次 429（步骤级重试会消耗后续脚本），断言仍是 `PROVIDER_RATE_LIMITED`；`maxRetries` 断言 1 → 2。
