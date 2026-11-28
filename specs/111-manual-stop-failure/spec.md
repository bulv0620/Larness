---
id: 111-manual-stop-failure
title: 手动停止按失败效果呈现
milestone: 发布后
status: done
depends_on: [080-plan-terminal-state, 070-runtime-efficiency]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 111 手动停止按失败效果呈现

> 状态：`done`（2026-11-27 用户直接要求：「手动中断现在也按失败的效果吧」）。本切片只改呈现，不把 `CANCELLED` 改写成 `FAILED`；验收记录见 [tasks](tasks.md#验收记录)。

## 1. 背景与问题

用户点「停止执行」时，服务端把 Turn 落到 `CANCELLED`，并广播 `turn.cancelled`。数据、事件、审计和 Job 映射都把它与真正的 `FAILED` 区分开，这部分保持不变。

Web 端在 [080](../080-plan-terminal-state/spec.md) A1 之后把 `cancelled` 呈现为中性「已停止」：

- 回合摘要显示 `Stopped`，不是 `Failed`；
- 「已停止当前执行。」提示使用中性边框，不是失败色；
- 计划中仍为 `running` 的步骤显示「已停止」，而失败/中断的回合显示「已中断」。

用户现在希望手动中断也按失败的效果呈现。保留停止原因（数据仍是 `CANCELLED`），但界面上应与失败回合一致，避免把一次未完成的执行读成一次正常收尾。

## 2. 目标

- G-1：`turn.cancelled` 的回合摘要显示 `Failed`，与 `turn.failed` 一致。
- G-2：`turn.cancelled` 的终态提示使用失败边框，保留原文案「已停止当前执行。」与「重试」入口。
- G-3：`turn.cancelled` 截断的 `running` 计划步骤显示「已中断」，与失败/中断回合一致；步骤自身仍是中性标记，不伪装成 `failed` 步骤。
- G-4：纯呈现——服务端状态、事件、审计、Job 运行状态、数据库与恢复条件零改动。

## 3. 非目标

- NG-1：不把 `CANCELLED` 落库或广播为 `FAILED`，不改 `TurnStatus` / `TurnTerminalReason`。
- NG-2：不改定时任务运行状态、命令状态、终端状态或部署状态的取消语义。
- NG-3：不改变「取消的回合不提供继续入口」这一恢复边界。
- NG-4：不改真实失败回合、服务重启中断回合的呈现。
- NG-5：不新增 Toast、横幅或行内提示条。

## 4. 用户故事

- 作为主动停止执行的用户，我希望界面明确显示这轮没有跑到完成，而不是看起来像正常结束。
- 作为回看历史的用户，我希望停止的那一步和失败回合一样标出「已中断」，且仍能一键重试。
- 作为维护者，我希望停止与失败在数据和审计里仍可区分，只改读法。

## 5. 验收场景

### A1 手动停止的回合摘要

```gherkin
Given 某个 Turn 以 turn.cancelled 结束
When 时间线渲染该回合摘要
Then 状态显示 Failed
And 不显示 Stopped
```

### A2 手动停止的终态提示

```gherkin
Given 某个 Turn 以 turn.cancelled 结束
When 时间线渲染「已停止当前执行。」提示
Then 提示使用失败边框
And 仍显示「重试」入口
```

### A3 计划步骤

```gherkin
Given 计划有一项 running 步骤
When 回合以 turn.cancelled 结束
Then 该步骤显示「已中断」
And 与 turn.failed / turn.interrupted 的呈现一致
And 不使用失败红叉，也不把步骤状态改写成 failed
```

### A4 恢复边界与真实失败

```gherkin
Given 一个 cancelled Turn
When 用户查看该回合
Then 仍不提供「继续这个任务」入口
And 真实 failed 回合的 Failed、失败提示与重试入口保持不变
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `Timeline` 把 `turnOutcome === "cancelled"` 与 `"failed"` 一样计入失败状态，摘要显示 `Failed`。 |
| R-2 | MUST | 终态错误提示统一使用失败边框；`turn.cancelled` 的文案保持「已停止当前执行。」。 |
| R-3 | MUST | `displayStepStatus` 对 `cancelled` / `failed` / `interrupted` 都派生 `interrupted`，文案为「已中断」。 |
| R-4 | MUST | 删除仅用于 `cancelled` 的 `stopped` 显示状态，避免两套停止呈现回流。 |
| R-5 | MUST | 服务端、事件、审计、Job 状态、数据库与恢复条件零改动。 |
| R-6 | SHOULD | 代码注释说明「手动停止按失败呈现」是有意行为，而不是借用失败标记。 |

## 7. 接口与契约变更

- REST / WebSocket / IPC / 配置：无变更。
- 前端内部：`PlanStepDisplay` 移除 `stopped`；`Timeline` 的失败判断包含 `cancelled`。
- 契约同步：`docs/contracts/*` 无需更新；[080](../080-plan-terminal-state/spec.md) A1 的「已停止」呈现由本切片取代，数据语义不变。

## 8. 数据与迁移

- 无新表 / 新列 / 索引 / 迁移。
- 历史 `CANCELLED` 行不回溯；重放时按同一呈现规则读取。

## 9. 安全、权限与审计

- 只读既有事件与 Turn 状态，不引入新的数据来源或权限。
- 审计仍记录 `turn.cancelled` 与 `terminalReason=cancelled`，不伪装成失败。
- 不改变停止、重试、恢复的授权与幂等边界。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 旧会话缺少终态事件 | 仍按「未标记完成」 | 不新增失败提示 |
| `turn.interrupted`（服务重启） | 保持「Interrupted」与继续入口 | 不出现 `Failed` |
| 计划步骤自身为 `failed` | 保持红叉 +「失败：」 | 不因回合是 cancelled 而改写 |
| 取消后重试 | 沿用既有重发入口 | 新 Turn 照常创建 |
| 取消的回合 | 仍不提供继续入口 | 不出现「继续这个任务」 |

## 11. 可观测性

- 无新增日志或指标；数据侧仍可用 `turns.status = CANCELLED` 与 `terminalReason = cancelled` 复核。
- 呈现由事件纯派生，重放与实时一致。

## 12. 测试计划

- 单元 / 组件：`apps/web/src/features/chat/Timeline.test.tsx`
  - `turn.cancelled` 的计划步骤显示「已中断」；
  - 手动停止的摘要显示 `Failed`、提示使用失败边框并保留「重试」；
  - cancelled 仍不提供继续入口。
- 回归：`@larness/web` 全量、`pnpm typecheck`、`pnpm exec biome ci .`、`pnpm build`。
- E2E / 视觉：本次不新增浏览器断言；文案与样式由组件测试覆盖，视觉验收待用户按需确认。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 停止提示是否要改写成失败错误码文案？ | 保留「已停止当前执行。」，只换呈现效果 | 用户可后续提出 |

## 14. 完成定义

- [x] 验收场景全部通过；
- [x] 测试与检查通过；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] 未新增行内提示条，沿用既有终态提示与重试入口；
- [x] 用户已直接给出方向。
