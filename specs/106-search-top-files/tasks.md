# 任务：宽搜索 Top files 摘要

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| STF-1 | [文件计数与 Top files 提示](tasks.md#stf-1-文件计数与-top-files-提示) | 104 | `in_progress` |

## 任务卡

### STF-1 文件计数与 Top files 提示

- 状态：`in_progress`
- 依赖：104
- 目标：搜索摘要除 Top dirs 外再给主要目录的代表文件，减少整文件读取。
- 交付物：
  - `SearchCodeResult.files`；
  - `searchModelText` Top files（≤3）；
  - 单测与合同文档。
- 验收：
  - spec A1–A4；
  - 真实复测 A5（有 Key 时跑）。
- 测试：
  - `pnpm --filter @larness/agent exec vitest run test/tools/fileService.test.ts test/tools/fileTools.test.ts`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `packages/resources/src/files/fileService.ts`
  - `packages/agent/src/tools/fileTools.ts`
  - `docs/contracts/agent-command-context.md`
- 备注：不改 prompt、schema、权限或搜索语义。

## 验收记录

### 2026-11-27（macOS arm64）

- `fileService.test.ts` + `fileTools.test.ts` 共 36 项通过：files 计数、Top files、小搜索不提示、src 优先。
- 真实仓库探针：`expectedVersion` + `*.ts` 的 Top files 为 `apps/server/src/modules/files/actions.ts (10), packages/agent/src/tools/fileTools.ts (7), packages/resources/src/files/fileService.ts (12)`；目标文件已出现在摘要中，不再只显示测试文件。
- `pnpm check` 退出码 0（web 322、agent 79+1 跳过、server 1006+14 跳过）；`pnpm build` 通过。
- A5 真实复测：**待用户 Key**。跑 `larness-edit-arg-repair-106`，对比 104 的 12 步/17 调用/4 次读/248,490 input/53.5s。
- 未运行：真实复测、E2E。
