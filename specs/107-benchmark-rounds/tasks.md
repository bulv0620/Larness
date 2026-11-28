# 任务：多轮基准采集脚本

> 状态：`done`（2026-11-27，BR-1 收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| BR-1 | [多轮采集脚本与汇总](tasks.md#br-1-多轮采集脚本与汇总) | 098 | `done`（2026-11-27） |

## 任务卡

### BR-1 多轮采集脚本与汇总

- 状态：`done`（2026-11-27）
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
- 真实 3 轮（2026-11-27，6 任务，两边各 18 次运行）：全部 verify 3/3。

| 指标（6 任务中位数之和） | Larness | opencode |
|---|---:|---:|
| steps | 38 | 37 |
| toolCalls | 55 | 57 |
| toolFailures | 4（修改前测试） | 0（shell 非零不计 error） |
| prompt tokens | 202,232 | 416,106 |
| 非缓存输入 | 20,052 | 56,232 |
| output tokens | 6,011 | 6,451 |
| duration | 106.9s | 114.2s |

- 完成度：两边 18/18 轮 verify=0；Larness 的 4 次失败是单文件/checkout/multi-turn 的修改前测试，不是工具错误。
- 上下文：Larness prompt 为 opencode 的 48.6%，非缓存输入为 35.7%。
- 速度：总中位数快 6.5%；6 个任务中 4 个更快（single/long/checkout/search），cross +1.6s、multi +4.8s。
- 结论：这组合成任务上 Larness 已达到“完成度同级、步骤/调用同级、速度略快、上下文约一半”；不再是“明显更笨/更慢”。
- 2026-11-27 基准阶段收口：不再新增外部仓库多轮 108；保留 `bench:rounds` 作为回归工具，后续由真实项目中的具体痛点驱动。
