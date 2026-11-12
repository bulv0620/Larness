---
id: 072-agent-error-budget
title: 工具调用错误预算：补丁容错、参数修复与命令用法
milestone: M6
status: done
depends_on: [070-runtime-efficiency, 051-agent-tool-contract]
owners: [human]
created: 2026-11-12
updated: 2026-11-12
approved: 2026-11-12
---

# 工具调用错误预算：补丁容错、参数修复与命令用法

> 2026-11-12 用户授权：Larness 的核心是“快和省”，频繁的工具调用错误带来的额外模型步进必须从工程化角度压低，先做全量审查再逐项修。
> 本切片只处理**能由工程手段消除的错误**；模型判断错误、测试真实变红、权限拒绝不属于本切片目标。

## 1. 背景与问题（数据审查）

审查对象：`~/Library/Application Support/larness/larness.db` 的 `agent_events`（89 轮、143 个模型步进、4.98M 输入 token / 0.21M 输出 token）与 `logs/commands/*.jsonl`。

| 错误码 | 次数 | 占比 | 说明 |
|---|---|---|---|
| `INVALID_PATCH` | 43 | 31% | 全部来自 `apply_patch` 的补丁解析 |
| `VALIDATION_ERROR` | 24 | 17% | `run_command` 15、`update_plan` 4、`apply_patch` 3、其他 2 |
| `NONZERO_EXIT` | 23 | 17% | 测试/检查命令返回 1；多数是有效信号 |
| `GIT_UNAVAILABLE` | 10 | 7% | 已由 Git 探测修复（2026-11-12） |
| `NOT_FOUND` | 10 | 7% | 路径/终端不存在 |
| `FORBIDDEN` | 10 | 7% | 预览解析未绑定，已修复（2026-11-12） |
| `SPAWN_FAILED` | 7 | 5% | 早期环境问题 |
| 其他 | 12 | 9% | 审批、预览目标、终端租约等 |

两条关键事实：

1. **139 次失败里 87 次在同一轮内以相同参数重发并成功**。失败不是“任务错了”，而是“形状不对、重来一次”。每次重发至少多一个模型步进；本机平均每步 3.5 万输入 token，重试是十万到百万级输入 token 的开销。
2. **今天（2026-11-12）仍活跃的只剩三类**：补丁形状（7 次）、参数枚举/必填字段（5 次）、命令用法（1 次，`pnpm check <files>` 把路径透传给 `vitest` 后 “No test files found”）。`GIT_UNAVAILABLE`、`FORBIDDEN`（预览）已经修掉。

### 1.1 可工程消除的诱因

- **hunk 头行数**：模型手写 `@@ -a,b +c,d @@` 时经常算错行数，正文本身是对的；`diff` 的 `parsePatch` 直接拒收。正文权威、计数可推导，属于纯机械修复。
- **hunk 正文缺行首空格**：模型复制上下文时丢掉前导空格，`parsePatch` 报 `contained invalid line`；按“裸行=上下文”补一个空格即可，应用阶段仍按 `fuzzFactor: 0` 精确匹配，修错会失败而不是写坏文件。
- **`update_plan` 状态词表**：schema 只接受 `pending|running|done|failed`，模型稳定地写 `in_progress` / `completed`（今天 2 次）。这是词表先验不匹配，不是任务错误。
- **命令用法**：`pnpm check` 是整仓门禁脚本，带文件参数会把路径透传给 `vitest`；`pnpm test -- <pattern>` 也不过滤文件。仓库文档没有给出“只跑单个测试文件”的确定命令。
- **`apply_patch` 路径别名**：模型偶尔用 `file_path` / `file` 代替 `path`，属于同义字段误用。

## 2. 目标

- **G-1 补丁只修信封**：hunk 计数错误、裸上下文行、空行、CRLF、围栏、缺文件头等“信封”问题在解析前修复；上下文不匹配仍然失败关闭，绝不写坏文件。
- **G-2 参数先修复再校验**：对无歧义的模型别名（计划状态词、补丁路径别名）在 `safeParse` 前归一；仍不合法的参数继续返回 `VALIDATION_ERROR` 与 `issues`。
- **G-3 命令用法有确定答案**：仓库给出“单文件测试 / 单文件 biome / 整仓门禁”的准确命令，并提供脚本，避免模型自创带参数的 `pnpm check`。
- **G-4 可回归**：每一类修复都有正例与反例测试；反例必须仍然失败关闭。
- **G-5 不增加上下文成本**：修复不向模型回传额外提示文本，不扩大工具结果。
- **G-6 重试语义可区分**：同一 `(tool, 规范化参数)` 之前的失败被后续成功取代时，界面把该次标记为已重试，摘要只把未被取代的失败计为失败，并单列重试成功次数；事件层保留每次失败。

## 3. 非目标

- **NG-1** 不做模糊匹配（保持 `fuzzFactor: 0`），不猜测缺失的必填参数（`expectedVersion`、`run_command.executable`）。
- **NG-2** 不改变审批、项目锁、幂等、审计、秘密检查与风险分级。
- **NG-3** 不把真实测试变红、权限拒绝、用户取消算作“错误”去消除；它们保留为有效信号。
- **NG-4** 不为了省 token 截断失败诊断；`issues` / 原因码保持可定位。
- **NG-5** 不引入新依赖（复用现有 `diff`、`zod`）。
- **NG-6** 不隐藏、不降级未被取代的真实失败；摘要必须继续显示它们。

## 4. 用户故事

- 作为在本机跑长任务的用户，我希望模型第一次发来的补丁即使 hunk 行数算错也能直接应用，而不是再烧一个 3.5 万 token 的步进去重发。
- 作为维护者，我希望“工具拒收”只发生在语义真的不对时，而不是信封格式不对时。
- 作为在仓库里工作的 Agent，我希望文档直接告诉我单文件验证命令，不用猜 `pnpm check` 能不能带路径。

## 5. 验收场景

### A1 hunk 计数错误仍可应用

```gherkin
Given 文件 app.js 版本 v，补丁正文为 2 行上下文 + 1 行删除 + 1 行新增
And hunk 头写成 @@ -1,9 +1,9 @@（计数错误）
When apply_patch(path=app.js, expectedVersion=v, patch)
Then 补丁成功应用，文件内容正确
And 返回 additions=1、deletions=1
```

### A2 裸上下文行与空行修复

```gherkin
Given 补丁 hunk 中有一行上下文缺少前导空格，另一行是真正的空行
When apply_patch
Then 补丁成功应用
And 文件被修改为补丁语义所表达的内容
```

### A3 上下文不匹配仍然失败关闭

```gherkin
Given 补丁 hunk 的上下文与文件不符
When apply_patch
Then 返回 INVALID_PATCH，summary 含 "patch does not match the file"
And 文件内容不变
And 不写 file.changed 事件
```

### A4 计划状态别名

```gherkin
Given update_plan 参数 steps[1].status = "in_progress"
When 工具执行
Then 接受并归一为 "running"
And 计划事件里的 status 是 "running"
And steps[1].status = "completed" 归一为 "done"
```

### A5 非法状态仍然拒绝

```gherkin
Given steps[1].status = "invented"
When 工具执行
Then 返回 VALIDATION_ERROR，issues 指向 steps.1.status
```

### A6 单文件验证命令可用

```gherkin
Given 仓库根目录
When 执行 pnpm --filter @larness/web test:file src/features/models/ModelSettingsDialog.test.tsx
Then 只运行该测试文件并通过
And AGENTS.md 的命令章节列出该用法
And 明确 pnpm check 不接受文件参数
```

### A7 重试成功与未解决失败分开呈现

```gherkin
Given 同一 Turn 内 call_1 以参数 P 失败，call_2 以同一参数 P 成功
When tool.completed(call_2) 带 supersedes=["call_1"]
Then 事件中 call_1 的 tool.failed 原样保留
And 时间线把 call_1 标为「失败 · 已重试」
And 摘要显示「失败 0 项 · 重试成功 1 次」或只显示「重试成功 1 次」
And 参数不同的 call_2 成功不产生 supersedes
```

### A8 未解决失败不被折叠掉

```gherkin
Given 一个 Turn 有 2 次失败，只有 1 次被后续相同参数成功取代
When 查看时间线摘要
Then 显示「失败 1 项 · 重试成功 1 次」
And 展开后仍能看到两次失败条目
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `normalizePatchText` 在解析前按正文重算 hunk 头计数；仅当计数/正文形态变化时重写 |
| R-2 | MUST | hunk 内缺少 ` ` / `+` / `-` / `\` 前缀的非空行按上下文行补空格 |
| R-3 | MUST | 空行按上下文行处理；文件末尾的空行丢弃；`\ No newline at end of file` 原样保留且不计数 |
| R-4 | MUST | `defineTool` 增加可选 `repairArgs` 钩子，在 `safeParse` 前运行；修复结果仍走同一 schema 校验 |
| R-5 | MUST | `update_plan` 归一 `in_progress`/`in-progress`/`active` → `running`，`completed`/`complete`/`finished` → `done`，`todo`/`queued` → `pending`，`error`/`blocked` → `failed` |
| R-6 | MUST | `apply_patch` 归一 `file`/`file_path` → `path` |
| R-7 | SHOULD | `@larness/web` 增加 `test:file` 脚本；`AGENTS.md` 第 7 节给出单文件测试/biome/整仓门禁的准确命令与禁用形态 |
| R-8 | SHOULD | `run_command` 描述补一个最小合法参数示例（减少漏 `executable`） |
| R-9 | MUST | 成功的 `tool.completed` 可附 `supersedes: string[]`：仅同一 Turn、同一 `(tool, 规范化参数)` 的更早失败；客户端标 `retried` 并单列重试成功 |
| R-10 | MUST | 未被取代的失败仍计入「失败 N 项」，条目、命令输出与审计不隐藏 |

## 7. 接口与契约变更

- 工具参数 schema：不改（`repairArgs` 只影响解析入口，`z.toJSONSchema(io: "input")` 输出不变）。
- REST/WS/IPC/配置：不变。
- 文档：`AGENTS.md` 命令章节、`docs/contracts/*` 无需变更。
- 包内 API：`ToolDefinitionInput` 新增可选 `repairArgs`（向后兼容）。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 修复把错误补丁“修成”另一个语义 | 只修信封；应用阶段保持精确上下文匹配，不匹配即失败关闭 |
| 裸行按上下文处理，实际是新增行 | 应用失败返回 `patch does not match the file`，不会写坏文件；测试覆盖 |
| 别名修复放宽了校验 | 只归一固定词表；未命中仍由 schema 拒绝，A5 覆盖 |
| 修改共享 `defineTool` 影响全部工具 | 钩子可选、默认不动；`toolContract.test.ts` 全量回归 |
| 与 070 的稳定前缀冲突 | 只改请求前的参数解析，不改 system/tools 序列 |

## 9. 测试计划

- `packages/agent/test/tools/fileService.test.ts`：计数错误、裸行、空行、反例（上下文不匹配）。
- `packages/agent/test/tools/registry.test.ts`：`repairArgs` 在 `safeParse` 前运行且不改变失败路径。
- `apps/server/test/agent/plan.test.ts`：状态别名归一、非法状态仍拒绝、计划事件存 canonical。
- `apps/server/test/agent/toolContract.test.ts`：工具集合与“合法参数到达 handler / 非法参数 VALIDATION_ERROR”矩阵不回归。
- `apps/server/test/agent/turnRunner.test.ts`：同参数失败后成功附 `supersedes`；不同参数成功不附。
- `apps/web/src/lib/eventReducer.test.ts`：`supersedes` 把更早失败标为 `retried`。
- `apps/web/src/features/chat/Timeline.test.tsx`：摘要只计未解决失败并单列重试成功。
- 手工：`pnpm --filter @larness/web test:file <file>` 实跑一次。
