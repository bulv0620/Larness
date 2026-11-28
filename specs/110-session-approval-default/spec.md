---
id: 110-session-approval-default
title: 新会话继承最近选择的审批策略
milestone: 发布后
status: done
depends_on: []
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 新会话继承最近选择的审批策略

## 1. 背景与问题

审批策略当前只保存在 `sessions.approval_policy_id`，新建会话固定为 `standard`。用户在项目内把策略改为只读、严格或完全自主后，下一次新建会话又回到标准审批，需要重复选择；新会话的草稿界面也无法提前显示项目最近一次的选择。

用户已明确要求：修改审批策略后，当前项目中的**新会话**按最后一次用户修改选择的策略创建；**已有会话保持不变**。

## 2. 目标

- G-1：项目记住最后一次由用户修改的审批策略，作为该项目新会话的初始策略。
- G-2：默认工作区（`prj_default` / `projectId=null`）独立记住自己的最近选择。
- G-3：新建草稿会话在选择前显示该默认策略；用户未主动改选时不回写策略，由服务端在创建时解析。
- G-4：旧会话继续使用各自保存的策略，不因项目默认变化而被改写。

## 3. 非目标

- NG-1：不改变已有 Turn 的 `executionContext.policy` 快照语义（仍只影响下一 Turn）。
- NG-2：不新增按会话批量迁移或回溯改写历史会话。
- NG-3：不改变定时任务 Agent 的 `readonly | autonomous` 独立策略。
- NG-4：不新增 REST 路径、DB 列或迁移。

## 4. 用户故事

- 作为用户，我在项目 A 的会话里把审批策略改为“只读”，之后在项目 A 新建会话时希望默认就是“只读”，不必每次重选。
- 作为用户，我在项目 A 的旧会话里仍看到并运行它原来的策略；项目 B 或默认工作区不受项目 A 的选择影响。

## 5. 验收场景

### A1 项目内新会话继承最近选择

```gherkin
Given 项目 P 中已有会话 S1，当前策略为 standard
When 用户把 S1 的策略改为 strict
Then POST /api/sessions 创建项目 P 的新会话 S2
And S2.approvalPolicyId = strict
And S1.approvalPolicyId = strict
```

### A2 再次修改只影响后续新会话

```gherkin
Given 项目 P 的默认策略为 strict，且已有会话 S2 为 strict
When 用户把另一会话的策略改为 autonomous
Then S2.approvalPolicyId 仍为 strict
And 新建会话 S3.approvalPolicyId = autonomous
```

### A3 旧会话不被批量改写

```gherkin
Given 项目 P 中会话 S2 创建时策略为 strict
When 项目 P 的默认策略后来变为 readonly
Then S2 的详情与下一 Turn 快照仍为 strict
And 只有新会话使用 readonly
```

### A4 默认工作区独立记忆

```gherkin
Given 默认工作区的会话 D1 把策略改为 readonly
When 在默认工作区新建 D2
Then D2.approvalPolicyId = readonly
And 项目 P 的新会话仍使用项目 P 自己的默认策略
```

### A5 草稿界面与不回写

```gherkin
Given 当前项目默认策略为 readonly
When 打开新建草稿会话
Then 审批盾牌显示“只读”
And 用户不改选并发送首条消息时，创建请求不携带 approvalPolicyId
And 会话创建后显示的仍是服务端解析出的 readonly
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `projects.settings_json` 增加 `defaultApprovalPolicyId`，枚举同会话策略，缺省为 `standard` |
| R-2 | MUST | 用户通过 `PATCH /api/sessions/:id` 修改策略且值变化时，在同一事务内更新该会话所属项目/默认工作区的默认策略 |
| R-3 | MUST | `POST /api/sessions` 未显式指定策略时，按目标项目（或默认工作区）的默认策略创建 |
| R-4 | MUST | 项目 DTO 的 `settings.defaultApprovalPolicyId` 返回当前默认值；默认项目从实例元数据解析 |
| R-5 | MUST | Web 草稿会话显示项目默认策略；用户未主动改选时，首条消息的 PATCH 不包含 `approvalPolicyId` |
| R-6 | MUST | 已有会话的 `approvalPolicyId` 不因默认策略变化而被更新 |
| R-7 | SHOULD | 非草稿会话修改策略成功后刷新工作区快照，使下一次草稿立即显示新默认 |

## 7. 接口与契约变更

- REST：无新路径；`Project.settings` 新增 `defaultApprovalPolicyId`；`POST /api/sessions` 的默认策略来源变更；`PATCH /api/sessions/:id` 的 `approvalPolicyId` 增加“同时记住为项目默认”的副作用。
- WebSocket / IPC / 配置：无变化。
- 事件 / 错误码：无新增；非法枚举仍为 `VALIDATION_ERROR`。
- 同步更新 `docs/contracts/rest-api.md` 与 `docs/architecture/security.md`。

## 8. 数据与迁移

- 新表 / 新列：无。项目设置写入既有 `projects.settings_json`。
- 默认工作区：使用既有 `app_meta` 键 `default_workspace.approval_policy`。
- 索引 / 约束：无。
- 迁移与回滚：无迁移；旧 `settings_json` 缺少字段时按 `standard` 解析。回滚只需恢复读取固定默认，遗留键无害。
- 保留与备份：随现有项目/实例数据备份。

## 9. 安全、权限与审计

- 身份与授权：沿用 Session PATCH 的认证、Origin/CSRF 与客户端会话校验；不新增入口。
- 审批级别：不改变审批引擎；只改变“新会话初始策略”的来源。用户改选完全自主仍需客户端风险确认。
- 秘密处理：无秘密写入。
- 审计事件：沿用现有 `session.created`；不新增策略变更审计（与当前 `approvalPolicyId` PATCH 行为一致）。
- 失败关闭：项目/元数据读取失败或值非法时回落 `standard`，不提升权限。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 项目设置缺失或损坏 | 解析为默认 `standard` | 草稿显示标准审批 |
| 默认工作区无记录 | 新会话 `standard` | 标准审批 |
| 旧会话所属项目已删除 | 旧会话保持自己的策略；之后的修改记到默认工作区 | 无额外提示 |
| 并发两个会话修改策略 | 后提交者成为默认；各自会话策略独立 | 无额外提示 |
| Web 快照尚未加载 | 显示 `standard`，但创建时不回传策略，服务端仍按真实默认解析 | 创建后详情纠正显示 |

## 11. 可观测性

- 日志：沿用请求日志，不新增。
- 指标 / 状态：无。
- 诊断入口：项目详情 `settings.defaultApprovalPolicyId` 可直接核对。

## 12. 测试计划

- 单元：session service 创建/更新；项目设置解析与默认项目 DTO。
- 集成：sessions API PATCH 后项目 DTO 与新建会话；默认工作区；旧会话不变。
- Web：Composer 草稿显示项目默认；未显式改选时不回传；显式改选时回传。
- 手动 / 视觉：审批盾牌文案与风险确认弹窗保持原样。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 无 | — | — |

## 14. 完成定义

- [x] 验收场景全部通过；
- [x] 测试与检查通过；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] 成功 / 失败 / 状态提示遵循 [统一消息反馈](../../docs/architecture/ui-feedback.md)，没有新增行内提示条；
- [ ] 人类评审通过（如需要）。
