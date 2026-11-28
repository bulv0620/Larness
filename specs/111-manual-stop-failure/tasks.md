# 任务：手动停止按失败效果呈现

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| MS-1 | 手动停止呈现红测试 | 080 done | `done` |
| MS-2 | 摘要、提示与计划步骤按失败呈现 | MS-1 | `done` |
| MS-3 | 验证（web 全量、类型、规范、构建） | MS-2 | `done` |
| MS-4 | 文档、状态回填与提交 | MS-3 | `done` |
| MS-5 | 失败回合折叠失败工具行 | MS-4 | `done` |

## 任务卡

### MS-1 手动停止呈现红测试

- 状态：`done`
- 依赖：080（终态呈现已交付）
- 目标：先固定「手动停止按失败呈现」的可见结果，确认现状确实红。
- 交付物：`apps/web/src/features/chat/Timeline.test.tsx`
  - `turn.cancelled` 的期望计划标签从「已停止」改为「已中断」；
  - 新增用例：cancelled 回合摘要为 `Failed`、停止提示使用失败边框、保留「重试」。
- 验收：实现未改前同文件 30 项中 2 项失败，失败原因分别为找不到「已中断」与找不到 `执行过程 · Failed`；cancelled 仍不提供继续入口的既有用例保持通过。
- 测试：`pnpm --filter @larness/web test:file src/features/chat/Timeline.test.tsx`。
- 涉及路径：`apps/web/src/features/chat/Timeline.test.tsx`。

### MS-2 摘要、提示与计划步骤按失败呈现

- 状态：`done`
- 依赖：MS-1
- 目标：只改前端读法，让 `cancelled` 与 `failed` 呈现一致，数据与恢复条件不变。
- 交付物：
  - `Timeline.tsx`：失败判断包含 `turnOutcome === "cancelled"`，摘要显示 `Failed`，移除单独的 `Stopped` 分支。
  - `TimelineItemView.tsx`：`displayStepStatus` 对 `cancelled` 返回 `interrupted`；移除 `stopped` 显示状态；终态提示统一使用失败边框。
- 验收：MS-1 全部转绿；`turn.interrupted`、真实 `turn.failed` 与缺终态回合的既有断言不变。
- 测试：同 MS-1。
- 涉及路径：`apps/web/src/features/chat/Timeline.tsx`、`apps/web/src/features/chat/TimelineItemView.tsx`。

### MS-3 验证

- 状态：`done`
- 依赖：MS-2
- 目标：确认改动没有回归，格式、类型与构建干净。
- 交付物：见验收记录。
- 验收：`@larness/web` 全量通过；`pnpm check`、`pnpm build` 通过。
- 测试：见验收记录。

### MS-4 文档、状态回填与提交

- 状态：`done`
- 依赖：MS-3
- 目标：登记切片、修订 080 的呈现说明并收口。
- 交付物：`specs/README.md`、`ROADMAP.md`、`STATUS.md`、`docs/log/2026-11.md`、`specs/080-plan-terminal-state/spec.md` 日期注记。
- 验收：三处状态一致（`ROADMAP.md` 为准）。

### MS-5 失败回合折叠失败工具行

- 状态：`done`
- 依赖：MS-4
- 目标：用户补充「失败的情况下，不需要把所有失败步骤列出来」：失败回合不再自动平铺失败工具行。
- 交付物：
  - `Timeline.tsx`：`visibleProcess` 对 `failed`（含 `cancelled`）不再自动露出错误工具行，仍保留摘要状态、终态提示与一键展开。
  - `Timeline.test.tsx`：新增 `failed` / `cancelled` 两个用例，断言失败行默认不可见、展开后可见。
- 验收：`failed` / `cancelled` 回合的失败工具行默认折叠；完成但无答复的回合保持原行为；`turn.interrupted` 不受影响。
- 测试：`pnpm --filter @larness/web test:file src/features/chat/Timeline.test.tsx`。
- 涉及路径：`apps/web/src/features/chat/Timeline.tsx`、`apps/web/src/features/chat/Timeline.test.tsx`。

## 验收记录

- 2026-11-27（macOS）：
- **先红**：实现未改时 `Timeline.test.tsx` 30 项中 **2 项失败**：cancelled 计划步骤读不到「已中断」（仍为「已停止」），cancelled 回合摘要读不到 `执行过程 · Failed`（仍为 `Stopped`，提示边框为中性）；`does not offer resume for a cancelled turn` 保持通过。
- 实现后同文件 **30/30 通过**；`@larness/web` 全量 **55 文件 / 324 项通过**。
- `pnpm check`：退出码 0。biome 808 文件、6 个工作区 `tsc --noEmit` 通过；server **188 文件 / 1018 项通过 / 15 跳过**，web 324 项通过。
- `pnpm build`：server 四入口 + web 通过（仅既有大 chunk 警告）。
- **未运行**：E2E（`pnpm test:e2e*`）与真实浏览器视觉截图；本次只改 Web 呈现，文案与样式由组件断言覆盖。
- **数据边界**：`turns.status` 仍为 `CANCELLED`、`terminalReason=cancelled`，事件仍为 `turn.cancelled`；Job 运行状态与「取消的回合不提供继续入口」均未变。

- 2026-11-28 补充（MS-5）：
- **先红**：`Timeline.test.tsx` 新增的 `keeps failed steps inside the record when a turn is failed / cancelled` 2 项失败，失败原因是失败工具行直接出现在折叠区外。
- 实现后 `Timeline.test.tsx` **32/32 通过**，`@larness/web` 全量 **55 文件 / 326 项通过**；`pnpm check` 退出码 0（server 188 文件 / 1018 项通过 / 15 跳过），改动文件 biome 与 `apps/web` typecheck 通过。
- **未运行**：本轮未重跑 `pnpm build`；E2E 与浏览器视觉验收仍未跑。
