# 实施计划：Agent 基准任务与请求级 A/B

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

新增 `apps/server/scripts/agent-benchmark/`：

- `tasks.ts`：5 个任务定义（prompts/files/verify）与 `seedTask`；
- `agent-benchmark.ts`：CLI，生成 fixture、临时 DB、`TurnRunner`、真实 Provider adapter（环境变量 Key）、事件指标、verify、diff、可选 request dump；
- `protocol.md`：Larness/opencode 手动 A/B 步骤。

Runner 复用产品 `TurnRunner`、`createFileToolRegistry`、`createCommandTool`/`createShellTool`/`createPlanTool`、`CommandManager`，不复制执行逻辑。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只写文档协议 | 零代码 | 无法自动记录指标/请求 | 否决 |
| 全自动 opencode A/B | 最省事 | CLI/版本/认证差异大 | 后续 |
| Larness runner + 手动 opencode | 可落地、指标可比 | opencode 侧手动 | **采用** |
| 基准结果提交仓库 | 可追踪 | 噪声/秘密/体积 | 否决；只落 tmp |

## 3. 目录与文件变更

```text
新增：
  apps/server/scripts/agent-benchmark/tasks.ts
  apps/server/scripts/agent-benchmark/agent-benchmark.ts
  apps/server/test/benchmark/tasks.test.ts
  specs/098-benchmark/{spec,plan,tasks,protocol}.md
修改：
  package.json（bench:agent）
  specs/README.md / specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

1. 定义 5 个任务与 `seedTask`；写 fixture 基线失败测试。
2. 实现 runner：临时 DB/项目、Provider adapter、TurnRunner、事件指标、verify、diff。
3. 实现 `--print` / 无 Key 失败 / `--dump`。
4. 写 A/B 协议。
5. 跑 fixture 测试、`pnpm check`、`pnpm build`；更新状态。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

删除脚本/任务/测试与 package script；无产品影响。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/benchmark/tasks.test.ts
pnpm --filter @larness/server typecheck
pnpm exec biome check <changed files>
pnpm check
pnpm build
pnpm bench:agent -- --print
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 真实模型调用慢/贵 | 本地运行成本 | 默认 5 任务、逐任务输出；用户自选 |
| 基准任务过拟合 | 结果不可泛化 | 5 类不同能力；后续扩展 |
| dump 含 fixture 内容 | 本地信息 | 默认关闭、0600、tmp |
| 临时 Provider 端口/模型差异 | 指标偏差 | 记录 model/endpoint/effort；同一参数对比 |

## 9. 未决事项

- opencode 自动化：后续。
- 更多任务/统计：后续。
