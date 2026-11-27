# 实施计划：精确标识符优先

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `SYSTEM_POLICY_BASE` 增加一条探索策略：
   - 从请求里的字段/函数/文件开始；
   - 不先搜邻近错误码/宽泛概念；
   - 已知包/目录时用 path/glob；
   - 大扫描是收窄信号。
2. `PROMPT_VERSION` 改为 `103-1`。
3. `searchModelText` 增加常量 `BROAD_SEARCH_FILES = 200`；当 `scannedFiles > 200` 时追加：
   `Broad scan: N files scanned. Narrow with path/glob, or search the exact identifier from the request.`
4. 工具描述补一句“大范围搜索先收窄”。
5. 更新合同文档。
6. 真实复测 102 的 Larness 099 任务。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只改 system prompt | 改动最小 | 模型可能仍宽搜 | 与结果提示一起做 |
| 只加 broad hint | 贴近工具 | 首次搜索仍可能宽 | 一起做 |
| 自动给 query 加 path | 最省事 | 猜错路径、改变语义 | 不做 |
| 降 maxFiles 默认值 | 强制收窄 | 可能漏结果 | 不做 |

## 3. 目录与文件变更

```text
新增：
specs/103-exact-identifier-search/{spec,plan,tasks}.md

修改：
packages/agent/src/tools/fileTools.ts              # broad hint + description
apps/server/src/modules/agent/contextAssembler.ts  # system policy + prompt version
packages/agent/test/tools/fileTools.test.ts         # broad/small search tests
apps/server/test/agent/contextAssembler.test.ts     # exact search policy
docs/contracts/agent-command-context.md             # contract
specs/ROADMAP.md / specs/README.md / STATUS.md       # 切片登记
```

## 4. 实施步骤

1. 先写失败测试：system prompt 约束、201 文件宽扫提示、小扫描不提示。
2. 实现 prompt 与 `searchModelText`。
3. 跑定向测试、`pnpm check`、`pnpm build`。
4. 更新合同与状态。
5. 提交；请用户用 102 的真实任务复测。
6. 记录前后调用/tokens/耗时。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

恢复 prompt 文本/版本与 broad hint 即可；无数据影响。

## 7. 验证命令

```bash
pnpm --filter @larness/agent exec vitest run test/tools/fileTools.test.ts
pnpm --filter @larness/server test test/agent/contextAssembler.test.ts
pnpm check
pnpm build
```

真实复测：

```bash
pnpm bench:agent -- \
  --repo /private/tmp/larness-real-task \
  --prompt "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id larness-edit-arg-repair \
  --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| prompt 太长 | 固定开销增加 | 只加一条，约 200 字符 |
| 宽扫提示被忽略 | 无改善 | 真实复测决定是否加强 |
| 阈值 200 不合适 | 小仓库提示过多/大仓库不提示 | 按复测调整 |
| 模型过度收窄 | 漏文件 | 提示 path/glob 而非硬限制 |

## 9. 未决事项

- 真实复测是否改善，待用户 Key。
