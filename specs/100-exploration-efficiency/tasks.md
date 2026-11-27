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
- A6 live 复测（2026-11-27，同模型/max，n=1）：**改善**。

| 指标 | 100 前 | 100 后 |
|---|---:|---:|
| steps | 7 | **5** |
| toolCalls | 8 | **5** |
| toolFailures | 0 | 0 |
| prompt tokens | 35,269 | **23,048** |
| durationMs | 13,267 | **10,008** |
| verify | 0 | 0 |

- 新序列：`search_code`（3 命中，带 299/301 上下文）→ `read_file` 290–309（20 行）→ `read_file` test → `edit` → `run_command`。旧序列中的 `list_files`、重复 `search_code`、`package.json` 读取和 60 行读取都没有再出现。
- 说明：单次复测，改善与目标机制一致（少 2 步/3 调用，tokens -35%，耗时 -25%）；仍需 3 次重复确认方差。
- 未运行：全任务复测、3 次重复、E2E。
