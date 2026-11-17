# 实施计划：计划终态呈现

> 用户已确认（2026-11-16）：单开切片定「Turn 终态如何处理未完成的计划步骤」，先写红测试再实现。

## 1. 顺序

1. **PT-1 红测试**：在 `Timeline.test.tsx` 断言 4 种终态各自的标签、无 `danger` 标记、摘要 `· 另有 N 步未完成`、活跃回合不变、`failed` 仍红叉、重放一致。此时实现未改，测试按预期失败。
2. **PT-2 呈现实现**：`TimelineItemView` 的 `PlanCard` 按 `turnOutcome` 派生显示状态，新增 `CircleDashed` 中性标记与「另有 N 步未完成」摘要；`Timeline` 传最后一片的 `turnOutcome`。
3. **PT-3 验证**：`@larness/web` 全量、`pnpm typecheck`、`pnpm exec biome ci .`、`pnpm build`。
4. **PT-4 收口**：`specs/README.md`、`ROADMAP.md`、`STATUS.md`、`docs/open-questions.md`（Q-040）。

## 2. 设计要点

- **显示状态是派生值，不写回数据**：`displayStepStatus(status, turnActive, outcome)`，`running` 在终态按结局映射，其他状态原样返回。
- **结局取合并链最后一片**：与回合摘要、成果汇总的口径一致，避免用第一片的 `interrupted` 给整条链贴标签。
- **`failed` 与「未完成」分离**：失败是模型报告的事实，未完成是回合结束时的状态；两者图标与色彩不同，计数只算后者。
- **引入 `CircleDashed`**：中性、非危险色，表示「开着但没结束」，避免让用户以为是失败。
- **纯前端**：服务端一行不改，重放天然一致（`turnOutcome` 已由 `applyServerEvent` 写进时间线）。

## 3. 不改动

- `PlanParamsSchema`、`plan.updated` 事件、`update_plan` 工具与审批。
- `turnRunner` 的终态处理、事件落库、REST / WS。
- 079 的提示与陈旧提醒。

## 4. 风险

| 风险 | 处置 |
|---|---|
| 把「已中断」读成「失败」 | 中性色 + 虚线圆，且标题写明已中断 / 已停止 |
| 摘要变长挤压标题 | 只在终态且存在未完成步骤时追加；`aria-label` 仍是计划标题 |
| 旧会话缺少终态事件 | 缺省按「未标记完成」，不红叉，测试覆盖 |
| 合并链结局取错片 | 与既有摘要同源（`stateUser` = 最后一片），已有链测试覆盖 |
