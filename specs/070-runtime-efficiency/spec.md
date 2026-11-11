---
id: 070-runtime-efficiency
title: 运行时效率：前缀缓存、上下文预算与停止语义
milestone: M6
status: ready
depends_on: [063-multi-provider, 064-scheduler, 050-deploy]
owners: [human]
created: 2026-11-11
updated: 2026-11-11
approved: 2026-11-11
---

# 运行时效率：前缀缓存、上下文预算与停止语义（M6）

> 状态：`ready`（2026-11-11 人类确认第 13 节 D1–D7 全部采用推荐方案，[ADR-057](../../docs/adr/ADR-057-runtime-efficiency.md) accepted）。来源为仓库外的方案稿《Larness Harness 核心优化方案》（2026-11-11，未入库），本切片把它收敛为可验收任务。
> 架构结论基于 `9fc26d7`；起草时已复核到 `aadfc99`，下列「现状证据」均按当前代码行号标注。

## 1. 背景与问题

聊天与定时 Job 共用同一条 Turn 路径。目标不是「少做几次请求」，而是**让每一次续步请求都成为上一次请求的严格超集**，从而由 Provider 的前缀缓存承担重复内容的成本；同时让长 Turn 在预算内要么完成、要么**诚实地停止**。

按当前代码复核，现有实现有 6 个具体缺口：

1. **前缀被每步重写**。`assembleContext` 每次调用都重查临时服务（含 `updatedAt`）、运行中终端、项目指令、最新摘要与 PM2 上下文（`apps/server/src/modules/agent/contextAssembler.ts:148-206`），全部拼进同一条 system 消息；`turnRunner.ts:1125-1140` 在每一步把 `messages[0]` 整体替换成重新装配的结果。任一服务状态抖动即作废整条前缀。附带成本：每步一次 `runtime.reconcile()` → `pm2.list()`（`docs/contracts/agent-command-context.md:13` 当前明确要求「模型步骤之间刷新服务观察」）。
2. **用量无法度量缓存收益**。`mapUsage` 只取 input/output/total（`packages/agent/src/providers/deepseek.ts:99-118`），`addUsage` 与 `model.usage` 事件同样只有三项。而 `ai` 的 `totalUsage` 已提供 `inputTokenDetails.cacheReadTokens / noCacheTokens`，DeepSeek 适配器已把 `prompt_cache_hit_tokens` 映射进去；即字段现成可用。
3. **截止时间没有接到在途请求**。`checkBudget` 仅在步骤边界比较时长（`turnRunner.ts:373-388`），没有任何计时器中止进行中的请求；`timeoutMs` 与 `maxOutputTokens` 从不传入（`turnRunner.ts:1150-1158`）。适配器默认 600s/步且 AI SDK 默认重试 2 次，而 Turn 预算为 10 分钟：单步可把会话队列占死远超预算。
4. **停止语义不诚实**。`finishReason === "length"`（模型输出截断）与正常完成走同一分支（`turnRunner.ts:1260-1265`）；时长、工具数、步数耗尽一律 `finalize("COMPLETED", { budgetExhausted: true })`（`turnRunner.ts:1113-1115`、`1285-1290`、`1544`），而 `budgetExhausted` 只进事件 payload，不进 `turns` 表（`turnRunner.ts:1676-1683` 只写 status/usage/error）；`apps/server/src/modules/jobs/agentRunner.ts:218-229` 只看 `status === "COMPLETED"` 即记 `succeeded`。
5. **长 Turn 无上下文保护**。压缩只在开轮前触发一次（`turnRunner.ts:1074`），且 `compressibleHistory` 明确排除当前 Turn（`contextCompressor.ts:92`），输入也只有已持久化的 user/assistant 文本——看不到工具调用与工具结果。因此长 Turn 一旦超窗，Provider 返回 `PROVIDER_CONTEXT_LIMIT`，Turn 直接 `FAILED`，本 Turn 内已完成的工作全部丢失。
6. **工具结果按字符切 JSON**。`toolMessageContent` 先 `JSON.stringify` 再按字符截断（`turnRunner.ts:142-151`、`184-199`），超过 20k 字符即在字符串中间切断，模型收到非法 JSON，`data.truncated`、分页位置一并丢失。`run_command` 只回传输出前 12k（`turnRunner.ts:495-520`），尾部诊断与"在哪里看完整输出"缺失。

此外，方案稿把两项已具备的能力列为待做：`read_file` 的 `offset/limit`、`search_code` 的 `path/limit/caseSensitive`（`packages/agent/src/tools/fileTools.ts:22-37`），以及"同一 Turn 固定工具集"（`turnRunner.ts:1064` 已只在开轮取一次）。本切片据此只保留真正的缺口。

### 1.1 复核中另行发现的缺口

同一轮代码复核另行发现 4 项。它们与 M6 的改动落在同一批文件上，因此并入本切片，避免两次改写同一段逻辑：

7. **工具参数校验重复解密全部秘密**（卫生项）。`createCommandTool` 的 `superRefine` 每次参数解析都 `listEncryptedSecrets()` 全表查询并解密全部秘密（`apps/server/src/modules/agent/commandTool.ts:33-58`），而 `defineTool.execute` 每次调用都解析一次（`packages/agent/src/tools/types.ts:79`），风险分类与摘要还会各解析一次。实测为微秒级，所以这是可读性与明文驻留次数问题，**不含可测的性能收益**。
8. **重复失败调用没有干预**。同一 `(tool, args)` 连续失败仍按原样重复执行，`turnRunner.ts` 无重复检测，典型表现是在同一条失败命令上烧掉多个步骤与对应 token。
9. **没有消耗预算**。`TurnBudget` 只有步数、工具数、时长（`turnRunner.ts:74-79`）：任务可以在 30 步内"正常完成"却消耗远超预期的 token。
10. **编排文件过大**。`turnRunner.ts` 1758 行同时承担编排、工具批次、审批、锁、终态与预算判定；本切片要在同一文件改 6 处，回归面过高。

## 2. 目标

- **G-1 可度量的基线**：每个模型请求上报输入、输出、缓存命中、未命中与未知口径，能算出命中率与未知占比。
- **G-2 稳定的请求前缀**：普通续步的请求体是上一次请求的严格超集；system 与 tools 在整个 Turn 内逐字节不变。
- **G-3 贯穿式预算**：模型调用、摘要调用、工具执行共享同一截止时间与取消信号；单步不会越过 Turn 截止时间。
- **G-4 诚实的停止语义**：正常完成、预算耗尽、输出截断、Provider 失败、用户取消在数据、事件、UI 与 Job 四处一致且可区分。
- **G-5 长 Turn 可预期降级**：在软水位建立可核实的检查点，硬水位有界降级，仍超预算则以预算停止结束并保留继续任务所需的事实。
- **G-6 热路径只做必要的事**：工具参数校验不重复全表解密秘密；同一失败调用重复到阈值时被明确干预而不是无限重试。
- **G-7 消耗可约束**：Turn 可设 token 总量上限，超限以预算终态结束并保留继续所需事实。
- **G-8 变更面可控**：`turnRunner` 按职责拆分且行为不变，使 HX-2～HX-8 的回归可定位。

## 3. 非目标

- **NG-1** 不实现自建 KV 缓存或跨请求缓存代理；只依赖 Provider 的前缀缓存规则。
- **NG-2** 不改变工具授权、审批、项目锁、幂等、资源归属与审计语义；预算停止不得绕过任何一条。
- **NG-3** 不把资源观察、项目指令或工具结果写入日志、审计或 `model.usage` 等事件（宪法第六条）。
- **NG-4** 不做模型自动路由、跨 Turn 复用同一请求、或同一条请求内混用 Provider。
- **NG-5** 不宣称沙箱；不因性能改动放宽 `run_command` 的风险分类或自主策略边界。
- **NG-6** 不修改已冻结 ADR；涉及契约的行为变更先由 ADR-057 批准。

## 4. 用户故事

- 作为在本机跑长任务的用户，我希望 Agent 接近窗口上限时仍有条理地继续，而不是在一个 `PROVIDER_CONTEXT_LIMIT` 后丢掉所有已完成工作。
- 作为用户，我希望界面和自动化历史明确告诉我"是预算用完了"而不是把半截结果标成成功。
- 作为维护者，我希望能在不接真实 Provider 的情况下用测试证明"续步没有破坏前缀"，并在真实 Provider 上读到命中/未命中 token。
- 作为跑定时任务的用户，我希望 Agent 任务被预算截停时记为未完成，以便我复核而不是误以为它做完了。

## 5. 验收场景

### A1 普通续步前缀一致（硬门禁）

```gherkin
Given 已配置 DeepSeek 凭据的项目会话，Turn 已完成第 1 个模型步骤与 1 个工具批次
When Turn 发起第 2 个模型步骤
Then 适配器捕获的第 2 次请求体中 system 与 tools 与第 1 次逐字节相同
And 第 2 次请求的 messages 以第 1 次请求的 messages 为完整前缀，只允许在尾部追加
And 捕获到的请求体不落盘、不写入事件与日志
```

### A2 用量细分可度量

```gherkin
Given 上游流式响应返回 prompt_tokens=1200、completion_tokens=80、prompt_cache_hit_tokens=900
When 该步骤结束
Then model.usage 事件包含 inputTokens=1200、outputTokens=80、cacheReadTokens=900、noCacheTokens=300
And turn.completed.usage 累计同等口径
And 上游未返回缓存字段时，cacheReadTokens 为 null 并把该请求计入未知口径
```

### A3 截止时间贯穿在途请求

```gherkin
Given Turn 预算 maxDurationMs=60000 且 Provider 不返回任何数据
When 经过 60 秒
Then 在途请求被中止，Turn 在 5 秒内进入终态
And terminalReason 为 budget_duration，UI 显示"预算停止"而不是"完成"
And 对应定时 Job 记为 failed(JOB_AGENT_INCOMPLETE)
```

### A4 输出截断不等于完成

```gherkin
Given 上游 finish_reason 为 length
When 该步骤不再产生工具调用
Then Turn 终态的 terminalReason 为 output_truncated
And 已产生的文本仍按正常消息可见
And 自动化运行不计为 succeeded
```

### A5 长 Turn 保命

```gherkin
Given 一个 30 步的编码任务，每步工具结果约 4000 tokens
When 每步预检发现估算输入超过软水位
Then Turn 只在完整工具批次之后建立检查点，绝不在 tool call 与 tool result 之间切断
And 检查点含目标、已改文件与版本、命令及退出码、最近失败诊断、未完成步骤
And 后续请求不再触发 PROVIDER_CONTEXT_LIMIT
And 超过硬水位时以 budget 终态结束，不静默丢弃未验证结论
```

### A6 工具结果结构完整

```gherkin
Given read_file 请求的区间超过单条结果预算
When 工具结果进入上下文
Then 该结果仍是合法 JSON，含 summary、page.nextOffset 与相对路径
And 依 nextOffset 连续读取可还原完整文件内容
And run_command 结果为合法 JSON，含 commandId、exitCode、output.head、output.tail 与完整输出位置
```

### A7 资源观察移位后的语义

```gherkin
Given Turn 开始后某个正式服务被人工重启
When Agent 继续执行并准备声明服务状态
Then 系统提示要求先刷新观察，再声明状态
And 显式刷新（refresh_observations 或等价查询）返回最新状态与观察时间
And 仅凭 RUNNING 或 CLI 退出码 0 仍不构成健康证明
```

### A8 摘要失败降级

```gherkin
Given 检查点摘要调用超时或返回空
When 建立检查点
Then Turn 继续，检查点标记 degraded 并使用已有结构化事实
And 不使用空摘要覆盖旧摘要，不把摘要当作验证结论
```

### A9 秘密校验不重复全表解密

```gherkin
Given 会话中配置了 3 个凭据秘密
When 一个 Turn 内连续执行 10 次 run_command
Then 秘密表查询总共只发生 1 次（Turn 起点）
And 含秘密明文作为参数的调用仍被拒绝
And 秘密被轮换后，下一个 Turn 按新值判定
```

### A10 重复失败调用被干预

```gherkin
Given 某个 run_command 参数组合连续失败
When 完全相同的调用第 3 次失败
Then 该 tool result 之后出现一条事实说明，指出同一调用已连续失败 N 次
And 执行策略、授权与审批不变：不自动跳过、不自动放弃
And 干预次数与阈值可审计，步数/ token 有前后对比
```

### A11 token 消耗上限生效

```gherkin
Given Turn 配置 maxTotalTokens
When 累计 input+output 超过该上限
Then Turn 以 terminalReason=budget（detail=tokens）结束
And 事件、DTO、UI 与 Job 判定与 A3 同口径
And 已改内容与待验证事项被保留
```

### A12 拆分不改变行为

```gherkin
Given HX-12 的机械拆分已完成
When 运行既有 server 全量测试与事件顺序快照用例
Then 全部通过，且事件类型、顺序、字段、错误码与拆分前一致
And 拆分提交不含任何行为改动
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | system 由版本化稳定核心（安全、工具使用、秘密保护、验证、服务生命周期、策略行）构成，Turn 内不变；`PROMPT_VERSION` 进入日志与事件元数据 |
| R-2 | MUST | tools 数组按名称稳定排序、描述与 schema 静态；整个 Turn 只解析一次 |
| R-3 | MUST | 资源观察（临时服务、终端、PM2、摘要）不再每步重写 system；改用 Turn 起点快照 + 显式刷新 + 工具结果携带（D1） |
| R-4 | MUST | 每步请求前预检：system + tools + messages + 预留输出额度 ≤ 窗口预算；软水位触发检查点，硬水位触发有界降级 |
| R-5 | MUST | token 估算以「上次上游回报的 inputTokens + 尾部增量启发式」为准，启发式对中文、源码、JSON、转义命令参数有测试 |
| R-6 | MUST | 截止时间贯穿：`timeoutMs` 取剩余预算、`maxOutputTokens` 有界、重试次数有界、截止时中止在途请求，摘要调用共享同一 signal |
| R-7 | MUST | 终态原因落库（`turns.terminal_reason`），事件、REST DTO、UI 与 Job 判定共用同一枚举 |
| R-8 | MUST | 预算耗尽与输出截断不再映射为 Job `succeeded`，错误码稳定 |
| R-9 | MUST | 工具结果结构裁剪：先按 token 预算裁剪内容再序列化，保证合法 JSON；保留 summary、错误码、分页/游标、头部与尾部片段 |
| R-10 | MUST | 长 Turn 检查点在完整工具批次后建立，事实来自已持久化事件（文件版本、命令退出码、失败诊断、计划步骤、资源 ID） |
| R-11 | MUST | 新增观测只存元数据：token 数、命中率、重建原因、体积；不含 prompt、工具参数、工具输出 |
| R-12 | SHOULD | `search_code` 增加上下文行、glob 与扫描预算；`read_file` 返回 `nextOffset`；命令结果含尾部与完整输出位置 |
| R-13 | SHOULD | 只读且互不依赖的工具调用可并发，结果严格按模型原始调用顺序追加（D7） |
| R-14 | MUST | 不变式：授权、审批、锁、幂等、审计、秘密保护、`RUNNING ≠ 健康` 语义在执行层不受影响 |
| R-15 | MUST | 工具参数校验的秘密列表每 Turn 只查询一次；不跨 Turn 缓存明文；拦截语义不变（D8） |
| R-16 | MUST | 同一 `(tool, args)` 连续失败达到阈值后追加事实说明；仅提示，不改变授权、审批、执行策略（D9） |
| R-17 | MUST | `TurnBudget` 含 `maxTotalTokens`，超限以 `budget` 终态结束，累计含摘要调用（D10） |
| R-18 | MUST | `turnRunner` 按职责拆分且行为零变化；对外事件、DTO、错误码、时序不变 |
| R-19 | MUST | 新增的干预与上限都可审计、可关闭，且默认值来自 spec 决策而非代码硬编码 |
| R-20 | MUST | 上述新增能力不扩大模型可做的事：不新增写入工具、不放宽风险分类、不隐藏失败 |

## 7. 接口与契约变更

- **REST**：`TurnDto` 增加 `terminalReason`（可空字符串枚举）。该 DTO 目前的暴露面是 `GET /api/sessions/:id` 的 `activeTurn`（无独立 turns 列表路由，历史轮次靠事件回放），因此本项不新增路由，只扩展既有 DTO 与 `docs/contracts/rest-api.md` 的字段说明。
- **WebSocket**：
  - `model.usage` 增 `cacheReadTokens`、`noCacheTokens`、`usageSource`（`provider` | `unknown`）；现有三字段保持兼容。
  - `turn.completed` / `turn.failed` / `turn.cancelled` 增 `terminalReason`。
  - 新增 `context.checkpoint`（与现有 `context.compressed` 并存；`context.compressed` 语义不变，仅用于开轮压缩）。
- **IPC**：无新增。
- **配置**：Turn 预算默认值（步数、工具数、时长、token 上限、软/硬水位、单条结果预算、重复失败阈值）集中在后端常量与 `config.json` 可选覆盖；不新增用户可见设置项，除非 D5 / D10 明确要求。
- **事件 / 错误码**：`JOB_AGENT_INCOMPLETE`（自动化预算/截断终止）。

需同步更新：`docs/contracts/ws-events.md`、`docs/contracts/agent-command-context.md`（第 13 行"模型步骤之间刷新服务观察"由 ADR-057 替换）、`docs/contracts/data-model.md`、`docs/contracts/rest-api.md`。

## 8. 数据与迁移

- 新列：
  - `turns.terminal_reason TEXT NULL`（`normal` / `budget` / `output_truncated` / `provider_error` / `error` / `cancelled` / `interrupted`）；
  - `session_context_summaries.scope TEXT NOT NULL DEFAULT 'session'`（`session` | `turn`）；
  - `session_context_summaries.turn_id TEXT NULL`；
  - `session_context_summaries.reason TEXT NULL`（`open_turn` / `soft_watermark` / `rebuilt`）。
- 索引 / 约束：`idx_summaries_session_scope_created`（session_id, scope, created_at）；`turn_id` 仅在 `scope='turn'` 时有值。
- 迁移：`apps/server/drizzle/0023_runtime_efficiency.sql` + `meta/_journal.json` 新条目；只加可空列与默认值，不回填、不删除。
- 回滚：旧代码忽略新列即可运行，但 rollback 前必须清理 `scope='turn'` 的摘要行——旧版 `latestContextSummary` 不过滤 scope，会把 Turn 检查点误当作跨轮摘要。因此查询改动（`scope='session'`）与迁移必须同批发布；或回退时先执行 `DELETE FROM session_context_summaries WHERE scope='turn'`。

## 9. 安全、权限与审计

- **身份与授权**：不变。预算停止、检查点、观察刷新都不新增执行入口。
- **审批级别**：不变；`refresh_observations` 为 L0 只读。
- **秘密处理**：用量、检查点、事件只存元数据与工程事实；检查点复用现有 `OutputRedactor` 与工具结果脱敏路径。
- **审计事件**：`turn.completed` 的 audit detail 增 `terminalReason`；`budgetExhausted` 保留兼容。
- **失败关闭**：截止时间到点必须真正中止在途请求；无法确认的执行结果仍走既有幂等与状态查询，不以预算停止为由跳过对账。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 单步越过截止时间 | 中止请求，终态 `budget`（detail `duration`） | 「预算用完，已停止」+ 已改内容与待验证项 |
| 上游返回 context limit | 先尝试硬水位降级；仍失败则 `FAILED` + `PROVIDER_CONTEXT_LIMIT` | 稳定错误码 + 建议继续指令 |
| 输出截断（length） | 终态 `COMPLETED` + `terminalReason=output_truncated` | 「输出被截断」标识 |
| 摘要调用失败 | 检查点 `degraded`，用结构化事实继续 | 不显示错误，仅在诊断处标注 |
| 观察刷新失败（PM2 不可用） | 明确报告不可用状态，不推断健康 | 「PM2 不可用」 |
| 锁丢失 | 维持 `RESOURCE_LOCKED` 失败路径 | 既有提示 |
| 用户取消 | `CANCELLED` + `terminalReason=cancelled` | 既有取消提示 |
| 缓存完全未命中 | 正常执行，仅记录指标 | 无 UI 变化 |
| 预算内提前结束（步数/工具数） | 终态 `budget`，保留继续所需事实 | 「预算用完，可继续」 |

## 11. 可观测性

- **日志**（pino，带 `requestId/sessionId/turnId/stepIndex`）：`promptVersion`、`toolsetVersion`、`rebuiltReason`、`estimatedTokens`、`providerInputTokens`、`cacheReadTokens`、`checkpointCoveredUpToSeq`。只记录数字与枚举。
- **指标口径**：按请求组统计 `cacheReadTokens / (cacheReadTokens + noCacheTokens)`，并报告 `usageSource=unknown` 的占比；分冷启动、热续步、检查点重建、跨模型切换四类。`turn` 维度统计请求数、步数、工具数、总输入、未命中输入、P50/P95 时长与终态原因。
- **诊断入口**：Turn 详情展示终态原因与用量细分；`context.checkpoint` 事件可在时间线查看"压缩了哪一段、压缩前后体积"。

## 12. 测试计划

- **单元**：
  - 前缀一致性：在 `packages/agent/test/providers/ai-sdk-wire.test.ts` 捕获两次请求体，断言 system/tools 逐字节相等且 messages 为前缀关系（A1）。
  - 用量映射：造带 `prompt_cache_hit_tokens` 的 SSE，断言四个字段；造缺失字段断言 `unknown`（A2）。
  - 预算：`remaining` → `timeoutMs/maxOutputTokens` 计算，重试有界（A3）。
  - 终态映射：`length` → `output_truncated`；步数/工具数/时长 → `budget`（A4）。
  - 估算校准：中文、源码、JSON、转义命令参数四类样本，误差门槛在 HX-1 基线后写入。
  - 工具结果裁剪：大文件、长命令输出、错误结果，断言始终为合法 JSON 且含分页指针（A6）。
- **集成**：
  - `turnRunner` 内构造 30 步长 Turn，断言软水位建检查点、硬水位降级、不出现 `PROVIDER_CONTEXT_LIMIT`（A5）。
  - Job 执行器：`budget` / `output_truncated` 终态映射为 failed + `JOB_AGENT_INCOMPLETE`（A3/A4）。
  - 资源观察：Turn 起点快照 + 刷新工具；断言 system 在 Turn 内不变（A7）。
- **E2E**：Mock Chromium 跑一次长任务（多工具批次）与一次预算停止，检查时间线与终态标识；认证 E2E 回归部署/预览路径（A7）。
- **手动 / 基线矩阵**：固定仓库快照、模型、思考档位与输入，覆盖代码定位、跨文件修复、测试失败后续跑、长对话恢复、预览与 PM2 运维；报告通过率、每成功任务总输入/未命中输入、请求数、P50/P95。真实命中率门槛在取得基线后按 Provider 设定。

## 13. 开放问题

| ID | 问题 | 已确认方案（2026-11-11） | 状态 |
|---|---|---|---|
| D1 | 资源观察在 Turn 内如何呈现 | Turn 起点快照 + 显式 `refresh_observations` + 工具结果携带；不做每步注入。替换命令上下文契约的每步刷新条款 | 已确认 |
| D2 | 预算停止的终态表达 | 枚举 `TurnStatus` 不变，新增 `terminal_reason` 列；Job 记 failed + `JOB_AGENT_INCOMPLETE` | 已确认 |
| D3 | 检查点存放位置 | 扩展现有 `session_context_summaries`（`scope`/`turn_id`/`reason`），不新建表 | 已确认 |
| D4 | token 估算校准方式 | 上次上游 `inputTokens` + 尾部增量启发式（CJK 感知），替换固定 chars/4 | 已确认 |
| D5 | 单条工具结果预算 | 每结果 4k tokens、每批次 12k tokens，可配置 | 已确认 |
| D6 | 缓存命中率发布门槛 | 先只观测，不设门槛；取得真实基线后按 Provider 设定 | 已确认（门槛值后置） |
| D7 | 只读并发是否上线 | HX-8 内单独评估，默认不做 | 已确认（默认不做） |
| D8 | 秘密校验的收敛方式 | 只把秘密列表收敛为每 Turn 一次查询，仍每次解密；不跨 Turn 缓存明文 | 已确认（2026-11-12） |
| D9 | 重复失败干预的阈值与文案 | 连续 3 次完全相同失败后追加事实说明；只提示不阻断 | 已确认（2026-11-12） |
| D10 | token 上限默认值 | 保持默认 `0`（关闭），等 HX-1 真实用量基线出来后再定默认值 | 已确认（2026-11-12）：默认关闭 |

缓存口径补充：官方说明命中需要**完整匹配一个缓存前缀单元**，且缓存是尽力而为、不保证 100% 命中，官方也未承诺延迟收益。因此 G-2 的验收只断言"请求体为严格超集"，命中率作为观测量而非硬门禁。

## 14. 完成定义

- [ ] 第 5 节 A1–A12 全部通过；A1 作为硬门禁进入常规检查，A12 以既有全量测试 + 事件顺序快照为准；
- [ ] 第 6 节 R-1～R-20 落地或明确记录偏差；
- [ ] `docs/contracts/*` 与受影响的 spec（051、063、064）同步；
- [ ] 迁移 `0023` 通过升级与回滚验证；
- [ ] `pnpm check`、`pnpm build`、相关 E2E 通过，真实 Provider 基线矩阵有记录；
- [ ] `STATUS.md`、`ROADMAP.md`、`tasks.md` 更新；
- [ ] 人类评审通过（D1、D2、D5–D10 已确认）。
