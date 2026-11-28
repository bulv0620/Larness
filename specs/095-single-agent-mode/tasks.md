# 任务：单一 Agent 模式

> 状态：`done`（2026-11-27，SM-1～SM-5 收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| SM-1 | Profile 合并与计划策略 | 094 | `done` |
| SM-2 | planState、tail 与 nudge | SM-1 | `done` |
| SM-3 | 项目指令/验证措辞与测试 | SM-2 | `done` |
| SM-4 | Composer 移除 Profile 切换 | SM-3 | `done` |
| SM-5 | 全量验证、文档与收口 | SM-4 | `done` |

## 任务卡

### SM-1 Profile 合并与计划策略

- 状态：`done`
- 目标：coding/plan 行为一致，`update_plan` 常驻，system 注入计划策略，`PROMPT_VERSION=095-1`。
- 交付物：`profiles.ts`、`contextAssembler.ts`、`profiles.test.ts`、`contextAssembler.test.ts`。
- 验收：A1/A2/A3（工具/提示部分）。
- 测试：`profiles.test.ts`、`contextAssembler.test.ts`。

### SM-2 planState、tail 与 nudge

- 状态：`done`
- 目标：最近计划注入 tail；当前 Turn open steps nudge 一次；旧计划不触发。
- 交付物：`planState.ts`、`planState.test.ts`、`contextAssembler.ts`、`turnRunner.ts`、`turnRunner.test.ts`。
- 验收：A3/A4。
- 测试：`planState.test.ts`、`contextAssembler.test.ts`、`turnRunner.test.ts`。

### SM-3 项目指令/验证措辞与测试

- 状态：`done`
- 目标：项目指令为“约定”，验证门禁可被项目指令提高；`planTool` 描述 3+ 步。
- 交付物：`instructions.ts`、`contextAssembler.ts`、`planTool.ts`、`instructions.test.ts`、`contextAssembler.test.ts`。
- 验收：A5/A6。
- 测试：`instructions.test.ts`、`contextAssembler.test.ts`。

### SM-4 Composer 移除 Profile 切换

- 状态：`done`
- 目标：移除 Profile 状态/选择器/发送参数；更新 web 测试。
- 交付物：`Composer.tsx`、`SessionModel.test.tsx`、`Composer.test.tsx`（如需要）。
- 验收：A1（UI 部分）。
- 测试：`SessionModel.test.tsx`、`Composer.test.tsx`。

### SM-5 全量验证、文档与收口

- 状态：`done`
- 目标：ADR/051/084/契约/路线图/STATUS；`pnpm check`、`pnpm build`。
- 交付物：文档与状态；验收记录。
- 验收：全部。

## 验收记录

（完成后填写：定向测试、`pnpm check`、`pnpm build`、未运行项、偏差。）

### 2026-11-27（macOS arm64）

- 后端定向：profiles / contextAssembler / plan / planState / turnRunner / instructions 共 91 项通过。
- Web 定向：`SessionModel.test.tsx` 13 项、`Composer.test.tsx` 9 项通过。
- 整仓：`pnpm check` 退出码 0（web 55 文件 / 322 项、agent 72 项 + 1 跳过、server 183 文件 / 987 项 + 14 跳过）；`pnpm build` 退出码 0。
- 覆盖：单一可见模式、旧 plan 兼容、update_plan 常驻、计划策略、计划 tail、当前 Turn open-step nudge 一次、旧计划不 nudge、项目指令“约定”措辞、项目指令提高验证门禁、Composer 移除 Profile 切换。
- 未运行：E2E、真实 Provider 会话。计划 nudge 与项目指令遵循的真实模型行为由后续基准/A-B 验证。
- 偏差：`PROMPT_VERSION=095-1`，工具数组增加 `update_plan`；升级后首次请求会有一次 `prompt_version`/`tools` 前缀断裂，属预期。
