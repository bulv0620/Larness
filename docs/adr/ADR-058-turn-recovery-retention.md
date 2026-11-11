# ADR-058 中断 Turn 的接手恢复与事件保留策略

- 状态 proposed（2026-11-11 草案，待人类负责人确认 D1–D4）。确认后改为 accepted 并记录日期。
- 关联：[071 spec](../../specs/071-turn-recovery/spec.md)、[070 运行时效率](../../specs/070-runtime-efficiency/spec.md)、[ADR-055](ADR-055-npm-update-security.md)（升级前备份）、[ADR-054](ADR-054-scheduler-execution.md)（自动化执行边界）、[工程宪法](../../CONSTITUTION.md) 第三条（失败关闭）、第六条（秘密不进入模型与前端）。
- 实施状态：未实施。规格 `draft`；TR-4（删除）必须在 D2、D3 确认且 TR-1 体积报告完成后才可开工。

## 背景

服务重启时 `repairInterruptedTurns` 把所有活跃 Turn 标记 `INTERRUPTED` 并写入终止事件（`apps/server/src/modules/agent/repair.ts:33-43`），没有续跑路径。同时 `cleanupExpired` 只清理认证相关行与资源事件（`apps/server/src/db/cleanup.ts:16-39`），`agent_events`、`turns`、`session_context_summaries` 没有任何保留策略——命令输出有 7 天、命令 30 天、资源事件 30 天，而这几张表永远增长。

两件事必须一起定：保留多久决定恢复能依赖多少历史；删除粒度决定时间线是否出现半截会话。070 的 HX-7 会产出结构化的工程事实（文件版本、命令退出码、失败诊断、未完成步骤），这使「接手恢复」第一次变得可行。

## 决策

1. **恢复通过新建 Turn 实现，旧 Turn 不可变**。`POST /api/turns/:id/resume` 校验原 Turn 为 `INTERRUPTED`、存在可用事实、原模型与凭据可解析，然后创建新 Turn 并记录 `resumedFromTurnId`，沿用原会话与 provider/model/thinking 快照。理由：终止事件、审计与幂等键都已按"旧 Turn 已结束"写入，原地复活需要改写历史并破坏幂等语义。旧 Turn 保持可追溯也是审计要求。
2. **不自动恢复**。重启后不自动续跑，恢复只能由用户在 UI 上显式确认。自动续跑会重复执行写入、命令与部署，违反"不重复副作用"；自动化任务（[ADR-054](ADR-054-scheduler-execution.md)）不提供恢复入口。
3. **事实只来自已持久化事件与检查点**。恢复上下文含目标、已改文件与版本、命令与退出码、最近失败诊断、未完成步骤、资源 ID，并显式标注"facts may be stale，执行写入或部署前先查实际状态"。事实段有 token 上限，超限时按 目标 → 未完成步骤 → 文件清单 的顺序裁剪。
4. **清理默认不删除**。`cleanup.enabled` 默认 `false`；默认只做 dry-run 并输出候选条数与预计释放体积。开启后按**会话整段删除**（跳过活跃 Turn 与 `pinned`），在单个事务内整体成功或整体不删，写入审计（策略版本、候选/删除条数、耗时、备份位置），并在开启前强制执行一次数据库备份（复用 [ADR-055](ADR-055-npm-update-security.md) 的备份路径）。
5. **保留期按表区分、可配置**：建议 events 90 天、turns 180 天、摘要 90 天，另有 `maxBytes` 上限；活跃会话与显式保留项豁免。默认值属产品决策（D2），未确认前不写死。
6. **诊断先行**。先提供只读的体积报告（各表行数/字节、最旧时间、候选清理规模），再决定是否开启删除。没有报告就不开启清理。

## 备选方案

- **原地复活旧 Turn**：时间线只保留一个 Turn，但需改写已写入的终止事件与审计结论，并与幂等键、预算重置、`endedAt` 语义冲突。
- **重启时自动续跑**：用户零操作，但会重复执行已成功的写入与部署；一旦事实过期还会基于旧状态决策。
- **只恢复摘要不恢复事实**：实现最省，但模型不知道哪些步骤已完成，仍会重跑，反而放大副作用风险。
- **单事件粒度删除**：保留更多历史，但会产生"只有提问没有回答"的半截会话，压缩与前端都要额外兼容。
- **清理默认开启**：体积自动受控，但属于静默删除用户数据，违反"破坏性操作需显式同意"。

## 影响

- **产品 / UI**：中断 Turn 显示"中断于第 N 步"与恢复按钮（二次确认）；设置或 doctor 增加体积报告与清理开关（默认关）。
- **API / 契约**：新增 `POST /api/turns/:id/resume` 与只读体积接口；`TurnDto` 增 `resumedFromTurnId`；新增 `turn.resumed` 事件；保留策略进入配置 schema。详见 [REST](../../docs/contracts/rest-api.md)、[WS 事件](../../docs/contracts/ws-events.md)、[数据模型](../../docs/contracts/data-model.md)。
- **数据 / 迁移**：`turns.resumed_from_turn_id`、`sessions.pinned_at`、`idx_turns_resumed_from`；迁移 `0024` 只加可空列。
- **安全 / 权限**：恢复是新的执行入口，必须走认证、CSRF 与项目锁，且不接受客户端覆盖模型/凭据；事实段不含秘密与工具输出正文；清理是破坏性操作，默认关闭、需备份、审计可查。
- **兼容性**：两列可空，旧行视为"非恢复、未保留"；未开启清理时行为与现状一致。

## 验证与回滚

- 验证：071 的 A1–A5；`pnpm check`、`pnpm build`、Mock E2E「中断 → 继续」；手动 kill 服务后恢复一次长任务；dry-run 报告与真实体积一致。
- 回滚：先关 `cleanup.enabled` 再回退代码；恢复接口回退不影响旧链路；已删除数据不可恢复，因此开启清理前必须完成备份并在审计中记录位置。

## 后续

- 保留期与体积上限的最终数值由 TR-1 的真实体积报告支撑后确定（Q-033）。
- 跨会话的长期记忆（项目级事实沉淀）不在本 ADR 范围。
