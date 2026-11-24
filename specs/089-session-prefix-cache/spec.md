---
id: 089-session-prefix-cache
title: 会话级前缀缓存：静态前缀分层、断裂归因与压缩可达
milestone: M6
status: ready
depends_on: [070-runtime-efficiency, 081-agent-lean, 084-agent-profiles-and-usage, 085-long-task-continuity, 086-project-memory, 087-web-search, 088-document-attachments]
owners: [human]
created: 2026-11-24
updated: 2026-11-24
---

# 会话级前缀缓存：静态前缀分层、断裂归因与压缩可达

> 状态：`ready`（2026-11-24）。第 13 节 D1–D5 已按推荐方案一次确认，实施顺序见 [tasks](tasks.md)。
> 行号按 2026-11-24 工作树标注，实施前需复核。
> 前序：[070 运行时效率](070-runtime-efficiency/spec.md) 的 HX-1～HX-12 已全部收口，本切片只处理**跨 Turn** 的剩余漏损，不重做 Turn 内前缀稳定性。

## 1. 背景与问题

070 已经交付「Turn 内前缀稳定」：`PROMPT_VERSION`、工具按名称排序、观察快照移到 Turn 起点、A1 作为硬门禁进入常规检查。当前缺口全部在**跨 Turn 与长会话**这一层。按现有代码复核，有 5 个具体问题，其中 2 个每轮都在发生。

1. **易变内容混在 system 里，且排在历史之前。** `assembleContext` 依次拼出：版本行、策略、web 策略与 `Current date`、作用域/审批、项目指令（AGENTS.md）、全局偏好、项目记忆索引、会话摘要、附件声明，然后才接历史（`apps/server/src/modules/agent/contextAssembler.ts:439-530`、`:536-547`）。前缀缓存只在「第一个不同 token」之前有效，因此只要上述任一块变化，**它后面的全部历史都作废**：
   - `remember` 写入的记忆在下一个 Turn 才注入（`updatedAt < turn.startedAt`，`:483`、`:492`），正好命中下一次请求；
   - 启用联网时，UTC 跨日让 `Current date`（`:445-447`）变化；
   - 压缩产生新摘要（`:506`）；
   - 记忆项由有效变为 `[stale]`（`isMemoryStale`，`:236`）；
   - 全局偏好、项目指令文件被编辑。
2. **超预算时从最前面逐条丢历史，且丢点每轮重算。** `while (estimatedTokens > budgetTokens && history.length > 0) history.shift()`（`:552-563`）。会话越长，每轮丢掉的条数越多，于是「system 之后的第一条历史」每轮都不同，**整段历史每轮都 miss**。同一函数里 `HISTORY_SCAN_LIMIT = 400`（`:76-80`）在更早处静默截断最老消息，却不置 `truncatedHistory`。
3. **会话级压缩实际上不可达。** `shouldCompress` 要求 `estimatedTokens >= window * 0.8`（`contextCompressor.ts:15`、`:155`），而装配把历史裁到 `floor(window * contextRatio)`，`contextRatio` 默认也是 `0.8`（`turn/budget.ts:26`、`contextAssembler.ts:552`）。裁剪后估算必然 ≤ 0.8，所以除「历史已空仍超限」或「估值恰好等于阈值」外，`compressContext` 永不执行；真实行为是静默丢最老历史，`agent_events` 里也就几乎不会出现 `context.compressed`。
4. **工具数组随可用性增删。** 附件三件套按「本会话是否已有 ready 附件」决定，`web_search`/`fetch_url` 按本轮连接可用性决定（`:126-141`、`:422-424`、`turnRunner.ts:1236` 传入的 `webSearchAvailable`）。tools 位于整个请求最前，任一变化即整段作废。
5. **没有断裂归因。** ADR-057 第 6 条要求把「前缀重建原因」作为数字/枚举记录，实际只把 `PROMPT_VERSION` 写进提示文本（`contextAssembler.ts:71`、`:439`），事件与日志里都没有；命中率骤降时无法区分「我方改了前缀」与「Provider TTL/驱逐」。Q-032 因此只能停留在「先观测」，而观测本身缺维度。

### 1.1 外部实现参考

同为长会话编码 harness 的实现，普遍把「稳定前缀 + 易变内容后置 + 断裂归因」当作同一件事处理：

| 实现 | 做法 | 对本切片的含义 |
|---|---|---|
| OpenAI 官方 | 只对**完整前缀**命中；要求静态指令在前、变量在后；≥1,024 token 才缓存；`prompt_cache_key` 把共享前缀的请求聚到同一后端（官方称有编码客户命中率 60%→87%） | 「易变块后置」是官方建议的默认结构，不是取巧 |
| DeepSeek 官方 | 以前缀**单元**落盘，请求结束位置与公共前缀检测各产生单元；命中是尽力而为，不保证 100% | 跨轮丢点移动会让「上一次请求的结束单元」永远无法完整匹配 |
| Claude Code（第三方源码分析） | 动态 system 段带 `cache break` 标记；CLAUDE.md、日期等 user 侧上下文包成 `<system-reminder>` 元消息；维护 system/tool-schema 哈希快照，用 `cache_read_input_tokens` 下降 >5% 且 >2,000 token 判定断裂，并归因到 TTL / 客户端变更 / 服务端驱逐 | 与本文的诊断设计同构：**先归因，再改行为** |
| Codex CLI（第三方逆向） | 环境上下文用 `<environment_context>` 用户消息承载，并只发送与上次快照的差量 | 易变内容放在消息层、且尽量小，是可行且已验证的路径 |
| Cline 系（网关侧优化） | 客户端把日期/工作目录放在提示最前导致永不命中；网关的 cache aligner 把易变行移到后缀，静态头保持 100% 稳定 | 正是本仓库 `Current date` + 记忆索引所在的位置 |

来源见第 15 节。第三方分析只作为设计参照，不作为正确性依据；本切片的验收仍以本仓库测试与真实 Provider 观测为准。

## 2. 目标

- **G-1 稳定前缀**：跨 Turn 的稳定段固定为「system 核心 + 项目指令 + 已持久化历史」，易变内容（日期、联网策略、记忆索引、全局偏好、会话摘要、附件声明）移到当前请求所在的尾部消息；易变内容变化只作废它自己。
- **G-2 断裂可归因**：每个模型请求记录 `promptVersion`、工具集哈希、历史起点/终点与断点原因枚举；客户端指纹未变但命中骤降时标记为 Provider 侧驱逐，而不是误判为代码回归。
- **G-3 压缩可达且可核实**：会话级压缩阈值低于装配预算，长会话真正走「摘要 + 持久化锚点」，而不是每轮静默丢历史；压缩失败时降级可见。
- **G-4 裁剪有滞回**（SHOULD）：超预算时一次裁到低水位，使丢点在同一位置稳定多轮，而不是每轮前进一格。
- **G-5 工具数组稳定**：会话内 tools 只随显式设置或 Profile 变化，不随「本会话有没有附件」「本轮连接是否抖动」变化。
- **G-6 零新增调用、零语义放宽**：除既有压缩外不新增 LLM 调用；授权、审批、锁、幂等、审计、秘密保护与 `RUNNING ≠ 健康` 语义不变。

## 3. 非目标

- **NG-1** 不自建 KV 缓存、缓存代理或跨账号路由；只依赖 Provider 的前缀缓存规则。
- **NG-2** 不实现 Anthropic 式 `cache_control` 显式断点，也不引入 OpenAI `prompt_cache_key`：现有适配层是 DeepSeek 原生与 OpenAI 兼容端点，新增协议面属于能力扩张，另开切片评估。
- **NG-3** 不跨轮重放工具调用与工具结果来「缝合」前缀。Turn 内折叠使上一轮最终形态不可复现，重放还会显著抬高 token。
- **NG-4** 不压缩 AGENTS.md 或记忆预算来降低固定开销；那是用户契约与产品决策，不是缓存问题。
- **NG-5** 不改 Turn 内 55% 折叠、80%/90% checkpoint、85% rollover 的阈值与顺序（ADR-071）。
- **NG-6** 不改授权、审批、项目锁、幂等、审计与秘密处理；诊断不得记录 prompt、记忆正文、工具参数或工具结果。
- **NG-7** 不新增用户可见设置、开关或图表；现有用量行与 Hint 的呈现不变（ADR-070 2026-11-24 修订）。
- **NG-8** 不改变「缺失不补零、下界用 `≥`」的统计口径。

## 4. 用户故事

- 作为长时间在同一会话里工作的用户，我希望写一条记忆、又或跨过零点之后，前面已经聊过的内容仍然便宜，而不是整段重新计费。
- 作为长会话用户，我希望历史真的被摘要收拢，而不是悄悄变少、模型却以为它还记得。
- 作为维护者，我希望命中率掉下来时能立刻看到「是谁改了前缀」，而不是靠猜 Provider 行为。
- 作为跑定时任务的用户，我希望缓存优化不改变任何执行语义与失败路径。

## 5. 验收场景

### A1 写入记忆不改变稳定前缀（硬门禁）

```gherkin
Given 一个已有一轮历史的项目会话，第一轮请求的 system 与历史已捕获
When 第一轮写入一条项目记忆，然后发起第二轮
Then 第二轮请求的 system 与第一轮逐字节相同
And 第二轮请求的 system 与其回放的历史，构成第一轮请求稳定段的逐字节超集
And 新记忆只出现在当前请求所在的尾部消息中
And 第二轮 model.usage 的 prefixBreak 为 "none"
```

注：上一轮尾部消息承载的是元信息，不进入历史回放，因此不要求「第一轮整条请求是第二轮的严格前缀」；要求的是稳定段逐字节不变。

### A2 日期变化与联网开关只影响尾部

```gherkin
Given 已启用联网的项目会话，第一轮请求已捕获
When UTC 跨日，或用户关闭再打开联网，然后发起下一轮
Then system 字节不变
And 变化只出现在尾部消息（日期行 / 联网策略是否存在）
And prefixBreak 为 "none"，prefixKeptTokens 不小于历史部分的估算
```

### A3 压缩后锚点稳定

```gherkin
Given 历史估算超过压缩阈值、会话第一次压缩已产生摘要与 coveredUpToSeq
When 连续发起三个 Turn（每轮只追加自己的 user/assistant 消息）
Then 三个 Turn 请求中「system 之后的第一条历史」相同
And prefixBreak 只在压缩那一次为 "compacted"
And 后续请求的 prefixBreak 为 "none"
```

### A4 压缩真正触发（回归死代码）

```gherkin
Given 会话历史估算为窗口的 0.75 倍（旧实现必然被裁剪而不压缩）
When 发起新的 Turn
Then 发出 context.compressed 事件并写入 scope='session' 摘要
And 新请求的历史起点大于 0（覆盖 coveredUpToSeq）
And 反例断言：在旧阈值 0.8 下同一输入不触发压缩
```

### A5 工具数组在会话内稳定

```gherkin
Given 一个无附件、Profile 支持附件工具的项目会话
When 第一轮请求发出后再上传一个附件，然后发起第二轮
Then 两轮 tools 数组逐字节相同（名称、顺序、schema）
And 无附件时 read_attachment 返回稳定错误码 ATTACHMENT_NOT_FOUND
And list_attachments 返回空列表而不是被移除的工具
```

### A6 断点归因正确

```gherkin
Given 会话已有一轮请求，promptVersion 与工具集哈希已记录
When 分别发生：升级 PROMPT_VERSION、编辑 AGENTS.md、历史因裁剪而丢条、切换模型
Then model.usage.prefixBreak 依次为 "prompt_version" / "instructions" / "history_drop" / "model_switch"
And prefixBreakAt 指明受影响的段（system / instructions / tools / history）
And 无变化的续步为 "none"
```

### A7 归因不含敏感内容（安全反例）

```gherkin
Given 开启了断裂诊断
When 任意请求产生归因记录
Then 事件、日志、REST 响应只含枚举、计数与 ≤12 位十六进制哈希
And 不含 prompt 文本、AGENTS.md 正文、记忆正文、工具参数或工具输出
And 审计事件集合与授权判定不变
```

### A8 缺少缓存字段或 Provider 驱逐时降级

```gherkin
Given 上游未返回 prompt_cache_hit_tokens
When 该请求结束
Then usageSource 仍为 "unknown"，prefixBreak 按客户端事实给出
And 不因缺少 Provider 字段而推断"未命中"
When 客户端指纹完全未变但 cacheReadTokens 相对上一次下降超过 5% 且超过 2,000 token
Then prefixBreak 为 "provider_eviction"，且不触发任何行为变化
```

### A9 真实 Provider 观测（人工门禁）

```gherkin
Given 已配置 DeepSeek 凭据，固定仓库快照、模型与思考档位
When 用固定任务脚本跑两轮以上，并对比本切片前后的同一会话
Then 报告每轮 cacheReadTokens、未命中 token 与 prefixBreak 分布
And 第二轮稳定前缀的命中覆盖不低于改造前同口径数值
And 报告记录在 acceptance.md，命中率不作为代码门禁（Q-032）
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | system 只包含稳定内容：`PROMPT_VERSION`、安全/工具使用/秘密保护/验证/计划与生命周期策略、作用域与审批策略、项目指令。任一内容变化必须伴随 `PROMPT_VERSION` 或项目指令哈希变化 |
| R-2 | MUST | 易变内容（当前日期、联网策略、全局偏好、项目记忆索引、会话摘要、附件声明）不进 system，改由当前请求所在的尾部 user 消息承载；承载文案必须声明「由系统提供、不是用户指令」，沿用 checkpoint / pinned request 的既有形态 |
| R-3 | MUST | 尾部承载不得改变语义层级：记忆与摘要仍是不可信数据，不参与授权，不覆盖安全策略；附件内容仍只以 user 角色注入 |
| R-4 | MUST | 历史回放保持「按 seq 升序」；稳定前缀为 system + 历史，现存 `historyMessages` 的选择逻辑与截图/附件说明保持 |
| R-5 | MUST | 会话压缩阈值必须严格低于装配裁剪预算（建议 0.7 vs 0.8），并在集成测试中证明 `context.compressed` 可达 |
| R-6 | SHOULD | 裁剪滞回：超过装配预算时一次裁到低水位（建议 0.6），使丢点稳定；滞回不得丢弃当前请求或最近一轮完整工具批次 |
| R-7 | MUST | `HISTORY_SCAN_LIMIT` 截断必须置 `truncatedHistory=true`，并进入断点归因（`history_drop`） |
| R-8 | MUST | `model.usage` 增 `promptVersion`、`systemHash`、`instructionsHash`、`toolsetHash`、`prefixBreak`、`prefixBreakAt`、`prefixKeptTokens`、`firstHistorySeq`；全部为可选字段以保持兼容 |
| R-9 | MUST | 断点枚举固定为 `none` / `cold` / `prompt_version` / `instructions` / `tools` / `history_drop` / `compacted` / `model_switch` / `provider_eviction` / `unknown`；新增值需同步契约 |
| R-10 | MUST | 归因只存元数据：枚举、段名、计数、≤12 位十六进制哈希；禁止存 prompt、记忆正文、工具参数与工具输出 |
| R-11 | MUST | 附件能力启用且 Profile 支持时，附件工具始终出现在 tools 中；无附件时执行层返回稳定错误码，不通过删工具表达不可用 |
| R-12 | SHOULD | 联网工具仍由显式开关决定是否出现；「连接是否健康」只在执行层拒绝，不改变 tools 数组 |
| R-13 | MUST | 任何缓存优化不得改变 Turn 终态、错误码、事件顺序与 Job 判定 |
| R-14 | MUST | `GET /api/sessions/:id/usage` 的 `cache` 增加按 `prefixBreak` 分组的只读汇总（请求数、命中、未命中）；未知口径不进入分母 |
| R-15 | MUST | 本次改动必须与 ADR-057 第 1、6 条一致；若需改变其文字，先按仓库惯例补日期修订段，不直接改写原文 |

## 7. 接口与契约变更

- **REST**：`GET /api/sessions/:id/usage` 的 `cache` 增 `breaks: Array<{ reason, requests, readTokens, missTokens }>`（只读派生自 `model.usage`，缺字段时为空数组）。不新增路由。
- **WebSocket**：
  - `model.usage` 增可选 `promptVersion`（字符串）、`systemHash` / `instructionsHash` / `toolsetHash`（均 ≤12 位十六进制，分别覆盖稳定 system 核心、项目指令、工具 schema）、`prefixBreak`（枚举）、`prefixBreakAt`（`system` / `instructions` / `tools` / `history` / `model`）、`prefixKeptTokens`（估算数字）、`firstHistorySeq`（数字）。字段缺失时前端与聚合层按旧口径处理。
  - `context.compressed` 与 `context.checkpoint` 载荷不变。
- **IPC**：无。
- **配置**：不新增用户可见设置。`COMPRESSION_RATIO`、裁剪滞回水位、诊断阈值作为后端常量，默认值来自本 spec 第 13 节。
- **事件 / 错误码**：不新增事件与错误码；`ATTACHMENT_NOT_FOUND` 复用既有稳定码。

需同步更新：`docs/contracts/ws-events.md`、`docs/contracts/rest-api.md`；`docs/contracts/agent-command-context.md` 若涉及 Turn 起点观察表述则只做一致性核对。

## 8. 数据与迁移

- **新表 / 新列**：无。`prefixBreak` 等只写入 `agent_events.payload`（`model.usage`），`session_context_summaries` 复用既有 `scope` / `coveredUpToSeq`。
- **索引 / 约束**：无变化。
- **迁移与回滚**：不新增迁移，`schemaVersion` 不变。回滚旧代码时新字段被忽略；旧统计只读 `cacheReadTokens` / `noCacheTokens`，不会误读枚举。
- **保留与备份**：沿用 Q-033 的保留期；诊断不增加显著体积（每请求 ≤ 200 字节）。

## 9. 安全、权限与审计

- **身份与授权**：不变；诊断不新增入口。
- **审批级别**：不变；尾部承载不改变任何工具的风险分级。
- **秘密处理**：哈希只覆盖稳定段（system 核心模板、项目指令、工具 schema、历史消息边界）；不对记忆正文、摘要正文、附件内容做哈希或摘要上送。日志与事件复用既有脱敏路径。
- **审计事件**：无新增；`turn.completed` 仍只带既有字段。
- **失败关闭**：记忆库不可读时尾部块省略且不影响前缀；压缩失败时降级为可见的 `history_drop`，不伪造摘要、不把估算当结论。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 记忆库读取失败 | 尾部省略记忆块，system 与历史不变，`prefixBreak=none` | 无（沿用现有静默） |
| 压缩调用超时/返回空 | 保留旧摘要与历史，裁剪并置 `truncatedHistory`，归因 `history_drop` | 现有「上下文已压缩」不出现；时间线不新增提示 |
| 项目指令被编辑 | 下一次请求 system 变化，归因 `instructions` | 无 |
| 升级 `PROMPT_VERSION` | 所有会话该轮 `cold`/`prompt_version` | 无 |
| Provider 未返回缓存字段 | `usageSource=unknown`，不推断命中率 | 现有「未知 N 次请求」 |
| 客户端未变但命中骤降 | 归因 `provider_eviction`，仅记录 | 无 |
| 附件工具常驻但无附件 | 执行层返回 `ATTACHMENT_NOT_FOUND` / 空列表 | 工具结果卡显示稳定错误码 |
| 联网开关切换 | tools 变化导致一次 `tools` 断裂 | 无 |
| 裁剪滞回后历史更短 | 模型收到「更早历史已省略」说明（沿用现有） | 时间线无新增提示 |
| 多模型切换 | 归因 `model_switch`，不尝试跨模型复用 | 无 |

## 11. 可观测性

- **日志**（pino，带 `requestId/sessionId/turnId/stepIndex`）：`promptVersion`、`toolsetHash`、`prefixBreak`、`prefixBreakAt`、`estimatedTokens`、`providerInputTokens`、`cacheReadTokens`、`firstHistorySeq`。
- **指标口径**：按 `prefixBreak` 分组统计 `cacheReadTokens / (cacheReadTokens + noCacheTokens)`；`unknown` 单列；分冷启动、热续步、压缩后、模型切换四类。
- **诊断入口**：会话用量行保持现有 `≥` 与 Hint 文案；REST `cache.breaks` 供诊断与后续验收；不新增图表或设置项。

## 12. 测试计划

- **单元**
  - `apps/server/test/agent/contextAssembler.test.ts`：同一会话两轮之间写入记忆 / 跨日 / 摘要变化时 `messages[0]` 逐字节不变，尾部块内容变化（A1/A2）；裁剪滞回丢点稳定（A3）；`HISTORY_SCAN_LIMIT` 截断置位（R-7）；tools 在有/无附件时一致（A5）。
  - 新增 `apps/server/test/agent/prefixCache.test.ts`：断点分类器对 6 类输入分别给出期望枚举；哈希为 ≤12 位且不含原文（A6/A7）。
  - `apps/server/test/agent/contextCompressor.test.ts`：0.7 阈值可达、0.8 反例不可达（A4）。
  - `apps/server/test/sessions/session-usage.test.ts`：`cache.breaks` 分组、未知口径不进分母（R-14）。
- **集成**
  - `apps/server/test/agent/turnRunner.*.test.ts`：长历史 Turn 触发一次 `context.compressed` 并重建请求；连续两轮历史起点一致；`model.usage` 载荷含新字段且不含正文（A3/A6/A7）。
  - 工具执行层：无附件会话调用 `read_attachment` 返回 `ATTACHMENT_NOT_FOUND`（A5）。
- **E2E**：Mock Chromium 跑一次「两轮 + 上传附件」的会话，断言界面没有新增提示条、用量行文案不变。
- **手动 / 基线**：`LARNESS_DEEPSEEK_SMOKE=1` 固定任务脚本，对比改造前后 `cacheReadTokens`、未命中与 `prefixBreak` 分布，写入 `acceptance.md`（A9）。

## 13. 开放问题

2026-11-24 用户确认（「按照推荐来决定」）：D1–D5 全部采用推荐方案，不再逐项停等。

| ID | 问题 | 结论 | 落点 |
|---|---|---|---|
| D1 | 易变内容放在哪一层 | 合并进当前 user 消息（尾部块，首行声明来源，记忆/摘要仍标不可信）；system 只留稳定段 | PA-1 |
| D2 | 压缩阈值 0.7 + 裁剪滞回 0.6 | 采用：长会话每轮多一次摘要调用可接受，换来不再静默丢历史；压缩失败仍降级为可见裁剪 | PA-4 |
| D3 | 附件工具是否常驻 | 常驻：tools 稳定，能力可见性由 `ATTACHMENT_NOT_FOUND` / 空列表表达 | PA-5 |
| D4 | 归因是否进入 `turn.completed` 累计口径 | 只进 `model.usage` 与 `cache.breaks`；`turn.completed.usage` 口径不变 | PA-2 / PA-3 |
| D5 | 是否实现 `prompt_cache_key` / 显式缓存断点 | 不做；Provider 适配层新增协议能力另开切片 | 无 |

## 14. 完成定义

- [ ] A1–A9 全部通过；A1、A4、A7 进入常规检查；
- [ ] R-1～R-15 落地或明确记录偏差；
- [ ] `docs/contracts/ws-events.md`、`docs/contracts/rest-api.md` 同步；
- [ ] ADR-057 按需补日期修订段（不改原文）；
- [ ] `pnpm check`、`pnpm build`、相关 E2E 通过；真实 Provider 基线有记录；
- [ ] `STATUS.md`、`ROADMAP.md`、`tasks.md` 更新；
- [ ] 人类评审通过（D1–D5 已确认）。

## 15. 参考

- OpenAI《Prompt Caching 201》：<https://developers.openai.com/cookbook/examples/prompt_caching_201>
- OpenAI Prompt Caching 指南（镜像原文）：<https://raw.githubusercontent.com/crasuna/openai-dev-docs-cn-mirror/main/sources/en/api/docs/guides/prompt-caching.md>
- DeepSeek 上下文硬盘缓存：<https://api-docs.deepseek.com/zh-cn/guides/kv_cache/>
- Claude Code 上下文工程分析（含 `promptCacheBreakDetection` 与 `<system-reminder>`）：<https://raw.githubusercontent.com/Windy3f3f3f3f/how-claude-code-works/refs/heads/main/docs/03-context-engineering.md>
- Claude Code 提示词分析（v2.1.126）：<https://raw.githubusercontent.com/agenticloops-ai/agentic-apps-internals/refs/heads/main/claude-code-cli/PROMPT-ENGINEERING.md>
- Codex CLI harness 逆向说明（`<environment_context>` 差量）：<https://github.com/AlexKenbo/codex-harness-internals>
- Cline 系 cache aligner（易变行后置）：<https://github.com/f0o/cline-vertex-gw/blob/main/docs/optimization/cache_aligner.md>
