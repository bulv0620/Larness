---
id: 104-search-directory-summary
title: 宽搜索目录摘要
milestone: 发布后
status: active
depends_on: [100-exploration-efficiency, 102-real-repo-ab]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 宽搜索目录摘要

> 状态：`active`（2026-11-27；目录统计、裸 glob 递归、测试、`pnpm check`/`build` 通过；真实 099 任务复测待用户 Key）。103 的“精确标识符优先” prompt 实机回退；本切片改为工具结果给出**按目录的命中分布**，让模型自己选 `path`，不再猜搜索词或包路径。

## 1. 背景与问题

102 的真实 Larness 099 任务里，Larness 23 次调用/299,718 tokens，opencode 10 次/157,152 prompt tokens。主要浪费是宽搜索：

- `expectedVersion` 命中 50 条/392 文件，结果截断，模型不知道匹配集中在哪些目录；
- 模型随后错误探索 `apps/server`，最后才到 `packages/agent`；
- `VERSION_CONFLICT` 宽搜命中 50 条/875 文件，但 fileTools 恰好在前 50 条才被找到。

单纯改 prompt（103）会让模型先搜错误的精确字段，已回退。需要让搜索本身提供“下一步该去哪”的信息。

## 2. 目标

- G-1：`search_code` 在达到 `limit` 后继续扫描（受 `maxFiles` 预算约束），统计每个目录的命中数，而不是立即停止。
- G-2：`SearchCodeResult` 增加 `directories: Array<{ path, matches }>`；按命中数降序、路径升序。
- G-3：结果被截断或扫描文件数 > 200 时，模型文本追加 `Top dirs: ...` 和 `Use path=<dir> to narrow.`，最多列 5 个目录。
- G-4：目录分组按 workspace 结构：`apps/<name>`、`packages/<name>`，其他按顶层目录；根文件用 `(root)`。
- G-5：不改变搜索 query、忽略规则、maxFiles、contextLines、权限或结果预算。
- G-6：裸 glob（不含 `/`，如 `*.ts`）递归匹配任意深度；含 `/` 的 glob 语义不变（如 `src/*.ts` 仍只匹配一层）。
- G-7：真实 099 任务复测，记录调用/tokens/耗时变化。

## 3. 非目标

- NG-1：不新增 prompt 行为约束，不改 `PROMPT_VERSION`。
- NG-2：不做搜索排序/重排/向量索引/LSP。
- NG-3：不自动改写 query 或自动选择 path。
- NG-4：不新增工具、REST/WS/DB/迁移或依赖。
- NG-5：不改变 `limit` 的“最多返回多少条命中”语义；只是继续扫描做统计。

## 4. 用户故事

- 作为在 Monorepo 里使用 Larness 的开发者，当搜索结果被截断时，我希望看到命中集中在 `packages/agent` 还是 `apps/server`，这样我可以直接 `path` 收窄，而不是继续猜。

## 5. 验收场景

### A1 截断时给出目录分布

```gherkin
Given apps/server/test/a.ts、packages/agent/src/b.ts、docs/c.md 都含 needle
When search_code(query="needle", limit=1)
Then matches 只有 1 条
And truncated=true
And directories 包含 apps/server:1、packages/agent:1、docs:1
And modelText 包含 "Top dirs:" 与 "path="
```

### A2 小搜索不加摘要

```gherkin
Given 只有 2 个文件命中且未截断
When search_code
Then modelText 不包含 "Top dirs:"
```

### A3 预算仍生效

```gherkin
Given maxFiles=1
When search_code
Then scannedFiles=1
And scanBudgetExhausted=true
And 不越界读取更多文件
```

### A4 现有行为

```gherkin
When 运行现有 search 测试
Then 忽略目录、glob、limit、contextLines、上下文格式不变
```

### A5 真实复测

```gherkin
Given 102 的 Larness 099 真实任务（103 已回退）
When 重跑外部模式
Then 记录 steps/toolCalls/tokens/duration
And 与 13/23/296,177 input/59.5s 对比
```

### A6 裸 glob 递归

```gherkin
Given 根目录、src/、test/ 都有 .ts 文件
When search_code(glob="*.ts")
Then 三处都能命中
And glob="src/*.ts" 仍只匹配 src 一层
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `SearchCodeResult` 增加 `directories` 统计。 |
| R-2 | MUST | 达到 limit 后继续扫描计数，受 maxFiles/scan budget 约束。 |
| R-3 | MUST | 目录分组按 apps/packages 二级目录，其余顶层目录；根文件 `(root)`。 |
| R-4 | MUST | 截断或 scannedFiles > 200 时模型文本追加 Top dirs（≤5）与 path 提示。 |
| R-5 | MUST | 小搜索/空结果不追加误导摘要。 |
| R-6 | MUST | 不改变权限、schema、忽略规则或结果预算。 |
| R-7 | MUST | 更新合同文档与测试。 |
| R-8 | MUST | 裸 glob（无 `/`）递归匹配；含 `/` 的 glob 保持原语义。 |

## 7. 接口与契约变更

- `SearchCodeResult`：新增 `directories: SearchDirectoryCount[]`。
- `scannedFiles`：现在统计到扫描结束（达到 limit 后仍继续，直到 maxFiles/树结束），不再在 limit 处停止。
- 模型文本：新增 Top dirs/path 提示。
- 工具 schema/权限/风险级别：不变。
- 同步更新 `docs/contracts/agent-command-context.md`。

## 8. 数据与迁移

- 无 schema/迁移/持久数据变更。

## 9. 安全、权限与审计

- 搜索仍在授权 project root；不新增路径/命令/网络。
- 继续扫描仍受 `maxFiles` 与忽略规则约束；不读取被忽略目录。
- 目录名来自项目相对路径，不包含文件内容。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 达到 limit 后继续扫描 | 继续计数，不追加 matches | Top dirs |
| 达到 maxFiles | 停止，scanBudgetExhausted=true | 原有预算提示 |
| 0 命中 | directories 为空，不追加 Top dirs | No matches |
| 深目录 | 按 apps/packages 二级分组 | 目录名 |
| 根文件 | 归入 `(root)` | `(root)` |

## 11. 可观测性

- 复用 `tool.completed` 的 data/modelText；不新增事件。
- 真实复测以 toolCalls/tokens/duration 为指标。

## 12. 测试计划

- `packages/agent/test/tools/fileService.test.ts`：目录统计、截断、预算、分组。
- `packages/agent/test/tools/fileTools.test.ts`：Top dirs 模型文本、小搜索不提示。
- `pnpm check`、`pnpm build`。
- 真实 099 任务复测（需用户 Key）。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| Top dirs 数量 | 5 | 实现后按复测调整 |
| 是否总是扫描全树 | 受 maxFiles 2000 约束 | 性能复测后调整 |
| 是否按 src/test 再分组 | 先按包目录 | 无 |

## 14. 完成定义

- [x] A1–A4、A6 通过；
- [ ] A5 记录（真实复测待用户 Key；102 基线已写入 tasks）；
- [x] `pnpm check`、`pnpm build` 通过；
- [x] 契约/文档/STATUS/ROADMAP/README 更新。
