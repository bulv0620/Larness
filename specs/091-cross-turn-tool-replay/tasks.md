# 091 任务

> 状态：`in_progress`（2026-11-25 用户直接要求实施 ①②③）

| ID | 状态 | 内容 |
|---|---|---|
| TR-1 | `done` | `toolReplay` 模块：构造 / 解析 / redact / 预算常量 |
| TR-2 | `done` | `turnRunner` 对 L0 成功结果写内部 `tool.replay`，不广播 |
| TR-3 | `done` | `contextAssembler` 回放：预算内原文、超预算折叠、摘要边界、裁剪配对保护 |
| TR-4 | `done` | `listSessionEvents` 过滤 `tool.replay` |
| TR-5 | `done` | 服务端单测（replay / assembler / events / turnRunner） |
| TR-6 | `done` | ③ 用量口径修订（084）：`本轮` + `会话累计` |
| TR-7 | `done` | 文档：089 修订段、ws-events 说明、STATUS |
| TR-8 | `done` | 回归修复：公开事件序号跳号时客户端补拉不得丢弃后续事件 |

## 验收记录（2026-11-25）

- 回放预算：`clamp(window × 0.05, 2_000, 32_000)` tokens；折叠预算为 25%，最多 16 条；扫描上限 120 条。
- 定向：`toolReplay` 5 项、`events` 5 项、`contextAssembler` 13 项、`turnRunner` 纯读批次用例、`contextCompressor` / `compaction` 28 项通过；③ `SessionUsageLine` 11 项、`Composer` 7 项通过。
- 整仓：server 175 文件 / 936 项通过（31 跳过），web 54 文件 / 312 项通过；`pnpm build`（含全 workspace typecheck）通过。
- **`pnpm check` 退出码为 1，但原因是已知的 `test/resources/terminals.test.ts` 原生 worker 崩溃（exit code 3），该文件其余用例通过，与本次改动无关**；不改写为全绿。
- 未运行：E2E、真实 Provider 长会话 A/B。回放对真实 token 成本与缓存前缀的影响未测。
- 2026-11-25 回归修复（TR-8）：新增 `timelineSequenceGap.test.ts` 3 项；覆盖补拉终态事件、实时缺口恢复、补拉进行中再次触发时排队重跑。前 2 项修复前失败（`lastSeq` 停在缺口前、`isStreaming` 保持 true），修复后全部通过。web 55 文件 / 318 项、`pnpm --filter @larness/web typecheck`、改动文件 `biome check` 通过。E2E 未运行。
