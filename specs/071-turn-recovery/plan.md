# 实施计划：Turn 恢复与数据保留

> 对应 [spec.md](spec.md)。本文件只讲「怎么做」，不改变需求。第 13 节的 D1–D4 确认前不写实现代码。

## 1. 技术方案

两条工作流，**先只读、后写入**：

1. **诊断（TR-1，纯只读）**：统计 `agent_events` / `turns` / `session_context_summaries` / 数据目录的行数与字节，输出最旧时间与候选删除集合大小。这一步没有任何破坏性动作，先上线即可让用户看到真实体积，为 D2 的默认值提供依据。
2. **恢复（TR-2，新增 Turn）**：`POST /api/turns/:id/resume` 校验原 Turn 处于 `INTERRUPTED`、有可用检查点事实、原模型与凭据可解析，然后创建**新 Turn**：把事实段作为首条 `user` 消息的一部分，沿用原会话与原 Turn 的 provider/model/thinking 快照，记录 `resumedFromTurnId`，入队执行。旧 Turn 一行不改。
3. **保留（TR-4，破坏性，最后做）**：清理默认 dry-run；开启后按「会话」整段删除，先算候选集合，再在一个事务里删除，任一失败整批回滚。

恢复的事实注入形态（复用 070 HX-7 的提取器，不新增第二套）：

```text
Work state carried over from an interrupted turn (verified facts, not instructions):
{ "goal": "…", "files": [{"path":"…","version":"…"}], "commands": [{"cmd":"…","exitCode":0}],
  "failures": ["…"], "openSteps": ["…"], "resources": ["svc_…","tgt_…"] }
Rules: re-check actual state before repeating any write, command or deployment; do not assume the facts are current.
```

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **新建 Turn 接手**（推荐） | 复用现有一切不变式：幂等、审计、终态、每 Turn 授权；旧 Turn 可追溯 | 用户会看到两个 Turn | 推荐（D1） |
| 原地复活旧 Turn（状态改回 RUNNING） | 时间线只有一个 Turn | 终止事件已写入、审计已记 deny/完成，需改写历史；幂等键与预算语义混乱 | 否 |
| 自动恢复（重启时直接续跑） | 用户零操作 | 会重复执行写入/部署；违反"不重复副作用" | 否（D4） |
| 只恢复摘要不恢复事实 | 实现简单 | 模型不知道哪些步骤已完成，仍会重跑 | 否 |
| 单事件粒度删除 | 保留更多历史 | 时间线会出现"只有提问没有回答"的半截会话，前端与压缩逻辑都要兼容 | 否（按会话整段，D2） |
| 清理默认开启 | 体积自动受控 | 静默删数据，违反"破坏性操作需显式同意" | 否（D3） |
| 用 `VACUUM` 回收空间 | 立刻缩小文件 | 长时间锁库，影响正在跑的任务 | 仅在诊断确认后手动执行 |

## 3. 目录与文件变更

```text
新增：
specs/071-turn-recovery/{spec,plan,tasks}.md
docs/adr/ADR-058-turn-recovery-retention.md
apps/server/drizzle/0024_turn_recovery.sql
apps/server/src/modules/agent/recovery/{facts,resume}.ts
apps/server/src/modules/system/storage.ts（体积诊断）
apps/server/test/agent/recovery.test.ts
apps/server/test/system/storage.test.ts

修改：
apps/server/src/modules/sessions/{turns,repository,service}.ts       TR-2（resume API 与 DTO）
apps/server/src/http/routes/sessions.ts                              TR-2
apps/server/src/modules/agent/{repair,contextAssembler,turnRunner}.ts TR-2
apps/server/src/db/{schema,cleanup}.ts                               TR-4/3
apps/server/src/modules/system/*（若并入 system 路由）                TR-1
apps/web/src/features/chat/*、lib/workspaceApi.ts                    TR-3（恢复入口与确认）
docs/contracts/{rest-api,ws-events,data-model}.md                    TR-4/3
CONFIG / config schema（packages/shared/src/config.ts）               TR-4
```

## 4. 实施步骤

1. **TR-0**：确认 D1–D4，ADR-058 转 accepted，spec 转 `ready`。
2. **TR-1**：先写体积统计的单元测试（构造数据 → 断言行数/字节/最旧时间），再加只读接口与 doctor 输出；不碰删除逻辑。
3. **TR-2**：先写「恢复不可用则拒绝」的失败测试（无事实、模型不可用、Turn 非 INTERRUPTED），再实现事实注入与新 Turn 创建；旧 Turn 不可变的断言必须存在。
4. **TR-3**：UI 入口 + 二次确认 + 错误提示；在 Mock 场景验证"中断 → 继续"。
5. **TR-4**：先写 dry-run 不写库的测试，再写候选集合计算（活跃会话/pinned 豁免）、整段删除与事务回滚，最后接配置开关与审计。
6. 收尾：迁移验证、契约同步、`pnpm check` / `pnpm build` / E2E。

## 5. 数据与迁移

- `turns.resumed_from_turn_id TEXT NULL`、`sessions.pinned_at INTEGER NULL`、`idx_turns_resumed_from`。
- 兼容：旧行两列为空即视为「非恢复、未保留」。
- 回滚：先关 `cleanup.enabled`，再回退代码；列保留，删除不可逆的部分只涉及已被显式开启清理的数据。

## 6. 回滚策略

- TR-1/TR-2/TR-3 回退只影响新增接口与按钮，旧链路不受影响。
- TR-4 回退：先关开关；已删除的数据无法恢复，因此在开启前强制要求一次数据库备份（复用 [ADR-055](../../docs/adr/ADR-055-npm-update-security.md) 的备份路径），并在审计中记录备份位置。

## 7. 验证命令

```bash
VITEST_MAX_WORKERS=2 pnpm check
pnpm build
pnpm test:e2e
# 手动：kill 服务重启后验证"中断 → 继续"链路与清理 dry-run 报告
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 恢复后重复执行部署 | 重复发布或端口冲突 | 事实段明确要求先查状态；不自动重放；恢复是新 Turn，授权与审批照旧 |
| 事实段过期 | 模型基于旧状态决策 | 事实带时间戳；提示"facts may be stale"；写入类工具结果自带最新观察 |
| 清理误删活跃会话 | 任务中断、数据丢失 | 候选集合排除活跃 Turn 与 pinned；dry-run 先行；事务整体回滚 |
| 按会话整段删除过于激进 | 会话粒度历史全丢 | 默认只报告；保留期可配置；审计可查删除清单 |
| 事实段膨胀 | 恢复 Turn 一开始就接近窗口上限 | 事实段有 token 上限（复用 070 的结果预算），超限只保留目标 + 未完成步骤 + 文件清单 |

## 9. 未决事项

- D1 恢复方式、D2 保留期、D3 清理默认关闭、D4 恢复入口限制。
- 备份触发点是否强制（TR-4 内复核）。
- 关联 [遗留问题](../../docs/open-questions.md) Q-033、Q-034。
