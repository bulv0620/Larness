# 实施计划：探索效率

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `searchCode` 在生成 `context` 时同时给出 `contextStart`（1-based 起始行），保持现有 `SearchMatch` 字段兼容。
2. `search_code` 工具 schema 把 `contextLines` 默认值设为 1；显式 0 关闭；现有 0–5 范围不变。
3. `searchModelText` 在有 `contextStart` 时按真实行号渲染相邻行，并跳过命中行；非空结果末尾追加一条窄读提示。
4. `SYSTEM_POLICY_BASE` 增加探索约束，`PROMPT_VERSION` 升到 `100-1`。
5. 更新工具描述和 `docs/contracts/agent-command-context.md`。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只加 system prompt | 改动最小 | 模型已忽略类似描述，效果不确定 | 不单独采用 |
| 默认 context 2 行 | 更可能直接编辑 | token 增加更多，复杂文件噪声大 | 先 1 行，benchmark 后再调 |
| 新增 read-around 工具 | 语义最直接 | 新工具、权限、UI、测试成本高 | 不做 |
| 默认 context 1 + 窄读提示 + 探索约束 | 工具就近生效，改动可控 | 仍依赖模型遵循提示 | 采用 |

## 3. 目录与文件变更

```text
新增：
specs/100-exploration-efficiency/{spec,plan,tasks}.md

修改：
packages/resources/src/files/fileService.ts       # SearchMatch.contextStart
packages/agent/src/tools/fileTools.ts              # schema 默认值、模型文本、描述
apps/server/src/modules/agent/contextAssembler.ts # 探索提示、PROMPT_VERSION
packages/agent/test/tools/fileTools.test.ts        # 默认上下文/提示/关闭
packages/agent/test/tools/fileService.test.ts      # contextStart/边界
apps/server/test/agent/contextAssembler.test.ts    # 探索提示
docs/contracts/agent-command-context.md            # 契约说明
specs/ROADMAP.md / specs/README.md / STATUS.md      # 切片登记与收口
```

## 4. 实施步骤

1. 先写失败测试：默认 context、contextStart、contextLines=0、窄读提示、探索提示。
2. 改 `fileService.ts` 的 `SearchMatch` 与 context 生成。
3. 改 `fileTools.ts` 的 schema、`searchModelText`、描述。
4. 改 `contextAssembler.ts` 的探索提示与 `PROMPT_VERSION`。
5. 跑定向测试，再跑 `pnpm check`、`pnpm build`。
6. 更新契约、任务表、STATUS、ROADMAP、README；记录 live benchmark 是否运行。
7. 提交；把任务移入「最近收口」。

## 5. 数据与迁移

- schema：无。
- 兼容：`SearchMatch` 只新增可选字段；旧消费者不受影响。
- 回滚：把 `contextLines` 默认值恢复 0、移除提示与探索约束，`PROMPT_VERSION` 回退。

## 6. 回滚策略

工具层回滚是纯代码回退，无数据迁移；live benchmark 若显示 token 明显上升且调用未下降，优先把默认值改回 0，保留窄读提示。

## 7. 验证命令

```bash
pnpm --filter @larness/agent test:file test/tools/fileTools.test.ts
pnpm --filter @larness/agent test:file test/tools/fileService.test.ts
pnpm --filter @larness/server test test/agent/contextAssembler.test.ts
pnpm check
pnpm build
```

真实 benchmark（需要用户 Key）：

```bash
pnpm bench:agent -- --task long-file-edit --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 默认 context 增加 token | 每次搜索多几行 | 默认 1 行；benchmark 对比 prompt tokens |
| 模型仍大窗口读 | 改动无效 | 结果级窄读提示；A6 复测后决定是否继续 |
| 探索约束过强 | 复杂任务探索不足 | 措辞限定“任务点名文件/路径未知” |
| `contextStart` 与截断不一致 | 行号错位 | 用原始 `index` 计算；单测覆盖首尾/截断 |

## 9. 未决事项

- 默认 1 行是否足够，取决于 A6；未跑 live 时不得声称已改善。
