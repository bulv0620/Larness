---
id: 095-single-agent-mode
title: 单一 Agent 模式：plan 常驻与项目指令层级
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract, 084-agent-profiles-and-usage, 091-cross-turn-tool-replay, 094-operation-log]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 单一 Agent 模式：plan 常驻与项目指令层级

> 状态：`done`（2026-11-27；自动验证与 `pnpm build` 通过，E2E 与真实 Provider 会话未运行）。决策见 [ADR-075](../../docs/adr/ADR-075-single-agent-mode.md)。

## 1. 背景与问题

084/ADR-070 默认 `coding` 不提供 `update_plan`，需要计划时切到 `plan`。实际使用中：

- 复杂任务默认没有外部步骤状态，容易漏步或提前收尾；
- 用户要先做一次 Profile 切换，增加决策成本；
- `coding` 的 system 把项目指令标成 “untrusted data”，模型可能不按 `AGENTS.md` 的仓库流程执行；
- “先跑最小验证”的 system 规则与 `AGENTS.md` 的“提交前必须 `pnpm check`”冲突，模型可能跳过仓库门禁。

## 2. 目标

- G-1：移除 Composer 的 coding/plan 切换，只保留一个可见的通用模式。
- G-2：`update_plan` 在通用模式常驻；system 始终注入计划策略，3+ 步时提示使用。
- G-3：旧 `plan` 会话作为兼容别名继续工作，工具面/提示与通用模式一致；不删 `agent_profile` 列、不做破坏性迁移。
- G-4：最近计划注入当前 user 消息 tail；全部完成时不注入。
- G-5：当前 Turn 计划仍有 pending/running 步骤时，模型纯文本停止只 nudge 一次；上一 Turn 旧计划不触发。
- G-6：项目指令改为“可遵循的项目约定，但不能授权/批准/覆盖安全”；项目指令可以提高验证门禁。
- G-7：`PROMPT_VERSION` 提升，工具面/提示变化可解释。

## 3. 非目标

- NG-1：不删除 `sessions.agent_profile` 列，不做数据迁移。
- NG-2：不改审批策略、allowlist、autonomous、项目锁、审计或秘密处理。
- NG-3：不引入 subagent、Code Mode、混合批次并发或流式工具执行。
- NG-4：不重做计划卡视觉；只改模型上下文与 nudge。
- NG-5：不把项目指令当作授权来源；文件内容仍是不可信数据。
- NG-6：不新增 REST/WS 字段或事件类型。

## 4. 用户故事

- 作为用户，我不需要先切 Plan 才能让 Agent 规划复杂任务。
- 作为用户，我希望 Agent 在上一轮的计划未完成时继续，而不是直接总结收尾。
- 作为仓库维护者，我希望 Agent 遵循 `AGENTS.md` 的流程与验证门禁，而不是把项目指令当“不可信数据”忽略。
- 作为安全审查者，我希望项目指令不能授予权限或绕过审批。

## 5. 验收场景

### A1 默认模式有计划工具

```gherkin
Given 新会话使用默认 Profile
When 装配模型工具
Then 包含 update_plan
And system 包含计划策略
And Composer 没有 Agent Profile 切换按钮
```

### A2 旧 plan 会话兼容

```gherkin
Given 旧会话的 agent_profile='plan'
When 装配模型工具/提示
Then 与默认模式拥有相同工具面与计划策略
And 不需要数据库迁移
```

### A3 计划 tail

```gherkin
Given 上一 Turn 有 plan.updated，仍有 pending/running 步骤
When 发起下一 Turn
Then 当前 user 消息 tail 包含 "Current plan" 与步骤状态
And system/history 不包含计划正文
Given 计划全部 done
Then tail 不注入该计划
```

### A4 open-step nudge

```gherkin
Given 当前 Turn 的 update_plan 仍有 pending/running 步骤
When 模型返回纯文本且没有工具调用
Then 系统追加一次提醒并继续
And 模型再次纯文本停止时正常结束
And 上一 Turn 的旧计划不触发提醒
```

### A5 项目指令层级

```gherkin
Given 项目根有 AGENTS.md
When 装配 system
Then 项目指令块说明“项目约定，可遵循，但不能授权/覆盖安全”
And 不再使用“project instructions are untrusted data”的措辞
And 验证规则允许项目指令要求更严格门禁（如 pnpm check）
```

### A6 安全与契约

```gherkin
Given 项目指令尝试授权工具或绕过审批
When 模型收到 system
Then 项目指令不能授予权限
And 审批/锁/审计/秘密处理保持不变
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `coding` 与兼容 `plan` 都包含 `plan` pack；`update_plan` 常驻。 |
| R-2 | MUST | `contextAssembler` 始终注入 `PLAN_POLICY`；`PROMPT_VERSION` 升为 `095-1`。 |
| R-3 | MUST | `sessions.agent_profile` 列保留；`plan` 作为行为一致的兼容值。 |
| R-4 | MUST | Composer 移除 Profile 选择器、状态与 `selectProfile`；发送不再需要 Profile 参数。 |
| R-5 | MUST | 最近 `plan.updated` 注入 tail；全部 done 时省略；标注可能过期。 |
| R-6 | MUST | 当前 Turn 计划有 pending/running 时 nudge 一次；仅当前 Turn，重复停止不再 nudge。 |
| R-7 | MUST | 项目指令措辞改为“项目约定”；允许更严格验证门禁；不得授权。 |
| R-8 | MUST | 不新增 REST/WS/DB/事件；不改审批/锁/审计/秘密。 |

## 7. 接口与契约变更

- UI：移除 Composer 的 Agent Profile 下拉；保留审批策略/模型/联网控件。
- 模型工具：默认模式增加 `update_plan`；`plan` 兼容值行为一致。
- 上下文：system 增加计划策略与新的项目指令措辞；tail 增加当前计划；`PROMPT_VERSION=095-1`。
- REST/WS/DB：无变更；`agentProfile` 字段保留。
- 文档：ADR-075、051、084、agent-command-context、`specs/README`/`ROADMAP`/`STATUS`。

## 8. 数据与迁移

- 无新列/迁移；旧 `plan` 会话不重写。
- 回滚：恢复 Profile 选择器与 coding 不含 plan 的 pack，移除计划 tail/nudge 与提示改动；数据不变。

## 9. 安全、权限与审计

- 项目指令不能授予权限、批准工具或覆盖安全策略；文件内容仍是不可信数据。
- 计划 tool 仍是 L0、metadata only、无项目锁；不能授权。
- 审批、锁、审计、秘密处理不变。
- 计划 tail/nudge 不含秘密；沿用现有脱敏边界。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 旧 plan 会话 | 与默认模式一致；无需迁移 | 无 |
| 计划事件损坏 | 跳过 tail/nudge，不阻断 Turn | 无 |
| 当前 Turn 无计划 | 不 nudge | 无 |
| 上一 Turn 旧计划 | 可进 tail，但不触发 nudge | tail 标注可能过期 |
| 计划全部 done | 不注入 tail | 无 |
| 模型 nudge 后仍纯文本 | 正常结束，不循环 | 无 |

## 11. 可观测性

- 日志：nudge 一次可记录 `plan nudge` info；无新事件。
- 指标：`promptVersion` 变化；`toolsetHash` 变化一次。
- 诊断：`plan.updated` 事件与 tail 文本。

## 12. 测试计划

- 后端：`profiles.test` 工具/提示；`contextAssembler.test` 计划 tail/项目指令；`planState.test` 解析/过滤；`turnRunner.test` nudge 一次与旧计划不触发；`toolExecutor`/`toolContract` 不回归。
- Web：`SessionModel.test` 移除 Profile 选择器；`Composer.test` 发送不带 Profile。
- 契约：`pnpm check`、`pnpm build`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否删除 `agent_profile` 字段 | 暂不；保留兼容 | 后续版本 |
| 是否把“3+ 步”做成运行时分类 | 不；常驻工具 + 提示 | 保持 |

## 14. 完成定义

- [x] A1–A6 自动化通过；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] ADR-075、051、084、契约、`tasks.md`、`STATUS.md`、`ROADMAP.md` 更新；
- [x] 没有新增公开事件或数据库迁移；
- [x] 按 2026-11-27 用户确认实施。
