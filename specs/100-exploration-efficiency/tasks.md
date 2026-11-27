# 任务：探索效率：search_code 上下文与窄读提示

> 状态：`done`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| EX-1 | [搜索上下文、窄读提示与探索约束](tasks.md#ex-1-搜索上下文窄读提示与探索约束) | 098 | `done` |

## 任务卡

### EX-1 搜索上下文、窄读提示与探索约束

- 状态：`done`
- 依赖：098
- 目标：搜索命中后模型能直接看到相邻行；system prompt 减少无必要的 list/package 读取和重复搜索。
- 交付物：
  - `SearchMatch.contextStart` 与默认 1 行上下文；
  - `searchModelText` 带行号、不重复命中行、追加窄读提示；
  - `SYSTEM_POLICY_BASE` 探索约束与 `PROMPT_VERSION=100-1`；
  - 工具描述与 `docs/contracts/agent-command-context.md`。
- 验收：
  - spec A1–A5；
  - A6 benchmark 记录（有 Key 时跑；无 Key 明确记录未运行）。
- 测试：
  - `packages/agent/test/tools/fileTools.test.ts`
  - `packages/agent/test/tools/fileService.test.ts`
  - `apps/server/test/agent/contextAssembler.test.ts`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `packages/resources/src/files/fileService.ts`
  - `packages/agent/src/tools/fileTools.ts`
  - `apps/server/src/modules/agent/contextAssembler.ts`
- 备注：默认 1 行是保守值；若 live 后 token 上升且调用未降，回退默认值，保留提示。

## 验收记录

### 2026-11-27（macOS arm64）

- 定向：`packages/agent/test/tools/fileTools.test.ts` 与 `fileService.test.ts` 共 32 项通过；`apps/server/test/agent/contextAssembler.test.ts` 15 项通过。
- 整仓：`pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 997+14 跳过）；`pnpm build` 退出码 0。
- 离线 smoke：`LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --task single-file-fix --out /private/tmp/larness-bench-100-smoke` 得到 steps=4、toolCalls=3、toolFailures=1、verify=0；仅验证接线，不覆盖搜索上下文行为。
- A6 live benchmark：**未运行**。当前会话没有 `LARNESS_BENCH_API_KEY`，不读取用户秘密；需在同模型/max 下运行 `pnpm bench:agent -- --task long-file-edit --dump`，与旧值 steps=7、toolCalls=8、toolFailures=0、prompt tokens=35,269 对比。
- 偏差：默认上下文采用 1 行（保守值）；若 live 显示 tokens 上升且调用未下降，按 plan 回退默认值，保留窄读提示。
- 未运行：真实 Provider A/B、3 次重复、E2E。结论只能写“已实现”，不能写“已证明更快”。
