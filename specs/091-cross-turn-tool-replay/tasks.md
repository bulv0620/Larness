# 091 任务

> 状态：`done`（2026-11-25 用户直接要求实施 ①②③；2026-11-26 补生成态粘滞修复）

| ID | 状态 | 内容 |
|---|---|---|
| 091-TR-1 | `done` | `toolReplay` 模块：构造 / 解析 / redact / 预算常量 |
| 091-TR-2 | `done` | `turnRunner` 对 L0 成功结果写内部 `tool.replay`，不广播 |
| 091-TR-3 | `done` | `contextAssembler` 回放：预算内原文、超预算折叠、摘要边界、裁剪配对保护 |
| 091-TR-4 | `done` | `listSessionEvents` 过滤 `tool.replay` |
| 091-TR-5 | `done` | 服务端单测（replay / assembler / events / turnRunner） |
| 091-TR-6 | `done` | ③ 用量口径修订（084）：`本轮` + `会话累计` |
| 091-TR-7 | `done` | 文档：089 修订段、ws-events 说明、STATUS |
| 091-TR-8 | `done` | 回归修复：公开事件序号跳号时客户端补拉不得丢弃后续事件 |

## 验收记录（2026-11-25）

- 回放预算：`clamp(window × 0.05, 2_000, 32_000)` tokens；折叠预算为 25%，最多 16 条；扫描上限 120 条。
- 定向：`toolReplay` 5 项、`events` 5 项、`contextAssembler` 13 项、`turnRunner` 纯读批次用例、`contextCompressor` / `compaction` 28 项通过；③ `SessionUsageLine` 11 项、`Composer` 7 项通过。
- 整仓：server 175 文件 / 936 项通过（31 跳过），web 54 文件 / 312 项通过；`pnpm build`（含全 workspace typecheck）通过。
- **`pnpm check` 退出码为 1，但原因是已知的 `test/resources/terminals.test.ts` 原生 worker 崩溃（exit code 3），该文件其余用例通过，与本次改动无关**；不改写为全绿。
- 未运行：E2E、真实 Provider 长会话 A/B。回放对真实 token 成本与缓存前缀的影响未测。
- 2026-11-25 回归修复（091-TR-8）：新增 `timelineSequenceGap.test.ts` 3 项；覆盖补拉终态事件、实时缺口恢复、补拉进行中再次触发时排队重跑。前 2 项修复前失败（`lastSeq` 停在缺口前、`isStreaming` 保持 true），修复后全部通过。web 55 文件 / 318 项、`pnpm --filter @larness/web typecheck`、改动文件 `biome check` 通过。E2E 未运行。

### 2026-11-26 生成态粘滞残余修复（用户反馈仍偶然出现）

- `isStreaming` 不再作为可写字段存在；客户端改成单一 `turn: { id, phase, startedAt }` 状态机，组件通过 `selectIsStreaming` / `selectActiveTurnId` / `selectTurnStartedAt` 派生。只有持久 Turn 生命周期事件与显式开始/取消操作能推进 phase。
- `assistant.delta` / 推理 delta 只追加文本，不能开始或结束 Turn；终态后、其他 Turn 的迟到增量、旧 socket 帧均被忽略。
- 事件补拉失败最多自动重试 2 次（500ms / 1s）；`fetchAllEvents` 每页 15 秒超时，避免一次挂起的补拉长期占用全局 `syncing`。
- WebSocket `message` 处理器增加当前 socket 身份校验，旧连接排队帧不能写入当前时间线。
- 回归测试：`timelineSequenceGap.test.ts` 8 项（新增孤立 delta、迟到增量、补拉重试、加载终态竞态、跨会话 resume 守卫）；web 323 项全通过。
