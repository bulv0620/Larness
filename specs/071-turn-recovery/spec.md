---
id: 071-turn-recovery
title: Turn 恢复与数据保留
milestone: M6
status: ready
depends_on: [070-runtime-efficiency]
owners: [human]
created: 2026-11-11
updated: 2026-11-11
---

# Turn 恢复与数据保留（M6 后续）

> 状态：`ready`（2026-11-12 人类确认 D1–D4 全部采用推荐方案，[ADR-058](../../docs/adr/ADR-058-turn-recovery-retention.md) accepted）。本切片是 [070](../070-runtime-efficiency/spec.md) 的后续：070 让长 Turn「要么完成、要么诚实停止并留下事实」，本切片让这些事实可以被**下一次 Turn 接手**，并给历史数据一个明确的寿命。
> 依赖 070 交付的检查点事实（HX-7）与用量口径（HX-1）；两者未交付前本切片只能做文档与诊断。

## 1. 背景与问题

1. **中断即丢失**。服务重启或崩溃时，所有活跃 Turn 一律被标记 `INTERRUPTED`（`apps/server/src/modules/agent/repair.ts:33-43`），没有续跑入口。一个跑到第 8 步的 10 步任务，重启后只能从零重来——上下文、已改文件、已跑过的验证全部作废。
2. **没有任何保留策略**。`cleanupExpired` 只清理认证相关行与资源事件（`apps/server/src/db/cleanup.ts:16-39`）；`agent_events`、`turns`、`session_context_summaries` 没有任何删除路径。作为对照，命令输出保留 7 天、命令 30 天、资源事件 30 天（`packages/shared/src/commands.ts:64-65`、`packages/shared/src/resources.ts:6`）。
3. **两者互相牵制**。保留多久决定恢复能依赖多少历史；删除粒度决定时间线会不会出现半截会话。必须一起设计，否则先做任何一个都要返工。

现状影响：长任务（多步、跨分钟）的重启成本 = O(整轮)；数据库体积随时间单调增长，备份、迁移前快照和时间线查询都随之变慢。

## 2. 目标

- **G-1 可接手**：被中断的 Turn 能在用户确认后由一个新的 Turn 接手，复用已持久化的工程事实（文件版本、命令与退出码、失败诊断、未完成步骤、资源 ID），不重跑已成功的步骤。
- **G-2 明确寿命**：事件、Turn、摘要各有保留期与体积上限；清理可配置、可审计、默认不删除数据。
- **G-3 可诊断**：能查看各类数据的体积与最旧时间，判断是否需要清理。
- **G-4 不重复副作用**：恢复不自动重放写入、部署或命令；需要确认状态的步骤仍走既有幂等与状态查询。

## 3. 非目标

- **NG-1** 不自动恢复。重启后自动重跑会重复执行写入与部署，必须由用户显式发起。
- **NG-2** 不恢复推理数据（按既有设计不持久化）。
- **NG-3** 不做字节级状态重放或事件重放到内存对象；续跑只依赖结构化事实 + 用户意图。
- **NG-4** 不替代 [ADR-055](../../docs/adr/ADR-055-npm-update-security.md) 的升级前备份与恢复流程。
- **NG-5** 不清理进行中会话的数据，不清理被显式保留的会话。

## 4. 用户故事

- 作为长任务用户，服务器中途重启后，我希望看到「这个任务被中断在第 6 步，可以继续」，而不是只能重新描述需求。
- 作为长期使用者，我希望数据库不会无限增长，但也不希望某天发现历史会话被静默清空。
- 作为运维者，我希望先看到体积报告，再决定是否开启删除。

## 5. 验收场景

### A1 中断后由新 Turn 接手

```gherkin
Given 一个 8 步 Turn 在第 6 步因服务重启被标记 INTERRUPTED
And 它已有检查点事实（已改文件与版本、命令与退出码、失败诊断、未完成步骤）
When 用户在该 Turn 上选择"继续"
Then 系统创建一个新 Turn，并记录 resumedFromTurnId
And 新 Turn 的首条上下文包含上述事实，且明确标注哪些步骤已完成
And 旧 Turn 保持 INTERRUPTED，事件与审计不被改写
And 新 Turn 的授权、审批、项目锁与预算按新 Turn 重新建立
```

### A2 不可恢复时明确拒绝

```gherkin
Given 被中断的 Turn 没有检查点事实，或原模型/凭据已不可用
When 用户选择"继续"
Then 系统返回稳定错误码并说明原因（无可接手事实 / 模型不可用）
And 不创建新 Turn，不发起任何模型请求
And 提示用户可以新建会话重新描述任务
```

### A3 恢复不重复副作用

```gherkin
Given 旧 Turn 已成功执行过构建与一次部署命令
When 新 Turn 依据事实继续
Then 系统提示先查询实际服务状态再决定是否重试
And 不自动重放旧 Turn 的命令
And 若 Agent 重试同类操作，仍走既有幂等键与命令状态对账
```

### A4 默认只报告不删除

```gherkin
Given 默认配置
When 清理任务按时运行
Then 只输出体积与将被清理的条数，不删除任何行
And 日志与审计记录本次运行是 dry-run
```

### A5 开启清理后的删除边界

```gherkin
Given 用户显式开启清理并设定保留期
When 清理运行
Then 只删除超过保留期且不属于活跃 Turn、未被保留标记的会话数据
And 按会话整段删除，不留下悬空事件
And 任一步失败则本次不删除任何行并告警
And 写入审计：策略版本、候选条数、实际删除条数、耗时
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 恢复通过**新建 Turn** 实现，旧 Turn 不可变；记录 `resumedFromTurnId` |
| R-2 | MUST | 新 Turn 的初始上下文含结构化事实段与"已完成/未完成"分列，事实只来自已持久化事件与检查点 |
| R-3 | MUST | 恢复入口需要用户显式确认；Agent 不得自行触发恢复 |
| R-4 | MUST | 不可恢复时失败关闭：明确错误码、不创建 Turn、不发模型请求 |
| R-5 | MUST | 清理默认 dry-run；默认不清除任何数据，除非用户在配置中显式开启 |
| R-6 | MUST | 清理按会话整段删除，跳过活跃会话与显式保留项；单次失败不影响其他行（事务内整体成功或整体不删） |
| R-7 | MUST | 清理与恢复写入审计（策略版本、候选/删除条数、耗时、原因） |
| R-8 | MUST | 提供体积诊断：各表行数、最旧/最新时间、数据目录占用 |
| R-9 | SHOULD | 恢复入口在 UI 上显示"中断于第 N 步"与已完成摘要，避免误以为任务已成功 |

## 7. 接口与契约变更

- **REST**：`POST /api/turns/:id/resume`（认证 + CSRF），返回新 Turn；`GET /api/system/storage` 返回体积报告（可并入现有 system 路由）。
- **WebSocket**：`turn.resumed`（`fromTurnId`、`toTurnId`）；`turn.completed` 等沿用 070 的 `terminalReason`。
- **配置**：`cleanup.retentionDays.{events,turns,summaries}`、`cleanup.maxBytes`、`cleanup.enabled`（默认 false）、`cleanup.keepPinned`。
- **DTO**：`TurnDto` 增 `resumedFromTurnId`；会话详情标注可恢复性。
- 同步更新 `docs/contracts/{rest-api,ws-events,data-model}.md` 与 [ADR-058](../../docs/adr/ADR-058-turn-recovery-retention.md)。

## 8. 数据与迁移

- 新列：`turns.resumed_from_turn_id TEXT NULL`；`sessions.pinned_at INTEGER NULL`（用户显式保留）。
- 索引：`idx_turns_resumed_from`；清理查询依赖 `idx_agent_events_session_seq`（已有）与 `sessions.updated_at`（已有）。
- 迁移：`apps/server/drizzle/0024_turn_recovery.sql`；只加可空列，不回填、不删除。
- 回滚：回退代码即可；新增列保留。删除类操作由配置开关控制，回退时先关开关。

## 9. 安全、权限与审计

- **身份与授权**：恢复是新的执行入口，必须走完整认证、CSRF、项目锁与策略判定；恢复不接受客户端传入的模型/凭据覆盖（沿用原 Turn 快照，不可用则失败）。
- **审批**：恢复本身不需要工具审批；恢复后执行的具体工具仍按策略审批。
- **秘密处理**：事实段只含路径、版本、退出码、错误码与资源 ID，不含命令明文中的秘密与工具输出正文。
- **审计**：`turn.resumed`、`storage.cleanup`（dry-run 与执行都记）。
- **失败关闭**：清理任一环节异常则本次不删除；恢复未能读取事实则拒绝。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 无检查点事实 | 拒绝恢复 | 「没有可接手的进度」+ 新建会话建议 |
| 原模型/凭据不可用 | 拒绝恢复并列明原因 | 「原模型不可用，请先在设置中恢复」 |
| 恢复时项目被锁 | 沿用现有锁等待与超时语义 | 既有锁提示 |
| 恢复后再次中断 | 允许再次恢复，事实以最新检查点为准 | 中断次数可见 |
| 清理与活跃 Turn 冲突 | 跳过活跃会话 | 报告中列出跳过原因 |
| 磁盘不足 / 数据库忙 | 本次清理放弃并告警 | 「清理未执行」 |
| 保留期设为 0 或负数 | 配置校验失败，保持原策略 | 配置错误提示 |

## 11. 可观测性

- 日志：`cleanup.dryRun`、`cleanup.candidates`、`cleanup.deleted`、`cleanup.durationMs`、`recovery.fromTurnId/toTurnId`。
- 指标：各表行数与字节、最旧事件时间、可恢复 Turn 数。
- 诊断入口：设置页或 doctor 输出体积报告；Turn 详情显示中断步骤与可恢复性。

## 12. 测试计划

- **单元**：事实提取与"已完成/未完成"分列；保留期计算与整段删除集合；dry-run 不写库。
- **集成**：kill 一个进行中的 Turn（模拟重启）→ 恢复 → 断言新 Turn 创建、旧 Turn 不变、无重复命令；清理在活跃会话存在时跳过；清理失败回滚。
- **E2E**：Mock 场景下"中断 → 继续"按钮链路与错误提示；清理开关默认关闭的界面表现。
- **手动**：真实重启一次长任务；大数据量下清理耗时与备份影响。

## 13. 开放问题

| ID | 问题 | 推荐方案 | 需要谁决策 |
|---|---|---|---|
| D1 | 恢复方式 | 新建 Turn 接手，旧 Turn 保持 INTERRUPTED 不可变；不原路复活 | 人类 |
| D2 | 保留期默认值 | events 90 天、turns 180 天、摘要 90 天；活跃会话与被保留项豁免；按会话整段删除 | 人类 |
| D3 | 清理是否默认开启 | 默认关闭，只 dry-run + 报告；用户显式开启才删除 | 人类（破坏性操作） |
| D4 | 恢复入口 | 仅 UI 显式按钮 + 二次确认；Agent 不可触发；自动化任务不自动恢复 | 人类 |

## 14. 完成定义

- [ ] A1–A5 通过；
- [ ] R-1～R-9 落地或记录偏差；
- [ ] 迁移 `0024` 通过升级与回滚验证；
- [ ] 清理默认不删除任何数据，且审计可查；
- [ ] 契约与 ADR-058 同步；
- [ ] `pnpm check`、`pnpm build` 与相关 E2E 通过；
- [ ] 人类评审通过（D1–D4 已确认）。
