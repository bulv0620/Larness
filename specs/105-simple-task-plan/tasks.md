# 任务：简单单文件任务不创建计划

> 状态：`dropped`（实机 tokens/耗时回退，代码已回退）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| STP-1 | [收窄计划策略与文案](tasks.md#stp-1-收窄计划策略与文案) | 095、104 | `dropped` |

## 任务卡

### STP-1 收窄计划策略与文案

- 状态：`dropped`
- 依赖：095、104
- 目标：单文件修复 + 一个目标验证命令不创建计划；复杂任务仍提示计划。
- 交付物：
  - `PLAN_POLICY` 与 `planTool` description；
  - `PROMPT_VERSION=105-1`；
  - 测试与合同/051 变更记录。
- 验收：
  - spec A1–A3、A5；
  - 真实复测 A4（有 Key 时跑）。
- 测试：
  - `pnpm --filter @larness/server test test/agent/contextAssembler.test.ts test/agent/profiles.test.ts test/agent/plan.test.ts`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `apps/server/src/modules/agent/planTool.ts`
  - `apps/server/test/agent/*`
  - `docs/contracts/agent-command-context.md`
- 备注：不删除/禁用 update_plan；只改提示与描述。

## 验收记录

### 2026-11-27（macOS arm64）

- `contextAssembler.test.ts` / `profiles.test.ts` / `plan.test.ts` 共 22 项通过：新策略、单文件豁免、coding/plan 文案、复杂计划持久化、工具描述。
- 历史裁剪滞回测试的窗口改为以 full 估算为窗口，避免新增 prompt 固定开销把测试推到裁剪边界（行为断言不变）。
- `pnpm check` 退出码 0（web 322、agent 77+1 跳过、server 1007+14 跳过）；`pnpm build` 通过。
- A4 真实复测（同模型/max，n=1）：`update_plan` 成功降为 **0**，steps 12→10、toolCalls 17→15；但 input tokens 248,490→272,813（+10%），duration 53.5s→60.8s（+14%），不满足 A4 的“tokens 不高于 104”。
- 序列变化：模型没有计划后改用 5 次搜索、分段读 fileTools、读整测试/package，并用 apply_patch；少 3 次 plan 但多 3 次搜索，净调用只少 2，tokens 反而上升。
- 决定：按 spec G-6 回退 105 的 PLAN_POLICY、planTool 描述、`PROMPT_VERSION` 与测试；恢复 `100-1`。任务 `dropped`。保留 104 作为最佳真实仓库基线。
- 回退后定向：context/profiles/plan 21 项通过；`pnpm check` 退出码 0（web 322、agent 77+1 跳过、server 1006+14 跳过），`pnpm build` 通过。
- 未运行：E2E。
