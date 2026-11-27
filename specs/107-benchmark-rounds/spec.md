---
id: 107-benchmark-rounds
title: 多轮基准采集脚本
milestone: 发布后
status: done
depends_on: [098-benchmark, 106-search-top-files]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 多轮基准采集脚本

> 状态：`done`（2026-11-27；脚本、单测、Larness/opencode smoke、多轮 session、错误边界、`pnpm check`/`build` 通过；真实 3 轮已完成：Larness 202,232 prompt/106.9s vs opencode 416,106/114.2s，双方 18/18 verify=0）。目标是让“同一任务跑 3 轮、两边取中位数”变成一条命令，而不是手动重复 benchmark/opencode。

## 1. 背景与问题

目前每轮 A/B 都要：

1. 手动跑 `pnpm bench:agent -- --task ... --out ... --dump`；
2. 找输出目录、复制 fixture；
3. 手动跑 opencode CLI（`--standalone` 顺序、`PWD`、session、JSONL 解析）；
4. 手工汇总 steps/toolCalls/tokens/duration/verify。

容易漏步骤、混用目录，也无法快速得到多轮中位数。需要一个脚本：

- Larness 每轮独立目录与 request dump；
- 可选自动跑 opencode 同一 fixture；
- 输出逐轮原始数据 + 汇总中位数；
- 不打印/保存 API Key，不修改源 fixture。

## 2. 目标

- G-1：`pnpm bench:rounds -- [--rounds N] [--task id|all] [--out dir]` 可用。
- G-2：每轮每个任务独立输出目录；Larness 使用现有 runner，保留 `--dump`。
- G-3：`--opencode` 时自动复制 Larness 的 baseline fixture，跑 opencode CLI（`--standalone` 在 `run` 前、`PWD` 指向副本、多轮用 session），解析 steps/toolCalls/failures/tokens/duration/verify/diff。
- G-4：生成 `rounds.json`（逐轮）、`summary.json`（中位数与 verify 通过轮数）、`summary.md`（可读表）。
- G-5：缺 Key/CLI、子进程失败、verify 失败都明确记录，不静默。
- G-6：纯函数（中位数、Larness 聚合、opencode JSONL 解析）有单元测试。

## 3. 非目标

- NG-1：不自动安装依赖、不自动 clone 仓库、不进入 CI。
- NG-2：不改 benchmark fixture、runner 指标口径或 Larness 产品代码。
- NG-3：不做外部真实仓库模式（先用 6 个 fixture；后续扩展）。
- NG-4：不启动/控制 Larness UI，不读用户 Larness 数据目录。
- NG-5：不保存 API Key 到结果/日志。

## 4. 用户故事

- 作为维护者，我希望一条命令跑 3 轮同一组任务，并拿到 Larness/opencode 的中位数和逐轮原始数据，以便判断改动是否真实有效，而不是被单次方差误导。

## 5. 验收场景

### A1 Larness 多轮

```gherkin
Given LARNESS_BENCH_API_KEY 已设置
When 运行 bench:rounds --rounds 2 --task single-file-fix
Then 产生 round-01/、round-02/
And 每轮有 Larness results.json 与 project
And summary.json 有 2 轮中位数
```

### A2 opencode 自动跑

```gherkin
Given --opencode 且 opencode CLI 可用
When 跑 single-file-fix
Then 每轮复制 baseline fixture
And 使用 --standalone 在 run 前、PWD 指向副本
And 解析出 steps/toolCalls/tokens/duration
And 执行对应 verify
```

### A3 多轮 session

```gherkin
Given multi-turn-fix 有两个 prompt
When --opencode 跑该任务
Then 第一轮取得 sessionID
And 第二条 prompt 使用 --session 继续
```

### A4 错误边界

```gherkin
Given 缺 LARNESS_BENCH_API_KEY 或 --opencode 但 CLI 不存在
Then 脚本在启动前失败
And 错误信息指出缺项
And 不产生半套结果
```

### A5 汇总

```gherkin
Given 两轮 metrics
Then summary.json 的 steps/tokens/duration 是中位数
And verifyPass 记录通过轮数
And summary.md 表格包含两边
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 支持 `--rounds`、`--task`、`--out`、`--opencode`、`--opencode-bin`、`--opencode-model`、`--model`、`--effort`、`--no-dump`。 |
| R-2 | MUST | Larness 调用现有 runner，每轮独立目录；结果从 `results.json` 读取。 |
| R-3 | MUST | opencode 解析 JSONL，按 `part.id` 去重 tool calls，step_finish 计步，tokens 分 input/cache/output/reasoning。 |
| R-4 | MUST | 输出 rounds.json、summary.json、summary.md；失败记录 error/verify。 |
| R-5 | MUST | 不输出 Key；不修改源 fixture；不读取用户 Larness 数据。 |
| R-6 | MUST | 纯函数单测；`pnpm check`/`build` 通过。 |

## 7. 接口与契约变更

- 新增根 script：`bench:rounds`。
- 新增开发脚本 `apps/server/scripts/agent-benchmark/rounds.ts` 与 `roundsLib.ts`。
- 不新增 REST/WS/DB/配置或生产依赖。

## 8. 数据与迁移

- 无；输出只写 `--out`（默认仓库 `tmp/agent-benchmark/rounds-*`，gitignored）。

## 9. 安全、权限与审计

- API Key 只从环境继承给 Larness 子进程，不写文件、不打印。
- opencode 使用本机已有 CLI/认证；不读取 Key。
- 不把 fixture 内容或 request dump 提交到仓库。
- 脚本只操作临时目录和用户显式给的 repo/fixture。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 缺 Key | 启动前退出 | 明确缺 `LARNESS_BENCH_API_KEY` |
| opencode CLI 不存在 | 启动前退出（--opencode） | 路径与 `--opencode-bin` 提示 |
| Larness 子进程失败 | 记录 error，继续其它任务/轮 | 该轮 side error |
| verify 失败 | 记录 exitCode，不伪造通过 | summary verifyPass |
| 某侧缺失 | summary 只列有数据的指标 | `—` |
| 超时 | 子进程超时记录 | timeout 信息 |

## 11. 可观测性

- 控制台每轮进度；结果文件保存原始数据。
- 不新增产品事件/日志。

## 12. 测试计划

- `roundsLib.test.ts`：median（奇偶）、Larness 聚合、opencode JSONL 解析、summary。
- fake smoke：`LARNESS_BENCH_FAKE=1 pnpm bench:rounds -- --rounds 1 --task single-file-fix`（仅 Larness）产出 summary。
- `pnpm check`、`pnpm build`。
- 真实 3 轮由用户 Key 执行，不作为 CI。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 默认是否跑 opencode | 否；显式 `--opencode` | 无 |
| 默认 rounds | 3 | 无 |
| 外部 repo 多轮 | 本切片不做 | 后续 |

## 14. 完成定义

- [x] A1–A5 通过（fake/smoke + 单测）；
- [x] `pnpm check`、`pnpm build` 通过；
- [x] 文档/STATUS/ROADMAP/README 更新；
- [x] 真实多轮运行命令写入文档（未自动跑）。
