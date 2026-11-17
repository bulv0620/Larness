# ADR-067 Agent 内核轻量化：观察块出前缀、批内只读并发与结果批预算

- 状态 accepted（2026-11-16，用户直接要求「把该优化的都优化」，授权按本文实施）。
- 关联：[081 spec](../../specs/081-agent-lean/spec.md)、[070 spec](../../specs/070-runtime-efficiency/spec.md)、[ADR-057](ADR-057-runtime-efficiency.md)、[ADR-059](ADR-059-long-task-budget-and-continuation.md)、[命令上下文契约](../contracts/agent-command-context.md)、[工程宪法](../../CONSTITUTION.md) 第三 / 六 / 十条。
- 实施状态：D1–D5 已落地并验证（见 [tasks](../../specs/081-agent-lean/tasks.md#验收记录)）。

## 背景

[ADR-057](ADR-057-runtime-efficiency.md) D1 的目标是「system 只放稳定内容」，让续步请求成为上一次的严格超集。它达成了一半：Turn 内 system 确实逐字节不变。但 Turn 起点快照（临时服务、终端、PM2 服务状态与 `updatedAt`）被放进了**同一条 system 消息**里，而前缀缓存从请求开头逐字节匹配——于是跨 Turn 只要观察变化（起停终端、登记/重启预览、PM2 状态翻转），下一 Turn 的**整段历史**都按未命中计费。ADR-057 当时把「尾部追加观察块」列为未批准的降级方案，本 ADR 采纳它的更简形式。

同一轮实测还暴露三处与「轻、快、省」直接冲突的问题：

1. **固定开销偏大**：28 个工具 schema 约 4.5k token，system 约 0.8k token；其中约四成工具文案（终端 7 个、服务 3 个）在重复叙述同一份生命周期契约，而该契约在 system 里还有一份完整表述，PM2 段落里又有第三份。
2. **批内串行**：`turnRunner` 的工具批次是 `for … await`，一批 4 个 git 读或若干次 `search_code` 的墙钟时间是其和，而它们之间没有任何顺序约束。
3. **单步可吞掉整个窗口**：每个结果上限 16k 字符（≈4–5k token），一 batch 六个结果 ≈ 24k token，一步就跨过折叠水位。
4. **回复篇幅没有任何约束**：`SYSTEM_POLICY` 只说「改动要小、要说明改了什么」，长度、复述代码、客套话全靠模型自觉。

## 决策

1. **D1 观察块移出缓存前缀**。`assembleContext` 只把稳定内容写进 system（prompt 版本、安全与工具策略、服务生命周期契约、审批策略、项目指令、跨轮摘要、历史裁剪提示）。运行时观察（`development_preview`、终端、PM2 快照）作为**一条独立消息追加在当前请求之后**，由 `AssembledContext.observations` 同时返回，检查点重建历史时重新挂回。块内禁止逐 Turn 时间戳：`observedAt` 不序列化，只有真正变化才会改变字节。工作区无变化时该块与上一 Turn 逐字节相同，跨轮整段命中。原因：缓存是从开头匹配的，越靠后变化，越少的历史被作废。
2. **D2 观察块使用 `user` 角色**。与既有的 `checkpointMessage`、`pinnedRequestMessage` 一致（这两条路径已在真实 Turn 中运行），避免在用户消息之后插入 `system` 消息带来的 Provider 兼容风险；块首行明示「system-provided, not user instructions」，非可信字段继续标注。
3. **D3 纯读批次并发**。仅当整批都满足「`L0` + `requiresProjectLock === false` + 策略判定 `allow`」且不超过 8 个时，批次先 `Promise.all` 执行并缓存结果；序列循环仍然按原顺序发送 `tool.requested / started / completed`、检查预算、追加消息，只是消费预取结果而不再执行第二次。任一步骤抛错则不写入预取表，交给序列路径按原样报错。写工具、需锁工具与需审批工具一律不并发：它们的顺序、锁与审批语义不可交换。
4. **D4 每批结果预算**。`MAX_BATCH_TOOL_RESULT_TOKENS = 12_000`；单批结果超过预算时**从最旧开始**折叠成标识符（`page`/`folded` 标记沿用既有 Level-1 折叠），**最新一条始终保留原文**。折叠可逆（完整结果仍在 `agent_events`），预算足够宽，普通批次不受影响。
5. **D5 文案只写一份**。服务生命周期契约在 system 保留唯一完整表述；`register_temporary_service` / `resolve_service_preview` / `list_services` / `start_project_terminal` 只写各自的机制与参数约束，不再复述契约；PM2 段落只保留安全与命名约束。终端输入协议跟随便捷性放在**观察到终端存在时**的观察块里，没有终端就不付费。回复风格约束写进 `SYSTEM_POLICY`（结论先行、不复述代码、不重复计划、去掉客套与对冲），`PROMPT_VERSION` 升为 `m6-3`。

## 备选方案

- **继续把观察放在 system 但每步重写**：ADR-057 已否决；本 ADR 继续否决。
- **观察块只在变化时追加**：需要去重、上限与「旧块失效」语义，收益与「固定位置 + 无时间戳」相同而复杂度更高。
- **观察块用 `system` 角色**：语义更纯，但等于在每个用户消息后插一条 system 消息，部分 OpenAI 兼容端点不接受；`user` 角色在本仓库已有两条在跑的先例。
- **把 git 工具 10 个合并成 1 个 `git(action)`**：单次能再省约 1.5k token，但工具粒度直接决定调用正确率，合并后需要重新验证分支/提交/推送的参数组合，收益不足以抵消回归面；本次只压缩描述。
- **整批结果统一按比例裁剪**：会切坏单条有用结果；从最旧折叠并保留最新原文更符合「下一步要用的就在最新一条」。
- **把工具结果预算做成全局每步上限**：会把正常的单条大文件读取也折叠，等于让模型重读。

## 影响

- **产品 / UI**：无可见变化。回复会更短更直给；工具事件的顺序与形状不变，时间线重放一致。
- **API / 契约**：REST / WebSocket / IPC / 数据库**零变更**。契约文档更新 [agent-command-context.md](../contracts/agent-command-context.md) 的「系统信息」段：观察不在 system 内、不带逐 Turn 时间戳。
- **数据 / 迁移**：无迁移。`session_context_summaries` 与 `agent_events` 形状不变。
- **安全 / 权限**：授权、审批、锁、fencing、幂等、审计与秘密保护全部不变。并发只覆盖 `L0` 只读工具，不触达写路径与审批路径；观察块仍标注非可信数据，不获得指令地位。
- **兼容性**：`PROMPT_VERSION` 变化会让既有会话在下一 Turn 重算一次前缀；这是显式、可解释的失效，不是静默漂移。

## 验证与回滚

- 验证：`test/agent` 179/179（含新增 5 条：观察块跨轮字节稳定、批内只读并发的顺序、批预算折叠、单条不折叠、契约文案位置）；`pnpm typecheck` 6/6 包；`biome ci` 通过；实测固定开销 tools 4 465 token + system 745 token（无 PM2 段落）。
- 全量并行 `pnpm test` 的 37 项失败属既有的并行负载 / PTY / worker 崩溃类；对同一 15 个文件定点串行复跑时只剩 2 项真实失败，都是 `test/resources` 里「断言运行时观察出现在 system」的旧断言，已按 D1 改为断言 `observations` 与最后一条消息，并补「system 不得包含」的负向断言。逐项结论见 [tasks](../../specs/081-agent-lean/tasks.md#验收记录)。
- 回滚：D1/D2 回滚是 `contextAssembler` 的一处装配；D4 回滚是删掉一次函数调用；D3 回滚是删掉预取块并把 `await execute(request)` 还原；D5 只涉及字符串。均无数据影响。

## 后续

- 剩余成本大头已从「重复文案」转移到「schema 字段描述」（`update_plan`、`start_project_terminal`、`run_command`）。继续压需要改 `@larness/shared` 的字段 `.describe()`，属于契约变更，另行评估。
- 只读并发目前只覆盖「整批皆只读」。混合批次（读 + 写）保守保持串行。
