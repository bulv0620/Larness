# 任务：真实仓库探索：精确标识符优先

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| EIS-1 | [精确标识符 prompt 与宽扫提示](tasks.md#eis-1-精确标识符-prompt-与宽扫提示) | 100、102 | `in_progress` |

## 任务卡

### EIS-1 精确标识符 prompt 与宽扫提示

- 状态：`in_progress`
- 依赖：100、102
- 目标：真实仓库里先搜请求中的精确字段/函数；大范围搜索在结果里提示收窄。
- 交付物：
  - system prompt 探索策略；
  - `searchModelText` 宽扫提示 + 工具描述；
  - 单测与合同文档。
- 验收：
  - spec A1–A4；
  - 真实复测 A5（有 Key 时跑）。
- 测试：
  - `pnpm --filter @larness/agent exec vitest run test/tools/fileTools.test.ts`
  - `pnpm --filter @larness/server test test/agent/contextAssembler.test.ts`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `packages/agent/src/tools/fileTools.ts`
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `docs/contracts/agent-command-context.md`
- 备注：不改 search schema、权限或忽略规则。

## 验收记录

### 2026-11-27（macOS arm64）

- `fileTools.test.ts` 10 项通过：201 文件宽扫提示、普通搜索不提示、默认上下文/关闭/边界/描述等。
- `contextAssembler.test.ts` 15 项通过：精确标识符约束、prompt version、历史裁剪滞回。历史窗口测试改为以 full 估算为窗口，避免新增 prompt 固定开销把测试推到裁剪边界（行为断言不变）。
- `pnpm check` 退出码 0（web 322、agent 76+1 跳过、server 1006+14 跳过）；`pnpm build` 通过。
- 真实复测 A5：**待用户 Key**。用 102 的命令重跑 `larness-edit-arg-repair`，与旧值 13 步/23 调用/296,177 input/59.5s 对比。
- 未运行：真实复测、E2E。
