---
id: 091-cross-turn-tool-replay
title: 跨 Turn 工具结果回放与按预算折叠
milestone: M6
status: done
depends_on: [089-session-prefix-cache]
owners: [human]
created: 2026-11-25
updated: 2026-11-25
---

# 跨 Turn 工具结果回放与按预算折叠

> 状态：`in_progress`（2026-11-25 用户直接要求：实施此前讨论的 ①②③）。
> 本切片推翻 [089](../089-session-prefix-cache/spec.md) 的两条旧约束：NG-3（不跨轮重放工具结果）与 R-4 中「historyMessages 的选择逻辑保持」。089 已按仓库惯例在文末加日期修订段，不改原文。
> ③（用量口径）是纯 web 修订，落在 [084](../084-agent-profiles-and-usage/tasks.md)，本切片不重复实现。

## 1. 背景与问题

当前跨 Turn 历史只重放 `user.message` / `assistant.message` 的文本（`contextAssembler.historyMessages`），上一轮的工具调用与工具输出不进入下一轮。实测同一会话的上下文占用呈锯齿：一轮从约 22k 起步、轮内涨到 102k，下一轮又回到 22k。模型因此必须重新 `read_file` / `search_code` 才能拿到上一轮已看过的内容。

`agent_events` 目前只持久化 `tool.completed.resultSummary` 与 `fileRead{path,version}`，没有可回放的正文。轮内已有 `foldOldToolResults`（保留最新 4 条、其余折叠为标识符）与 `lastCompleteToolBatch`，证明「保留最近 N + 折叠旧结果」是可用的固定策略；缺的是把它延伸到跨 Turn。

## 2. 目标

- **G-1** 跨 Turn 回放**最近 N token** 的只读工具结果原文，按 `seq` 升序插入历史，保持 tool-call / tool-result 配对。
- **G-2** 超出回放预算的旧结果**折叠（prune）为标识符**（复用 `foldToolResultContent`），而不是直接丢弃；更老的才省略，并在当前请求尾部显式说明省略数量。
- **G-3** 回放内容明确标记为「可能过期」，提醒模型在写入前重新读取，避免用旧版本内容生成 patch。
- **G-4** 只持久化只读（L0）工具的结果；写入、命令、部署、服务控制不回放。落盘前走 `OutputRedactor`，只保留有界正文。
- **G-5** 回放元数据不进入公开事件流：新增内部事件 `tool.replay`，只落库供装配读取，不广播、不出现在 `GET /api/sessions/:id/events` 的可见列表。

## 3. 非目标

- 不回放 L1+ 工具（`apply_patch`、`write_file`、`run_command`、部署、服务控制）的输入或输出。
- 不改变 Turn 内 55% 折叠、80%/90% checkpoint、85% rollover 阈值（ADR-071）。
- 不改变压缩阈值 0.7、保留 12 条、裁剪滞回 0.6/0.8（089 已定）。
- 不新增用户可见设置或图表；回放是后端常量。
- 不改变授权、审批、项目锁、幂等、审计与秘密处理语义。

## 4. 验收场景

### A1 回放配对与顺序

```gherkin
Given 上一 Turn 有 read_file 的 tool.completed 与内部 tool.replay
When 发起下一 Turn
Then 请求历史中出现 assistant(toolCalls=[该 call]) 紧跟 tool(toolCallId 相同)
And 顺序按事件 seq 升序，不早于摘要 coveredUpToSeq
And 当前 Turn 的回放不进入自己的请求
```

### A2 预算内保留原文

```gherkin
Given 最近若干条回放总估算不超过回放预算
When 组装请求
Then 这些 tool 消息逐字包含落盘正文
And 尾部块不含「已折叠」提示
```

### A3 超预算折叠而非丢弃

```gherkin
Given 回放候选总估算超过预算
When 组装请求
Then 最新的候选保留原文，直到预算用尽
And 次新的候选折叠为含 "folded":true 的标识符，仍保留 call/result 配对
And 更老的候选省略，尾部块说明省略数量
```

### A4 非 L0 与敏感内容

```gherkin
Given 一次成功 apply_patch 或 run_command
When Turn 结束
Then 不产生 tool.replay 事件
Given 一次 read_file 返回含 `token=...` 的文本
When 写入 tool.replay
Then agent_events 中的 replay 正文已替换为 [Redacted]
```

### A5 公开事件流不泄露回放正文

```gherkin
Given 会话中存在 tool.replay 事件
When 客户端拉取 GET /api/sessions/:id/events 或订阅 WS
Then 列表与推送中都不含 tool.replay
And seq 仍连续、分页不因隐藏事件空转
```

## 5. 接口与数据变更

- 内部事件 `tool.replay`，payload：`{ turnId, toolCallId, toolName, args, content, isError }`。`content` ≤16k 字符，落盘前 redact；`args` 序列化后 ≤2k 字符，否则该次不回放。
- 不新增 REST / WS 公开字段；`listSessionEvents` 过滤 `tool.replay`。
- 不新增表与迁移；复用 `agent_events`。保留期沿用 Q-033。
- 常量：回放预算 = `clamp(window × 0.05, 2_000, 32_000)` tokens；折叠预算 = 回放预算的 25%；最多折叠 16 条；扫描上限 120 条。

## 6. 安全与权限

- 只回放 L0 只读结果；写入类工具的事实仍走 checkpoint 与 `file.changed`，不进历史。
- 落盘前先跑 `secretVerdict`（命中已知凭据则跳过该条），再用 `OutputRedactor([])` 做模式化脱敏；回放不进入日志、审计或公开事件。
- `tool.replay` 不是授权来源；模型重新执行工具时仍走完整鉴权与审批。
- 回放正文按不可信数据处理，提示语声明可能过期。

## 7. 失败与边界

| 场景 | 行为 |
|---|---|
| 无 `tool.replay` | 历史与现状完全一致 |
| payload 解析失败 | 跳过该条，不阻断 Turn |
| 回放导致超预算 | 沿用 0.8 触发 / 0.6 低水位裁剪；裁到 tool 消息时连同其 call 一起丢，避免孤立 tool 消息 |
| 摘要覆盖到回放区间 | 按 `coveredUpToSeq` 跳过，摘要与回放不重复 |
| 当前 Turn 尚未完成 | 该 Turn 的回放事件不进入本 Turn 请求 |

## 8. 测试计划

- `apps/server/test/agent/toolReplay.test.ts`：构造/解析、redact、参数超限拒绝、正文截断。
- `apps/server/test/agent/contextAssembler.test.ts`：A1/A2/A3；裁剪边界不产生孤立 tool 消息。
- `apps/server/test/agent/events.test.ts` 或 sessions 事件测试：A5 分页与过滤。
- `turnRunner` 集成：L0 成功写入 `tool.replay`、L1 不写（如现有 turnRunner 测试夹具允许）。
- web：③ 的 `SessionUsageLine.test.tsx` 与 `Composer.test.tsx`（见 084 修订）。

## 9. 完成定义

- 上述测试通过，`pnpm --filter @larness/server test <相关文件>`、`pnpm --filter @larness/web test:file` 通过。
- `docs/contracts/ws-events.md` 增加「内部事件不广播」说明；089 修订段与 084 修订记录就位。
- `STATUS.md` 增加一行最近收口；不宣称 E2E 或真实 Provider 已验证。

## 10. 日期修订

### 2026-11-25 公开事件序号可跳号（回归修复）

- 原文 A5 的「seq 仍连续」表述不准确：`tool.replay` 占用会话内 `sequence`，过滤后公开事件的序号必然可能跳号。正确约束是**严格递增**，分页与补拉不因隐藏行空转。
- 客户端此前要求 `sequence === lastSeq + 1`，遇到 `tool.replay` 造成的缺口会把补拉回来的后续事件继续丢弃；若被丢的是 `turn.completed`，界面会永久停在 `generating`，切换会话触发全量加载才恢复。
- 修正：补拉路径允许跨过缺口并按事件序号推进 `lastSeq`；实时推送仍以跳号触发补拉，且补拉进行中再次触发时排队重跑，避免终态事件落在两次查询之间。
- 回归测试：`apps/web/src/stores/timelineSequenceGap.test.ts`（补拉终态事件、实时缺口恢复两项）。

### 2026-11-27 L1+ 操作日志（094）

- 本切片的 NG-2（不回放 L1+ 工具全文）继续成立；L1+ 的“做过什么”改由 [094](../094-operation-log/spec.md) 的 `tool.operation` + 当前 user 消息 tail 承担：只保留命令退出码/尾部、文件路径/版本/统计与失败摘要，不回放完整输出或 diff。
- 091 的 L0 回放、预算、折叠与公开事件过滤不变；两套机制互补，不重复记录 L0。
