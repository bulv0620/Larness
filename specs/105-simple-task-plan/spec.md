---
id: 105-simple-task-plan
title: 简单单文件任务不创建计划
milestone: 发布后
status: dropped
depends_on: [095-single-agent-mode, 104-search-directory-summary]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 简单单文件任务不创建计划

> 状态：`dropped`（2026-11-27；`update_plan` 降为 0，但 tokens/耗时回退：104 248,490/53.5s → 105 272,813/60.8s；已回退策略与 `PROMPT_VERSION=100-1`）。104 的真实 099 任务用了 3 次 `update_plan`；同一任务 opencode 不建计划。单文件一行修复 + 一个目标测试不需要计划。

## 1. 背景与问题

104 的真实 Larness 099 任务：

- Larness 12 步 / 17 调用 / 248,490 input / 53.5s；
- 其中 3 次 `update_plan`（初始 + 两次更新），占 3 个步骤；
- 实际工作只是改一个 `repairEditArgs` 的 key 列表 + 跑一个目标测试；
- opencode 10 次调用，不建计划，直接修改并验证。

095 的计划策略是“3+ 个不同步骤时创建计划”。模型把“复现 → 修改 → 验证”理解成 3 个步骤，即使它们只是同一个单文件改动的阶段。计划对复杂/多文件任务有价值，但对这种任务纯属开销。

## 2. 目标

- G-1：计划策略改为“3+ 个不同工作项，或跨多文件/未知范围的改动”才创建计划。
- G-2：明确“单文件修复 + 一个目标验证命令算一个工作项；不要为它创建计划”。
- G-3：同步 `update_plan` 工具描述与 system `PLAN_POLICY`。
- G-4：保留复杂任务计划、计划状态机、UI、nudge、权限与持久化不变。
- G-5：`PROMPT_VERSION=105-1`。
- G-6：真实 099 任务复测，记录计划调用/steps/tokens/耗时；若仍建计划或出现回归，记录并回退。

## 3. 非目标

- NG-1：不移除 `update_plan` 或 plan pack。
- NG-2：不改计划 schema、事件、UI、nudge 或 DB。
- NG-3：不自动判断任务复杂度或运行时禁用工具。
- NG-4：不修改其他探索/搜索 prompt。
- NG-5：不新增 REST/WS/配置/依赖。

## 4. 用户故事

- 作为让 Larness 改一个小 bug 的开发者，我希望它直接修改并验证，而不是先建一个三步计划再执行，以便更快完成。

## 5. 验收场景

### A1 system prompt

```gherkin
Given 组装 system prompt
Then 包含 "3 or more distinct work items"
And 包含 "single-file fix with one targeted verification command is one work item"
And 包含 "do not create a plan"
And PROMPT_VERSION=105-1
```

### A2 工具描述

```gherkin
Given 创建 update_plan 工具
Then description 包含同样的单文件豁免
And 仍包含复杂任务使用计划的说明
```

### A3 复杂计划不回退

```gherkin
When 运行现有 plan/context/profiles/turnRunner 测试
Then 多步骤计划仍可创建、更新、持久化与回放
```

### A4 真实复测

```gherkin
Given 104 的 Larness 099 真实任务
When 重跑
Then update_plan 调用为 0（或明显减少）
And steps/toolCalls/tokens 不高于 104
And verify=0、diff 仅 fileTools.ts
```

### A5 整仓

```gherkin
When 运行 pnpm check 与 pnpm build
Then 通过
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `PLAN_POLICY` 改为“不同工作项/多文件/未知范围”，并加单文件豁免。 |
| R-2 | MUST | `planTool` description 同步单文件豁免。 |
| R-3 | MUST | `PROMPT_VERSION=105-1`。 |
| R-4 | MUST | 复杂任务计划测试继续通过。 |
| R-5 | MUST | 不改 schema/权限/事件/UI/DB。 |
| R-6 | MUST | 真实 099 任务复测并记录。 |

## 7. 接口与契约变更

- system prompt 文案 + `PROMPT_VERSION`。
- `update_plan` 工具描述文案。
- 同步 `docs/contracts/agent-command-context.md` 与 `specs/051-agent-tool-contract/spec.md` 变更记录。
- 无 REST/WS/DB/配置变更。

## 8. 数据与迁移

- 无。

## 9. 安全、权限与审计

- `update_plan` 仍 L0、metadata only、不授权任何操作。
- 计划文案变化不改变执行层权限、审批或项目锁。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 单文件修复 | 不计划，直接做 | 无计划行 |
| 多文件/未知范围 | 仍提示计划 | 计划行 |
| 模型仍为单文件建计划 | 允许，只记录 | 计划行 |
| 复杂任务计划回归 | 回退 105 prompt | 无 |

## 11. 可观测性

- 复用 `plan.updated`、`tool.requested`、`model.usage`；不新增事件。
- 真实复测统计 `update_plan` 次数。

## 12. 测试计划

- `apps/server/test/agent/contextAssembler.test.ts`：新策略/豁免。
- `apps/server/test/agent/profiles.test.ts`：coding/plan 兼容模式都看到新策略。
- `apps/server/test/agent/plan.test.ts`：复杂计划仍工作 + tool description。
- `pnpm check`、`pnpm build`。
- 真实 099 任务复测（需用户 Key）。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 单文件但多验证命令是否计划 | 仍算一个工作项；模型可自行判断 | 复测后 |
| 多文件小改是否计划 | 3+ 文件或未知范围才提示 | 无 |

## 14. 完成定义

- [ ] A1–A3 通过（实现后已回退）；
- [ ] A4 记录（实机 10 步/15 调用/0 计划/272,813 input/60.8s，tokens 回退）；
- [x] A5 通过（实现阶段）；
- [ ] 代码保留（已回退，任务 `dropped`）。
