# 任务：计划步骤即时更新

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| PG-1 | 计划更新行为诊断复核 | 036 done | `done` |
| PG-2 | 提示层：系统提示与工具描述要求同批更新 | PG-1 | `done` |
| PG-3 | 运行时：计划陈旧提醒 | PG-2 | `done` |
| PG-4 | 验证、文档与状态回填 | PG-3 | `done` |

## 任务卡

### PG-1 计划更新行为诊断复核

- 状态：`done`
- 依赖：036（真实任务计划与 `plan.updated` 契约）
- 目标：确认「计划只在结尾一次性勾完」是模型行为还是链路缺陷。
- 交付物：
  - 只读统计：最近 55 个 Turn 中 18 个有计划，37 次 `update_plan` / 34 条 `plan.updated`；每轮 0 次 37 轮、1 次 5 轮、2 次 10 轮、3 次 3 轮。
  - 结论：持久化、广播、reducer、渲染均逐条生效；缺陷在提示与运行时激励。
  - 附带缺陷：7/18 轮计划终态与执行事实不一致（3 轮停在 running/pending，4 轮完成后仍留 pending）。
- 验收：结论与数据一致，且「中途更新能落库、能推送、能渲染」有既有测试与真实数据两侧证据。
- 测试：不新增代码；复核 `eventReducer.test.ts`、`Timeline.test.tsx`、`events.test.ts` 覆盖。
- 涉及路径：只读查询本机数据库，不改仓库文件。

### PG-2 提示层：系统提示与工具描述要求同批更新

- 状态：`done`
- 依赖：PG-1
- 目标：把「完成一步就更新」写成明确、可执行的稳定约束，并要求与下一步工具调用同批发出。
- 交付物：
  - `contextAssembler.ts`：`SYSTEM_POLICY` 计划条款改写（首动作前创建、稳定 ID、最多一个 running、完成即同批更新、未验证 / 取消 / 失败不得标 done）；`PROMPT_VERSION` → `m6-2`。
  - `planTool.ts`：`update_plan` 描述改写，与提示一致。
- 验收：实际组装的系统提示与工具描述都含同批更新与「未验证不得标 done」的表述。
- 测试：
  - `test/agent/contextAssembler.test.ts`：4 种审批策略 × 有 / 无项目共 8 种组合都断言提示条款。
  - `test/agent/plan.test.ts`：断言工具描述含 `same batch` 与 `never mark a step done`。
- 涉及路径：`apps/server/src/modules/agent/contextAssembler.ts`、`apps/server/src/modules/agent/planTool.ts`。

### PG-3 运行时：计划陈旧提醒

- 状态：`done`
- 依赖：PG-2
- 目标：模型不更新计划时，由运行时确定性地提醒一次。
- 交付物：
  - 新增 `apps/server/src/modules/agent/turn/planReminder.ts`：`PLAN_STALE_TOOL_CALLS = 6`、`MAX_QUOTED_OPEN_STEPS = 5`、纯函数 `stalePlanReminder`（已提醒 / 阈值 / 无未完成步骤 → `null`）。
  - `turnRunner.ts`：`planSteps`、`toolCallsSincePlanUpdate`、`planReminderSent` 状态；`update_plan` 处理器复位；每次工具执行前自增；每步请求前注入一次提醒并写结构化日志。
- 验收：
  - 6 个工具调用未更新计划 → 下一步请求出现一次提醒，引用当前 running 步骤；
  - 更新后不再重复；
  - 计划新鲜、无计划、全部结束后都不出现提醒。
- 测试：
  - 新增 `test/agent/planReminder.test.ts`（5 项：阈值边界、内容与上限、不重复、无计划 / 全部结束、`threshold <= 0`）。
  - `test/agent/plan.test.ts` 新增集成用例：真实 Runner + SQLite + FakeProvider，断言 `nudges(1)=0`、`nudges(2)=1`、`nudges(3)=1`、`nudges(4)=1` 与 `plan.updated` 序列 `[running, pending] → [done, running]`。
- 涉及路径：`apps/server/src/modules/agent/turn/planReminder.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/test/agent/planReminder.test.ts`、`apps/server/test/agent/plan.test.ts`。

### PG-4 验证、文档与状态回填

- 状态：`done`
- 依赖：PG-3
- 目标：全量验证并回填状态。
- 交付物：`specs/README.md` 与 `ROADMAP.md` 登记 079；`STATUS.md` 收口行；`docs/open-questions.md` 记录 Q-039（阈值）。
- 验收：`app test/agent` 29 文件 174 项通过；`pnpm check`、`pnpm build` 通过。
- 测试：见验收记录。

## 验收记录

- 2026-11-16（Windows 11）：先红测试——`planReminder.ts` 尚不存在，两个测试文件因模块缺失失败；实现后转绿。
- `pnpm --filter @larness/server exec vitest run test/agent`：**29 文件 / 174 项通过**（含新增 5 项单元 + 1 项 Runner 集成）。
- `pnpm exec biome ci .`：退出码 0（另有 8 个文件的既有 warning / info，本切片文件无新增）。
- `pnpm typecheck`：6 个包 `tsc --noEmit` 全部通过。
- `pnpm build`：server（四入口）+ web 构建通过。
- `pnpm test` 全量：9 文件 / 16 项失败，全部落在真实子进程、PTY、预览、Vite 与终端组（`commands`、`terminalControl`、`terminalTools`、`services`、`previews`、`terminals`、`dev-web/vite`、`default-workspace`），均为并发下的 20 秒超时或跨文件时序；单独复跑 `test/agent`（含 `commands`）174/174、`test/resources/services.test.ts` 7/7 均通过，与 `STATUS.md` 已记录的批量时序抖动一致，非本切片引入。**未修复这批既有脆用例**，如实记录。
- 未运行：`pnpm test:e2e`、`pnpm test:e2e:auth`、`pnpm test:e2e:prod`，以及真实模型长任务观察。提醒对真实模型的实际影响需在后续长任务中按 `plan.updated` 次数复核。
