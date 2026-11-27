# 任务：多轮基准采集脚本

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| BR-1 | [多轮采集脚本与汇总](tasks.md#br-1-多轮采集脚本与汇总) | 098 | `in_progress` |

## 任务卡

### BR-1 多轮采集脚本与汇总

- 状态：`in_progress`
- 依赖：098
- 目标：一条命令跑 N 轮 Larness，可选自动跑 opencode，输出逐轮与中位数。
- 交付物：
  - `roundsLib.ts` + 单测；
  - `rounds.ts` CLI；
  - 根 `bench:rounds` script；
  - 协议/状态文档。
- 验收：
  - spec A1–A5；
  - fake smoke 成功；
  - `pnpm check`、`pnpm build`。
- 测试：
  - `pnpm --filter @larness/server test test/benchmark/roundsLib.test.ts`
  - `LARNESS_BENCH_FAKE=1 pnpm bench:rounds -- --rounds 1 --task single-file-fix --out /private/tmp/larness-rounds-smoke`
- 涉及路径：
  - `apps/server/scripts/agent-benchmark/rounds.ts`
  - `apps/server/scripts/agent-benchmark/roundsLib.ts`
  - `apps/server/test/benchmark/roundsLib.test.ts`
  - `package.json`
- 备注：不打印 Key；opencode 默认关闭。

## 验收记录

### 2026-11-27（macOS arm64）

- `roundsLib.test.ts` 5 项通过：median、Larness 聚合、opencode JSONL 去重/统计、session 提取、中位数汇总。
- fake smoke（Larness only）：`--rounds 2 --task single-file-fix` 生成 round-01/02、summary.json/md/csv；steps=4、calls=3、verifyPass=2/2。
- fake smoke（Larness + opencode）：`single-file-fix` 两边 verify=0；opencode steps=6/calls=7/tokens=45,359（含启动耗时）。
- 多轮续接 smoke：`multi-turn-fix` + `--opencode` 生成 prompt-1/2；opencode 两轮 verify=0（10 steps/12 calls），证明 `--session` 续接与解析生效。
- 错误边界：缺 `LARNESS_BENCH_API_KEY` 退出 1 并提示；`--opencode` 指向不存在 CLI 退出 1 并提示；无 stack trace。
- `pnpm check` 退出码 0（web 322、agent 77+1 跳过、server 1011+14 跳过）；`pnpm build` 通过。
- 真实 3 轮：**未运行**，需用户 Key；命令见 [protocol](specs/098-benchmark/protocol.md#31-多轮采集脚本107)。
- 未运行：真实 3 轮、E2E。
