# 实施计划：流式启动 L0 只读工具

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

在 `TurnRunner` 每个 step 的流循环前创建 `prefetched: Map<string, Promise<ToolExecutionOutcome>>`。收到 `tool-call` chunk 时，先按 `L0 + requiresProjectLock:false + allow + budget ok + 未禁用 + <8` 判断，符合条件立即 `execute` 并存入 Map。

流结束后仍走现有序列循环；该循环按 `toolRequests` 顺序消费 Promise，失败则回退到 `execute`。旧的“整批纯读结束后预取”块删除。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持 step 结束后预取 | 改动最小 | 不重叠模型流 | 当前，优化掉 |
| 事件到达即启动所有工具 | 最快 | 写工具顺序/锁/审批风险 | 否决 |
| 只提前 L0/无锁/allow | 安全、收益明确 | 混合批次只读部分提前 | **采用** |
| 混合批次全并发 | 最快 | read→patch 依赖被破坏 | 否决 |

## 3. 目录与文件变更

```text
新增：
  specs/097-streaming-reads/{spec,plan,tasks}.md
修改：
  apps/server/src/modules/agent/turnRunner.ts     # 流内预取
  packages/agent/src/tools/fileTools.ts           # L0 文件工具 requiresProjectLock:false
  apps/server/test/agent/turnRunner.test.ts       # 流式/串行/只执行一次
  packages/agent/test/tools/fileTools.test.ts     # L0 元数据
  specs/081-agent-lean/spec.md                    # 日期修订
  specs/README.md / specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

1. 写红测试：流未结束时 L0 handler 已启动；同批 L1 写未启动；结束后写执行；结果只执行一次。
2. 在 `turnRunner` 流循环内实现 `prefetch`；删除旧批后预取。
3. `fileTools.ts` 三个 L0 工具显式 `requiresProjectLock: false`。
4. 跑定向、`pnpm check`、`pnpm build`；更新 081/状态/文档。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

移除流内 `prefetch` 调用，恢复批后预取；`requiresProjectLock:false` 可保留或回退。无数据影响。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/turnRunner.test.ts
pnpm --filter @larness/agent test test/tools/fileTools.test.ts
pnpm check
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 预取在流失败后继续 | 浪费/日志噪声 | 仅 L0 无副作用；信号取消 |
| 消费顺序错乱 | 消息配对错误 | 仍按 toolRequests 顺序消费 |
| 写工具被提前 | 依赖/锁风险 | eligibility 明确排除非 L0 |
| 预取失败重复执行 | 读工具幂等 | 仅 L0；失败回退串行 |

## 9. 未决事项

- 混合批次写并发：不做，依赖顺序。
