---
id: 100-exploration-efficiency
title: 探索效率：search_code 上下文与窄读提示
milestone: 发布后
status: done
depends_on: [093-tool-interface, 098-benchmark]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 探索效率：search_code 上下文与窄读提示

> 状态：`done`（2026-11-27；工具层、prompt 与整仓检查通过；A6 long-file 两次 live 复测均为 5 步/5 调用，tokens 22,620–23,048（中位数 22,834），verify=0；旧值 7 步/8 调用/35,269 tokens）。基于 098 实机 A/B：long-file 任务 Larness 8 次工具调用，opencode 5 次；Larness 多出 `list_files`、重复 `search_code` 和 60 行大窗口读取。

## 1. 背景与问题

098 的干净 A/B 显示两边完成度同级，但 Larness 在 long-file 类任务上探索更重：

- `search_code` 已返回 `path:line`，模型仍然 `read_file` 了 60 行，而不是围绕命中行窄读；
- 模型先 `list_files`，再读 `package.json`，即使任务已经点名目标文件；
- 同一目标用不同大小写/子串重复搜索。

这些都不是工具失败，而是模型缺少“搜索后怎么走”的就近提示和默认上下文。结果多花 1–3 次工具往返，增加延迟和 token。

## 2. 目标

- G-1：`search_code` 默认返回命中行前后各 1 行上下文；上下文带行号、不重复命中行；`contextLines: 0` 可关闭。
- G-2：搜索结果模型文本给出紧凑的窄读提示：命中已定位时读小窗口，不重复同一搜索。
- G-3：system prompt 增加探索约束：任务点名文件时直接读；路径未知时才 `list_files`；`package.json` 只在脚本/依赖/module type 相关时读。
- G-4：保持搜索忽略规则、glob、maxFiles、结果上限与安全边界不变。
- G-5：用现有 098 benchmark 复测 long-file 的调用数与 prompt tokens，记录是否改善。

## 3. 非目标

- NG-1：不新增工具、LSP、formatter、env block、输出续写或 checkpoint。
- NG-2：不改变 `search_code` 的 L0/无锁/prefetchable 属性或审批策略。
- NG-3：不改变 `read_file` 的 50KB/2000 行分页与 `edit` 的版本/替换语义。
- NG-4：不自动创建计划，不改变 plan nudge。
- NG-5：不引入持久 always-allow 或 autonomous 默认。

## 4. 用户故事

- 作为使用 Larness 的开发者，我希望 Agent 搜索到符号后直接围绕命中行修改，而不是先列目录、读整段文件、再重复搜索，以便更快完成小改动。

## 5. 验收场景

### A1 默认上下文

```gherkin
Given src/config.js 第 300 行包含 DEFAULT_TIMEOUT
When 调用 search_code 且不传 contextLines
Then 结果命中行是 src/config.js:300
And 模型文本包含 299、300、301 的带行号上下文
And 300 行只出现一次
```

### A2 关闭与边界

```gherkin
Given 同一文件
When contextLines=0
Then matches[].context 不存在
And 模型文本不包含相邻行
When contextLines=5 且命中在文件首行
Then 只返回存在的行，不越界
```

### A3 窄读提示

```gherkin
Given 搜索结果非空
When 渲染 modelText
Then 包含“narrow window / do not repeat”语义的提示
And 仍是纯文本，不出现 JSON 的 "matches" 字段
```

### A4 探索提示

```gherkin
Given 组装 system prompt
Then 包含“任务点名文件时直接读”“路径未知才 list_files”“package.json 只在相关时读”
And PROMPT_VERSION 已递增
```

### A5 现有行为不回退

```gherkin
Given 忽略目录、glob、maxFiles、limit 截断用例
When 运行现有 search 测试
Then 行为不变
```

### A6 benchmark 复测

```gherkin
Given 098 的 long-file-edit fixture
When 用同模型重跑 Larness
Then 记录 steps/toolCalls/toolFailures/prompt tokens
And 与旧值 7/8/0/35,269 对比；若未改善，记录原因并决定回退或继续
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `SearchMatch` 增加可选 `contextStart`（1-based），仅在有 context 时出现。 |
| R-2 | MUST | `search_code` 工具 schema 的 `contextLines` 默认 1；显式 0 关闭，最大 5。 |
| R-3 | MUST | 模型文本的上下文按真实行号渲染，跳过命中行，避免重复。 |
| R-4 | MUST | 非空结果追加一行窄读提示；空结果不追加误导提示。 |
| R-5 | MUST | system prompt 增加探索约束；`PROMPT_VERSION` 递增。 |
| R-6 | MUST | 更新工具描述与 `docs/contracts/agent-command-context.md`。 |
| R-7 | MUST | 不改变权限、风险级别、忽略规则、结果预算或 DB schema。 |

## 7. 接口与契约变更

- REST / WebSocket / IPC：无。
- 工具参数：`search_code.contextLines` 从“可选、默认 0”变为“可选、工具层默认 1”；显式 0 仍有效。
- 工具结果 `data.matches[]`：新增可选 `contextStart?: number`；旧字段不变。
- 模型文本：上下文行改为 `  <line>: <text>`，并追加窄读提示。
- system prompt：新增探索约束，`PROMPT_VERSION` 从 `095-1` 升到 `100-1`。
- 同步更新 `docs/contracts/agent-command-context.md`。

## 8. 数据与迁移

- 新表/新列：无。
- 索引/约束：无。
- 迁移与回滚：无迁移；回滚只需恢复默认值与 prompt。
- 保留与备份：无。

## 9. 安全、权限与审计

- 身份与授权：不变；搜索仍限制在授权 project root。
- 审批级别：`search_code` 仍为 L0、无项目锁、prefetchable。
- 秘密处理：上下文只来自已授权项目文件；不新增日志或事件字段；模型文本仍受工具结果预算约束。
- 审计事件：不变。
- 失败关闭：路径/二进制/超大文件/scan budget 行为不变。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 命中在文件首/尾行 | 上下文只返回存在的行 | 无额外提示 |
| `contextLines=0` | 不生成 context/contextStart | 与旧行为一致 |
| 匹配很多 | 仍受 limit 与 80k 字符结果预算约束 | 原有 truncated 提示 |
| 搜索结果为空 | 不追加窄读提示 | `No matches in N files` |
| 模型仍大窗口读 | 工具不阻止，只提供更近的下一步 | 无错误 |

## 11. 可观测性

- 复用 `model.usage`、`tool.requested/completed`；不新增事件。
- benchmark 的 toolCalls/prompt tokens 作为效果指标。

## 12. 测试计划

- 单元：`packages/agent/test/tools/fileTools.test.ts`（默认上下文、0、提示、无重复）；`packages/agent/test/tools/fileService.test.ts`（contextStart、边界）。
- 集成：`apps/server/test/agent/contextAssembler.test.ts`（探索提示、prompt version）；现有 search/ignore/glob 用例。
- E2E：不新增。
- 手动/真实：按 098 protocol 复跑 `long-file-edit`，记录前后对比；需要用户 Key，未跑时明确记录。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 默认上下文 1 行还是 2 行 | 1 行，先控制 token | 实现后按 benchmark 调整 |
| 是否把探索约束放进 system 还是 tail | system，稳定前缀 | 无 |

## 14. 完成定义

- [x] 验收场景 A1–A5 通过；
- [x] `pnpm check`、`pnpm build` 通过；
- [x] 契约 / 文档 / STATUS 已更新；
- [x] A6 已记录（2026-11-27 long-file 两次 live 复测均 5 步/5 调用，tokens 22,620–23,048，verify=0；全任务与第 3 次未跑）；
- [x] 没有新增行内提示条或 UI 变更。
