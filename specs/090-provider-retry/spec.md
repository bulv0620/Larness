---
id: 090-provider-retry
title: Provider 失败重试、诊断与标题超时
milestone: M6
status: done
depends_on: [070-runtime-efficiency, 081-agent-lean, 085-long-task-continuity, 089-session-prefix-cache]
owners: [human]
created: 2026-11-24
updated: 2026-11-24
---

# Provider 失败重试、诊断与标题超时

> 状态：`done`（2026-11-24 实施并验证；未运行项见 [tasks](tasks.md#验收记录2026-11-24macos)）。2026-11-24 用户直接要求“开个任务完成修改”，批准第 13 节 D1–D4 的推荐方案，不再单独评审。
> 行号按 2026-11-24 工作树标注，实施前复核。
> 关联：[ADR-057](../../docs/adr/ADR-057-runtime-efficiency.md) 第 4 条（`timeoutMs` / `maxOutputTokens` / `maxRetries` 必须显式下发）、[051 工具执行契约](../051-agent-tool-contract/spec.md)、[rest-api 错误码](../../docs/contracts/rest-api.md)。

## 1. 背景与问题

2026-11-24 用户报告两类真实故障：

1. 会话经常出现 `PROVIDER_UNAVAILABLE: provider request failed` 与 `PROVIDER_UNKNOWN: provider request failed`，整轮 Turn 直接 FAILED，只能手动重试。
2. 会话标题经常不生成（侧栏保留首条消息派生的长标题）。诊断确认为标题请求被 20 秒硬超时中断，两次失败都停在 20.2 秒；失败后不重试。

按当前代码复核，重试与诊断的实际覆盖是：

- **只有 SDK 内层重试**：`turnRunner.ts` 下发 `maxRetries: 1`，AI SDK 仅对 `APICallError.isRetryable`（408/409/429/5xx、`fetch failed`、`ECONNRESET`、`ENOTFOUND`、`ETIMEDOUT`）重试一次；第二次失败即整轮 FAILED。
- **流中断不重试**：`mapAiSdkStream` 的 `error` 分支结束流，`turnRunner.ts` 立即 `turn.failed`；`streamRetries` 从未下发。
- **`PROVIDER_UNKNOWN` 永不重试**：`packages/agent/src/providers/errors.ts` 标 `retryable: false`，SDK 也不认同，它只来自非 `APICallError` 兜底或 <500 且不可重试的 API 错误。
- **诊断丢失**：`turnRunner.ts` 把 `ProviderError` 压成 `{code, message}`，`statusCode`、是否可重试、实际尝试次数都不进日志；`turn.failed` 只有 code + message，`PROVIDER_UNKNOWN` 无法区分 400 参数错与上游 502。
- **标题与压缩违反 ADR-057 第 4 条**：`titleSummarizer.ts` 的 20 秒超时、`maxRetries` 未下发；`contextCompressor.ts` 同样未下发 `maxRetries`，走 SDK 默认 2 次。

不做的后果：一次上游抖动就报废整轮（可能已执行多个工具），长回答中途断线必须用户手动重来；标题失败只能靠时间差猜原因。

## 2. 目标

- **G-1 步骤级重试**：模型步骤在**没有产出任何用户可见内容**（无 text / reasoning delta、无 tool-call、无 usage）且错误属于可重试类别时，自动重试最多 2 次，退避 1s / 2s。
- **G-2 有产出不重试**：已经流式输出过内容或已产生 tool-call 的步骤不重试，避免重复文本、重复工具调用与重复计费。
- **G-3 内核重试加一档**：主回合 `maxRetries: 1 → 2`，只影响 429/5xx/网络失败，最多 3 次尝试。
- **G-4 失败可诊断**：最终失败写结构化 warn（`errorCode`、`statusCode`、`retryable`、`attempts`、`step`），标题失败写明确原因（timeout / provider_error / empty_text + `finishReason` / 是否只有 reasoning）。
- **G-5 标题与压缩显式预算**：标题超时 20s → 60s，并显式下发 `maxRetries`；压缩显式下发 `maxRetries`，不再依赖 SDK 默认值（ADR-057 第 4 条）。
- **G-6 零语义放宽**：授权、审批、锁、幂等、审计、秘密保护、`RUNNING ≠ 健康` 语义不变；不重试终止类错误（鉴权、余额、上下文超限、内容过滤、用户取消）。

## 3. 非目标

- **NG-1** 不重试已经产生 tool-call 的步骤，也不做“半轮续接”或工具结果对账。
- **NG-2** 不新增 Provider、不换 SDK、不引入指数退避库。
- **NG-3** 不改 `TurnStatus`、`turn.failed` / `turn.completed` 事件字段与 REST DTO；诊断只进结构化日志，契约面保持稳定。
- **NG-4** 不做全局熔断、跨 Turn 自动重排队或后台补偿任务。
- **NG-5** 不改标题生成时机（仍在首 Turn 开始时并发触发）。

## 4. 用户故事

- 作为用户，我希望上游一次抖动不要报废整轮任务，以便不用手动重来。
- 作为用户，我希望标题在模型慢一点时仍能生成，而不是永久保留长标题。
- 作为维护者，我希望 `PROVIDER_UNKNOWN` 失败能看出状态码与尝试次数，而不是只能靠时间差猜。

## 5. 验收场景

### A1 无产出的瞬时失败自动重试并完成

```gherkin
Given 第一步骤第一次请求返回 PROVIDER_UNAVAILABLE 且没有输出任何 chunk
And 第二次请求返回正常文本
When 执行该 Turn
Then Turn 状态为 COMPLETED
And Provider 被调用 2 次
And 日志记录一次步骤重试（attempt=2、errorCode、statusCode）
```

### A2 重试耗尽后如实失败

```gherkin
Given 每一次请求都返回 PROVIDER_UNAVAILABLE 且无输出
When 执行该 Turn
Then Turn 状态为 FAILED，errorCode 为最后一次的稳定码
And Provider 最多被调用 3 次（首次 + 2 次重试）
And 日志记录 attempts=3 与最终 errorCode
```

### A3 有产出后不重试

```gherkin
Given 请求先流出一个 text-delta，随后返回 PROVIDER_UNAVAILABLE
When 执行该 Turn
Then Turn 状态为 FAILED
And Provider 只被调用 1 次
And 已流出的文本不重复
```

### A4 终止类错误不重试

```gherkin
Given 请求返回 PROVIDER_AUTH_FAILED / PROVIDER_CONTEXT_LIMIT / PROVIDER_QUOTA_EXHAUSTED / PROVIDER_ABORTED
When 执行该 Turn
Then Provider 只被调用 1 次
And Turn 的 errorCode 与既有映射一致（ABORTED 仍映射为 PROVIDER_UNAVAILABLE + 超时/中断文案）
```

### A5 标题超时放宽且失败可归因

```gherkin
Given 标题请求在 20 秒后仍无返回、在第 50 秒返回文本
When 首个 Turn 启动并触发标题总结
Then 标题被更新
And 标题调用不下发 SDK 重试（maxRetries=0）

Given 标题请求返回 PROVIDER_UNAVAILABLE
When 触发标题总结
Then 保留派生标题
And warn 记录 reason=provider_error 与 errorCode
```

### A6 压缩调用显式预算

```gherkin
Given 会话触发跨轮压缩
When 发起摘要请求
Then 请求显式携带 maxRetries（不再使用 SDK 默认值）
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 步骤级重试只在该次尝试**零产出**时发生：无 text-delta、无 reasoning-delta、无 tool-call、无 usage。 |
| R-2 | MUST | 最多 2 次重试（共 3 次尝试），退避基数 1s、倍数 2，等待期间响应取消与 Turn 截止时间。 |
| R-3 | MUST | 可重试类别：`PROVIDER_UNAVAILABLE`、`PROVIDER_RATE_LIMITED`、以及 `statusCode` 缺失或 ≥500/408/409 的 `PROVIDER_UNKNOWN`。 |
| R-4 | MUST | 不可重试类别：`PROVIDER_AUTH_FAILED`、`PROVIDER_QUOTA_EXHAUSTED`、`PROVIDER_CONTEXT_LIMIT`、`PROVIDER_CONTENT_FILTERED`、`PROVIDER_ABORTED`；`PROVIDER_UNKNOWN` 且 4xx（除 408/409）同样不重试。 |
| R-5 | MUST | 单次尝试已耗时超过 60 秒（视为超时/长断线，而非瞬时抖动）或剩余预算不足时不再重试。 |
| R-6 | MUST | 重试等待前后都检查 Turn 预算与取消状态；等待被取消打断时按既有取消路径收口。 |
| R-7 | MUST | 主回合单步 `maxRetries` 为 2；标题调用 `maxRetries: 0`；压缩调用 `maxRetries: 1`。 |
| R-8 | MUST | 标题超时为 60 秒；失败原因写入 warn：`reason`（`timeout` / `provider_error` / `empty_text`）、`errorCode`、`statusCode`、`finishReason`、`sawReasoning`。 |
| R-9 | MUST | 最终 provider 失败写入 warn：`turnId`、`sessionId`、`step`、`attempts`、`errorCode`、`statusCode`；不含 prompt、工具参数或工具输出。 |
| R-10 | SHOULD | 重试策略集中在独立模块，纯函数可单测；TurnRunner 只负责编排与日志。 |

## 7. 接口与契约变更

- REST：无。
- WebSocket：无；`turn.failed` / `turn.completed` 字段不变。
- IPC：无。
- 配置：无新增用户配置；重试基数仅内部常量（测试可注入延迟）。
- 事件 / 错误码：沿用 `PROVIDER_*` 稳定码；不新增错误码。
- 契约文档：无需修改 `docs/contracts/*`；行为遵循 [ADR-057](../../docs/adr/ADR-057-runtime-efficiency.md) 第 4 条。

## 8. 数据与迁移

- 无新表、无新列、无迁移、无 schemaVersion 变化。
- 重试与诊断不进审计与事件，只进结构化日志。

## 9. 安全、权限与审计

- 身份与授权：不涉及；重试复用同一已解析的 Provider 凭据与同一 Turn。
- 审批级别：不变；重试不重放已完成的工具调用。
- 秘密处理：日志只写稳定码、状态码、计数与枚举，不写 prompt、响应正文、工具参数或工具输出。
- 失败关闭：终止类错误仍立即失败；重试耗尽后如实 FAILED，不伪报 COMPLETED。
- 审计：`turn.*` 审计不变。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 首次即 401/402/上下文超限/内容过滤 | 不重试，直接 FAILED | 既有稳定码文案 |
| 5xx / 网络失败且无产出 | 最多重试 2 次 | 成功则无感；失败显示最后一次稳定码 |
| 5xx 且已有文本或 tool-call | 不重试，FAILED | 稳定码 + 已流出文本保留 |
| 429 | SDK 内层重试 3 次后，步骤级再重试（无产出时） | 最终失败仍为 `PROVIDER_RATE_LIMITED` |
| 单次尝试 >60s 后断线 | 不重试（避免再消耗一个完整超时窗口） | FAILED，稳定码 |
| 用户取消 / Turn 截止 | 不重试，按既有 CANCELLED / budget 路径收口 | 既有提示 |
| 标题超时 | 保留派生标题，warn 记录 timeout | 无（后台任务） |
| 标题只输出 reasoning | 保留派生标题，warn 记录 empty_text + finishReason=length | 无 |

## 11. 可观测性

- 日志：`provider step retry`（info，含 attempt/delayMs/errorCode/statusCode）、`provider step failed`（warn）、`title summary produced no usable text`（warn，扩展字段）。
- 指标 / 状态：无新增事件或 REST 字段。
- 诊断入口：现有服务端日志。

## 12. 测试计划

- 单元：`providerRetry` 纯函数（可重试类别、4xx `PROVIDER_UNKNOWN`、有产出、耗尽、60s 窗口、剩余预算）。
- 集成：TurnRunner 重试成功 / 耗尽 / 有产出不重试 / 终止类不重试；标题失败回调；标题 `maxRetries: 0`；压缩 `maxRetries`。
- E2E：不新增；Mock E2E 默认禁用标题总结，行为不受影响。
- 手动：真实 Provider 抖动无法构造，按日志字段核对。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| D1 重试次数与退避 | 共 3 次尝试，1s / 2s | 已于 2026-11-24 由用户按推荐方案批准 |
| D2 `PROVIDER_UNKNOWN` 是否重试 | 仅无状态码或 ≥500/408/409 时重试 | 同上 |
| D3 超长失败是否重试 | 单次尝试 >60s 不重试 | 同上 |
| D4 标题超时 | 60s，`maxRetries: 0` | 同上 |

## 14. 完成定义

- [x] 人类批准 D1–D4（2026-11-24）；
- [x] 验收场景 A1–A6 通过（均由 `test/agent/*` 覆盖；真实 Provider 抖动未构造，见 tasks 验收记录）；
- [x] `pnpm check` 通过（Windows `VITEST_MAX_WORKERS=2`：server 175 文件 / 935 项）；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] 无新增行内提示或 UI 变更。
