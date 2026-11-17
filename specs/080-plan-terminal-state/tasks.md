# 任务：计划终态呈现

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| PT-1 | 终态呈现红测试 | 079 done | `done` |
| PT-2 | 计划终态派生与摘要 | PT-1 | `done` |
| PT-3 | 验证（web 全量、类型、规范、构建） | PT-2 | `done` |
| PT-4 | 文档与状态回填 | PT-3 | `done` |

## 任务卡

### PT-1 终态呈现红测试

- 状态：`done`
- 依赖：079（提示层与陈旧提醒已交付）
- 目标：先把「终态计划怎么读」写成可执行断言，确认现状确实红。
- 交付物：`Timeline.test.tsx`
  - `it.each` 覆盖 `turn.interrupted / cancelled / failed / completed`：实时只有 spinner、终态标签分别为「已中断 / 已停止 / 已中断 / 未标记完成」、`.text-danger` 为空、重放同标签。
  - 摘要断言：`计划 · 1/3 · 样式调整 · 另有 2 步未完成`。
  - 三条补充用例：失败步骤不计入计数并保持红叉、全部结束不追加计数、缺少终态事件读作「未标记完成」。
- 验收：实现未改前，`Timeline.test.tsx` 25 项中 6 项失败，失败原因均为缺少新标签 / 新计数。
- 测试：`pnpm --filter @larness/web exec vitest run src/features/chat/Timeline.test.tsx`。
- 涉及路径：`apps/web/src/features/chat/Timeline.test.tsx`。

### PT-2 计划终态派生与摘要

- 状态：`done`
- 依赖：PT-1
- 目标：按回合结局解释未结束的步骤，并如实报出剩余步数，且不写回任何状态。
- 交付物：
  - `TimelineItemView.tsx`：新增 `PlanStepDisplay` 与 `displayStepStatus`（`cancelled → stopped`、`failed / interrupted → interrupted`、`completed / 缺失 → unmarked`）；`planStepLabels` 增加三项；`CircleDashed` 中性标记；`planStepStated` 让结局文案可见；终态摘要追加 `· 另有 N 步未完成`。
  - `Timeline.tsx`：把 `stateUser?.turnOutcome` 传给计划卡（合并链取最后一片）。
- 验收：PT-1 全部转绿；活跃回合呈现与旧行为一致。
- 测试：同 PT-1。
- 涉及路径：`apps/web/src/features/chat/TimelineItemView.tsx`、`apps/web/src/features/chat/Timeline.tsx`。

### PT-3 验证

- 状态：`done`
- 依赖：PT-2
- 目标：确认改动没有回归，且格式与类型干净。
- 交付物：见验收记录。
- 验收：`@larness/web` 全量通过；`typecheck`、`biome ci`、`build` 通过。
- 测试：见验收记录。

### PT-4 文档与状态回填

- 状态：`done`
- 依赖：PT-3
- 目标：登记切片与待决问题。
- 交付物：`specs/README.md`、`ROADMAP.md`、`STATUS.md` 收口行、`docs/open-questions.md` Q-040。
- 验收：三处状态一致（`ROADMAP.md` 为准）。

## 验收记录

- 2026-11-16（Windows 11）：
- **先红**：实现未改时跑 `src/features/chat/Timeline.test.tsx`，25 项里 **6 项失败**，失败原因是找不到 `计划 · 1/3 · 样式调整 · 另有 2 步未完成`、`已中断 / 已停止 / 未标记完成`；其中「全部结束不追加计数」当时即通过，作为回归护栏保留。
- 实现后同文件 **25/25 通过**；`pnpm --filter @larness/web test` 全量 **45 文件 / 249 项通过**。
- `pnpm typecheck`：6 个包 `tsc --noEmit` 全部通过。
- `pnpm exec biome ci .`：退出码 0（16 warnings / 3 infos 均为既有，`packages/resources`、`service-ops`、`agentRunner.test`、`previews.test`、`LoginPage`、`e2e-server` 等，本切片文件无新增；两个改动文件已 `biome check --write`）。
- `pnpm build`：server（四入口）+ web 构建通过。
- **未运行**：
  - `pnpm test` 全量（server 套件）：本切片零服务端改动，未重复跑；079 记录过的并发脆用例与本次无关。
  - E2E（`pnpm test:e2e*`）与真实应用界面截图：本机未启动应用，视觉核对限于 DOM 断言（图标类名、`sr-only` 文案、折叠标题）。若需要视觉基线，另行安排。
- **诊断依据**：079 的只读统计显示 18 个有计划的本机 Turn 中 7 个计划终态与执行事实不一致（3 个停在 `running`/`pending`、4 个完成后仍留 `pending`）。
