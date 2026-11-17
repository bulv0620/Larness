---
id: 079-plan-progress
title: 计划步骤即时更新
milestone: 发布后
status: done
depends_on: [036-conversation-experience, 051-agent-tool-contract]
owners: []
created: 2026-11-16
updated: 2026-11-16
---

# 079 计划步骤即时更新

> 状态：`done`（2026-11-16）。用户确认「提示层加硬 + 运行时陈旧提醒」方向后实现；验收记录见 [tasks](tasks.md#验收记录)。

## 1. 背景与问题

「计划不会一步步勾下去，等全部完成才一次性全勾」由用户报告。按本机数据库最近 55 个 Turn 复核，链路本身没有丢事件：

- 18 个 Turn 产生过计划，共 37 次 `update_plan` / 34 条 `plan.updated`；
- 34 次计划事件中，**每轮 1 次 = 5 轮、2 次 = 10 轮、3 次 = 3 轮**；「2 次」的第二次基本落在最后一个工具调用之后（例如 `tools=203` 的一轮在 `+1849s` 才更新）；
- 因此计划在 55～200 个工具调用期间一个字都没变，用户看到的正是「0/N 一直不动，最后一次性全勾」。

问题出在模型行为，而非持久化 / 广播 / 渲染：事件逐条落库并广播（`turnRunner.ts` 的 `update_plan` 处理器、`#emit`），前端 reducer 与时间线也逐条应用（`eventReducer.ts`、`Timeline.tsx`），已有测试覆盖逐次更新。根因是三处叠加：

1. 系统提示只有一句软约束「use update_plan … update it as you work」，工具描述同样是「update progress as work completes」。
2. 没有任何**步骤级**运行时机制。唯一的进度提醒是 ADR-059 的预算收尾提示，它恰好发生在结尾，与「结尾补一次全 done」的行为吻合。
3. 成本结构不利：`update_plan` 是全量替换语义，每更新一次要多一次工具调用往返，在花费 / 步数预算下模型自然攒到最后。

同一根因还留下两个可观测缺陷：3 轮终态停在 `running`/`pending`（Turn 结束后被渲染成「未完成」红叉），4 轮已交付但计划仍留 `pending`，合计 **7/18 轮的计划终态与执行事实不一致**。

## 2. 目标

- G-1：提示层明确「完成一个步骤就立即更新」，并要求与下一步的工具调用同批发出，而不是只在结尾更新一次。
- G-2：运行时有确定性机制：计划陈旧时注入一次简短提醒，不依赖模型自觉。
- G-3：提醒只是提示，绝不代模型改状态；取消 / 失败的步骤不得被自动勾完。
- G-4：提醒有界且不重复，不成为新的上下文与花费问题。

## 3. 非目标

- NG-1：不做服务端自动勾完或自动推导步骤状态（违反 036 的「取消/失败不得自动勾完」）。
- NG-2：不改变 `update_plan` 参数、schema、风险级别（L0）、审批、项目锁与事件形状。
- NG-3：不新增工具、不新增 REST / WS 端点、不新增数据库列。
- NG-4：不改变前端计划渲染与 Turn 终态呈现。
- NG-5：不做提醒次数的自适应学习或按模型区分。

## 4. 用户故事

- 作为等待长任务完成的用户，我希望计划在每一步完成时勾掉，以便知道现在做到哪一步。
- 作为取消任务的用户，我希望计划如实保留未完成状态，而不是显示我刚取消的工作「已完成」。
- 作为审查对话历史的用户，我希望历史 Turn 的计划回放与当时一致。

## 5. 验收场景

### A1 步骤完成即更新

```gherkin
Given 一个复杂任务已创建计划，第一步 running、第二步 pending
When 第一步的真实工作完成、模型继续下一步
Then 模型在同一批工具调用中调用 update_plan，将第一步置 done、第二步置 running
And 事件流中出现第二条 plan.updated，且步骤状态为 [done, running]
```

### A2 计划陈旧时提醒一次

```gherkin
Given 计划存在未完成步骤，且已有 6 个工具调用没有更新计划
When 发起下一步模型请求
Then 请求中出现一条提醒，引用当前未完成步骤与未更新时长，要求与下一批工具调用同批更新
And 计划更新后，同一提醒不再重复出现
```

### A3 计划新鲜时不打扰

```gherkin
Given 模型每完成一步就更新计划
When 继续执行
Then 请求中不出现陈旧提醒
```

### A4 没有计划或无事可做时保持安静

```gherkin
Given 本轮没有计划，或所有步骤已 done / failed
When 工具调用数超过阈值
Then 不注入任何提醒
```

### A5 提醒不得诱导虚假完成

```gherkin
Given 出现陈旧提醒
When 模型随后更新计划
Then 提醒文本只要求「完成且已验证才标 done」，不要求把剩余步骤一次性标 done
And 服务端仍按 036 校验（重复 ID、多项 running、超限状态一律 VALIDATION_ERROR）
```

### A6 取消 / 失败不自动勾完

```gherkin
Given 计划仍有 running 步骤
When 本轮被取消、失败或中断
Then 计划保持模型最后报告的状态，不产生补写的 plan.updated
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 稳定系统提示必须要求「计划在第一个动作前创建；步骤完成后与下一步的工具调用同批更新；不得把全部状态变更留到结尾」。 |
| R-2 | MUST | `update_plan` 工具描述必须与提示一致，并明确「状态是模型对进度的报告；未完成或未验证不得标 done；取消或失败的步骤不得标 done」。 |
| R-3 | MUST | Runner 按工具调用数统计「距上次计划更新」，达到阈值时在下一步请求尾部注入一次提醒。 |
| R-4 | MUST | 提醒每个计划版本只发一次；模型调用 `update_plan` 后计数与「已提醒」一起复位。 |
| R-5 | MUST | 提醒只在存在未完成步骤（`pending` / `running`）时产生；无计划或全部 `done` / `failed` 时不产生。 |
| R-6 | MUST | 提醒文本有界（最多引用 5 个未完成步骤，其余以计数收尾），且不得要求把未验证步骤标 done。 |
| R-7 | SHOULD | 注入提醒时写一条结构化日志（`turnId`、`sessionId`、`toolCallsSincePlanUpdate`），不含计划正文。 |

## 7. 接口与契约变更

- **REST / WebSocket / IPC**：无变更。`plan.updated` 的 payload 与事件类型不变。
- **模型上下文**：`contextAssembler.ts` 的 `SYSTEM_POLICY` 计划条款改写；`PROMPT_VERSION` 由 `m6-1` 升为 `m6-2`（稳定系统核心变化，便于解释缓存失效）。
- **工具描述**：`planTool.ts` 的 `update_plan` 描述改写；schema `PlanParamsSchema` 与状态别名 `repairPlanArgs` 不变。
- **新增内部模块**：`apps/server/src/modules/agent/turn/planReminder.ts`（阈值常量、纯函数、提醒文本）。
- **常量**：`PLAN_STALE_TOOL_CALLS = 6`、`MAX_QUOTED_OPEN_STEPS = 5`。
- **契约同步**：按 [051 持续约束](../051-agent-tool-contract/spec.md#持续约束)，工具描述、模型 schema、system prompt 与验收同批更新；`docs/contracts/ws-events.md` 无需变更（事件形状未变）。

## 8. 数据与迁移

- 无 schema 迁移，无新表 / 新列，无历史回填。
- 提醒只存在于该次请求的消息里，不落库、不进事件、不影响重放。

## 9. 安全、权限与审计

- 提醒不携带新权限：仍是同一次已鉴权 Turn 的同一次模型请求。
- 提醒文本只含计划标题 / 状态与计数，属于模型自己报告的内容；`update_plan` 的凭据检查（`secretVerdict`）照旧在工具执行前运行。
- 不因提醒放宽任何校验：重复 ID、多项 running、1–12 步、非法状态仍返回 `VALIDATION_ERROR`。
- 不自动勾完：服务端不改写步骤状态，取消 / 失败 / 中断不补写 `plan.updated`。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 模型忽略提醒，继续不更新计划 | 不重复提醒，不阻塞执行；计划停在旧状态 | 与现状一致（计划未勾） |
| 计划全部 `done` 后仍有工具调用 | 不提醒；新增工作由模型自行扩步 | 无变化 |
| 计划更新后又过了 6 个工具调用 | 再次提醒一次（每个计划版本一次） | 无变化 |
| 上下文压缩 / 检查点替换消息 | 提醒不重复注入；检查点 `openSteps` 仍保留未完成步骤 | 无变化 |
| 提醒发生在预算收尾提示同一步 | 两条提示同时附加，收尾提示仍要求「按实际更新计划」 | 无变化 |
| 模型用别名状态（`in_progress` 等） | 仍由 `repairPlanArgs` 归一化后校验 | 无变化 |

## 11. 可观测性

- 日志：`stale plan reminder requested`，字段 `turnId` / `sessionId` / `toolCallsSincePlanUpdate`；不含计划标题正文。
- 计划事件本身已可统计「每轮计划更新次数」，作为本切片效果的真实指标。

## 12. 测试计划

- 单元：`planReminder.test.ts`——阈值前后、优先级（running 优先）、上限引用、无计划 / 全部结束、已提醒不重复、`threshold <= 0` 关闭。
- 集成（真实 Runner + SQLite + FakeProvider）：`plan.test.ts`——6 次工具调用后出现一次提醒、更新后不再重复、`plan.updated` 序列为 `[running, pending] → [done, running]`；工具描述包含同批更新与「未验证不得标 done」。
- 上下文：`contextAssembler.test.ts`——实际组装的系统提示包含同批更新条款与「never mark a step done」。
- 回归：`test/agent` 全量（29 文件 174 项）。
- 命令：`biome ci`、`pnpm typecheck`、`pnpm build`；`pnpm test` 全量的既有并发脆用例见 [tasks](tasks.md#验收记录)。未运行 E2E 与真实模型长任务，按需另行安排。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 阈值 6 个工具调用是否合适 | 取 6：既覆盖单步多次读改，又在 100+ 调用的一轮里只多花一次提示 | 见 [Q-039](../../docs/open-questions.md) |
| 是否按模型区分提醒强度 | 本切片不区分 | 未排期 |

## 14. 完成定义

- [x] 验收场景全部通过；
- [x] 测试与检查通过；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] 用户已确认方向（A + B）。
