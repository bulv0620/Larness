---
id: 096-command-approvals
title: 命令 allowlist 与本轮审批复用
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract, 072-agent-error-budget, 095-single-agent-mode]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 命令 allowlist 与本轮审批复用

> 状态：`done`（2026-11-27；自动验证与 `pnpm build` 通过，E2E 与真实 Provider 会话未运行）。决策见 [ADR-076](../../docs/adr/ADR-076-command-allowlist-and-turn-approvals.md)。

## 1. 背景与问题

标准审批下 `run_command` / `run_shell` 默认 L2，每条命令都需要人工点一次。常见验证命令（`pnpm check`、`pnpm --filter ... test:file`、`git status`、`rg`）在同一个任务里反复出现，审批成为主要停顿来源；同一 Turn 内重复执行相同命令也要重复批准。

## 2. 目标

- G-1：把常见只读/验证命令在标准策略下降为 L1，自动放行。
- G-2：用户批准一次后，同一 Turn 内相同 `toolName + 规范化参数哈希` 的调用不再请求审批。
- G-3：不跨 Turn、不持久化、不新增审批规则/数据库；L3 在 standard/strict 仍 deny。
- G-4：allowlist 只影响审批分类，不改变命令执行权限、项目锁、审计或秘密检查。
- G-5：`run_shell` 只放行无 shell 元字符、无引号、无绝对/`..` 路径的简单命令。

## 3. 非目标

- NG-1：不把 autonomous 设为默认；不改变 autonomous 对 L3 的既有语义。
- NG-2：不做持久 always-allow、规则管理 UI、审批模式迁移。
- NG-3：不新增命令沙箱或黑名单；不宣称安全隔离。
- NG-4：不改变审批 TTL、审批面板或 REST/WS 契约。
- NG-5：不改变项目锁、命令超时、输出上限或秘密处理。

## 4. 用户故事

- 作为用户，我希望 `pnpm check`、`git status`、`rg` 这类验证命令不再每条都弹审批。
- 作为用户，我希望同一 Turn 内重复跑同一个测试命令只批准一次。
- 作为安全审查者，我希望 allowlist 不能放行 `sudo`/`chmod`，也不能被 `--prefix`、`exec`、shell 元字符绕过。

## 5. 验收场景

### A1 allowlist 正例

```gherkin
Given standard 策略
When 调用 run_command({executable:"pnpm",args:["check"]})
Then 风险为 L1，不请求审批
And git status/diff/log、rg、ls、pwd 同样为 L1
```

### A2 allowlist 反例

```gherkin
Given standard 策略
When 调用 run_command 使用 sudo/chmod、--prefix、exec/dlx、绝对路径程序、rg --pre 或 git --output
Then 仍为 L2/L3，按原策略审批或拒绝
Given run_shell 包含管道、重定向、命令替换、引号或 ../ 路径
Then 仍为 L2
```

### A3 本轮审批复用

```gherkin
Given 同一 Turn 有两次完全相同的 L2 run_command
When 用户批准第一次
Then 第二次不再创建审批行
And 两次命令都执行
Given 第二次参数不同或跨 Turn
Then 仍请求审批
```

### A4 L3 与安全边界

```gherkin
Given standard 或 strict
When 调用 sudo/chmod
Then 仍拒绝
And 项目锁、审计、秘密检查、命令超时不变
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 新增 `isAllowlistedCommand` / `isAllowlistedShellCommand`；只读/验证命令返回 L1。 |
| R-2 | MUST | 拒绝扩大范围/写操作 flags、绝对路径程序、`..`/绝对路径参数、shell 元字符与引号。 |
| R-3 | MUST | `ExecuteToolInput` 增加可选 `approvedParams`；命中 `toolName + hashApprovalParams` 时跳过审批。 |
| R-4 | MUST | `TurnRunner` 在用户批准后把该 key 加入本 Turn 集合；集合不持久化、不跨 Turn。 |
| R-5 | MUST | L3 在 standard/strict 仍 deny；autonomous 不改。 |
| R-6 | MUST | 不新增表/列/公开事件；审批、锁、审计、秘密处理不变。 |
| R-7 | MUST | 工具描述说明常见验证命令可能自动放行；不承诺沙箱。 |

## 7. 接口与契约变更

- 内部：`ExecuteToolInput.approvedParams?: ReadonlySet<string>`；`commandRisk`/`shellRisk` 的 L1 集合扩大。
- 模型工具描述：`run_command` / `run_shell` 说明常见验证命令在标准策略下可能自动放行，其余仍按审批。
- REST/WS/DB：无变更。
- 审计：复用不新增 approval 行；命令/工具事件沿用现有路径。

## 8. 数据与迁移

- 无。

## 9. 安全、权限与审计

- allowlist 不是沙箱；命令仍以 Larness 账户权限执行。
- L3 在 standard/strict 仍 deny；`autonomous` 既有语义不改。
- 复用仅限同一 Turn、相同工具、规范化参数哈希；不持久化。
- 项目锁、命令超时、输出上限、秘密扫描、审计不变。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| allowlist 解析失败 | 按原风险 L2 | 正常审批 |
| `run_shell` 含元字符 | L2 | 正常审批 |
| 参数不同 | 新审批 | 正常审批 |
| 跨 Turn | 新审批 | 正常审批 |
| 审批过期/拒绝 | 原语义 | 原错误码 |

## 11. 可观测性

- 日志：复用可记录 debug/info `approval reused`；无新事件。
- 指标：审批行数量下降；命令执行/审计不变。
- 诊断：审批行仍可按 turn/tool 查询。

## 12. 测试计划

- 单元：allowlist 正反例；`commandRisk`/`shellRisk`。
- 集成：同一 Turn 两次相同 L2 命令只生成 1 个 approval；不同参数仍审批。
- 回归：`pnpm check`、`pnpm build`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否做持久 always-allow | 否；本轮复用先落地 | 后续 |
| 是否允许更宽的命令前缀 | 否；先用精确参数哈希 | 后续 |

## 14. 完成定义

- [x] A1–A4 自动化通过；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] ADR-076、051、契约、`tasks.md`、`STATUS.md`、`ROADMAP.md` 更新；
- [x] 没有新增数据库/公开事件；
- [x] 按 2026-11-27 用户选择实施。
