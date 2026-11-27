---
id: 093-tool-interface
title: 工具面与结果预算：行号读取、edit、覆盖写入与命令输出
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract, 072-agent-error-budget, 073-context-budget, 082-agent-kernel, 091-cross-turn-tool-replay, 092-search-ignore]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 工具面与结果预算：行号读取、edit、覆盖写入与命令输出

> 状态：`done`（2026-11-27；自动验证与 `pnpm build` 通过，E2E 与真实 Provider 会话未运行）。
> 本切片只改工具面与结果预算；跨 Turn L1 操作日志、单 Profile/计划、审批 allowlist、流式执行另开切片。

## 1. 背景与问题

当前工具面与模型习惯的 coding 工具差异较大，且结果预算会把放大后的页面再次截断：

- `read_file` 每页只有 12,000 字符，且返回的 `content` 不带行号（`packages/agent/src/tools/fileTools.ts`、`packages/resources/src/files/fileService.ts`）；模型改文件时要自己数行。
- 修改现有文件只能 `apply_patch`（unified diff + 64 位 sha256 `expectedVersion`）；没有 `edit(oldString/newString)`，小改动也容易失败。
- `write_file` 只能新建，已存在时返回 `VERSION_CONFLICT`（`createTextFile` 使用 `wx`），不能整体覆盖。
- `run_command` 的输出总上限约 6,000 字符，stdout/stderr 再各算一份；失败测试的关键片段可能被截掉。
- 工具结果统一是 JSON envelope；即使把 read 提到 50KB，`MAX_TOOL_RESULT_CHARS=16_000` 也会再把内容压回 16k 字符，`MAX_BATCH_TOOL_RESULT_TOKENS=12_000` 还会把大结果折叠。**尺寸参数必须一起改，否则改动无效。**
- 工具描述变化会改变 `toolsetHash`，升级后首次请求有一次 `tools` 前缀断裂，属于预期。

## 2. 目标

- G-1：`read_file` 返回带 1-based 行号的模型文本，每页最多 50KB 或 2000 行；原始 `data.content` 保持不变。
- G-2：新增 `edit` 工具，用 `oldString`/`newString`/`replaceAll` 做精确替换；唯一匹配、CRLF 容错、版本返回与 `file.changed`。
- G-3：`write_file` 允许覆盖已有文件；可选 `expectedVersion` 做冲突校验；新建与覆盖都返回 `created` 与版本。
- G-4：`run_command` 输出上限提升到 32KB；模型文本只保留一份合并输出，不再重复 stdout/stderr。
- G-5：`read_file` / `search_code` / `run_command` 使用 `modelText` 纯文本结果；JSON `data` 继续供 UI 与后续工具使用。
- G-6：结果/批预算同步提升，使 50KB 读取与 32KB 命令输出能真正到达模型。
- G-7：`edit` 加入 `core.write` Pack，coding/plan 都可见；工具契约矩阵、文件工具注册与描述测试同步。

## 3. 非目标

- NG-1：不实现跨 Turn L1 操作日志/命令输出回放（后续切片）。
- NG-2：不移除 coding/plan Profile，不把 `update_plan` 常驻（后续切片）。
- NG-3：不改审批默认值、allowlist、autonomous 或 always-allow（后续切片）。
- NG-4：不做流式工具执行、混合批次并发、subagent 或 Code Mode。
- NG-5：不引入完整 `.gitignore` 解析或 ripgrep。
- NG-6：不新增 REST / WS / IPC / 数据库 / 配置项。
- NG-7：不改变 Secret、路径校验、项目锁、审计与授权语义。
- NG-8：不把 `search_code` 升级为正则引擎；本切片只改结果格式与默认忽略（092 已完成）。

## 4. 用户故事

- 作为让 Agent 改代码的用户，我希望模型读文件时看到行号，并用 `edit` 改一小段，而不是反复构造 unified diff。
- 作为让 Agent 重写配置/生成文件的用户，我希望 `write_file` 能覆盖已有文件，并在需要时用版本校验避免并发覆盖。
- 作为跑测试/构建的用户，我希望失败输出的尾部能完整到达模型，而不是被 6KB 截断。
- 作为维护者，我希望工具结果对模型是自然文本，对 UI 仍是结构化数据，二者不互相牺牲。

## 5. 验收场景

### A1 行号读取

```gherkin
Given src/a.ts 有 3 行
When 调用 read_file(path="src/a.ts")
Then modelText 包含 "version: <64位 sha256>"
And 内容按 "1: ..."、"2: ..."、"3: ..." 编号
And data.content 仍是不带行号的原文
```

### A2 大页读取

```gherkin
Given src/big.ts 有 3000 行、总字符数小于 50KB
When 调用 read_file(path="src/big.ts")
Then 第一页最多 2000 行
And modelText 说明 next offset
And data.truncated=true、data.nextOffset=2001
```

### A3 edit 精确替换

```gherkin
Given src/a.ts 中 "needle" 只出现一次
When 调用 edit(path="src/a.ts", oldString="needle", newString="pin")
Then 文件被替换且返回新 version
And file.changed 的 changeType 为 modified
And 同一 oldString 出现多次且未设置 replaceAll 时返回 INVALID_PATCH
And replaceAll=true 时替换全部
```

### A4 覆盖写入

```gherkin
Given src/a.ts 已存在
When 调用 write_file(path="src/a.ts", content="new\n")
Then 文件内容被整体替换，返回 created=false 与新 version
When 再调用 write_file 并传入过期的 expectedVersion
Then 返回 VERSION_CONFLICT，不写文件
When 调用 write_file(path="src/new.ts", content="...")
Then 返回 created=true
```

### A5 命令输出

```gherkin
Given 一条命令输出 30KB 文本，失败信息在尾部
When 调用 run_command
Then modelText 包含尾部失败信息
And modelText 不重复 stdout 与 stderr
And data.output/stdout/stderr 仍按有界字段返回
```

### A6 预算联动

```gherkin
Given 一个 read_file 结果约 50KB
When 结果进入当前 step 的 tool 消息
Then 结果不会被 16k 字符上限截断
And 单批两条 50KB 结果超过 24k token 时，最旧的一条被折叠，最新一条保留原文
```

### A7 工具契约

```gherkin
Given coding 或 plan Profile
When 装配工具数组
Then 包含 edit、read_file、write_file、apply_patch
And edit 的风险级别为 L1、需要项目锁
And 工具描述说明行号只用于引用、不进入 patch 上下文
```

### A8 安全与失败

```gherkin
Given 文件路径越界、二进制文件、超大内容、多个匹配或版本冲突
When 调用 edit / write_file
Then 返回稳定错误码且不静默写入
And 原有审批、项目锁、路径校验与秘密检查不变
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `ToolResult` 增加可选 `modelText`；`toolMessageContent` 优先使用它，错误时仍带 `errorCode + summary` 前缀。 |
| R-2 | MUST | `read_file` 的 `modelText` 含完整 version、行号、页范围与 next offset；`data.content` 保持原文。 |
| R-3 | MUST | `READ_PAGE_CHARS` 提升到 50,000；`MAX_TOOL_RESULT_CHARS` 提升到 80,000；`MAX_TOOL_MESSAGE_CHARS` 提升到 80,000；`MAX_BATCH_TOOL_RESULT_TOKENS` 提升到 24,000。 |
| R-4 | MUST | 新增 `editTextFile` 资源函数与 `edit` 工具；唯一匹配、`replaceAll`、CRLF 容错、版本冲突与项目锁。 |
| R-5 | MUST | `writeTextFile` 支持覆盖；可选 `expectedVersion`；返回 `created`、新版本与 `previousVersion`。 |
| R-6 | MUST | `run_command` 输出上限 32KB；`modelText` 只放合并输出与状态，不重复 stdout/stderr；`data` 保留结构化字段。 |
| R-7 | MUST | `edit` 加入 `core.write` Pack；文件工具注册、Profile 测试、ToolContract 矩阵同步。 |
| R-8 | MUST | `turnRunner` 对 `edit` 与覆盖写入记录 `file.changed`，覆盖时 `changeType=modified`。 |
| R-9 | MUST | 不改变路径校验、审批、项目锁、秘密处理、审计与事件持久化语义。 |

## 7. 接口与契约变更

- 模型工具：`read_file` 文本格式、`edit` 新工具、`write_file` 覆盖与可选 `expectedVersion`、`run_command` 文本输出。
- 工具结果：`ToolResult.modelText?: string`；JSON `data` 继续存在。
- Profile：`core.write` 增加 `edit`；coding/plan 工具面同步。
- REST / WS / IPC / 数据库：无变更。
- 前缀缓存：工具数组/描述变化改变 `toolsetHash`，升级后首次请求一次 `tools` 前缀断裂；不修改 `PROMPT_VERSION`（system 未变）。
- 契约文档：更新 [Agent 命令与 PM2 系统上下文](../../docs/contracts/agent-command-context.md) 与 [051 工具契约](../051-agent-tool-contract/spec.md) 的相关说明。

## 8. 数据与迁移

- 新表 / 新列 / 索引 / 迁移：无。
- 兼容：旧工具结果事件保留；旧 `write_file` 调用没有 `expectedVersion` 时按覆盖处理，新调用行为更宽。
- 回滚：恢复 `createTextFile` 路径、移除 `edit` 工具与 `modelText` 分支即可；无数据影响。

## 9. 安全、权限与审计

- `edit` / `write_file` 均为 L1，默认需要项目锁；路径仍走 `resolveInput` 的项目根校验。
- `write_file` 覆盖是显式能力；`expectedVersion` 可选，传入时必须匹配，否则 `VERSION_CONFLICT`。
- `edit` 不做正则/脚本执行；只做字面量替换，避免注入面。
- 工具结果进入模型前沿用现有 `toolMessageContent` 边界；命令/文件内容仍按不可信数据处理。
- 不新增审计事件；`file.changed`、`tool.completed` 形状保持。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| oldString 未找到 | `INVALID_PATCH`，不写文件 | 稳定错误码 + 明确摘要 |
| oldString 多处匹配且未 replaceAll | `INVALID_PATCH`，提示加长上下文或 replaceAll | 同上 |
| expectedVersion 不匹配 | `VERSION_CONFLICT`，带 currentVersion | 同上 |
| 文件是二进制/超大 | 现有 `VALIDATION_ERROR` / `TOO_LARGE` | 同上 |
| 读取结果超过 80k 字符 | 截断并标记，不返回半截 JSON | `...[truncated]` |
| 单批结果超过 24k token | 从最旧折叠，最新保留 | `"folded":true` |

## 11. 可观测性

- 日志：无新增。
- 指标 / 状态：`tool.completed` 的 `resultSummary`、`file.changed` 的 path/version/changeType；结果大小继续由现有事件与用量观察。
- 诊断入口：`model.usage` 的 `toolsetHash` 会变化一次；`context.checkpoint`/折叠日志沿用。

## 12. 测试计划

- 资源层（`packages/agent/test/tools/fileService.test.ts`）：`writeTextFile` 覆盖/新建/版本冲突；`editTextFile` 唯一/多处/replaceAll/CRLF/二进制/越界。
- 工具层（`packages/agent/test/tools/fileTools.test.ts`）：read 行号与 50KB 页、modelText、edit、write 覆盖、错误码、描述。
- 服务层（`apps/server/test/agent/turnRunner.test.ts`）：edit/覆盖写入的 `file.changed`、命令输出 32KB、modelText 序列化、预算折叠。
- 契约（`apps/server/test/agent/toolContract.test.ts`、`profiles.test.ts`、`contextAssembler.test.ts`）：edit 注册/描述/Pack/风险级别；工具数组仍稳定。
- 单元（`apps/server/test/agent/compaction.test.ts`）：纯文本 `foldToolResultContent` 与批预算。
- E2E：不新增；本切片是工具/资源层行为，单元/集成覆盖足够。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| `write_file` 覆盖是否必须带 `expectedVersion` | 可选；传入才校验。保留整体覆盖能力，同时给并发写者一个安全选项 | 用户可在验收时改 |
| 50KB 页与 24k 批预算是否合适 | 是；1M 窗口下可容纳，128k 窗口下仍受折叠保护 | 后续基准切片可调 |
| 是否在本切片加 `search_code` 正则 | 否；避免 ReDoS 与新依赖，先保持字面量 + glob | 后续切片 |

## 14. 完成定义

- [x] A1–A8 自动化通过；
- [x] `pnpm check` 通过（退出码 0）；
- [x] 工具描述、契约文档、`tasks.md`、`STATUS.md`、`ROADMAP.md` 已更新；
- [x] 没有新增 UI 行内提示；
- [x] 按 2026-11-27 用户确认的“完整耦合方案”实施。
