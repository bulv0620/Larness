# 实施计划：简单单文件任务不创建计划

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `PLAN_POLICY`：
   - “3+ 个不同工作项，或跨多文件/未知范围”才创建计划；
   - 单文件修复 + 一个目标验证命令算一个工作项，明确不建计划；
   - 保留现有状态更新、验证后勾选与复杂任务规则。
2. `planTool` description 同步。
3. `PROMPT_VERSION=105-1`。
4. 更新 context/profiles/plan 测试与合同文档。
5. 真实 099 任务复测，统计 `update_plan` 次数。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只改 system prompt | 改动小 | 工具描述仍说 3+ steps | 两者同步 |
| 运行时禁止单文件计划 | 强制 | 需要任务分类，易误伤 | 不做 |
| 移除 plan 工具 | 彻底 | 破坏复杂任务功能 | 不做 |
| 收窄策略 + 单文件豁免 | 保留能力，减少简单任务开销 | 模型仍可能计划 | 采用，复测 |

## 3. 目录与文件变更

```text
新增：
specs/105-simple-task-plan/{spec,plan,tasks}.md

修改：
apps/server/src/modules/agent/contextAssembler.ts  # PLAN_POLICY + version
apps/server/src/modules/agent/planTool.ts           # description
apps/server/test/agent/contextAssembler.test.ts     # 新策略
apps/server/test/agent/profiles.test.ts             # coding/plan 文案
apps/server/test/agent/plan.test.ts                 # description + 复杂计划
docs/contracts/agent-command-context.md             # 合同
specs/051-agent-tool-contract/spec.md               # 变更记录
specs/ROADMAP.md / specs/README.md / STATUS.md       # 登记
```

## 4. 实施步骤

1. 先改测试断言到新策略/豁免，确认失败。
2. 改 `PLAN_POLICY`、`planTool` description、`PROMPT_VERSION`。
3. 跑定向测试、`pnpm check`、`pnpm build`。
4. 更新合同/051/状态。
5. 提交；用户复测真实 099 任务。
6. 记录 plan 调用与 steps/tokens；决定收口或回退。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

恢复 095 的 PLAN_POLICY/planTool 文案与 `PROMPT_VERSION=100-1` 即可；无数据影响。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/contextAssembler.test.ts
pnpm --filter @larness/server test test/agent/profiles.test.ts
pnpm --filter @larness/server test test/agent/plan.test.ts
pnpm check
pnpm build
```

真实复测：

```bash
pnpm bench:agent -- \
  --repo /private/tmp/larness-real-task \
  --prompt "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id larness-edit-arg-repair-105 \
  --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模型把复杂任务也当单文件 | 计划缺失 | 只豁免“单文件 + 一个验证命令” |
| 复杂计划测试回退 | 功能破坏 | 现有 plan/turnRunner 用例全跑 |
| prompt 变化不可预测 | 103 式回退 | 真实 099 任务复测；不改善就回退 |
| 工具描述与 system 不一致 | 模型困惑 | 两处同步并测试 |

## 9. 未决事项

- 单文件但多验证命令是否算一个工作项，复测后确定。
