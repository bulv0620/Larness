# ADR-070 Agent Profile 收敛与会话用量统计

- 状态：**accepted（2026-11-18）**
- 批准记录：2026-11-18 人类审核通过 084 spec 并指示开始实施；spec §12 的显示细节按下列决议执行。
- 关联：[084 spec](../../specs/084-agent-profiles-and-usage/spec.md)、[ADR-069](ADR-069-project-services-and-service-ops.md)、[ADR-068](ADR-068-agent-kernel.md)、[ADR-059](ADR-059-long-task-budget-and-continuation.md)。

## 决策

1. **Profile 只保留执行模式**：`AgentProfileId` 为 `coding | plan`。删除 `service-ops` Profile；旧 `sessions.agent_profile='service-ops'` 由迁移 `0034` 归一为 `coding`。
2. **两个 Profile 共享完整工具面**：读取、写入、命令、后台进程与 Service Ops 工具都进入 `coding` 和 `plan`；`plan` 仅额外拥有 `update_plan` 与计划提示。
3. **`plan` 不再是只读安全边界**：它只是“完整能力 + 计划”的执行模式。只读需求继续由审批策略 `readonly` 或未来的显式模式承担。
4. **PM2 观察按需读取**：两个 Profile 都不注入每轮 PM2 /runtime 观察快照；模型需要时调用 `list_service_ops`。`refresh_observations` 不再属于任何 Profile 的工具包，保留实现但退出模型面。
5. **验证比例原则进入系统提示**：Coding 默认先跑改动范围的定向检查；仅跨包、契约、迁移、认证/安全或用户明确要求时跑全量。不新增命令黑名单。
6. **会话用量只从已持久化 usage 聚合**：新增只读 `GET /api/sessions/:id/usage`，不新增表、不做字符估算。缺失 usage 的 Turn 计入 `missingTurns`，聚合标记 `partial`；前端用 `≥` 与“部分统计”呈现，不补零伪装精确总量。
7. **最后一步速度只来自实测**：`model.usage` 增加模型步骤墙钟 `durationMs`；前端仅在 Turn 进行中显示 `outputTokens / durationMs`。Provider 未上报 usage 时隐藏速度。
8. **过程状态收敛到折叠标题行**：删除时间线底部独立状态栏。标题行左侧为波形，显示 `Thinking...` / `Generating...` / `Running...` / `Waiting for approval...` / `Starting...` / `Completed · {duration}` / `Failed · {duration}` / `Stopped · {duration}`；reasoning 文本不进入可见 UI，也不触发自动滚动。

## 后果

- ADR-069 第 5 条“workspace 改为 service-ops、只管理 PM2”的独立 Profile 决策被本 ADR 取代；Service Ops 的人类弹窗、REST、锁与审计不变。
- 旧 `plan` 会话升级后直接获得写文件、命令与 PM2 能力；因为 `plan` 从未承担安全边界，不增加二次确认。
- 默认 Coding 的固定提示成本下降（无计划提示、无 PM2 观察），但部署任务需要一次显式 `list_service_ops`。
- 用量统计是只读派生数据，可在不影响 Turn 执行的情况下回退 UI 或路由。
- 迁移不可逆地改写 Profile 值；应用回滚不会恢复 `service-ops` 会话，需向前迁移新增值而不是删除数据。
