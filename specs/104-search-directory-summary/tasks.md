# 任务：宽搜索目录摘要

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| SDS-1 | [目录统计与 Top dirs 提示](tasks.md#sds-1-目录统计与-top-dirs-提示) | 100、102 | `in_progress` |

## 任务卡

### SDS-1 目录统计与 Top dirs 提示

- 状态：`in_progress`
- 依赖：100、102
- 目标：搜索被截断时给模型完整的目录命中分布，帮助选择 `path`。
- 交付物：
  - `SearchCodeResult.directories`；
  - 达到 limit 后继续计数（受 maxFiles 约束）；
  - `searchModelText` Top dirs + path 提示；
  - 裸 glob 递归匹配（`*.ts`）；
  - 单测与合同文档。
- 验收：
  - spec A1–A4、A6；
  - 真实复测 A5（有 Key 时跑）。
- 测试：
  - `pnpm --filter @larness/agent exec vitest run test/tools/fileService.test.ts test/tools/fileTools.test.ts`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `packages/resources/src/files/fileService.ts`
  - `packages/agent/src/tools/fileTools.ts`
  - `docs/contracts/agent-command-context.md`
- 备注：不改 prompt、schema、权限或忽略规则。

## 验收记录

### 2026-11-27（macOS arm64）

- `fileService.test.ts` + `fileTools.test.ts` 共 34 项通过：三目录限制/统计、Top dirs、小搜索不提示、裸 glob 递归、`src/*.ts` 层级不变。
- 真实仓库探针：`expectedVersion` + `glob:"*.ts"` 从 103 的 **0 命中/3 文件** 变为 **50 命中（截断）/625 文件**；Top dirs 为 `apps/server (80), packages/agent (23), packages/resources (14), packages/shared (3), apps/web (2)`。`packages/agent` 已出现在摘要中。
- `pnpm check` 退出码 0（web 322、agent 77+1 跳过、server 1006+14 跳过）；`pnpm build` 通过。
- A5 真实任务复测：**待用户 Key**。用 102 基线重跑 `larness-edit-arg-repair-104`，与 13 步/23 调用/296,177 input/59.5s 对比。
- 未运行：真实复测、E2E。
