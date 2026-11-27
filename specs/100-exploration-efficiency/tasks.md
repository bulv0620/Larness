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
- A6 live 复测（2026-11-27，同模型/max）：**两次均改善且稳定**。

| 指标 | 100 前 | 第 1 次 | 第 2 次 | 两次中位数 |
|---|---:|---:|---:|---:|
| steps | 7 | **5** | **5** | **5** |
| toolCalls | 8 | **5** | **5** | **5** |
| toolFailures | 0 | 0 | 0 | 0 |
| prompt tokens | 35,269 | 23,048 | 22,620 | **22,834** |
| durationMs | 13,267 | 10,008 | 10,134 | **10,071** |
| verify | 0 | 0 | 0 | 0 |

- 第 1 次序列：`search_code`（3 命中，带 299/301 上下文）→ `read_file` 290–309（20 行）→ `read_file` test → `edit` → `run_command`。
- 第 2 次序列：`search_code` → `list_files` → `read_file` 295–304（10 行）→ `edit` → `run_command`；`list_files` 回来了，但省掉了读 test、重复搜索和 package.json，总调用仍为 5。
- 两次都命中搜索上下文（299/301 或 299/301 附近），读取窗口从 60 行降到 10–20 行；旧序列的重复 `search_code`、`package.json` 读取和 60 行读取均未出现。
- 说明：n=2，结果稳定在同一步数/调用数；仍建议全任务复测确认其它任务没有 token 回退。
- 未运行：全任务复测、第 3 次重复、E2E。
