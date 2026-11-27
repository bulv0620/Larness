---
id: 101-deep-repo-benchmark
title: 更大仓库基准任务：跨模块折扣修复
milestone: 发布后
status: done
depends_on: [098-benchmark, 100-exploration-efficiency]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 更大仓库基准任务：跨模块折扣修复

> 状态：`done`（2026-11-27；fixture、基线与可解性测试、`pnpm check`、`pnpm build` 通过；live A/B 未运行，需用户 Key）。现有 5 个 fixture 都是 4–8 个文件的小任务；100 已把 long-file 拉到 opencode 同级，下一步需要一个更接近真实项目的跨模块任务来暴露剩余差距。

## 1. 背景与问题

098 的 5 个 fixture 能验证单文件、重命名、长文件、连续修复和符号定位，但不能验证：

- 从测试失败出发，跨 3–4 层 import 追踪根因；
- 在一个约 30 文件的结构中区分目标模块与干扰模块；
- 同时修改两个文件才能让行为正确，而不是单点补丁。

没有这类 fixture，formatter/LSP、上下文组织和多文件编辑的收益无法用数据判断。

## 2. 目标

- G-1：新增 `checkout-discount` fixture，约 30 个文件，含 `src/checkout`、`src/pricing`、`src/catalog` 等真实目录和 24 个干扰模块。
- G-2：基线 `node --test` 失败；失败现象只能定位到 `quote`，根因分布在 `src/pricing/discount.js` 与 `src/checkout/quote.js`，必须同时修两个文件才能通过。
- G-3：新增“预期修复后通过”的测试，证明 fixture 可解，避免只验证失败。
- G-4：任务进入现有 runner 的 `--task` / `--task all` / `--print`，不新增 runner 参数。
- G-5：更新 098 协议任务表；真实 Larness/opencode A/B 由用户 Key 执行，未跑时明确记录。

## 3. 非目标

- NG-1：不实现 formatter/LSP、env block、输出续写或 checkpoint。
- NG-2：不改变 runner 的临时 DB、权限、指标或 dump 格式。
- NG-3：不改变现有 5 个 fixture 的内容或 verify。
- NG-4：不引入第三方依赖或网络访问。

## 4. 用户故事

- 作为维护者，我希望有一个中等规模、跨模块的固定任务，用来判断 Larness 在真实项目里是“定位慢/读得多”还是“工具不够”，而不是继续用 4 行小文件猜。

## 5. 验收场景

### A1 基线失败

```gherkin
Given checkout-discount fixture
When 在 Agent 运行前执行 node --test
Then 退出码非 0
And 失败信息指向 quote 的折扣结果
```

### A2 预期修复可通过

```gherkin
Given 把 discount.js 改为按折后金额返回
And 把 quote.js 改为只对商品小计折扣、运费后加
When 执行 node --test
Then 退出码 0
And 3 个 quote 测试全部通过
```

### A3 单点修复不够

```gherkin
Given 只修 discount.js 或只修 quote.js
When 执行 node --test
Then 至少一个 quote 测试仍失败
```

### A4 runner 接线

```gherkin
When 执行 pnpm bench:agent -- --print
Then 输出包含 checkout-discount
When 执行 pnpm bench:agent -- --task checkout-discount
Then 创建 baseline 并运行该 fixture
```

### A5 回归

```gherkin
When 运行现有 benchmark fixture 测试与 pnpm check
Then 5 个旧任务仍失败于基线、1 个新任务失败于基线
And 现有工具/服务测试不受影响
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `tasks.ts` 新增 `checkout-discount`，文件数 ≥ 30。 |
| R-2 | MUST | 基线 verify `node --test` 非 0。 |
| R-3 | MUST | 预期两文件修复后 verify 0；单点修复仍非 0。 |
| R-4 | MUST | 测试覆盖基线与可解性。 |
| R-5 | MUST | 098 协议任务表加入第 6 个任务。 |
| R-6 | MUST | 不新增依赖、REST/WS/DB/配置变更。 |

## 7. 接口与契约变更

- runner 任务清单：新增一个 fixture；接口不变。
- REST / WebSocket / IPC / 配置 / 事件 / 错误码：无。
- 文档：`specs/098-benchmark/protocol.md` 任务表。

## 8. 数据与迁移

- 无 schema、迁移或持久数据变更；fixture 仅在临时目录生成。

## 9. 安全、权限与审计

- 不新增网络、命令或权限路径；verify 仍是本地 `node --test`。
- 不读取用户数据；fixture 在临时目录。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 只修一个文件 | 测试仍失败 | 标准 node --test 输出 |
| 多改无关文件 | 测试仍应通过，但 diff 变大 | 由 diffStat 观察 |
| 无 Key | 只跑离线 fixture 测试 | 明确记录 live 未运行 |

## 11. 可观测性

- 复用 runner 的 steps/toolCalls/toolFailures/tokens/duration/verify/diff。
- 不新增事件或日志。

## 12. 测试计划

- `apps/server/test/benchmark/tasks.test.ts`：所有任务基线失败；新增任务预期修复后通过；单点修复仍失败。
- `pnpm bench:agent -- --print`：包含新任务。
- `pnpm check`、`pnpm build`。
- 真实 A/B：`pnpm bench:agent -- --task checkout-discount --dump`（需要用户 Key）；opencode 侧按 protocol。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 任务是否需要脚本额外校验 | 不需要，3 个行为测试足够 | 实现后按 fixture 结果 |
| 文件数 30 是否足够 | 先 30，观察探索路径再调 | benchmark 结果 |

## 14. 完成定义

- [x] A1–A5 通过；
- [x] `pnpm check`、`pnpm build` 通过；
- [x] 098 协议与 STATUS/ROADMAP/README 更新；
- [x] live A/B 已记录未运行原因（当前会话无 Key；命令已写入 tasks）。
