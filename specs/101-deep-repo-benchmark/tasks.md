# 任务：更大仓库基准任务

> 状态：`done`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| DRB-1 | [checkout-discount fixture 与测试](tasks.md#drb-1-checkout-discount-fixture-与测试) | 098、100 | `done` |

## 任务卡

### DRB-1 checkout-discount fixture 与测试

- 状态：`done`
- 依赖：098、100
- 目标：新增约 30 文件、两文件修复的跨模块任务，基线失败、预期修复通过、单点修复仍失败。
- 交付物：
  - `TASKS` 新增 `checkout-discount`；
  - 24 个干扰模块；
  - `tasks.test.ts` 的基线/可解性/单点修复测试；
  - 098 协议任务表。
- 验收：
  - spec A1–A5；
  - `pnpm check`、`pnpm build`；
  - live A/B 未运行原因记录。
- 测试：
  - `pnpm --filter @larness/server test test/benchmark/tasks.test.ts`
  - `LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --print`
  - `pnpm check`、`pnpm build`
- 涉及路径：
  - `apps/server/scripts/agent-benchmark/tasks.ts`
  - `apps/server/test/benchmark/tasks.test.ts`
  - `specs/098-benchmark/protocol.md`
- 备注：单点修复测试用于证明任务不能被一行补丁糊过去。

## 验收记录

### 2026-11-27（macOS arm64）

- fixture：`checkout-discount` 共 31 个文件（核心链 6 + 干扰模块 24 + package/AGENTS），基线 `node --test` 失败；两文件预期修复后 3 个测试全过；只修 `discount.js` 或只修 `quote.js` 均仍失败。
- `apps/server/test/benchmark/tasks.test.ts`：10 项通过（原 5 个基线 + 新 fixture 基线 + 文件数 + 可解性 + 2 个单点失败）。
- `pnpm --silent bench:agent -- --print`：输出 6 个任务，`checkout-discount` files=31。
- 整仓：`pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 1002+14 跳过）；`pnpm build` 退出码 0。
- live A/B（2026-11-27，n=1，同模型/max）：

| 指标 | Larness | opencode |
|---|---:|---:|
| steps | 6 | 8 |
| toolCalls | 12 | 12 |
| toolFailures | 1（修改前测试失败） | 0（shell 非零退出不计 error） |
| prompt tokens | 37,409 | 75,253（input 8,565 + cache 66,688） |
| output tokens | 1,289 | 1,122（含 reasoning 274） |
| duration | 18.8s | 18.7s |
| verify | 0 | 0 |
| diff | 2 文件 +1/-1 | 同左 |

- 两边都追踪到 `discount.js` 和 `quote.js`，没有改错文件，也没有需要 formatter/LSP 的信号。
- Larness 工具序列：list_files → 跑测试 → 读 test/quote/discount/subtotal/shipping → search_code → 读 package.json → 2 次 edit → 跑测试；其中 list/search/package 是探索开销，但总调用仍与 opencode 持平。
- opencode 工具序列：shell(ls/find) → 读 test → shell(find/git) → 读 4 文件 → shell(测试) → grep → 2 次 edit → shell(测试+diff)。
- 结论：这个 31 文件任务上两边同级；Larness 步数和上下文更少，未暴露新的产品差距。n=1，仍需重复确认。
- 偏差：新增任务未改变现有 5 个 fixture；`--task all` 现在包含 6 个任务，旧 5 任务历史指标仍可比。
- 未运行：Larness/opencode 第 2 次重复、`--task all` 新基线、E2E。
