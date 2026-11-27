---
id: 097-streaming-reads
title: 流式启动 L0 只读工具
milestone: 发布后
status: done
depends_on: [070-runtime-efficiency, 081-agent-lean, 093-tool-interface, 096-command-approvals]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 流式启动 L0 只读工具

> 状态：`done`（2026-11-27；自动验证与 `pnpm build` 通过，E2E 与真实 Provider 会话未运行）。本切片只把纯只读工具的启动提前到 `tool-call` 事件到达时；写工具与混合批次仍串行。

## 1. 背景与问题

当前 `TurnRunner` 在整步模型流结束后才执行工具；081 的纯读批次并发也发生在 step 结束后。多个 `read_file` / `search_code` 的墙钟时间仍包含等待模型流结束。把无锁、无审批的 L0 调用在 `tool-call` 事件到达时启动，可以重叠模型流与工具执行，减少延迟，同时保持事件/消息顺序。

另外，`list_files` / `read_file` / `search_code` 虽然 L0，但 `defineTool` 默认 `requiresProjectLock: true`，导致 081 的“L0 + 无锁 + allow”预取条件永远不命中文件读取；需要显式设为 `false`（L0 本来就不获取项目锁）。

## 2. 目标

- G-1：L0、`requiresProjectLock: false`、策略 allow 的调用在 `tool-call` 事件到达时立即启动。
- G-2：每个 step 最多预取 8 个；结果按模型给出的 call 顺序消费，不重复执行。
- G-3：写工具、需锁工具、需审批工具与混合批次中的非 L0 调用仍按原顺序串行。
- G-4：事件顺序、消息顺序、预算检查、取消与 finalize 语义不变。
- G-5：`list_files` / `read_file` / `search_code` 显式 `requiresProjectLock: false`，使只读预取真正生效。

## 3. 非目标

- NG-1：不做混合批次写工具并发。
- NG-2：不并发审批或需项目锁的工具。
- NG-3：不改变工具风险级别、审批、allowlist、锁、审计或秘密处理。
- NG-4：不新增事件、REST/WS/DB 字段。
- NG-5：不引入 subagent、Code Mode 或后台作业。

## 4. 用户故事

- 作为一次读多个文件的用户，我希望模型还在生成时文件读取已经开始，而不是等整步结束。
- 作为安全审查者，我希望只有 L0、无锁、策略 allow 的调用被提前启动；写工具仍串行。
- 作为维护者，我希望事件与消息顺序保持可预测，预取失败能回退到串行路径。

## 5. 验收场景

### A1 流式启动

```gherkin
Given 模型流先发出一个 L0、无锁、allow 的 tool-call
And 流还没结束
When TurnRunner 收到该事件
Then 工具 handler 已经开始执行
```

### A2 写工具仍串行

```gherkin
Given 同一批里有 L0 读与 L1 写
When 模型流尚未结束
Then 读可以开始
And 写 handler 尚未开始
When 流结束后
Then 写按 call 顺序执行
```

### A3 不符合条件的调用不预取

```gherkin
Given 调用是 L2、需要审批、需要项目锁或被 profile 禁用
When tool-call 事件到达
Then 不提前启动
And 仍在序列循环中按原策略处理
```

### A4 结果只消费一次且顺序不变

```gherkin
Given 同一批 2 个 L0 调用
When 序列循环消费预取结果
Then 每个 callId 只执行一次
And tool 消息顺序与模型给出的顺序一致
```

### A5 取消与预算

```gherkin
Given 预取进行中用户取消或 Turn 预算到期
When 序列循环检查预算
Then 按现有 cancel/budget 语义结束
And 不产生重复工具消息
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 在 `tool-call` chunk 到达时，对符合条件调用启动 `execute` 并存入 step-local Map。 |
| R-2 | MUST | 条件：`risk === "L0"`、`requiresProjectLock === false`、`decideToolAccess(policy, risk) === "allow"`、未被禁用、`checkBudget() === "ok"`。 |
| R-3 | MUST | 每个 step 最多 8 个预取；超出部分走序列循环。 |
| R-4 | MUST | 序列循环按 call 顺序消费预取 Promise；拒绝/异常时回退到串行执行。 |
| R-5 | MUST | 事件、消息、预算与 finalize 顺序不变；写/锁/审批工具不提前启动。 |
| R-6 | MUST | `list_files` / `read_file` / `search_code` 显式 `requiresProjectLock: false`。 |
| R-7 | MUST | 不新增事件/DB/REST/WS；不改审批/锁/审计/秘密语义。 |

## 7. 接口与契约变更

- 内部执行顺序：L0 预取从 step 结束后提前到 tool-call 事件。
- 工具元数据：三个 L0 文件工具显式 `requiresProjectLock: false`；执行层对 L0 本来不取锁。
- 无 REST/WS/DB 变更；工具描述不变。

## 8. 数据与迁移

- 无。

## 9. 安全、权限与审计

- 仅提前启动 L0、无锁、策略 allow 的调用；写/审批/锁路径不变。
- 预取结果仍通过现有 `tool.started/completed` 与审计路径记录；不新增授权。
- 取消信号传递到预取执行；失败回退串行。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 预取抛错 | 回退到串行执行该 call | 正常工具失败 |
| 超过 8 个 L0 | 前 8 个预取，其余串行 | 无 |
| 预取中取消 | 现有 cancel 语义 | 停止 |
| 预取中预算到期 | 现有 budget 语义 | 预算结束 |
| 预取与写混合 | 读可提前，写仍串行 | 无 |

## 11. 可观测性

- 日志：可记录 `read prefetch started` debug；无新事件。
- 指标：`timing.toolMs` 继续记录消费/执行耗时。
- 诊断：tool 事件顺序不变。

## 12. 测试计划

- `turnRunner.test.ts`：流未结束时 L0 handler 已启动；同批 L1 写未启动；流结束后写执行；结果只执行一次、消息顺序不变。
- `fileTools.test.ts`：三个 L0 文件工具 `requiresProjectLock === false`。
- 回归：`pnpm check`、`pnpm build`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否做混合批次并发 | 否；写依赖顺序 | 后续 |
| 预取上限 | 8；沿用 081 | 可调 |

## 14. 完成定义

- [x] A1–A5 自动化通过；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] 081/契约/`tasks.md`/`STATUS.md`/`ROADMAP.md` 更新；
- [x] 没有新增公开事件或数据库迁移。
