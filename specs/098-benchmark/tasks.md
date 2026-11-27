# 任务：Agent 基准任务与请求级 A/B

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| BM-1 | 5 个任务 fixture 与基线测试 | 097 | `done` |
| BM-2 | Larness runner、指标与 request dump | BM-1 | `done` |
| BM-3 | A/B 协议、验证与收口 | BM-2 | `done` |

## 任务卡

### BM-1 5 个任务 fixture 与基线测试

- 状态：`done`
- 目标：单文件修复、跨文件重构、长文件编辑、多轮修复、符号定位；fixture 基线 verify 失败。
- 交付物：`tasks.ts`、`tasks.test.ts`。
- 验收：A1；文件/路径/verify 正确。
- 测试：`pnpm --filter @larness/server test test/benchmark/tasks.test.ts`。

### BM-2 Larness runner、指标与 request dump

- 状态：`done`
- 目标：临时 DB/项目、真实 Provider adapter、TurnRunner、事件指标、verify/diff、`--dump`/`--print`。
- 交付物：`agent-benchmark.ts`、`package.json` script。
- 验收：A2/A3/A5。
- 测试：typecheck + 手动 `--print`；真实运行需 Key。

### BM-3 A/B 协议、验证与收口

- 状态：`done`
- 目标：protocol.md；`pnpm check`/`pnpm build`；状态/路线图。
- 交付物：文档与验收记录。

## 验收记录

（完成后填写：fixture 测试、`pnpm check`、`pnpm build`、未运行项、偏差。）

### 2026-11-27（macOS arm64）

- fixture 基线：`apps/server/test/benchmark/tasks.test.ts` 5 项通过，5 个任务在 Agent 运行前 verify 均非 0。
- runner：`pnpm bench:agent -- --print` 退出 0；无 Key 运行退出 1 且不发网络；`LARNESS_BENCH_FAKE=1` 的 `single-file-fix` smoke 得到 `COMPLETED`、verify=0、1 次工具调用、diff `+1 -1`。
- 整仓：`pnpm check` 退出码 0（web 55 文件 / 322 项、agent 72 项 + 1 跳过、server 185 文件 / 997 项 + 14 跳过）；`pnpm build` 退出码 0。
- 未运行：真实 Provider A/B（无 Key）、opencode 侧手动运行。协议见 [protocol](protocol.md)。
- 偏差：runner 的 `steps/tokens` 来自 `model.usage`；fake adapter 不产生 usage，因此 smoke 中为 0。真实运行会记录。
