# 实施计划：更大仓库基准任务

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

在 `tasks.ts` 增加 `checkout-discount`：

- 核心链：`test/quote.test.js` → `src/checkout/quote.js` → `src/pricing/subtotal.js` / `src/pricing/discount.js` / `src/checkout/shipping.js`。
- 两个缺陷：
  1. `discount.js` 返回折扣金额而不是折后金额；
  2. `quote.js` 把运费也纳入折扣基数。
- 干扰模块：`src/catalog/*`、`src/orders/*`、`src/users/*`、`src/notifications/*` 等 24 个无依赖的小模块，形成约 30 文件结构。
- 测试：基线失败、两文件修复通过、只修一个仍失败。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只把现有 fixture 复制到更多文件 | 改动小 | 干扰无意义，不能测真实追踪 | 不做 |
| 新增 30 文件、单点 bug | 易解 | 不能测跨文件协同 | 不做 |
| 新增 30 文件、两文件 bug | 能测追踪与多文件编辑 | fixture 代码稍多 | 采用 |
| 引入真实开源仓库快照 | 最真实 | 体积/依赖/许可/网络不可控 | 不做 |

## 3. 目录与文件变更

```text
新增：
specs/101-deep-repo-benchmark/{spec,plan,tasks}.md

修改：
apps/server/scripts/agent-benchmark/tasks.ts       # checkout-discount + 干扰模块
apps/server/test/benchmark/tasks.test.ts           # 基线 + 可解性 + 单点失败
specs/098-benchmark/protocol.md                    # 第 6 个任务
specs/ROADMAP.md / specs/README.md / STATUS.md      # 切片登记
```

## 4. 实施步骤

1. 先写失败测试：新任务基线失败、预期修复通过、单点修复失败。
2. 在 `tasks.ts` 增加 fixture 和 24 个干扰模块。
3. 跑 `tasks.test.ts`；修正 fixture 代码直到三个断言符合预期。
4. 跑 `pnpm bench:agent -- --print` 确认任务出现。
5. 跑 `pnpm check`、`pnpm build`。
6. 更新协议、ROADMAP、README、STATUS；记录 live 未运行。
7. 提交并等待用户跑 live A/B。

## 5. 数据与迁移

- 无 schema/迁移。
- fixture 只在临时目录 seed；不写用户数据。

## 6. 回滚策略

删除 `checkout-discount` 任务与对应测试即可；不影响现有 5 个 fixture。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/benchmark/tasks.test.ts
LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --print
pnpm check
pnpm build
```

真实运行：

```bash
pnpm bench:agent -- --task checkout-discount --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 两文件 bug 太隐晦 | 模型无法从测试定位 | 测试断言输出明确，文件链短（3 层） |
| 干扰模块太多 | 搜索噪声过大 | 目录命名清晰，目标符号唯一 |
| fixture 代码写错 | 基线/修复行为不稳定 | 三个 fixture 测试覆盖 |
| 任务过大 | 单次 benchmark 成本高 | 只加 1 个任务；文件都很短 |

## 9. 未决事项

- 真实 A/B 结果是否能暴露 formatter/LSP 需求，待用户运行。
