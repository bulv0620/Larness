# 实施计划：多轮基准采集脚本

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `roundsLib.ts`：
   - `median(values)`
   - `aggregateLarness(result)`（多 prompt 求和，input 含 cache）
   - `parseOpenCodeJsonl(text)`（去重 tool part、step_finish、tokens）
   - `summarizeSides(rounds)`（中位数、verifyPass）
   - `renderMarkdown(summary)` / `renderCsv`
2. `rounds.ts`：
   - 解析参数、选择 `TASKS`；
   - 每轮每任务 spawn 现有 benchmark runner；
   - `--opencode` 时复制 Larness 的 baseline project，跑 opencode CLI；
   - 输出 `rounds.json`、`summary.json`、`summary.md`、`summary.csv`。
3. 根 package script `bench:rounds`。
4. 测试纯函数；fake smoke 验证 CLI。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Bash 循环 | 简单 | JSON/中位数/opencode 解析难 | 不做 |
| 扩展 runner 内部多轮 | 无子进程 | 与 opencode/外部进程耦合 | 不做 |
| Node/TS 编排 + 纯函数库 | 可测、可移植 | 代码稍多 | 采用 |
| 只跑 Larness | 简单 | 仍要手动 A/B | 加可选 opencode |

## 3. 目录与文件变更

```text
新增：
specs/107-benchmark-rounds/{spec,plan,tasks}.md
apps/server/scripts/agent-benchmark/rounds.ts
apps/server/scripts/agent-benchmark/roundsLib.ts
apps/server/test/benchmark/roundsLib.test.ts

修改：
package.json                                  # bench:rounds
specs/098-benchmark/protocol.md                # 多轮命令
specs/ROADMAP.md / specs/README.md / STATUS.md # 登记
```

## 4. 实施步骤

1. 写 `roundsLib.test.ts` 的失败测试（median/聚合/JSONL）。
2. 实现 `roundsLib.ts`。
3. 实现 `rounds.ts` CLI 与子进程编排。
4. 跑 fake smoke（1 轮 single-file-fix）。
5. 跑 `pnpm check`、`pnpm build`。
6. 更新协议/状态；提交。
7. 用户用真实 Key 跑 3 轮。

## 5. 数据与迁移

- 无；结果目录 gitignored。

## 6. 回滚策略

删除 script/package 入口即可；不影响 runner。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/benchmark/roundsLib.test.ts
LARNESS_BENCH_FAKE=1 pnpm bench:rounds -- --rounds 1 --task single-file-fix --out /private/tmp/larness-rounds-smoke
pnpm check
pnpm build
```

真实：

```bash
pnpm bench:rounds -- --rounds 3 --task all --opencode
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 子进程输出大 | 内存 | maxBuffer 64MB；JSONL 落文件 |
| opencode 版本差异 | 解析失败 | 解析失败记录 error，不中断 |
| 采样时间长 | 3×6×2 轮很久 | 允许 --task/--rounds 限制 |
| Key 泄漏 | 严重 | 只继承 env，不打印/落盘 |

## 9. 未决事项

- 是否默认 3 轮；已按协议默认 3。
- 外部 repo 多轮留待 108。
