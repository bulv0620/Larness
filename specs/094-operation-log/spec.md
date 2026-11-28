---
id: 094-operation-log
title: 跨 Turn 操作日志
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract, 091-cross-turn-tool-replay, 093-tool-interface]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 跨 Turn 操作日志

> 状态：`done`（2026-11-27；自动验证与 `pnpm build` 通过，E2E 与真实 Provider 会话未运行）。
> 本切片只做“上一轮 L1+ 操作日志”注入当前请求尾部；不做完整 transcript 回放，不改变 system/history。

## 1. 背景与问题

091 只回放 L0 只读工具结果，`run_command`、`apply_patch`、`write_file`、`edit`、进程/服务控制等 L1+ 操作的结果和调用不进入下一轮。模型在下一轮只看到上一轮的最终文本，常见后果：

- 忘了上一轮跑过什么命令、退出码和失败尾部；
- 忘了改过哪些文件、版本和增删行数；
- 重复跑同一测试或重复修改同一文件；
- 最终回答很简洁时，工作记忆几乎只剩一句结论。

091 的 NG-2 明确不回放 L1+ 全文，这是为了秘密、体积和 transcript 配对安全。本切片用**有界操作日志**解决“记住做过什么”，而不是把命令输出/diff 全量塞回历史。

## 2. 目标

- G-1：为 L1+ 工具记录内部 `tool.operation` 事件；内容只含状态、参数摘要、退出码、尾部输出、文件路径/版本/增删统计，不含完整输出或 diff。
- G-2：装配下一 Turn 时，把最近的 `tool.operation` 渲染成一段纯文本，放进当前 user 消息的 tail，而不是 system 或 history。
- G-3：覆盖命令、文件写入/补丁/编辑、失败、进程/服务控制；L0 只读工具不重复记录（091 已有回放）。
- G-4：日志有 token 预算（默认 2,500），超出时保留最新，省略更老并显式计数。
- G-5：落盘前 redaction；命中已知秘密时不写尾部；`tool.operation` 不进公开事件流、不广播。

## 3. 非目标

- NG-1：不回放 L1+ 的完整命令输出、diff 或 patch 正文。
- NG-2：不改变 091 的 L0 回放机制、预算或 transcript 配对。
- NG-3：不注入 system/history；不改 `PROMPT_VERSION`。
- NG-4：不把操作日志作为授权来源；模型重新执行工具仍走完整鉴权/审批/锁。
- NG-5：不改计划、Profile、审批 allowlist、流式执行或 Code Mode。
- NG-6：不新增 REST/WS 公开字段、数据库列或迁移。

## 4. 用户故事

- 作为连续让 Agent 改代码的用户，我希望下一轮还记得上一轮跑了什么测试、失败尾部是什么、改了哪些文件。
- 作为安全审查者，我希望操作日志只保留 bounded、redacted 的摘要，不把秘密或大段源码写进事件。
- 作为长会话用户，我希望日志不会无限增长，预算满时保留最新并明确省略数量。

## 5. 验收场景

### A1 命令操作

```gherkin
Given 上一 Turn 有一条 run_command
And 退出码为 1，输出尾部包含 "Tests 1 failed"
When 发起下一 Turn
Then 当前 user 消息 tail 包含该命令的退出码与 "Tests 1 failed"
And 不包含完整 32KB 输出
```

### A2 文件操作

```gherkin
Given 上一 Turn 有 edit/apply_patch/write_file
When 发起下一 Turn
Then tail 包含路径、changeType、版本前缀与增删/替换统计
And 不包含文件正文或完整 diff
```

### A3 失败与进程/服务控制

```gherkin
Given 上一 Turn 有失败的 run_command 或 control_service_ops
When 发起下一 Turn
Then tail 包含 errorCode 与 summary
```

### A4 当前 Turn 与摘要边界

```gherkin
Given 当前 Turn 已有 tool.operation
And 更早的操作已被会话摘要覆盖
When 装配当前 Turn
Then 当前 Turn 的操作不进入 tail
And coveredUpToSeq 之前的操作不重复进入 tail
```

### A5 秘密与公开事件

```gherkin
Given 命令输出包含已知秘密
When 写入 tool.operation
Then 尾部被省略或替换为 [Redacted]
And GET /api/sessions/:id/events 与 WS 不返回 tool.operation
```

### A6 预算

```gherkin
Given 操作日志超过 2,500 token
When 装配 tail
Then 保留最新操作
And 更老的被省略并显示省略数量
```

### A7 前缀稳定

```gherkin
Given 只有操作日志变化
When 装配当前 Turn
Then system 与 retained history 逐字节不变
And 变化只出现在当前 user 消息 tail
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | L1+ 工具完成后写内部 `tool.operation`；L0 不写。 |
| R-2 | MUST | payload 含 toolCallId/toolName/ok/summary，可选 argsSummary、errorCode、command{exitCode,outputTail,truncated}、file{path,version,changeType,additions,deletions}。 |
| R-3 | MUST | outputTail ≤ 800 字符；argsSummary ≤ 400 字符；不存完整输出/diff。 |
| R-4 | MUST | 落盘前 redaction；命中已知秘密则省略尾部/参数并保留状态。 |
| R-5 | MUST | `contextAssembler` 只读取 `coveredUpToSeq` 之后、当前 Turn 之前的最近操作。 |
| R-6 | MUST | 渲染为 tail 块，预算 2,500 token；超出保留最新并显式省略数量。 |
| R-7 | MUST | `tool.operation` 不广播、不出现在公开事件列表；分页与 `hasMore` 仍正确。 |
| R-8 | MUST | 不改变授权、审批、锁、秘密、审计与事件持久化语义。 |

## 7. 接口与契约变更

- 内部事件：`tool.operation`，payload 见 R-2；只落库供装配读取，不广播。
- 公开 REST/WS：无新增字段；`GET /api/sessions/:id/events` 过滤 `tool.operation`。
- 模型上下文：当前 user 消息 tail 增加“Previous turn operations”块；system/history 不变。
- 事件类型：`AgentEventType` 增加 `tool.operation`。
- 契约文档：更新 [Agent 命令与 PM2 系统上下文](../../docs/contracts/agent-command-context.md) 与 [WS 事件](../../docs/contracts/ws-events.md) 的内部事件说明。

## 8. 数据与迁移

- 新表/列：无。
- 事件保留：沿用 `agent_events` 保留期；`tool.operation` 体积有界。
- 迁移/回滚：无；删除/忽略该事件类型即可回滚。

## 9. 安全、权限与审计

- `tool.operation` 不是授权来源；模型重新执行工具仍走审批/锁/审计。
- 命令尾部与参数摘要落盘前用 `OutputRedactor` 与 `secretVerdict`；命中已知秘密时省略。
- 不存完整 stdout/stderr/diff/环境变量。
- 不新增审计事件；`tool.operation` 只用于上下文装配。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| payload 解析失败 | 跳过该条，不阻断 Turn | 无 |
| 日志超预算 | 保留最新，省略较老并计数 | tail 中显示省略数量 |
| 当前 Turn 操作 | 不进入本 Turn tail | 无 |
| 秘密命中 | 省略尾部/参数 | 仍显示工具与状态 |
| 事件过多 | 查询上限 40 条，先取最新 | 省略计数 |

## 11. 可观测性

- 日志：无新增；`tool.operation` 写入失败不应阻断 Turn（best-effort）。
- 指标：tail 中省略数量；`model.usage` 的 prefix hash 不变（tail 在 user 消息内）。
- 诊断：`tool.operation` 只读数据库可查。

## 12. 测试计划

- 单元：`operationLog.test.ts` 的构建、解析、redaction、预算、渲染。
- 装配：`contextAssembler.test.ts` 的 A1–A7。
- 事件：`events.test.ts` 过滤与分页。
- 运行：`turnRunner.test.ts` 的命令/文件操作写入（内部事件不公开）。
- 安全：秘密输出/参数不落盘。
- E2E：不新增。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 日志覆盖几轮 | 最近操作，最多 40 条；预算优先 | 后续可调 |
| 是否包含 L0 操作 | 不包含；091 已回放只读结果 | 保持 |

## 14. 完成定义

- [x] A1–A7 自动化通过；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] 契约文档、`tasks.md`、`STATUS.md`、`ROADMAP.md` 已更新；
- [x] 没有新增公开事件或 UI 变更；
- [x] 按 2026-11-27 用户确认的“继续下一步”实施。
