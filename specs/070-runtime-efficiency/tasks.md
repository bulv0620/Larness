# 任务：运行时效率（M6）

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 依赖顺序：HX-0 → HX-12（拆分）→ HX-1 → HX-2 → HX-3 → HX-4 → HX-5 → HX-6 → HX-7 → HX-8；HX-9 / HX-10 / HX-11 可在任意任务之间插入。
> HX-2..HX-4 与 HX-5 之间无技术依赖，但按序实现便于定位回归。HX-12 是纯机械拆分、行为不变，建议紧随 HX-0 完成，以降低后续 6 个任务在同一文件的回归面。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| HX-0 | 规格、ADR 与契约草案 | — | `done` |
| HX-1 | 用量细分与阶段耗时基线 | HX-0 | `todo` |
| HX-2 | 截止时间与请求级约束 | HX-0 | `todo` |
| HX-3 | 终态原因落库与 Job 判定 | HX-2 | `todo` |
| HX-4 | 工具结果结构裁剪 | HX-0 | `todo` |
| HX-5 | 稳定前缀与资源观察移位 | HX-1 | `todo` |
| HX-6 | 每步预算预检与估算校准 | HX-1 | `todo` |
| HX-7 | 长 Turn 检查点与有界降级 | HX-6、HX-4 | `todo` |
| HX-8 | 编码工具效率与只读并发 | HX-4 | `todo` |
| HX-9 | 工具参数校验的秘密查询收敛（卫生项） | HX-0 | `todo` |
| HX-10 | 重复失败调用的循环干预 | HX-0 | `todo` |
| HX-11 | Turn 级 token 消耗上限 | HX-1 | `todo` |
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

- 状态：`todo`
- 依赖：HX-0
- 目标：让"缓存命中"和"时间花在哪"可测量，作为后续所有优化的判据。
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

### HX-2 截止时间与请求级约束

- 状态：`todo`
- 依赖：HX-0
- 目标：单步不得越过 Turn 截止时间；取消、超时、预算三种中止原因可区分。
- 交付物：
  - `deadline = startedAt + maxDurationMs`，越界时中止在途请求（与用户取消分开的原因）；
  - 每步下发 `timeoutMs = min(适配器默认, 剩余预算)`、`maxOutputTokens`、有界 `maxRetries`；
  - 摘要调用共享同一 signal 与剩余时长；
  - 工具执行沿用 `remainingMs` 但统一取同一 deadline。
- 验收：A3 通过；Provider 挂起时 Turn 预算 + 宽限内进入终态；取消路径与超时路径产生不同终态。
- 测试：`apps/server/test/agent/runtime-budget.test.ts` 用 FakeProvider 挂起；断言 abort 时间与终态。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/src/modules/agent/contextCompressor.ts`
- 备注：不改变 `DEFAULT_BUDGET` 数值，除非 D5 确认；AI SDK 默认重试必须显式收窄，否则 3×600s 无法被预算约束。

### HX-3 终态原因落库与 Job 判定

- 状态：`todo`
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

### HX-4 工具结果结构裁剪

- 状态：`todo`
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
- 备注：`MAX_TOOL_MESSAGE_CHARS/LINES` 由 token 预算替代，保留常量迁移说明；改动涉及工具结果契约，需同步 051 的"成功条件"描述。

### HX-5 稳定前缀与资源观察移位

- 状态：`todo`
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
- 备注：本任务是本切片唯一改变既有产品行为的项；D1 已确认走「起点快照 + 显式刷新」，ADR-057 已 accepted。「尾部变化才追加」仅作为实现受阻时的降级，采用前需回到 ADR。

### HX-6 每步预算预检与估算校准

- 状态：`todo`
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
- 备注：`APPROX_CHARS_PER_TOKEN=4` 对中文低估约 3 倍，必须替换而非叠加。

### HX-7 长 Turn 检查点与有界降级

- 状态：`todo`
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
- 备注：不复用 `compressContext`——它排除当前 Turn 且只读已持久化文本；需新增独立函数并复用其脱敏与持久化路径。

### HX-8 编码工具效率与只读并发

- 状态：`todo`
- 依赖：HX-4
- 目标：减少无关扫描与无效读取，评估工具集瘦身与只读并发的真实收益。
- 交付物：
  - `search_code` 增上下文行、glob、扫描预算；`SearchCodeResult` 扩字段；
  - 只读并发（仅明确无副作用且互不依赖的调用），结果按模型原始调用顺序追加；
  - 固定编码工具集 vs 完整工具集的对比报告（同一基准矩阵）。
- 验收：搜索定位的 token 开销下降且定位准确率不降；权限、锁、审批语义不变；对比报告有数据。
- 测试：搜索参数与结果结构单测；并发路径的顺序断言；工具执行权限回归。
- 涉及路径：`packages/agent/src/tools/fileTools.ts`、`packages/resources/src/files/fileService.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`specs/051-agent-tool-contract/spec.md`
- 备注：D7 已确认——并发只在本任务内单独评估，默认不做；工具集变更属契约变更，需同步 051 的说明与受影响界面提示。

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

- 状态：`todo`
- 依赖：HX-0
- 目标：同一 `(tool, 参数)` 连续失败时给模型一次明确干预，避免在同一失败上烧掉整个步数预算。
- 交付物：
  - Turn 内记录 `(toolName, argsHash)` 的连续失败次数；
  - 达到阈值（默认 3，可配置）后，在该 tool result 之后追加一条简短事实说明（"该完全相同的调用已连续失败 N 次，结论与上次相同；请更换方式或说明阻塞"），不注入新指令、不放宽授权；
  - 仅对失败结果计数，成功即清零；写入 `tool.failed` 事件的可选字段，供审计与诊断。
- 验收：构造同一失败命令连续调用 5 次的用例，断言第 3 次后出现干预且后续仍按策略执行（不自动跳过、不自动放弃）；步数与 token 有前后对比。
- 测试：`turnRunner` 单测（FakeProvider 脚本化 5 次相同调用）；断言 argsHash 不受参数顺序影响。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`docs/contracts/ws-events.md`（`tool.failed` 增可选字段）
- 备注：只做"提示"，不做"禁止/跳过"——后者属于新的执行策略，必须另立 ADR。D9 确认阈值与文案。

### HX-11 Turn 级 token 消耗上限

- 状态：`todo`
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
- 备注：默认值需人类确认（D10）；未确认前不启用，只保留字段与测试。

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
