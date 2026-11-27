---
id: 103-exact-identifier-search
title: 真实仓库探索：精确标识符优先
milestone: 发布后
status: active
depends_on: [100-exploration-efficiency, 102-real-repo-ab]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 真实仓库探索：精确标识符优先

> 状态：`active`（2026-11-27；prompt/宽扫提示与测试、`pnpm check`/`build` 通过；真实复测待用户 Key）。102 的真实 Larness 099 任务暴露差距：Larness 23 次调用/299,718 tokens，opencode 10 次/157,152 prompt tokens；两边都修对，但 Larness 先宽搜错误码、扫 875/1232 文件，再读整文件。

## 1. 背景与问题

真实仓库里，请求已经给出要改的字段名（`expectedVersion`、`version`），但 Larness：

- 先搜 `VERSION_CONFLICT`，扫 875 文件、50 条截断；
- 再 `ls`、读 180 行文件、读合同；
- 再搜 `EditFileSchema`、`repairEditArgs`，各自扫 1232 文件；
- 最后才搜 `expectedVersion` 并读测试。

opencode 直接 grep 精确字段/错误码，读 spec 和 90 行代码就完成。100 的“窄读提示”只在命中后生效，管不到搜索范围。

## 2. 目标

- G-1：system prompt 要求从请求里的精确字段/函数/文件开始搜索，而不是先搜邻近错误码或宽泛概念。
- G-2：已知包/目录时使用 `path`/`glob` 收窄；大扫描是收窄信号，不是重复同一宽搜的理由。
- G-3：`search_code` 在扫描文件数 > 200 时，结果文本追加一行可执行的收窄提示（`path`/`glob` 或精确标识符）。
- G-4：不改变搜索语义、忽略规则、权限、schema 或结果预算。
- G-5：用 102 的真实 Larness 099 任务复测，记录调用/tokens/耗时变化；不预设必须达到某个数字。

## 3. 非目标

- NG-1：不实现 LSP/符号索引/向量搜索。
- NG-2：不自动改写用户 query，不自动猜测 path。
- NG-3：不处理 pnpm `NO_SCRIPT` 命令纠错（另立切片）。
- NG-4：不改变 `search_code` 的 L0/无锁/prefetchable 属性。
- NG-5：不新增工具、REST/WS/DB/迁移或依赖。

## 4. 用户故事

- 作为在真实 Monorepo 里使用 Larness 的开发者，我希望 Agent 直接搜索我提到的字段/函数，而不是先花多次调用扫整个仓库，以便更快定位和修改。

## 5. 验收场景

### A1 精确标识符优先

```gherkin
Given 组装 system prompt
Then 包含“从请求里的精确标识符开始”
And 包含“不要先搜邻近错误码/宽泛概念”
And 包含“大扫描要收窄”
And PROMPT_VERSION 已递增
```

### A2 宽扫描提示

```gherkin
Given 仓库有 201 个匹配文件
When 调用 search_code
Then 模型文本包含 "Broad scan: 201 files scanned"
And 包含 pass path/glob 与 exact identifier 语义
```

### A3 小扫描不提示

```gherkin
Given 只有几个匹配文件
When 调用 search_code
Then 模型文本不包含 "Broad scan"
And 命中/上下文格式不变
```

### A4 现有行为

```gherkin
When 运行现有 search 测试
Then 忽略目录、glob、maxFiles、limit、contextLines 行为不变
```

### A5 真实复测

```gherkin
Given 102 的 Larness 099 真实任务
When 重跑外部模式
Then 记录 steps/toolCalls/tokens/duration
And 与旧值 13/23/296,177 input/59.5s 对比
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `SYSTEM_POLICY_BASE` 增加精确标识符优先与宽搜收窄约束。 |
| R-2 | MUST | `PROMPT_VERSION` 递增到 `103-1`。 |
| R-3 | MUST | `searchModelText` 在 `scannedFiles > 200` 时追加宽扫提示。 |
| R-4 | MUST | 小扫描与现有命中文本不回归。 |
| R-5 | MUST | 工具描述/合同同步。 |
| R-6 | MUST | 不改变权限、风险级别、schema、忽略规则或结果预算。 |

## 7. 接口与契约变更

- 工具参数/返回结构：无变化。
- 模型文本：大扫描追加一行提示。
- system prompt：新增探索约束；`PROMPT_VERSION=103-1`。
- 同步更新 `docs/contracts/agent-command-context.md`。
- REST/WS/DB/配置：无。

## 8. 数据与迁移

- 无 schema/迁移/持久数据变更。

## 9. 安全、权限与审计

- 搜索仍在授权 project root；不新增路径/命令/网络。
- 提示只影响模型文本；不改变执行层权限。
- 不记录文件内容到日志或事件。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 0 命中且扫描 > 200 | 仍追加宽扫提示 | 原有 "No matches" + 提示 |
| 结果截断但扫描 ≤ 200 | 不追加宽扫提示 | 原有 truncated 标记 |
| 扫描预算耗尽 | 沿用原有提示；若 scannedFiles > 200 也加宽扫提示 | 原有 budget 提示 |
| 权限/路径错误 | 与现有 search 一致 | 稳定错误码 |

## 11. 可观测性

- 复用 `tool.requested/completed` 与 `model.usage`；不新增事件。
- 真实复测以调用数、tokens、duration 为指标。

## 12. 测试计划

- 单元：`fileTools.test.ts` 宽扫提示、小扫描不提示、现有 search 用例；`contextAssembler.test.ts` 精确搜索约束与 prompt version。
- 整仓：`pnpm check`、`pnpm build`。
- 真实：102 的 `larness-edit-arg-repair` 外部任务复测（需用户 Key）；未跑时记录。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 宽扫阈值 200 是否合适 | 先 200；按真实复测调整 | 实现后 |
| 提示是否应包含具体 path | 不猜 path，只提示收窄 | 无 |

## 14. 完成定义

- [x] A1–A4 通过；
- [ ] A5 记录（真实复测待用户 Key；旧值已写入 tasks）；
- [x] `pnpm check`、`pnpm build` 通过；
- [x] 契约/文档/STATUS/ROADMAP/README 更新。
