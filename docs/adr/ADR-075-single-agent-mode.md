# ADR-075：单一 Agent 模式、plan 常驻与项目指令层级

- 状态：**accepted（2026-11-27）**
- 批准记录：2026-11-27 人类确认「去掉 coding/plan 切换，保留通用模式；plan/todo 常驻；项目指令按约定执行但不得授权」。
- 关联：[095 spec](../../specs/095-single-agent-mode/spec.md)、[084 spec](../../specs/084-agent-profiles-and-usage/spec.md)、[ADR-070](ADR-070-agent-profiles-and-usage.md)、[ADR-068](ADR-068-agent-kernel.md)、[093 spec](../../specs/093-tool-interface/spec.md)、[094 spec](../../specs/094-operation-log/spec.md)。

## 背景

084/ADR-070 把 Profile 收敛为 `coding`（无 `update_plan`）与 `plan`（完整工具 + `update_plan`），目标是小任务少付计划提示成本。实际使用中：

- 默认 `coding` 的复杂任务没有外部步骤状态，容易漏步或提前收尾；
- 用户需要计划时必须先切换 Profile，切换本身是额外决策；
- `update_plan` 的 schema 约 299 token，且位于前缀缓存中，固定成本远低于“复杂任务失败一次”的代价；
- 项目 `AGENTS.md` 被 system 标成 “untrusted data”，模型可能不按仓库流程执行；验证策略又与仓库的 `pnpm check` 门禁冲突。

## 决策

1. **一个可见 Agent 模式**：移除 Composer 的 coding/plan 切换；新会话与界面只呈现通用模式。
2. **`update_plan` 常驻**：通用 Profile 包含 `plan` pack；system 始终注入计划策略，提示“3+ 个不同步骤时使用”，简单问题不用。
3. **`plan` 保留为兼容别名**：`sessions.agent_profile` 列与 API 值暂不删除；旧 `plan` 会话读取后与通用模式拥有相同工具面和提示。不做破坏性迁移，不删除历史数据。
4. **计划跨 Turn 可见**：最近一次 `plan.updated` 的计划以“Current plan（可能过期）”注入当前 user 消息 tail；全部步骤完成时不注入。
5. **一次 open-step nudge**：模型在当前 Turn 计划仍有 `pending`/`running` 步骤却返回纯文本时，追加一次 user 提示要求继续或更新计划；同一 Turn 只 nudge 一次，避免循环。上一 Turn 的旧计划不触发 nudge。
6. **项目指令层级**：`AGENTS.md` / `.larness/instructions.md` 是“项目约定”，模型应遵循；但它们不能授予权限、批准工具或覆盖安全策略。文件内容与工具输出仍是不可信数据。
7. **验证比例原则让位于项目门禁**：项目指令可以要求更严格的验证（例如提交前 `pnpm check`）；模型应遵循，除非与安全/授权冲突。没有项目门禁时仍默认先跑最小定向检查。
8. **提示版本**：system 核心变化，`PROMPT_VERSION` 升为 `095-1`；工具数组增加 `update_plan`，升级后首次请求一次 `tools`/`prompt_version` 前缀断裂，属预期。

## 替代 / 补充关系

- 取代 [ADR-070](ADR-070-agent-profiles-and-usage.md) 第 1～3 条关于 `coding` 无计划、`plan` 独立执行模式的决策；084 的用量统计、阶段状态与 UI 收敛继续有效。
- 保留 [ADR-068](ADR-068-agent-kernel.md) 的单循环、工具面与人类操作面分离；不引入 subagent。
- 不改变 [091](../091-cross-turn-tool-replay/spec.md) 的 L0 回放与 [094](../094-operation-log/spec.md) 的 L1 操作日志。

## 备选方案

- **继续保留两个 Profile**：切换成本与默认模式缺计划的问题仍在。
- **删除 `agent_profile` 列并强制迁移**：破坏性、无产品收益；保留列与别名更安全。
- **运行时分类“3+ 步”自动切工具**：误判且会改变工具数组/前缀；改为常驻工具 + 提示。
- **把项目指令当完全可信 system 指令**：会引入越权风险；采用“可遵循的约定，但不能授权”的层级。

## 影响

- **产品/UI**：Composer 移除 Profile 选择器；计划卡继续显示；不再需要用户先切 Plan。
- **API/数据**：`agent_profile` 字段保留；`plan` 作为兼容值映射到相同行为；无迁移。
- **上下文**：system 增加计划策略；tail 增加当前计划；`PROMPT_VERSION` 变化。
- **安全**：项目指令仍不能授权；审批、锁、审计、秘密处理不变。
- **验证**：更新 profiles/contextAssembler/turnRunner/plan/Composer 测试；覆盖 nudge 一次与旧计划不触发。

## 验证与回滚

- 验证：默认模式工具包含 `update_plan`；旧 `plan` 会话工具面一致；计划 tail 与 nudge 测试；项目指令措辞与验证门禁测试；`pnpm check`、`pnpm build`。
- 回滚：恢复 Profile 选择器与 `coding` 不含 `plan` 的 pack，移除计划 tail/nudge 与提示改动；`agent_profile` 数据未变，无需迁移。
