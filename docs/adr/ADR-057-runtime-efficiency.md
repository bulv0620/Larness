# ADR-057 运行时效率：稳定前缀、预算终态与长 Turn 检查点

- 状态 accepted（2026-11-11，人类直接确认 D1–D7 全部采用推荐方案）。
- 关联：[070 spec](../../specs/070-runtime-efficiency/spec.md)、[063 多 Provider 与压缩](../../specs/063-multi-provider/spec.md)、[064 调度器](../../specs/064-scheduler/spec.md)、[051 工具执行契约](../../specs/051-agent-tool-contract/spec.md)、[ADR-050](ADR-050-pm2-cli-deployment.md)、[ADR-053](ADR-053-model-catalog-thinking.md)、[工程宪法](../../CONSTITUTION.md) 第三 / 六 / 十条。
- 实施状态：规格 `ready`，按 HX-1 → HX-8 落地（见 [tasks](../../specs/070-runtime-efficiency/tasks.md)）。未实施前不得宣称已获得缓存收益或已修好停止语义。

## 背景

当前每个模型步骤都会重写请求的第一条 system 消息，而这条消息里混入了实时资源观察（临时服务、运行中终端、PM2 服务状态与 `updatedAt`）与摘要。任一观察变化都会作废整条前缀，使 Provider 的上下文缓存无法命中续步；同时每步都要跑一次 `runtime.reconcile()` → `pm2.list()`。这一点与 [命令上下文契约](../../docs/contracts/agent-command-context.md) 第 13 行「每次模型请求使用实际运行时生成的 PM2 信息，模型步骤之间刷新服务观察」直接相关——该条款是本 ADR 要替换的对象。

另外三处问题不属于性能范畴，而是正确性：

1. Turn 的 `maxDurationMs` 没有接到在途请求上，单步可越过整个 Turn 预算占用会话队列。
2. 预算耗尽与模型输出截断都被记为 `COMPLETED`，自动化任务据此记录 `succeeded`。
3. 长 Turn 没有上下文保护：现有压缩只处理已持久化的跨轮文本，明确排除当前 Turn，一旦超窗即 `PROVIDER_CONTEXT_LIMIT` 失败。

## 决策

1. **system 只放稳定内容**。`PROMPT_VERSION` + 安全/工具使用/秘密保护/验证/服务生命周期/策略行 + 项目指令 + **Turn 起点**的资源观察快照，在 Turn 内逐字节不变。工具数组按名称排序并在 Turn 内只解析一次。依据官方说明，命中要求**完整匹配一个缓存前缀单元**，所以续步请求必须是上一次的严格超集：一旦重写 system，任何已落盘单元都无法匹配。缓存本身是尽力而为，不保证 100% 命中，也不承诺延迟收益，收益按命中 token 计。
2. **资源观察改为「起点快照 + 显式刷新」**。普通续步不再注入实时观察；Agent 需要最新状态时调用只读的 `refresh_observations`，或使用既有的服务/终端/PM2 查询；状态变更类工具的结果自带最新观察。系统提示明确：声明状态前先刷新，`RUNNING` 与 CLI 退出码 0 不构成健康证明。**本决定替换 `docs/contracts/agent-command-context.md` 第 13 行的每步刷新条款**，保留"每次执行仍以真实运行时为准"的实质约束。
3. **终态用 `terminal_reason` 表达，不扩张 `TurnStatus`**。取值为 `normal` / `budget` / `output_truncated` / `provider_error` / `cancelled` / `interrupted`，落在 `turns.terminal_reason`，同时进入 `turn.*` 事件、REST DTO、UI 与审计。自动化任务把非 `normal` 的 `COMPLETED` 记为 `failed` + `JOB_AGENT_INCOMPLETE`。理由：`TurnStatus` 已被 web、E2E、契约与历史数据广泛依赖，新增枚举的改造面远大于收益。
4. **截止时间贯穿**。`deadline = startedAt + maxDurationMs` 同时约束模型请求、摘要调用与工具执行；在途请求在到点时被中止；`timeoutMs`、`maxOutputTokens`、`maxRetries` 显式下发，不允许 SDK 默认值越过预算。
5. **长 Turn 检查点复用摘要表**。`session_context_summaries` 增 `scope`（`session`/`turn`）、`turn_id`、`reason`；检查点只在本 Turn 的完整工具批次边界建立，事实来自已持久化事件；摘要失败时 `degraded` 并使用结构化事实，不覆盖旧摘要；跨轮装配忽略 `scope='turn'` 的记录。
6. **用量与诊断只存元数据**。`model.usage` 增 `cacheReadTokens` / `noCacheTokens` / `usageSource`，`turns.usage_json` 同口径；检查点、前缀重建原因、阶段耗时都只记录数字与枚举，不记录 prompt、工具参数或工具输出（宪法第六条）。
7. **开轮压缩规则保留**。M5-1d 的「≥70% 窗口触发跨轮压缩」不变；新的每步预检与 soft/hard 水位只作用于 Turn 内部，两者不互相替代。

## 备选方案

- **只把 PM2 字段换成稳定值，保留每步重装配**：服务与终端观察仍会抖动，前缀仍会失效，且每步仍有 PM2 RPC，收益不足以覆盖改动。
- **尾部「变化才追加」观察块**：前缀也能稳，但每次变化都新增消息，需要去重与上限逻辑；作为 D1 未批准时的降级方案保留。
- **新增 `BUDGET_EXHAUSTED` 状态**：语义直白，但枚举扩散到前后端与历史数据，迁移与兼容成本高。
- **新建 `turn_checkpoints` 表**：语义干净，但与摘要表共享脱敏、清理与事件路径，维护面翻倍。
- **依赖 SDK 默认重试与超时**：无法被 Turn 预算约束，实测可产生 3×600s 的单步。
- **只在 UI 上标注"可能提前结束"**：不解决 Job 假成功与数据一致性问题，属于把不确定当成功，违反宪法第三条。

## 影响

- **产品 / UI**：Turn 详情与时间线新增"预算停止""输出截断"标识；用量区分命中与未命中；Agent 多一次显式刷新才能拿到实时服务状态。
- **API / 契约**：[WS 事件](../../docs/contracts/ws-events.md)（`model.usage` 扩展、`turn.*` 增 `terminalReason`、新增 `context.checkpoint`）、[REST](../../docs/contracts/rest-api.md)（Turn DTO）、[数据模型](../../docs/contracts/data-model.md)、[命令上下文](../../docs/contracts/agent-command-context.md)（每步刷新条款被替换）。迁移 `0023` 只加可空列。
- **数据 / 迁移**：`turns.terminal_reason`、`session_context_summaries.{scope,turn_id,reason}`、索引 `idx_summaries_session_scope_created`；不回填、不删除；旧代码可读。
- **安全 / 权限**：授权、审批、锁、幂等、审计、秘密保护不变；`refresh_observations` 为 L0 只读并走同一鉴权；预算停止不跳过执行结果对账。
- **兼容性**：`budgetExhausted` 事件字段保留；`TurnStatus` 不变；历史 Turn 的 `terminal_reason` 为空时按 `normal` 展示。

## 验证与回滚

- 验证：070 spec 第 5 节 A1–A8；A1（出站前缀一致性）作为硬门禁；`pnpm check`、`pnpm build`、`pnpm test:e2e`、`pnpm test:e2e:auth`；`LARNESS_DEEPSEEK_SMOKE=1` 核对真实命中/未命中 token；部署与预览认证回归。
- 回滚：每项决策独立提交可单独回退；HX-5 回退只需恢复 Turn 起点快照逻辑并保留 `refresh_observations`；HX-7 回退把软水位置 1.0 即回到现状；迁移只加列，回退代码即可，不删列。

## 后续

- 缓存命中率的发布门槛（D6）在取得真实基线后按 Provider 分别设定。
- 只读并发（D7）与工具集瘦身属独立评估，不在本 ADR 生效范围内。
