# 实施计划：Provider 失败重试、诊断与标题超时

> 对应 [spec](spec.md)。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

把“这一步要不要重试”从 TurnRunner 里抽成 `modules/agent/turn/providerRetry.ts` 的纯函数，TurnRunner 只做编排：

1. 每个模型步骤进入内层 `while` 循环；每次尝试独立统计 `attemptOutput`（是否流过 text/reasoning/tool-call/usage）与耗时。
2. 流结束后若有 `providerError`，调用 `shouldRetryProviderStep({failure, attempts, emittedOutput, elapsedMs, remainingMs})`；为真则按 `providerRetryDelayMs(attempts)` 等待后重试，重新计算 `remainingMs`，在等待前后沿用 `checkBudget()` 与 `controller.signal`。
3. 有产出、终止类错误、单次尝试超过 60 秒或预算不足时立即按既有路径收口。
4. `maxRetries: 1 → 2`；`ProviderError.statusCode` 保留到 `providerError`，最终失败写结构化 warn。
5. 标题：`TITLE_TIMEOUT_MS = 60_000`，`maxRetries: 0`，新增 `onFailure` 诊断回调；`summarizeSessionTitle` 记录 `timedOut` 与失败详情。
6. 压缩：`summarizeOnce` 下发 `maxRetries: 1`。

不新增事件、REST 字段、错误码、迁移或用户配置。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只把 `maxRetries` 调大 | 改动最小 | 流中断、超时、`PROVIDER_UNKNOWN` 仍不重试 | 采用为 G-3，不足以解决问题 |
| 整个 Turn 失败后自动重排队 | 能覆盖长断线 | 已执行的工具副作用难以对账，容易重复写 | 不采用 |
| 步骤级重试 + 零产出保护 | 覆盖流中断，且不会重复文本/工具 | 需要额外的失败分类 | 采用（G-1/G-2） |
| 按 `ProviderError.retryable` 统一重试 | 简单 | `PROVIDER_UNKNOWN` 4xx 会被无意义重试，超时会被重跑整窗 | 不采用，改用显式类别 + 60s 窗口 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/turn/providerRetry.ts
  apps/server/test/agent/providerRetry.test.ts
  specs/090-provider-retry/{spec,plan,tasks}.md
修改：
  apps/server/src/modules/agent/turnRunner.ts
  apps/server/src/modules/agent/titleSummarizer.ts
  apps/server/src/modules/agent/contextCompressor.ts
  apps/server/test/agent/turnRunner.test.ts
  apps/server/test/agent/titleSummarizer.test.ts
  apps/server/test/agent/contextCompressor.test.ts
  specs/ROADMAP.md、specs/README.md、STATUS.md
删除：
  无
```

## 4. 实施步骤

1. 写失败测试：`providerRetry.test.ts`、TurnRunner 重试四例、标题失败回调、压缩 `maxRetries`。
2. 实现 `providerRetry.ts` 纯函数与等待。
3. TurnRunner 内层重试循环 + `maxRetries: 2` + 结构化 warn。
4. 标题超时/诊断与压缩 `maxRetries`。
5. 跑 `pnpm check`（Windows：`VITEST_MAX_WORKERS=2`），回填文档与 STATUS。

## 5. 数据与迁移

- schema：无。
- 兼容：事件、REST、审计字段不变。
- 回滚：删除内层重试循环并把 `maxRetries` 改回 1 即可；无数据影响。

## 6. 回滚策略

单文件改动，逐项可独立回退。标题超时与诊断互不依赖；压缩 `maxRetries` 独立。

## 7. 验证命令

```powershell
pnpm --filter @larness/server test test/agent/providerRetry.test.ts
pnpm --filter @larness/server test test/agent/turnRunner.test.ts
pnpm --filter @larness/server test test/agent/titleSummarizer.test.ts
pnpm --filter @larness/server typecheck
$env:VITEST_MAX_WORKERS="2"; pnpm check
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 重试放大 Provider 计费 | 每步最多 3 次请求 | 只在零产出时重试；终止类不重试 |
| 超时被重跑 | 单步再占 10 分钟 | 单次尝试 >60s 不重试；剩余预算不足不重试 |
| 重试后事件/文本重复 | UI 重复 | 零产出才重试；已有 text/reasoning/tool-call 一律不重试 |
| 取消被延迟 | 用户等待 | 等待用既有 `delay(ms, signal)`，abort 立即返回 |

## 9. 未决事项

- 无新增；真实 Provider 抖动无法在自动化中构造，只能按日志字段核对。
