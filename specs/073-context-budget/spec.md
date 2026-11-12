---
id: 073-context-budget
title: 上下文预算：读文件分页与结果裁剪
milestone: M6
status: done
depends_on: [070-runtime-efficiency, 072-agent-error-budget]
owners: [human]
created: 2026-11-12
updated: 2026-11-12
approved: 2026-11-12
---

# 上下文预算：读文件分页与结果裁剪

> 2026-11-12 用户要求继续审查“重复读文件”和“裁剪策略”。本切片处理这两类**浪费**（不是失败）：它们不改变正确性，但每一步都在付 token 与时间。

## 1. 背景与问题（数据审查）

审查 `agent_events` 的全部读文件与命令结果：

- `read_file` 共 **160** 次；同一 Turn 内、对同一路径、在该路径尚未被修改前的**重复读 15 次**（4 个 Turn）。最典型的一轮：`style.css` 在第一次 `apply_patch` 之前被读了 **5 次**。
- 根因不在模型“健忘”，在裁剪策略：
  1. `readTextFile` 一次最多返回 2,000 行 / 1 MiB（`MAX_TOOL_OUTPUT_LINES`），`nextOffset` 指向**整个请求范围之后**；
  2. 结果序列化器 `toolMessageContent` 对**每个字符串字段**只留 **4,000 字符**（head 60% + tail 40%），并附 `page.truncated`；
  3. 于是一个 725 行文件返回给模型的是「约 2.4k 头部 + 1.6k 尾部 + 中间省略」，而 `nextOffset` 却说已经读到末尾。模型再读同一段仍然只能看到头尾，重复读无法逼近中部。
- `run_command` 输出用 `truncateToolMessage` + 反复保留前 70% 截到 12k，**尾部被丢弃**。测试/类型检查的结论通常只在尾部，模型只能改用 `| tail` 再跑一次（多一个步进、多一份输出）。

## 2. 目标

- **G-1 读文件返回连续页**：一页内容必须是从 `offset` 开始的连续文本，不再出现“头 + 省略 + 尾”的空洞；`nextOffset` 指向真正下一页的第一行。
- **G-2 页大小与结果预算对齐**：单页字符数 ≤ 12,000，序列化后不再被二次裁剪；摘要直接给出「当前行范围 + 下一页 offset」。
- **G-3 单字段可用满预算**：结果总长仍 ≤ 16,000 字符且始终是合法 JSON，但单个大字段（如 `content`）可以占约 14,000 字符，而不是固定 4,000。
- **G-4 命令输出保留尾部**：超长命令输出保留头 + 尾并标注省略字符数，测试失败摘要不再被丢掉。
- **G-5 有回归**：正例证明分页连续、预算放大、尾部保留；反例证明超长结果仍是合法 JSON 且页面标记正确。

## 3. 非目标

- **NG-1** 不做“重复读返回 unchanged”之类的去重/缓存——先修根因，再用真实数据判断是否还需要。理由：HX-7 的 Turn 检查点会在中途替换历史，早期读取结果可能已不在上下文；此时返回“已读过”会变成错误事实。
- **NG-2** 不改变 `search_code` / `list_files` 的语义与上限。
- **NG-3** 不改变终端增量读的 cursor 语义（它靠 `nextCursor` 续读，不是一次性全文）。
- **NG-4** 不截断错误诊断、不把失败结果缩成一句。
- **NG-5** 不引入新依赖。

## 4. 验收场景

### A1 长文件按字符分页且连续

```gherkin
Given 一个 725 行、约 30k 字符的文本文件
When read_file(path) 不带 offset
Then 返回 content 少于 12,100 字符且不含“chars omitted”空洞
And truncated 为 true 且 nextOffset 指向第 1 页之后的第一行
And 摘要包含当前行范围与“继续用 offset=N”
When 从 nextOffset 继续读
Then 两页拼接后与原文按行完全一致（无重叠、无缺口）
```

### A2 单字段预算放大

```gherkin
Given 一个 content 长 200,000 字符的工具结果
When toolMessageContent 序列化
Then 结果长度 ≤ 16,000 且是合法 JSON
And 保留的 content 长度 ≥ 12,000（不再是 4,000）
And page.truncated 为 true 且 omittedChars > 0
```

### A3 命令输出保留尾部

```gherkin
Given 命令输出 30,000 字符，最后 3 行是测试失败摘要
When 构造 run_command 的工具结果
Then 输出中同时包含开头与最后几行
And 中间以“chars omitted”标记省略
```

### A4 短结果不变

```gherkin
Given 一个 2 行的读文件结果
When 序列化
Then 内容逐字保留且没有 page 字段
```

## 5. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `readTextFile` 支持 `maxChars`：按整行切分，单页不超过该字符数（至少保留一行）；`truncated` 与 `nextOffset` 按实际返回行数计算 |
| R-2 | MUST | `read_file` 工具传 `maxChars=12_000`，摘要附行范围与下一页 offset（仅截断时） |
| R-3 | MUST | `toolMessageContent` 的字段预算从 4,000 起步改为「总量 − 2,000」起步，超限时阶梯减半；结果仍 ≤ 16,000 |
| R-4 | MUST | `run_command` 输出用头尾保留（约 60/40）替代只留头部，并标注省略字符数 |
| R-5 | MUST | 现有 `page: {truncated, omittedChars}` 与合法 JSON 保证不变 |

## 6. 接口与契约变更

- 工具结果结构不变（`content` / `offset` / `nextOffset` / `truncated` 语义收紧为“实际返回”）。
- 不新增事件、REST、WS、IPC 或配置键。
- 文档：`docs/contracts/ws-events.md` 无需变更；工具描述补一句“每次返回连续页，按 nextOffset 续读”。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 单页 12k 字符让单步上下文变大 | 仍在 16k/结果上限内；页尾明确给续读 offset，减少重复读 |
| 按行切分遇到单行超长（压缩文件） | 至少返回一行并标 `truncated`；`nextOffset` 前进一行，避免死循环 |
| 头尾保留把命令中段错误藏起来 | 只在超 12k 时启用；错误码、exit code 与 `truncated` 仍在结构里，界面可看完整输出 |
| 预算放大让 search 结果更长 | 总量上限不变（16k），阶梯减半仍覆盖多字段结果 |

## 8. 测试计划

- `packages/agent/test/tools/fileService.test.ts`：725 行分页连续、单行超长、短文件不变。
- `apps/server/test/agent/turnRunner.test.ts`：现有序列化用例适配 14k 预算；命令输出头尾保留的单测。
- `packages/agent/test/tools/fileTools.test.ts`：摘要包含页信息。
