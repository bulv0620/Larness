---
id: 081-agent-lean
title: Agent 内核轻量化：观察块出前缀、文案收敛、批内并发与结果批预算
milestone: 发布后
status: done
depends_on: [070-runtime-efficiency, 073-context-budget]
owners: []
created: 2026-11-16
updated: 2026-11-16
---

# 081 Agent 内核轻量化

> 状态：`done`（2026-11-16）。用户要求「让 agent 灵活轻量快速、干活准、回复精炼、省 token」，并要求一次把该优化的都优化；决策见 [ADR-067](../../docs/adr/ADR-067-lean-agent-context.md)，验收记录见 [tasks](tasks.md#验收记录)。

## 1. 背景与问题

[070](../070-runtime-efficiency/spec.md)（HX）已经让 **Turn 内** 的续步请求成为上一次的严格超集，system 在 Turn 内逐字节稳定。但按「轻、快、省」重新测量内核后，仍有四处与之直接冲突的问题。

**固定开销（每个请求都发）**。同一份 28 工具注册表实测：

| 组成 | 字符 | 估算 token |
|---|---|---|
| 28 个工具 schema | 18 775 | 4 807 |
| system（项目 + PM2 + Git，不含工作区观察） | 5 254 | 1 314 |
| 合计 | | 6 130 |

工具描述里约四成在讲终端（7 个工具 5 457 字符）与服务（3 个工具 2 862 字符）的生命周期，而同一份生命周期契约在 system 的 `SERVICE_LIFECYCLE_POLICY`（2 172 字符）里已有一份完整表述、PM2 段落里还有第三份。同一件事付了三次钱。

**跨轮缓存失效**。[ADR-057](../../docs/adr/ADR-057-runtime-efficiency.md) D1 把 Turn 起点观察快照（临时服务、终端、PM2 状态与 `updatedAt`）放进了 **同一条 system 消息**。前缀缓存从请求开头逐字节匹配，因此只要观察变化（起停终端、登记或重启预览、PM2 状态翻转），下一 Turn 的**整段历史**按未命中计费。观察越靠前，失效面越大。

**批内串行**。`turnRunner` 的工具批次是 `for … await` 串行执行，一批 5 个 `read_file` 或若干次 `search_code` 的墙钟时间是它们之和，而它们之间没有任何顺序约束。

**单步可吞掉整个窗口**。单条工具结果上限 16k 字符（约 4–5k token），一批六个结果约 24k token，一步就跨过折叠水位；[070 HX-4](../070-runtime-efficiency/tasks.md) 遗留的批次级预算一直未做。

**回复篇幅没有约束**。`SYSTEM_POLICY` 只要求「改动要小、要说明改了什么」，长度、复述代码、客套话完全依赖模型自觉。

## 2. 目标

- G-1：运行时观察不再改变缓存前缀。工作区无变化时，跨 Turn 的历史整段命中。
- G-2：服务生命周期契约、终端输入协议、观察块语义各只表述一次；固定开销下降。
- G-3：整批纯只读调用并发执行，事件、预算与消息顺序与串行完全一致。
- G-4：单批工具结果受 token 预算约束，超限折叠最旧结果，最新一条保留原文。
- G-5：系统策略明确要求精炼输出，且不靠新增机制实现。

## 3. 非目标

- NG-1：不拆 `turnRunner` 循环体（[070 HX-12b](../070-runtime-efficiency/tasks.md#hx-12b-turnrunner-循环体拆分) 于 2026-11-18 按用户决定废弃，本切片仍不拆循环体）。
- NG-2：不合并工具（git 10 个仍为 10 个、终端 7 个仍为 7 个）。工具粒度直接决定调用正确率，见 ADR-067「备选方案」。
- NG-3：不改 `@larness/shared` 的字段 `.describe()`。schema 字段描述已是当前最大单项成本，但属执行契约变更，另行评估。
- NG-4：不并发任何写工具、需要项目锁的工具或需要审批的工具。
- NG-5：不改 `PROMPT_VERSION` 之外的缓存键、不改折叠水位（55% / 70% / 90%）。
- NG-6：不新增工具参数、不新增事件类型、不改 REST / WS / IPC / 数据库。

## 4. 用户故事

- 作为连续使用同一会话的用户，我希望每次新 Turn 不必让服务端重算整段历史，响应更快、费用更低。
- 作为一次读多个文件的用户，我希望模型读 5 个文件的墙钟时间接近读 1 个。
- 作为读长日志的用户，我希望最早那几条被折叠，而不是下一步要用的最新一条。
- 作为读回复的用户，我希望得到结论和改动，而不是代码复述与客套。

## 5. 验收场景

### A1 工作区无变化时跨轮命中

```gherkin
Given 上一 Turn 的观察快照与本次完全相同
When 装配本次上下文
Then 观察块与上一 Turn 逐字节相同
And 它位于所有历史消息之后，system 只含稳定内容
```

### A2 观察变化只影响尾部

```gherkin
Given 用户启动了一个开发终端，观察快照因此改变
When 装配本次上下文
Then system 与上一 Turn 逐字节相同
And 只有观察块的字节变化
```

### A3 观察块不带逐 Turn 时间戳

```gherkin
Given 工作区没有任何变化
When 两个不同时刻各装配一次
Then 两次观察块的字节相同
And 块内不出现 observedAt 之类的逐 Turn 字段
```

### A4 纯读批次并发

```gherkin
Given 模型一批返回 4 个 L0、无锁、策略允许的工具调用
When 执行该批次
Then 4 个调用并发执行
And tool.requested / started / completed 仍按模型给出的顺序发出
And 结果消息顺序与串行一致
```

### A5 混合批次保持串行

```gherkin
Given 一批里同时有只读工具与需要项目锁的写工具
When 执行该批次
Then 全部按原顺序串行执行
And 不产生任何并发写入
```

### A6 批次结果超预算

```gherkin
Given 一批 6 条结果合计超过 12 000 token
When 结果进入消息历史
Then 从最旧的结果开始折叠为标识符
And 最新一条保留原文
And 完整结果仍可从事件回查
```

### A7 普通批次不受影响

```gherkin
Given 一批 3 条结果合计未超过预算
When 结果进入消息历史
Then 三条全部保留原文，不产生折叠标记
```

### A8 精炼输出约束存在

```gherkin
Given 任一 Turn 的 system 策略
When 读取风格约束段
Then 要求结论先行、不复述代码、不重复计划、不使用客套与对冲
```

### A9 服务生命周期只写一次

```gherkin
Given agent 工具的完整描述集合
When 检索生命周期契约的关键句
Then 只有 system 保留完整表述
And 服务工具只写各自机制与参数约束，终端工具只写用途去重
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `assembleContext` 只把稳定内容写进 system；运行时观察作为**一条独立消息追加在全部历史之后**，并通过 `AssembledContext.observations` 返回。 |
| R-2 | MUST | 观察块不得序列化逐 Turn 时间戳；工作区无变化时与上一 Turn 逐字节相同。 |
| R-3 | MUST | 检查点重建历史时重新挂回观察块；消息角色与该路径既有先例一致（`user`），块首行明示其为系统提供的事实而非用户指令。 |
| R-4 | MUST | 仅当整批调用都满足「`L0` + `requiresProjectLock === false` + 策略判定 `allow`」且数量在 2–8 之间时并发预取；事件顺序、预算检查与消息追加仍在序列循环中按原顺序执行。 |
| R-5 | MUST | 预取失败不得吞掉错误：该调用不进入预取结果，交给序列路径按原样执行并报错。 |
| R-6 | MUST | 单批工具结果超过 `MAX_BATCH_TOOL_RESULT_TOKENS = 12_000` 时，从最旧开始折叠，最新一条始终保留原文；折叠沿用既有 Level-1 折叠标记，可逆。 |
| R-7 | MUST | 服务生命周期契约在 system 中保留唯一完整表述；服务与终端工具只描述各自机制、参数与用途去重；终端输入协议仅在观察到终端存在时才进入观察块。 |
| R-8 | MUST | `SYSTEM_POLICY` 包含精炼输出约束；`PROMPT_VERSION` 升为 `m6-3`。 |
| R-9 | MUST | 授权、审批、锁、fencing、幂等、审计与秘密保护零变化；并发不触达写路径、锁路径与审批路径。 |
| R-10 | SHOULD | 观察块内的非可信字段继续标注来源，且不获得指令地位。 |

## 7. 接口与契约变更

- **REST / WebSocket / IPC / 数据库**：无变更，`agent_events` 与 `session_context_summaries` 形状不变。
- **内部装配结果**：`AssembledContext` 新增 `observations: string | null`，`turnRunner` 据此把观察块作为独立消息发送，并在检查点重建时重新挂回。
- **Provider 请求形状**：观察块以 `user` 角色出现在最后一条用户消息之后、模型请求之前。这只是既有「检查点消息 / 固定请求消息」两条同角色路径的第三处使用，不新增协议。
- **缓存键**：`PROMPT_VERSION`（`m6-2` → `m6-3`）使既有会话在下一 Turn 重算一次前缀；这是显式、可解释的失效，ADR-067 已记录。
- **契约同步**：[命令上下文契约](../../docs/contracts/agent-command-context.md) 的「系统信息」段已改为「观察不在 system 内、不带逐 Turn 时间戳」。

## 8. 数据与迁移

- 无 schema 迁移、无新表 / 新列、无历史回填。
- 折叠后的结果仍可从 `agent_events` 回查，不需要重建存储。

## 9. 安全、权限与审计

- 并发只覆盖 `L0` 且无项目锁且策略为 `allow` 的调用；`L1` / `L2`、需锁工具与需审批工具一律串行，审批与锁语义不可交换。
- 预取不改变审计：审计仍由序列循环中的执行入口写入一次，不会因并发而重复记录。
- 观察块仍标注为系统提供的事实，项目路径、终端输出等非可信字段继续按原规则标注。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 预取的某个调用抛错 | 该调用不进预取表，序列路径重跑并走正常错误上报 | 与串行时相同 |
| 批次中混有写工具或需审批工具 | 整批串行 | 无变化 |
| 单批结果刚好超预算 | 折叠最旧一条直到不超 | 该条显示为已折叠标识符 |
| 单条结果本身超预算 | 不折叠（最新一条始终保留原文） | 该条由既有单条裁剪处理 |
| 检查点触发后重建历史 | 观察块重新挂回在最新请求之后 | 模型仍能看到当前工作区事实 |
| 工作区无变化 | 观察块字节不变 | 跨轮命中 |

## 11. 可观测性

- 无新增日志与指标：观察块是装配产物，批次折叠沿用在既有结果裁剪日志之外的单一路径。
- 收益可用既有用量统计复核：`cachedInputTokens` 与 `inputTokens` 的变化即可看出跨轮命中是否恢复。

## 12. 测试计划

- `apps/server/test/agent/contextAssembler.test.ts`：观察块不在 system 内、跨轮字节稳定、不出现逐 Turn 时间戳、检查点重建后仍挂回。
- `apps/server/test/agent/turnRunner.test.ts`：纯读批次并发的顺序断言（事件序列与串行一致）、混合批次不并发。
- `apps/server/test/agent/compaction.test.ts`：批次预算折叠最旧、保留最新原文、单条不折叠、未超预算不折叠。
- `apps/server/test/agent/service-ops-agent.test.ts`：PM2 段落与工具描述不再重复服务生命周期契约。
- 回归：`test/agent` 全量、`pnpm typecheck`、`pnpm exec biome ci .`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| schema 字段描述（`update_plan`、`start_project_terminal`、`run_command`）是否继续压缩？ | 当前不动：修改 `@larness/shared` 的 `.describe()` 属执行契约变更，需要单开一轮并重跑工具契约矩阵 | 见 [Q-041](../../docs/open-questions.md) |
| git 10 个工具是否合并为 `git(action)`？ | 不合并：可再省约 1.5k token，但工具粒度影响调用正确率，回归面大于收益 | 见 ADR-067 |
| 混合批次（读 + 写）是否也并发？ | 不并发：写工具的锁与审批语义不可交换 | 见 ADR-067 |

## 14. 完成定义

- [x] 验收场景全部通过；
- [x] 测试与检查通过（`test/agent` 179、类型 6 包、biome 退出码 0）；
- [x] 契约 / ADR / 文档 / STATUS 已更新；
- [x] 用户已确认方向（「建立一个任务把应该优化的都一步步优化」）。

## 日期修订

### 2026-11-27 流式启动 L0（097）

- 本切片 R-4 的纯读并发从“step 结束后整批预取”扩展为“`tool-call` 事件到达即启动”：仍限 L0、`requiresProjectLock === false`、策略 allow、每 step 最多 8 个；结果仍按 call 顺序消费，写/锁/审批与混合批次中的非 L0 调用保持串行。
- `list_files` / `read_file` / `search_code` 显式 `requiresProjectLock: false`，使只读预取条件真正命中。见 [097](../097-streaming-reads/spec.md)。
