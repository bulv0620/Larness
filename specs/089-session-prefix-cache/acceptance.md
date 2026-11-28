# 验收记录：089 会话级前缀缓存（2026-11-24）

> 日期：2026-11-24。范围：PA-1～PA-5 交付物 + A1～A9。
> 未运行项在第 4 节逐条列出，不冒充通过。

## 1. 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm --filter @larness/server test test/agent/contextAssembler.test.ts` | 11 项通过 |
| `pnpm --filter @larness/server test test/agent/prefixCache.test.ts` | 16 项通过 |
| `pnpm --filter @larness/server test test/agent/contextCompressor.test.ts` | 7 项通过 |
| `pnpm --filter @larness/server test test/attachments/context.test.ts` | 5 项通过 |
| `pnpm --filter @larness/server test test/sessions/session-usage.test.ts` | 6 项通过 |
| `pnpm --filter @larness/server test test/sessions/api.test.ts test/agent/commands.test.ts` | 17 项通过 |
| `$env:VITEST_MAX_WORKERS="2"; pnpm check` | 通过：server 173 文件 / 923 项、31 跳过；biome 与全仓 typecheck 一并通过 |
| `pnpm build` | 通过：server（tsdown 四入口）+ web（vite） |
| `pnpm --filter @larness/web typecheck` | 通过 |

补充说明：同一套 `pnpm check` 在 `VITEST_MAX_WORKERS=3` 下连续两次出现 `test/agent/commands.test.ts > expires approval at the Turn deadline` 的 4 秒 `until()` 超时；该用例单独运行 565 ms 通过，且 2 workers 全量运行通过。属既有并行负载下的定时脆用例（与本次改动无调用关系），未修改其等待时间。

## 2. 验收场景

| ID | 结论 | 证据 |
|---|---|---|
| A1 写入记忆不改变稳定前缀 | 通过 | `contextAssembler.test.ts > keeps the system prefix byte-identical when a memory is written between turns`：两轮 `messages[0]` 逐字节相等，新记忆只出现在尾部块 |
| A2 日期变化与联网开关只影响尾部 | 通过 | `...keeps the system stable when the date changes or web search is toggled`：跨日与开关切换 `system` 均不变，日期/策略只在尾部 |
| A3 压缩后锚点稳定 | 通过 | `contextCompressor.test.ts > keeps the same history anchor for the turns after a compression`：压缩后追加历史，连续装配 `firstHistorySeq` 不变 |
| A4 压缩真正触发 | 通过 | `...triggers session compression before trimming on a long Turn`：窗口取 0.75 倍估算，`context.compressed` 落地且摘要行写入；`shouldCompress(699,1000)=false` 为阈值反例，`COMPRESSION_RATIO < DEFAULT_BUDGET.contextRatio` 断言防回归 |
| A5 工具数组会话内稳定 | 通过（单元/集成） | `attachments/context.test.ts > keeps attachment tools resident before any attachment exists`：上传前后 `tools` 深度相等，无附件 `read_attachment` 返回 `ATTACHMENT_NOT_FOUND`、`list_attachments` 为 `ok`；联网开关打开但连接不可用时工具仍在（`contextAssembler.test.ts`） |
| A6 断点归因正确 | 通过 | `prefixCache.test.ts` 11 个分类用例 + `TurnRunner` 两轮集成：`cold → none`，版本/指令/工具/裁剪/压缩/模型切换/驱逐各自命中枚举 |
| A7 归因不含敏感内容 | 通过 | 同上集成用例断言事件序列化后不含回复文本与 system 正文，哈希为 12 位十六进制；日志只有枚举与计数 |
| A8 缺字段/Provider 驱逐降级 | 通过 | `usageSource=unknown` 时 `cacheReadTokens` 缺省且不进分母（`session-usage.test.ts`）；`provider_eviction` 需同时满足 >2,000 token 与 >5%，且不改变行为 |
| A9 真实 Provider 观测 | **未运行（已按降级关闭）** | 本环境无 DeepSeek 凭据，未跑 `LARNESS_DEEPSEEK_SMOKE=1`；命中率本来也不是代码门禁（Q-032）。2026-11-28 用户确认按 Q-084 降级：089 的发布结论只覆盖合成与 Mock 验证，不补跑真实基线 |

## 3. 行为要点（便于人工复核）

- system 现在只含 `PROMPT_VERSION`（`089-1`）、策略与项目指令；易变块（日期、联网策略、全局偏好、记忆索引、会话摘要、附件声明）合并在当前 user 消息的 `Context supplied by the system for this Turn...` 块内，`AGENTS.md` 等指令段不再随日期/记忆变化而失效。
- 「更早历史已省略」提示也移到了当前请求，不再重写 system。
- 裁剪：超过 0.8 预算后一次降到 0.6，并把丢弃条数向上取整到 4 条一块，使后续几轮锚点不动。
- 会话压缩阈值 0.7 < 装配预算 0.8，长会话改走「摘要 + `coveredUpToSeq`」，不再静默丢历史。
- 附件三件套在注入附件服务后常驻；联网工具只由显式开关决定，连接健康只影响尾部文案与执行层错误码。
- `GET /api/sessions/:id/usage` 新增 `cache.breaks`；`turn.completed.usage` 口径未变，界面无新增提示。

## 4. 未运行 / 未覆盖

- A9 真实 Provider 两轮对比（无凭据）；`cacheReadTokens` 的前后基线因此缺失。
- `pnpm test:e2e`（Mock Chromium「两轮 + 上传附件」）：未运行，界面变化仅限无新增提示，未做 E2E 断言。
- 中段/尾段 system 之外的承载形态在真实 Provider 上的兼容性：本次只用 Fake provider 与单元/集成测试验证；`prompt_cache_key` 与显式缓存断点按 D5 不做。
- `HISTORY_SCAN_LIMIT` 截断的归因在 TurnRunner 层只通过 `history_drop` 体现，未单独构造 400+ 事件的 Turn 级集成。

## 5. 回滚

- 分层装配：把尾部块移回 system 并同步降回 `PROMPT_VERSION`（缓存冷启动一次）。
- 阈值/滞回：常量改回 0.8 / 关闭块取整。
- 归因：停止写入新字段即可，旧客户端与聚合层按缺省处理；无 schema 变化。
- 工具常驻：恢复 ready-attachment 判据与 `!webSearchAvailable` 的禁用规则。
