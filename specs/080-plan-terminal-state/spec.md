---
id: 080-plan-terminal-state
title: 计划终态呈现
milestone: 发布后
status: done
depends_on: [036-conversation-experience, 079-plan-progress]
owners: []
created: 2026-11-16
updated: 2026-11-16
---

# 080 计划终态呈现

> 状态：`done`（2026-11-16）。用户确认「Turn 终态如何处理未完成的计划步骤」单开切片后实现；验收记录见 [tasks](tasks.md#验收记录)。

## 1. 背景与问题

079 的诊断记录了同一根因的附带缺陷：本机 18 个有计划的本机 Turn 中，**7 个计划终态与执行事实不一致**——3 个停在 `running`/`pending`，4 个已交付但计划仍留 `pending`。

- 回合结束后，`running` 步骤被渲染成**红色叉号 +「未完成」**，等于把「被取消 / 被中断 / 模型没来得及同步」说成「失败」。
- 已完成的回合仍留 `pending` 时，折叠行只显示 `计划 · 3/5`，不说还剩几步。

服务端不得改写步骤状态（[036](../036-conversation-experience/spec.md) 的「取消 / 失败不得自动勾完」），因此这条只能在呈现层解决：用回合结局解释仍未结束的步骤，并如实报出剩余步数。

## 2. 目标

- G-1：终态的 `running` 步骤不再借用失败标记，按回合结局显示「已停止 / 已中断 / 未标记完成」。
- G-2：终态折叠摘要报出未完成步数。
- G-3：`failed` 仍是失败；`done` / `pending` 的含义不变。
- G-4：纯呈现——不改事件、不改库、不改服务端状态，重放与实时一致。

## 3. 非目标

- NG-1：不补写 `plan.updated`、不自动勾完、不推断步骤是否真实完成。
- NG-2：不改 `PlanParamsSchema`、`plan.updated` 事件、REST / WS / IPC 与存储。
- NG-3：不改活跃回合的呈现（spinner、当前步骤标题）。
- NG-4：不给「完成但计划未同步」新增弹窗、横幅或提示音。

## 4. 用户故事

- 作为取消任务的用户，我希望计划写「已停止」，而不是把我刚取消的工作标成失败。
- 作为审查历史的用户，我希望重放的计划与当时看到的一致。
- 作为完成长任务的用户，我希望一眼看出还有几步没有勾掉。

## 5. 验收场景

### A1 取消的回合

```gherkin
Given 计划有一项 running 步骤
When 回合以 turn.cancelled 结束
Then 该步骤显示「已停止」与中性标记
And 不使用失败红叉，也不计入失败
```

### A2 中断或失败的回合

```gherkin
Given 计划有一项 running 步骤
When 回合以 turn.interrupted 或 turn.failed 结束
Then 该步骤显示「已中断」
And 不使用失败红叉（失败由步骤自身的 failed 状态表达）
```

### A3 完成但计划未同步

```gherkin
Given 计划有一项 running 步骤
When 回合以 turn.completed 结束
Then 该步骤显示「未标记完成」
And 同计划的 pending 步骤仍显示「待做：」
```

### A4 没有终态记录的回合

```gherkin
Given 会话里某一轮的终态事件缺失（历史数据）
When 展示该轮计划
Then running 步骤显示「未标记完成」而不是红叉
```

### A5 终态摘要

```gherkin
Given 回合已结束，计划有 N 项 running 或 pending
When 折叠行渲染
Then 显示「计划 · 已完成数/总数 · 标题 · 另有 N 步未完成」
And 全部步骤为 done / failed 时不追加该计数
```

### A6 活跃回合不变

```gherkin
Given 回合仍在进行
When 计划有 running 步骤
Then 仍显示 spinner 与当前步骤标题
And 没有结局文案，也没有未完成计数
```

### A7 重放一致

```gherkin
Given 同一份计划与终态事件
When 从事件重建时间线并重新渲染
Then 标签与摘要与实时一致
```

### A8 失败步骤保持失败

```gherkin
Given 计划有一项 failed 步骤
When 回合已结束
Then 该步骤仍是红叉 +「失败：」
And 它不计入「另有 N 步未完成」
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 终态下 `running` 步骤的显示状态按 `turnOutcome` 派生：`cancelled → stopped`，`failed` / `interrupted → interrupted`，`completed` / 缺失 → `unmarked`。 |
| R-2 | MUST | 上述三类派生状态使用中性标记（虚线圆），禁止使用 `danger` 色；`failed` 步骤保持 `danger` 叉号。 |
| R-3 | MUST | 终态且存在未完成步骤时，折叠摘要追加 `· 另有 N 步未完成`，N 为 `running` + `pending` 数量；N 为 0 不追加。 |
| R-4 | MUST | 活跃回合的呈现不变：spinner、当前步骤标题、无结局文案与计数。 |
| R-5 | MUST | 服务端、事件与存储零改动；不得改写计划步骤状态。 |
| R-6 | SHOULD | 派生状态文案可见（不只 `sr-only`），并保留既有 `sr-only` 的「已完成：/ 待做：」。 |

## 7. 接口与契约变更

- **REST / WebSocket / IPC / 数据库**：无变更。
- **前端内部属性**：`TimelineItemView` 新增可选 `turnOutcome`，转交 `PlanCard`；`Timeline` 传 `stateUser?.turnOutcome`（合并链取最后一片）。
- **新增前端显示状态**：`stopped` / `interrupted` / `unmarked`，仅存在于 `apps/web` 的显示类型，不进入共享 schema。
- **契约同步**：`plan.updated` 形状未变，`docs/contracts/ws-events.md` 无需更新；与 [036](../036-conversation-experience/spec.md) 的「取消 / 失败不得自动勾完」一致，本切片只改读法。

## 8. 数据与迁移

- 无 schema 迁移、无新表 / 新列、无历史回填。
- 旧会话缺少终态事件时按 A4 呈现，不需要重建数据。

## 9. 安全、权限与审计

- 呈现只读既有事件，不引入新的数据来源或权限。
- 不因终态暗示「工作已完成」或「工作已失败」：文案区分「未标记完成」「已中断」「已停止」，失败只由 `failed` 表达。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 旧会话缺少终态事件 | 视为未落终态 | 「未标记完成」，不红叉 |
| 自动继续的合并链 | 结局取最后一片，计划取最新一份 | 与既有回合摘要一致 |
| 实时 → 终态过渡时计划已展开 | 只换状态文案与图标 | 展开状态保留 |
| 终态下仍有 `failed` 步骤 | 保持失败标记 | 红叉 +「失败：」 |
| 计划全部 `done` | 不追加未完成计数 | `计划 · N/N · 标题` |

## 11. 可观测性

- 无新增日志：显示状态由 `turnOutcome` 与步骤状态纯派生，可重复计算。
- 效果可用既有 `plan.updated` 事件与回合终态统计复核，不需新指标。

## 12. 测试计划

- `apps/web/src/features/chat/Timeline.test.tsx`：
  - 4 种终态 × 实时 / 终态 / 重放（`it.each`）；
  - 未完成计数、失败步骤不计入、全部结束不追加；
  - 未落终态回合读作「未标记完成」；
  - `.text-danger` 断言保证中性标记。
- 回归：`@larness/web` 全量、`pnpm typecheck`、`pnpm exec biome ci .`、`pnpm build`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 完成回合仍有 `pending` 时，是否需要在回合摘要额外提示「计划未同步」？ | 只计划行显示计数，不加回合级提示 | 见 [Q-040](../../docs/open-questions.md) |

## 14. 完成定义

- [x] 验收场景全部通过；
- [x] 测试与检查通过；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] 用户已确认方向（单开切片）。
