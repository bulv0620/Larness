# 实施计划：单一 Agent 模式

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

保留 `agent_profile` 列与 `"coding" | "plan"` 类型，但让两个 Profile 拥有相同 packs（含 `plan`）。新会话继续 `coding`；`plan` 仅作为旧数据的兼容别名。Composer 移除 Profile 选择器与发送参数。

`update_plan` 常驻后，`contextAssembler` 始终注入计划策略；新增 `planState` 读取最近计划并注入 tail；`turnRunner` 在纯文本停止时检查当前 Turn 的 open steps，nudge 一次。

项目指令改为“项目约定，可遵循但不能授权”，验证规则允许项目指令提高门禁。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 删 `agent_profile` 列并迁移 | 数据模型干净 | 破坏性、无产品收益 | 否决 |
| 只移除 UI，后端仍分两套 | 改动小 | 旧 plan 与默认行为不一致 | 否决 |
| 两 Profile 行为一致 + 旧值兼容 | 无迁移、旧会话可用 | 代码保留一个别名 | **采用** |
| 运行时判断 3+ 步自动加计划 | 无需常驻提示 | 误判、工具数组变化 | 否决 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/turn/planState.ts
  apps/server/test/agent/planState.test.ts
  docs/adr/ADR-075-single-agent-mode.md
  specs/095-single-agent-mode/{spec,plan,tasks}.md
修改：
  packages/agent/src/kernel/profile.ts                 # 注释/类型兼容（不删 plan）
  apps/server/src/modules/agent/profiles.ts            # coding + plan pack
  apps/server/src/modules/agent/contextAssembler.ts    # 计划策略/项目指令/计划 tail/PROMPT_VERSION
  apps/server/src/modules/agent/turnRunner.ts          # open-step nudge
  apps/server/src/modules/projects/instructions.ts     # 项目约定措辞
  apps/server/src/modules/agent/planTool.ts            # 3+ 步描述
  apps/web/src/features/chat/Composer.tsx              # 移除 Profile 选择器
  apps/web/src/features/chat/SessionModel.test.tsx
  apps/server/test/agent/{profiles,contextAssembler,plan,planState,turnRunner}.test.ts
  docs/adr/DECISIONS.md
  docs/contracts/agent-command-context.md
  specs/051-agent-tool-contract/spec.md
  specs/084-agent-profiles-and-usage/spec.md           # 日期修订
  specs/README.md / specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

1. 改 `profiles.ts`：coding 包含 plan pack；plan 作为同构别名；更新 profile 测试。
2. 改 `contextAssembler`：计划策略常驻、`PROMPT_VERSION=095-1`、项目指令措辞、计划 tail。
3. 新增 `planState.ts`：读取最近计划/当前 Turn open steps；单测。
4. 改 `turnRunner`：open-step nudge 一次；测试当前 Turn、重复停止、旧计划不触发。
5. 改 `instructions.ts` 与验证提示；更新 context/instructions 测试。
6. 改 Composer：移除 Profile 状态/选择器/send 参数；更新 SessionModel 测试。
7. 更新 ADR/051/084/契约/路线图/STATUS；跑 `pnpm check`、`pnpm build`。
8. 提交，快进 main。

## 5. 数据与迁移

- schema：无。
- 兼容：旧 `plan` 值继续可读，行为与 coding 一致。
- 回滚：恢复 Profile packs/提示/UI；数据不变。

## 6. 回滚策略

移除计划 tail/nudge、恢复 `coding` 不含 plan、恢复 Composer 选择器与提示即可；不涉及数据迁移。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/profiles.test.ts test/agent/contextAssembler.test.ts test/agent/plan.test.ts test/agent/planState.test.ts test/agent/turnRunner.test.ts
pnpm --filter @larness/web test:file src/features/chat/SessionModel.test.tsx
pnpm --filter @larness/web test:file src/features/chat/Composer.test.tsx
pnpm check
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 计划 nudge 造成循环 | Turn 不结束 | 每 Turn 只 nudge 一次 |
| 旧计划干扰新任务 | 错误续做旧任务 | 只对当前 Turn 的 open steps nudge；旧计划仅 tail 标注 |
| 项目指令被误解为授权 | 越权 | 明确“可遵循但不可授权/覆盖安全” |
| 工具面变化导致缓存断裂 | 首次请求成本 | `PROMPT_VERSION`/`toolsetHash` 归因，预期一次 |
| UI 移除 Profile 影响旧 plan 会话 | 无切换但行为一致 | 兼容别名 + 测试 |

## 9. 未决事项

- 是否后续删除 `agent_profile` 字段：保留兼容，后续版本再评估。
- 计划卡视觉是否展示 nudge：不在本切片。
