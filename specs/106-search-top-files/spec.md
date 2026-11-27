---
id: 106-search-top-files
title: 宽搜索 Top files 摘要
milestone: 发布后
status: dropped
depends_on: [104-search-directory-summary]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 宽搜索 Top files 摘要

> 状态：`dropped`（2026-11-27；实机 13 步/19 调用/269,324 input/61.6s，较 104 的 12/17/248,490/53.5s 回退；已回退 `files`/Top files 文本）。104 把真实仓库从 23 调用降到 17，但模型仍读整 `fileTools.ts`/整测试；Top dirs 只告诉它包，没告诉它文件。

## 1. 背景与问题

104 的真实 099 任务首次搜索 `expectedVersion` 后，Top dirs 已显示 `packages/agent (23)`，模型因此没有再去 `apps/server`。但它仍：

- 读完整 `fileTools.ts`（411 行，分两段）；
- 读完整 `fileTools.test.ts`（379 行）；
- 读 `types.ts`、`package.json`；
- 共 4 次读取。

Top dirs 只到包目录，模型还需要在 `packages/agent` 里继续找文件。若摘要给出命中最多的文件，模型可以直接读该文件的小窗口。

## 2. 目标

- G-1：`searchCode` 统计每个文件的命中数，新增 `files: Array<{ path, matches }>`。
- G-2：模型文本在截断或扫描 >200 文件时，除 Top dirs 外再给 Top files；每个主要目录优先取 `src`/非测试文件，没有则取命中最多文件，最多 3 个。
- G-3：Top files 只含项目相对路径和计数，不含文件内容。
- G-4：小搜索/空结果不追加 Top files。
- G-5：不改变搜索语义、limit、maxFiles、glob、权限或结果预算。
- G-6：真实 099 任务复测，记录读取次数/调用/tokens/耗时。

## 3. 非目标

- NG-1：不改 prompt/PLAN_POLICY。
- NG-2：不自动读取文件内容或自动选 path。
- NG-3：不做 LSP/符号索引/排序。
- NG-4：不新增工具、REST/WS/DB/迁移或依赖。

## 4. 用户故事

- 作为在 Monorepo 里使用 Larness 的开发者，我希望搜索被截断时看到“哪个文件命中最多”，这样我可以直接读那个文件的命中窗口，而不是整文件。

## 5. 验收场景

### A1 Top files

```gherkin
Given apps/server/test/a.ts 有 2 个 needle、packages/agent/src/b.ts 有 1 个 needle
When search_code(query="needle", limit=1)
Then files 包含 a.ts:2、b.ts:1
And modelText 包含 "Top files:" 与两个文件路径
```

### A2 目录代表性

```gherkin
Given apps/server 同时有 test/a.ts（2 命中）和 src/c.ts（1 命中）
When search_code 截断
Then Top files 优先列 src/c.ts
And Top files 最多列 3 个
```

### A3 小搜索不提示

```gherkin
Given 只有 2 个文件命中且未截断
Then modelText 不包含 "Top files:"
```

### A4 现有行为

```gherkin
When 运行现有 search 测试
Then 目录统计、glob、limit、context、预算行为不变
```

### A5 真实复测

```gherkin
Given 104 的 Larness 099 真实任务
When 重跑
Then 记录读取次数/update_plan/toolCalls/tokens/duration
And verify=0、diff 仅 fileTools.ts
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `SearchCodeResult` 增加 `files` 计数。 |
| R-2 | MUST | 模型文本在截断/宽扫时给 Top files（≤3，目录代表）；优先 `src`/非测试文件。 |
| R-3 | MUST | 小搜索/空结果不追加。 |
| R-4 | MUST | 不改变权限、schema、忽略规则、limit 或结果预算。 |
| R-5 | MUST | 更新合同与测试。 |
| R-6 | MUST | 真实 099 任务复测并记录。 |

## 7. 接口与契约变更

- `SearchCodeResult`：新增 `files: SearchFileCount[]`。
- 模型文本：新增 `Top files:` 行。
- 工具参数/权限/风险级别：不变。
- 同步更新 `docs/contracts/agent-command-context.md`。

## 8. 数据与迁移

- 无。

## 9. 安全、权限与审计

- 只统计项目相对路径与匹配数，不新增文件内容读取或路径权限。
- 仍受 project root、忽略规则、maxFiles 约束。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 0 命中 | files 为空，不追加 | No matches |
| 截断 | files 计数完整（受 maxFiles） | Top files |
| 根文件 | 路径直接显示 | `(root)` 仅用于目录统计 |
| 深层同名文件 | 显示项目相对路径 | 无歧义 |

## 11. 可观测性

- 复用 `tool.completed` data/modelText；不新增事件。
- 真实复测统计 read_file 次数。

## 12. 测试计划

- `fileService.test.ts`：files 计数、目录代表、预算。
- `fileTools.test.ts`：Top files 文本、小搜索不提示。
- `pnpm check`、`pnpm build`。
- 真实 099 任务复测（需用户 Key）。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| Top files 数量 | 3（每个主要目录一个） | 复测后调整 |
| 是否按 src/test 过滤 | 代表文件优先 src；其余仍按命中数 | 无 |

## 14. 完成定义

- [ ] A1–A4 通过（实现后已回退）；
- [ ] A5 记录（实机 13/19/269,324/61.6s，较 104 回退）；
- [x] `pnpm check`、`pnpm build` 通过（实现阶段）；
- [ ] 代码保留（已回退，任务 `dropped`）。
