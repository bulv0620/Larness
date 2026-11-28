# 任务：真实仓库探索：精确标识符优先

> 状态：`dropped`（实机回归，代码已回退）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| EIS-1 | [精确标识符 prompt 与宽扫提示](tasks.md#eis-1-精确标识符-prompt-与宽扫提示) | 100、102 | `dropped` |

## 任务卡

### EIS-1 精确标识符 prompt 与宽扫提示

- 状态：`dropped`
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

- 实现阶段：`fileTools.test.ts` 10 项、`contextAssembler.test.ts` 15 项通过；`pnpm check` 退出码 0（web 322、agent 76+1 跳过、server 1006+14 跳过）；`pnpm build` 通过。
- A5 真实复测（同模型/max，n=1）：**明显回退**。Larness 22 步 / 29 调用 / 2 失败 / input 546,390（cache 505,600）/ 94.4s；102 基线为 13 步 / 23 调用 / 296,177 input / 59.5s。opencode 仍是 8 步 / 10 调用 / 157,152 prompt tokens / 43.1s。
- 回归序列：先搜 `expectedVersion`（glob `*.ts`，50 命中/392 文件）→ `VALIDATION_ERROR` → 连续 `list_files` 探索 `apps/server` → 搜 `edit`/`editTool`/`write_file` → 才到 `packages/agent`。宽扫提示出现了一次，但没有纠正错误包路径。
- 原因：请求里的 `expectedVersion` 在基线实现中已被移除，直接搜它命中大量测试；102 先搜 `VERSION_CONFLICT` 反而命中了 `fileTools.ts`。103 的“精确标识符优先” prompt 把模型带离了有效线索。
- 决定：**回退** 103 的 prompt、宽扫提示与 `PROMPT_VERSION`，恢复 `100-1`；保留本 spec 记录回归，任务标记 `dropped`。后续应做仓库/包索引或更准的搜索排序，而不是继续加行为 prompt。
- 回退后定向：`fileTools.test.ts` 9 项、`contextAssembler.test.ts` 15 项通过；`pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 1006+14 跳过），`pnpm build` 通过。
- 未运行：E2E。
