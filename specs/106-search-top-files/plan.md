# 实施计划：宽搜索 Top files 摘要

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `searchCode` 在扫描时同时累加 `fileCounts: Map<path, number>`。
2. `SearchCodeResult` 增加 `files: SearchFileCount[]`，按 matches 降序、path 升序。
3. `searchModelText` 在 `truncated || scannedFiles > 200` 时：
   - 先输出 Top dirs（已有）；
   - 再按 Top 3 目录各取代表文件：优先 `src/` 内命中最多文件，没有则取该目录命中最多文件，输出 `Top files: ...`；
   - 追加 `Use path=<dir> or read the matching file window to narrow.`
4. 不改 prompt、schema、权限、limit 或 maxFiles。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 全局 Top files 5 | 简单 | apps/server 可能占满，看不到 packages/agent | 不做 |
| 每个 Top dir 取一个代表文件 | 保证每个主要目录可见 | 可能不是全局最大 | 采用 |
| 只给 Top dirs | 已有 | 还差一层文件 | 不做 |
| 自动读文件 | 最省调用 | 越权/内容预算/不可控 | 不做 |

## 3. 目录与文件变更

```text
新增：
specs/106-search-top-files/{spec,plan,tasks}.md

修改：
packages/resources/src/files/fileService.ts   # fileCounts/files
packages/agent/src/tools/fileTools.ts          # Top files 文本
packages/agent/test/tools/fileService.test.ts  # 计数/代表
packages/agent/test/tools/fileTools.test.ts    # 文本/小搜索
docs/contracts/agent-command-context.md        # 契约
specs/ROADMAP.md / specs/README.md / STATUS.md  # 登记
```

## 4. 实施步骤

1. 先写失败测试：files 计数、Top files 文本、小搜索不提示。
2. 改 `searchCode` 与 `searchModelText`。
3. 跑定向测试、`pnpm check`、`pnpm build`。
4. 更新合同/状态；提交。
5. 用户复测 099 真实任务。
6. 记录读取次数/调用/tokens；决定收口或调整。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

删除 `files` 与 Top files 文本即可；无数据影响。

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
  --id larness-edit-arg-repair-106 \
  --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Top files 增加 token | 少量 | 最多 3 个 |
| 代表文件不是目标 | 无效 | Top dirs 仍在；可再搜 |
| 路径太长 | 噪声 | 只给相对路径 |

## 9. 未决事项

- 是否在真实复测后改为每目录 2 个文件，待数据。
