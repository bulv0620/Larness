# 实施计划：宽搜索目录摘要

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `searchCode` 达到 `limit` 后不再停止：继续遍历文件，但只累加 `directoryCounts`，不追加 `matches`。
2. 目录分组函数：
   - `apps/<name>/**` → `apps/<name>`
   - `packages/<name>/**` → `packages/<name>`
   - 其他路径 → 第一段；根文件 → `(root)`
3. `SearchCodeResult` 增加 `directories`，按 count 降序、path 升序。
4. `searchModelText` 在 `truncated || scannedFiles > 200` 时追加 Top 5 与 `path=` 提示。
5. `globToRegExp`：不含 `/` 的 glob 加 `(?:.*/)?` 前缀，使 `*.ts` 递归匹配；含 `/` 的 glob 不变。
6. `maxFiles` 预算仍会停止扫描；`scanBudgetExhausted` 逻辑保持。
7. 不修改 schema/prompt/权限。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只改 prompt | 简单 | 103 已证明会带偏 | 不做 |
| 只统计已返回的 50 条 | 无额外扫描 | 可能看不到 packages/agent | 不做 |
| 继续扫描计数 | 分布完整 | 宽搜多读文件 | 采用，受 maxFiles 限制 |
| 新增目录索引/LSP | 更准 | 成本高 | 后续再评估 |

## 3. 目录与文件变更

```text
新增：
specs/104-search-directory-summary/{spec,plan,tasks}.md

修改：
packages/resources/src/files/fileService.ts   # 继续扫描 + directories
packages/agent/src/tools/fileTools.ts          # modelText Top dirs
packages/agent/test/tools/fileService.test.ts  # 统计/预算/分组
packages/agent/test/tools/fileTools.test.ts    # 摘要/小搜索
docs/contracts/agent-command-context.md        # 契约
specs/ROADMAP.md / specs/README.md / STATUS.md  # 登记
```

## 4. 实施步骤

1. 先写失败测试：三目录、limit=1 的 Top dirs；小搜索不提示；预算。
2. 改 `searchCode`：计数、继续扫描、返回 directories。
3. 改 `searchModelText`：Top dirs ≤5 + path 提示。
4. 跑定向测试、`pnpm check`、`pnpm build`。
5. 更新合同/状态；提交。
6. 用户用 102 的真实任务复测。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

恢复 limit 处停止与删除 directories 即可；无数据影响。

## 7. 验证命令

```bash
pnpm --filter @larness/agent exec vitest run test/tools/fileService.test.ts test/tools/fileTools.test.ts
pnpm check
pnpm build
```

真实复测：

```bash
pnpm bench:agent -- \
  --repo /private/tmp/larness-real-task \
  --prompt "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id larness-edit-arg-repair-104 \
  --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 宽搜扫描变慢 | 延迟增加 | maxFiles 2000 + 只计数不存内容 |
| 目录名太粗 | 仍难以选择 | apps/packages 二级；后续可细分 |
| Top dirs 增加 token | 少量开销 | 只列 5 个 |
| 结果预算 | 不受影响 | directories 是计数，不含文件内容 |

## 9. 未决事项

- 是否需要在目录摘要中显示 `src/test` 分布，待真实复测。
