# 任务：运行时效率（M6）

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 依赖顺序：HX-0 → HX-12（拆分）→ HX-1 → HX-2 → HX-3 → HX-4 → HX-5 → HX-6 → HX-7 → HX-8；HX-9 / HX-10 / HX-11 可在任意任务之间插入。
> HX-2..HX-4 与 HX-5 之间无技术依赖，但按序实现便于定位回归。HX-12 是纯机械拆分、行为不变，建议紧随 HX-0 完成，以降低后续 6 个任务在同一文件的回归面。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| HX-0 | 规格、ADR 与契约草案 | — | `done` |
| HX-1 | 用量细分（阶段耗时移至 HX-2） | HX-0 | `done` |
| HX-2 | 截止时间与请求级约束 | HX-0 | `done` |
| HX-3 | 终态原因落库与 Job 判定 | HX-2 | `done` |
| HX-4 | 工具结果结构裁剪 | HX-0 | `done` |
| HX-5 | 稳定前缀与资源观察移位 | HX-1 | `done` |
| HX-6 | 每步预算预检与估算校准 | HX-1 | `done` |
| HX-7 | 长 Turn 检查点与有界降级 | HX-6、HX-4 | `done` |
| HX-8 | 编码工具效率与只读并发 | HX-4 | `done`（搜索效率；并发按 D7 不做） |
| HX-9 | 工具参数校验的秘密查询收敛（卫生项） | HX-0 | `todo` |
| HX-10 | 重复失败调用的循环干预 | HX-0 | `done` |
| HX-11 | Turn 级 token 消耗上限 | HX-1 | `done` |
| HX-12 | turnRunner 机械拆分（前置工程动作） | HX-0 | `todo` |

## 任务卡

### HX-0 规格、ADR 与契约草案

- 状态：`done`（2026-11-11，人类确认 D1–D7 全部采用推荐方案；[ADR-057](../../docs/adr/ADR-057-runtime-efficiency.md) accepted，spec 转 `ready`）
- 依赖：无
- 目标：把仓库外方案稿收敛为可验收切片；明确需要 ADR 批准的行为与契约变更；不写实现代码。
- 交付物：
  - `specs/070-runtime-efficiency/spec.md`（A1–A8、R-1～R-14、D1–D7）
  - `specs/070-runtime-efficiency/plan.md`
  - `specs/070-runtime-efficiency/tasks.md`
  - `docs/adr/ADR-057-runtime-efficiency.md`（`proposed`）
  - `specs/README.md`、`specs/ROADMAP.md`、`docs/adr/DECISIONS.md`、`docs/open-questions.md` 登记
- 验收：
  - spec 满足 AGENTS.md §4 的最小集：目标 / 非目标 / GWT / 接口与数据 / 安全 / 失败与边界 / 测试计划；
  - 每一条"现状证据"都能在代码中对应到行号；
  - 与 `docs/contracts/agent-command-context.md:13` 的冲突被显式记录并交由 ADR-057 处理。
- 测试：文档相对链接与锚点校验（沿用既有检查）。
- 涉及路径：`specs/070-runtime-efficiency/`、`docs/adr/`、`specs/README.md`、`specs/ROADMAP.md`、`STATUS.md`
- 备注：D1（观察呈现）、D2（终态表达）、D5（结果预算）、D6（命中率门槛）、D7（只读并发）已于 2026-11-11 确认。D6 的门槛值在 HX-1 基线后另定，不阻塞 HX-1～HX-4。

### HX-1 用量细分与阶段耗时基线

- 状态：`done`（2026-11-11，分支 `task/hx-1-usage-cache-metrics`）
- 依赖：HX-0
- 目标：让"缓存命中"和"时间花在哪"可测量，作为后续所有优化的判据。实际交付只含**用量细分**；阶段耗时移到 HX-2（见备注）。
- 交付物：
  - `ProviderUsage` 增 `cacheReadTokens` / `noCacheTokens` / `usageSource`；
  - `mapUsage` 读取 `totalUsage.inputTokenDetails`（DeepSeek 已把 `prompt_cache_hit_tokens` 映射为 `cacheRead`）；
  - `addUsage` 的合并规则：任一侧未知则记为未知，不把 0 当命中；
  - `model.usage`、`turn.completed.usage`、`turns.usage_json` 同口径；
  - 阶段耗时：排队、上下文装配、首 token、工具执行、摘要调用；
  - web 时间线可选展示命中/未命中。
- 验收：A2 通过；未知口径有独立计数；事件与 DTO 只含数字与枚举。
- 测试：`packages/agent/test/providers/ai-sdk-wire.test.ts` 造带 `prompt_cache_hit_tokens` 与不带该字段的两种 SSE；`eventReducer` 单测。
- 涉及路径：`packages/agent/src/providers/{types,deepseek,compatible,fake}.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`apps/web/src/lib/eventReducer.ts`、`docs/contracts/ws-events.md`
- 备注：`inputTokenDetails` 由 AI SDK 提供，无需升级依赖；真实 Provider 核对用 `LARNESS_DEEPSEEK_SMOKE=1`。
- 偏差记录：阶段耗时（排队 / 装配 / 首 token / 工具 / 摘要）未随本任务交付，移到 HX-2。理由：耗时只有与截止时间、终态一起改才有意义，单独加会在同一段代码做两次契约变更。
- 验证：`packages/agent` 28 通过（1 跳过），`apps/server` `test/agent/turnRunner.test.ts` 16 通过；全量 server 仍有 73 个**环境性**失败（本机无独立 `node`，子进程/PTY 用例由 Electron 充当），与本次改动无关，详见 STATUS。

### HX-2 截止时间与请求级约束

- 状态：`done`（2026-11-11，分支 `task/hx-1-usage-cache-metrics`，随 HX-1 分支连续交付）
- 依赖：HX-0
- 目标：单步不得越过 Turn 截止时间；取消、超时、预算三种中止原因可区分。
- 交付物：
  - `deadline = startedAt + maxDurationMs`，越界时中止在途请求（与用户取消分开的原因）；
  - 每步下发 `timeoutMs = min(适配器默认, 剩余预算)`、`maxOutputTokens`、有界 `maxRetries`；
  - 摘要调用共享同一 signal 与剩余时长；
  - 工具执行沿用 `remainingMs` 但统一取同一 deadline；
  - 阶段耗时（排队、装配、首 token、工具执行、摘要），随 `model.usage` 或独立诊断字段输出（HX-1 移入）。
- 验收：A3 通过；Provider 挂起时 Turn 预算 + 宽限内进入终态；取消路径与超时路径产生不同终态。
- 测试：`apps/server/test/agent/runtime-budget.test.ts` 用 FakeProvider 挂起；断言 abort 时间与终态。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/src/modules/agent/contextCompressor.ts`
- 备注：不改变 `DEFAULT_BUDGET` 的步数 / 工具数 / 时长数值；新增 `maxOutputTokens=8192`（内部常量，未进用户设置）。AI SDK 默认重试必须显式收窄，否则 3×600s 无法被预算约束。
- 实现要点：`deadline` 计时器到点 `abort` 在途请求并置 `deadlineReached`，取消与超时因此可区分；模型请求、摘要调用、工具执行共享同一 deadline；`#waitForApproval` 因超时返回 `cancelled` 时改判预算终态。
- 阶段耗时（原 HX-1 交付物）随本任务落地：`TurnRunner` 接收可选 `logger`，Turn 结束输出 `assembleMs / summaryMs / toolMs / firstTokenMs / durationMs`，只进日志不进事件，避免契约膨胀。
- 验证：`packages/agent` 46 通过 / 1 跳过；`apps/server` `turnRunner + contextCompressor + contextAssembler` 24 通过；`test/agent` 60 通过 / 9 个既有环境性失败（命令与终端用例需要真实 `node`）；biome 与两处 typecheck 通过。

### HX-3 终态原因落库与 Job 判定

- 状态：`done`（2026-11-11）
- 依赖：HX-2
- 目标：完成、预算、截断、Provider 失败、取消四端一致；自动化不再把预算停止记为成功。
- 交付物：
  - 迁移 `0023_runtime_efficiency.sql`：`turns.terminal_reason`；
  - `finalize` 写入枚举并进审计 detail；
  - `turn.completed/failed/cancelled` 事件增 `terminalReason`；
  - REST Turn DTO 增字段；web 时间线显示"预算停止 / 输出截断"；
  - Job：非 `normal` 的 COMPLETED 记 `failed` + `JOB_AGENT_INCOMPLETE`。
- 验收：A3、A4 通过；`budgetExhausted` 事件字段保留兼容；历史 Turn 的 `terminal_reason` 为空时不显示标识。
- 测试：Job 执行器单测；turnRunner 终态矩阵（步数/工具数/时长/截断/取消）；`eventReducer` 单测。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/src/modules/jobs/agentRunner.ts`、`apps/server/src/modules/sessions/turns.ts`、`apps/server/src/db/schema.ts`、`apps/server/drizzle/`、`apps/web/src/lib/eventReducer.ts`、`docs/contracts/{ws-events,rest-api,data-model}.md`、`specs/064-scheduler/spec.md`
- 备注：`TurnStatus` 枚举不变（D2 推荐方案）；如人类选择新增枚举，本任务改为迁移 + 全量读取方改造。
- 实现要点：迁移 `0023_turn_terminal_reason.sql` 加可空 `turns.terminal_reason`；`TurnTerminalReason` 定义在 `@larness/shared`（web 与 server 共用），枚举在 spec 六值基础上增加 `error`，用于非 Provider 的失败（如锁冲突、审批无效），避免把这类失败误标为 `provider_error`。
- 终态推导集中在 `#finalize`：`budgetExhausted` → `budget`，`finishReason=length` → `output_truncated`，取消 / 中断 / Provider 错误码前缀分别映射；事件、REST DTO、审计 detail 三处同值。
- Job 判定：`AgentJobExecutor` 把非 `normal` 的 `COMPLETED` 记为 `failed` + `JOB_AGENT_INCOMPLETE`（新增到 `ScheduledJobRunErrorCode`），旧 Turn 的 `NULL` 仍按 `normal` 兼容。
- UI：时间线在 `completed` 但 `terminalReason` 为 `budget` / `output_truncated` 时显示「预算停止」「输出被截断」；**视觉验收待用户确认**（本环境无浏览器）。
- 验证：`apps/server` `turnRunner + repair + agentRunner` 26 通过；`apps/web` 158 通过；`test/agent` 63 通过 / 9 个既有环境性失败；全包 typecheck 与 biome 通过。

### HX-4 工具结果结构裁剪

- 状态：`done`（2026-11-11）
- 依赖：HX-0
- 目标：任何工具结果都能被模型解析，超限时可继续读，不再产出半截 JSON。
- 交付物：
  - 结构感知裁剪函数（先裁内容、后序列化）；
  - 统一 `page` 信封：`truncated` / `nextOffset` / `omittedChars` / `fullOutputRef`；
  - `read_file` 返回 `nextOffset`；`run_command` 返回 `output.head` / `output.tail` / `commandId`；
  - 错误结果保留 `errorCode` 与诊断首行。
- 验收：A6 通过；大文件按 `nextOffset` 连续读取可还原；命令尾部诊断可读。
- 测试：超限文件、超长命令输出、错误结果三组用例断言 `JSON.parse` 成功与字段齐备。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`packages/resources/src/files/fileService.ts`、`packages/agent/src/tools/fileTools.ts`、`docs/contracts/agent-command-context.md`、`specs/051-agent-tool-contract/spec.md`
- 备注：`MAX_TOOL_MESSAGE_CHARS/LINES` 仅保留给原始终端文本捕获（`boundedTerminalOutput` / `run_command` 读数），模型可见的结果不再经过字符截断。
- 实现要点：新增内容感知序列化 `shrinkValue` / `shrinkString`（长字符串保留头 60% + 尾 40% 并标注省略字符数），按字段预算 4k 字符、整包 16k 字符逐级收缩；超限结果附 `page: { truncated, omittedChars }`，绝不切割已序列化的 JSON。`read_file` 新增 `offset` / `nextOffset` 支持续读（`ReadFileResult` 扩展）。序列化函数导出以便单测。
- 偏差：D5 的「每批次 12k tokens」尚未实现，当前只按单条结果预算；批次级预算留待 HX-6 的整包预检一并处理（那时才有统一的 token 估算）。
- 验证：`packages/agent` 46 通过 / 1 跳过（含 `nextOffset` 续读用例）；`test/agent` 66 通过 / 9 个既有环境性失败；新增 3 个序列化单测（超大结果、错误结果、小结果不变）；biome 与 typecheck 通过。

### HX-5 稳定前缀与资源观察移位

- 状态：`done`（2026-11-11）
- 依赖：HX-1（无 HX-1 时无法验证收益）
- 目标：普通续步请求体是上一次的严格超集；system 与 tools 在 Turn 内逐字节不变。
- 交付物：
  - 删除 `turnRunner.ts:1125-1140` 每步重装配；
  - system 拆为 `PROMPT_VERSION` + 稳定核心 + 策略行 + 项目指令 + Turn 起点观察快照；
  - 工具数组按名称排序并 Turn 内缓存；
  - 新增 `refresh_observations`（L0 只读）返回最新服务/终端/PM2 观察与时间戳；
  - 契约更新：`agent-command-context.md` 的每步刷新条款改为"起点快照 + 显式刷新"；
  - 前缀一致性测试进入常规检查。
- 验收：A1 通过并作为硬门禁；A7 通过；真实热续步命中率有前后对比记录。
- 测试：`ai-sdk-wire.test.ts` 捕获两次 fetch body 比较前缀；部署/预览认证 E2E 回归。
- 涉及路径：`apps/server/src/modules/agent/{turnRunner,contextAssembler}.ts`、`packages/agent/src/tools/registry.ts`、`apps/server/src/modules/service-ops/commandContext.ts`、`docs/contracts/agent-command-context.md`
- 实现要点：system 增加 `PROMPT_VERSION`（`m6-1`），工具数组按名称排序并在 Turn 内只取一次；删除每步 `assembleContext` 重装配，Turn 起点取一次运行时快照；新增 `observationSnapshot.ts` 统一快照构造，system 与 `refresh_observations`（L0、无参数、不申请项目锁）共用同一实现；`ToolContext` / `ExecuteToolInput` 增加 `refreshObservations` 注入；`bootstrap` 注册新工具。
- 契约：`docs/contracts/agent-command-context.md` 的「模型步骤之间刷新服务观察」改为「Turn 起点快照 + 显式刷新」；`specs/051` 记录新工具与结果裁剪。
- 验证（硬门禁）：`ai-sdk-wire.test.ts` 新增「第 2 步请求是第 1 步的严格超集」用例（比较 SDK 序列化后的 `messages` 前缀与 `tools`）；`turnRunner` 新增用例断言 `pm2Context` 每 Turn 只调用 1 次、`messages[0]` 与 `tools` 跨步完全相等、system 含 `PROMPT_VERSION` 与「snapshot at Turn start」；`refresh_observations` 用例验证返回 `observedAt / preview / terminals / pm2` 且不触发审批。`test/agent` 68 通过 / 9 个既有环境性失败，`packages/agent` 47 通过 / 1 跳过，`apps/web` 158 通过；biome 与 typecheck 通过。
- 备注：本任务是本切片唯一改变既有产品行为的项；D1 已确认走「起点快照 + 显式刷新」。「尾部变化才追加」未采用。

### HX-6 每步预算预检与估算校准

- 状态：`done`（2026-11-11）
- 依赖：HX-1
- 目标：每步请求前可知是否超预算，且估算误差可控（尤其中文）。
- 交付物：
  - 每步预检：`estimated + reservedOutput <= window * ratio`；
  - 估算锚定上次上游 `inputTokens` + 尾部增量；首请求用 CJK 感知启发式；
  - soft/hard 水位计算与触发点接入（阈值由 D5 确认）；
  - 四类样本的误差门槛测试。
- 验收：中文长会话不再出现"估算远低于实际"导致的超窗失败；预检不改变开轮 `shouldCompress` 的 70% 规则。
- 测试：中文、源码、JSON、转义命令参数四组；用真实 `inputTokens` 反向校验。
- 涉及路径：`apps/server/src/modules/agent/contextAssembler.ts`、`turnRunner.ts`
- 实现要点：新增 `tokenEstimator.ts`——ASCII 4 字符/token、CJK 1 字符/token、其他 2 字符/token，工具 schema 单独计入；`calibrateEstimate` 用「上次上游 `inputTokens` × 本轮启发式增长比」锚定；`reservedOutputTokens = min(maxOutputTokens, 15% 窗口)`；`contextWatermark` 给出 ok/soft/hard（0.7 / 0.9）。
- 每步预检：`estimated + reserved > window` 时以 `budget` 终态停止，**不发请求**；soft 水位只记日志（检查点在 HX-7 落地）。
- 复用：`contextAssembler` 的开轮估算与截断循环改用同一估算器，删除 `APPROX_CHARS_PER_TOKEN`。
- 验证：新增 `tokenEstimator.test.ts` 6 个用例（长 ASCII、中文对比、转义命令参数、工具 schema、锚定、水位与预留）；`turnRunner` 新增「窗口过小不发送请求」用例；`turnRunner + contextAssembler + contextCompressor + tokenEstimator` 33 通过；biome 与 typecheck 通过。
- 备注：`APPROX_CHARS_PER_TOKEN=4` 对中文低估约 3 倍，已整体替换而非叠加。

### HX-7 长 Turn 检查点与有界降级

- 状态：`done`（2026-11-11）
- 依赖：HX-6、HX-4
- 目标：长 Turn 不因超窗丢失已完成工作，且降级有界、事实可核实。
- 交付物：
  - 事实提取器（从本 Turn 事件取文件版本、命令退出码、失败诊断、计划步骤、资源 ID）；
  - 批次边界检查点替换 `messages[1..k]`；
  - 持久化 `session_context_summaries(scope='turn', turn_id, reason)` + `context.checkpoint` 事件；
  - 摘要失败降级；硬水位降级与预算终态；
  - 跨轮装配忽略 `scope='turn'`。
- 验收：A5、A8 通过；检查点前后体积同口径可比；`degraded` 不覆盖旧摘要。
- 测试：30 步长 Turn 集成测试；tool call/result 配对完整性断言；摘要超时用例。
- 涉及路径：`apps/server/src/modules/agent/{turnRunner,contextCompressor,contextAssembler}.ts`、`apps/server/src/db/schema.ts`、`apps/server/drizzle/`、`docs/contracts/{data-model,ws-events}.md`、`specs/063-multi-provider/spec.md`
- 备注：迁移号顺延——`0023` 已被 HX-3 占用，本任务使用 `0024`，071 的恢复切片顺延为 `0025`。
- 实现要点：新增 `turnCheckpoint.ts`（`TurnFactsBuilder` 收集已改文件与版本、命令摘要、失败诊断、未完成计划步骤、资源 ID，全部有上限）；迁移 `0024` 给 `session_context_summaries` 加 `scope` / `turn_id` / `reason` 与索引；`latestContextSummary` 只读 `scope='session'`，跨轮压缩与 Turn 检查点互不污染。
- 触发：每步预检得到 soft（≥0.7）或 hard（≥0.9）水位时，且已有完整工具批次、事实非空、替换后同口径体积至少减少 200 tokens，才把 `messages[1..]` 替换为一条 `Work state checkpoint` 用户消息；替换后重置估算锚点，避免用旧锚点继续推算。
- 事件：新增 `context.checkpoint`（`summaryId / scope / reason / coveredUpToSeq / tokensBefore / tokensAfter / files / failures / openSteps`），已持久化后再广播。
- **偏差**：检查点只用结构化事实，不调用模型生成摘要（省一次请求与 token，也避免摘要编造）；因此没有「摘要失败降级」路径，`degraded` 恒为 0。A8 的降级分支标记为不适用。
- 附加修复：`FakeProvider` 记录请求时改为快照 `messages` / `tools`，此前保存的是同一个可变数组引用，导致跨步断言（含 HX-5 的前缀门禁）实际读到最终状态。
- 验证：`turnCheckpoint` 3 个单测（事实去重与上限、空态、`scope='turn'` 不污染跨轮摘要）+ Turn 内检查点集成测试（3 步、窗口 1900、断言事件、存储行、`tokens_after < tokens_before` 与替换后的消息条数）；`test/agent` 79 通过 / 9 个既有环境性失败，`packages/agent` 47 通过 / 1 跳过，`apps/web` 158 通过；迁移计数与 `schemaVersion` 期望同步到 24；biome 与 typecheck 通过。

### HX-8 编码工具效率与只读并发

- 状态：`done`（2026-11-11，搜索效率部分）
- 依赖：HX-4
- 目标：减少无关扫描与无效读取，评估工具集瘦身与只读并发的真实收益。
- 交付物：
  - `search_code` 增上下文行、glob、扫描预算；`SearchCodeResult` 扩字段；
  - 只读并发（仅明确无副作用且互不依赖的调用），结果按模型原始调用顺序追加；
  - 固定编码工具集 vs 完整工具集的对比报告（同一基准矩阵）。
- 验收：搜索定位的 token 开销下降且定位准确率不降；权限、锁、审批语义不变；对比报告有数据。
- 测试：搜索参数与结果结构单测；并发路径的顺序断言；工具执行权限回归。
- 涉及路径：`packages/agent/src/tools/fileTools.ts`、`packages/resources/src/files/fileService.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`specs/051-agent-tool-contract/spec.md`
- 实现要点：`search_code` 新增 `contextLines`（0–5，返回匹配行上下文的拼接文本）、`glob`（简单通配，支持 `*.ts` / `src/**` / `**/x`）、`maxFiles`（扫描预算，默认 2000，上限 2 万）；`SearchCodeResult` 增加 `scanBudgetExhausted`；工具描述同步说明"用 path/glob/maxFiles 缩小扫描，用 contextLines 代替反复读文件"。
- 验证：`fileService` 搜索用例覆盖 glob 过滤、上下文行与扫描预算；`packages/agent` 47 通过 / 1 跳过；biome 与 typecheck 通过。
- **偏差（两项未做，理由记录）**：
  1. 只读并发按 D7「默认不做」跳过，未实现也未评估——它需要重排工具批次执行顺序，风险高于收益。
  2. 「固定编码工具集 vs 完整工具集」对比报告未产出：本机没有可用的真实 Provider 凭据与基准环境，凭空写报告会失真；等 HX-1 基线矩阵具备条件后另行评估。
- 工具 schema 变更属执行契约变更，已在 `specs/051` 同步。

### HX-9 工具参数校验的秘密查询收敛（卫生项）

- 状态：`todo`
- 依赖：HX-0
- 目标：把「每次工具参数校验都全表查询并解密全部秘密」收敛为每 Turn 一次查询，同时保持凭据出现在命令参数时的拦截能力。
- 交付物：
  - `createCommandTool` 的 `superRefine` 改为依赖注入的 per-turn 秘密列表（Turn 起点取一次，Turn 结束释放）；
  - 每次校验仍做明文包含检查（不改变拦截语义），不跨 Turn 缓存明文；
  - 计量：一次 Turn 内 `listEncryptedSecrets` 调用次数从「命令数」降到 1。
- 验收：含秘密的参数仍被拒（正反例）；秘密轮换后新 Turn 生效；`pnpm check` 与命令审批回归通过。
- 测试：`apps/server/test/agent/` 命令工具正反例；断言每 Turn 查询次数。
- 涉及路径：`apps/server/src/modules/agent/commandTool.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/src/modules/models/repository.ts`
- 备注：**这是卫生项（可读性 + 明文驻留次数），不是性能项**——实测该路径为微秒级，收益不在耗时。D8 未确认前保持现状：若要跨 Turn 缓存明文，必须先评估明文驻留期延长，默认不做。

### HX-10 重复失败调用的循环干预

- 状态：`done`（2026-11-11）
- 依赖：HX-0
- 目标：同一 `(tool, 参数)` 连续失败时给模型一次明确干预，避免在同一失败上烧掉整个步数预算。
- 交付物：
  - Turn 内记录 `(toolName, argsHash)` 的连续失败次数；
  - 达到阈值（默认 3，可配置）后，在该 tool result 之后追加一条简短事实说明（"该完全相同的调用已连续失败 N 次，结论与上次相同；请更换方式或说明阻塞"），不注入新指令、不放宽授权；
  - 仅对失败结果计数，成功即清零；写入 `tool.failed` 事件的可选字段，供审计与诊断。
- 验收：构造同一失败命令连续调用 5 次的用例，断言第 3 次后出现干预且后续仍按策略执行（不自动跳过、不自动放弃）；步数与 token 有前后对比。
- 测试：`turnRunner` 单测（FakeProvider 脚本化 5 次相同调用）；断言 argsHash 不受参数顺序影响。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`docs/contracts/ws-events.md`（`tool.failed` 增可选字段）
- 实现要点：`stableArgsKey` 对参数做键排序后哈希，保证键序不同也视为同一调用；同一 `(tool, 规范化参数)` 连续失败计数，成功即清零；第 3 次失败（`repeatFailureThreshold`，可配置）后在 tool result 之后追加一条事实说明，并记 `tool.failed.repeatCount` 供审计。执行策略、授权与审批不变。
- 验证：新增用例——同一 `read_file missing.txt` 连续失败 3 次，断言 3 次都执行、第 3 次后出现「failed 3 times in a row」说明、`tool.failed` 事件第 3 条带 `repeatCount: 3`。
- 备注：只做"提示"，不做"禁止/跳过"——后者属于新的执行策略，必须另立 ADR。D9 的默认值（3 次）按 spec 建议启用，文案可后续调整。

### HX-11 Turn 级 token 消耗上限

- 状态：`done`（2026-11-11，默认关闭）
- 依赖：HX-1（无用量细分则无法计量）
- 目标：在步数/工具数/时长之外增加消耗约束，防止「步数内跑完但烧掉大量 token」。
- 交付物：
  - `TurnBudget` 增 `maxTotalTokens`（默认值见 D10），累计取 `inputTokens + outputTokens`；
  - 每步预检接入；超限以 `terminalReason=budget` 结束并记录已改内容与待验证项；
  - 摘要调用计入累计；
  - 配置可覆盖，审计与事件记录超限原因（`budget_tokens`）。
- 验收：构造 3 步即超限的用例，断言终止原因、事件与 Job 判定一致；正常任务不受影响。
- 测试：`runtime-budget.test.ts` 增 token 超限用例；HX-3 的终态矩阵补一行。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/src/db/schema.ts`（如终态细分需要）、`docs/contracts/ws-events.md`
- 实现要点：`TurnBudget.maxTotalTokens`（默认 `0` = 关闭），每步预检按 `input+output` 累计判断，超限以 `budget` 终态结束；摘要调用用量当前不计入（`compressContext` 未回传 usage），已在备注记录。
- 验证：新增用例——`maxTotalTokens: 500` 且首步回报 1000 tokens，断言只发 1 次请求且 `terminal_reason=budget`。
- 备注：**默认关闭**。D10 的人类确认仍未完成，因此只交付字段、校验与测试，不改变默认行为；确认后只需调整默认值。
- 偏差：HX-10 与 HX-11 因共用同一文件的连续改动，合并在一个提交 `feat(agent): stop repeated failing calls and cap spend (HX-10, HX-11)` 中；两者的测试与文档各自独立。

### HX-12 turnRunner 机械拆分（前置工程动作）

- 状态：`todo`
- 依赖：HX-0
- 目标：把 1758 行的 `turnRunner.ts` 按职责拆成可独立测试的模块，**行为零变化**，为 HX-2～HX-8 降低回归面。
- 交付物：
  - 拆出 provider 单步（请求构造、流解析、用量、取消）、工具批次（锁、审批、执行、结果写入）、终态（`finalize`、审计、事件）三个模块；
  - `TurnRunner` 只保留编排与预算判定；
  - 不改变任何对外事件、DTO、错误码、时序。
- 验收：拆分前后 `pnpm check`（server 577 项）全绿；事件序列与终态用例逐条一致；无行为差异的 diff 审查记录。
- 测试：既有 `turnRunner.test.ts` 全量通过即为主要验收；补充一个"事件顺序快照"用例锁定拆分前行为。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、新增 `apps/server/src/modules/agent/turn/`（或等价目录）
- 备注：纯机械动作，禁止夹带行为改动；若发现必须改行为的地方，单独记入 `docs/open-questions.md` 而不是顺手改。建议在 HX-4 之前完成。

## 验收记录

（待任务完成后追加，格式参考 [068](../068-ui-fixes/tasks.md#验收记录)。）
