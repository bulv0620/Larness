# 实施计划：运行时效率（M6）

> 对应 [spec.md](spec.md)。本文件只讲「怎么做」，不改变需求。第 13 节的 D1–D7 确认前不进入 HX-1 之后的实现。

## 1. 技术方案

整体分四条互相独立、可分别回滚的工作流，按「先可观测 → 再正确性 → 后优化」推进：

1. **观测**：把 Provider 已回报的缓存细分接到 `ProviderUsage`、`model.usage` 与 `turns.usage_json` 上，并补 Turn 各阶段耗时。之后所有优化都以真实命中率和时长为依据。
2. **预算与终态**：把 `maxDurationMs` 变成真正的截止时间（计时器 + 中止在途请求 + 剩余时长下发），把 `terminal_reason` 落库并统一事件、DTO、UI、Job 的判定。这一步不依赖缓存优化，独立消除「假成功」与「队列被单步占死」。
3. **上下文**：先修工具结果的裁剪方式（结构感知，永远是合法 JSON），再做 system 拆分与观察移位，最后加每步预检与长 Turn 检查点。检查点必须新建机制——现有 `compressContext` 只处理已持久化的跨轮文本，且显式排除当前 Turn。
4. **工具效率**：`search_code` 的上下文行与扫描预算、只读并发、工具集瘦身对比。收益最小、风险最高，放最后且可单独下线。

### 1.1 稳定前缀（HX-5）

请求体形态固定为：

```text
[0] system  = PROMPT_VERSION + 稳定核心 + 策略行 + 项目指令 + Turn 起点观察快照
[1..n]      = 历史 user/assistant（跨轮，已按摘要裁剪）
[n+1]       = 当前 Turn 输入
[n+2..]     = 本 Turn 逐步追加：assistant(toolCalls) → tool(results) …
```

规则：

- `messages[0]` 在整个 Turn 内只生成一次；删除 `turnRunner.ts:1125-1140` 的每步重装配。
- 观察快照只在 Turn 起点取一次（其中 `runtime.reconcile()` 也只在此时发生）；Turn 内需要最新状态时走显式 `refresh_observations`（L0 只读）或既有 `list_services` / `pm2 list --nostatus` 类查询。
- 工具数组按 `name` 排序生成（`registry.list()` 后 `sort`），并按 Turn 缓存一次。
- 系统提示新增一句事实说明：观察时刻以快照时间戳为准，声明状态前先刷新；`RUNNING` 与 CLI 退出码 0 不构成健康证明（沿用现有措辞，不新增承诺）。
- 契约同步：`docs/contracts/agent-command-context.md:13` 的「模型步骤之间刷新服务观察」由 ADR-057 改为「Turn 起点快照 + 显式刷新」。

### 1.2 每步预检与估算（HX-6）

```text
estimated = lastProviderInputTokens + estimateDelta(本轮新增内容)
budget    = contextWindow * ratio
soft      = contextWindow * 0.70
hard      = contextWindow * 0.90
需要满足  estimated + reservedOutput <= budget
```

- `reservedOutput = min(maxOutputTokensDefault, contextWindow * 0.15)`。
- 首次请求没有 `lastProviderInputTokens` 时用启发式：ASCII 段按 4 字符/token，CJK 与全角按 1 字符/token，再乘 1.05 安全系数；该启发式只在首个请求使用。
- 每步请求前计算；超过 soft 触发检查点（HX-7），超过 hard 直接进入降级（保 `system + 最近一个完整工具批次 + 检查点事实`）。

### 1.3 长 Turn 检查点（HX-7）

- 触发条件：`estimated > soft` 且当前处于完整工具批次边界（所有 tool call 都有对应 result）。
- 事实来源：本 Turn 已持久化事件（`tool.started/completed/failed`、`file.changed`、`plan.*`、`service.*`）中提取——目标、已改文件与版本、命令与退出码、最近失败诊断、未完成计划步骤、资源 ID。模型摘要只作背景段落，且必须与事实段分列，摘要失败不影响事实段。
- 落地形态：把 `messages[1..k]`（历史部分，不含 system）替换为一条 `user` 消息 `Work state checkpoint (verified facts)`；`k` 必须落在批次边界。
- 持久化：写 `session_context_summaries`（`scope='turn'`、`turn_id`、`coveredUpToSeq`、`tokensBefore/After`、`reason`），发 `context.checkpoint` 事件，`degraded` 时保留旧摘要不覆盖。
- 下一 Turn 的历史装配必须忽略 `scope='turn'` 的记录，避免与跨轮摘要重复计数。

### 1.4 工具结果结构裁剪（HX-4）

`toolMessageContent` 改为：先估算内容 token，超预算则**在序列化前**裁剪内容字段，再 `JSON.stringify`。统一信封：

```json
{ "ok": true, "summary": "…", "data": { "…": "…" }, "page": { "truncated": true, "nextOffset": 1200, "omittedChars": 48213, "fullOutputRef": "commandId" } }
```

- 字符串字段超限时保留头 60% + 尾 40%，中间标注 `…[N chars omitted; continue with offset X]`。
- `read_file`：返回 `nextOffset`，`limit` 上限沿用 2000 行。
- `run_command`：`output.head` + `output.tail` + `commandId`（完整输出现有资源读取）。
- 错误结果：保留 `errorCode` 与诊断首行，不裁剪错误码。

### 1.5 秘密校验与重复失败干预（HX-9 / HX-10）

- 秘密：Turn 起点取一次秘密行（不跨 Turn），每次校验仍逐条解密做明文包含检查。这样不会延长明文驻留期，只去掉重复的全表查询。**默认不缓存明文**；如日后要缓存，必须单独评估驻留期。
- 重复失败：Turn 内维护 `Map<"tool|sha256(规范化参数)", 连续失败次数>`。参数规范化 = 键排序后的 JSON，保证参数顺序不同也视为同一调用。失败 +1、成功清零；达到阈值时在对应 tool result 之后追加一条事实说明。只追加说明，不改风险分类、不跳过、不自动放弃。

### 1.6 Token 上限（HX-11）

```text
turnTokens = Σ(step.inputTokens + step.outputTokens) + Σ(摘要调用用量)
每步预检：turnTokens + 本步预计 > maxTotalTokens → 预算终态（detail=tokens）
```

- 只统计 Provider 回报的用量；未知口径不猜测（不把未知当 0 或超限）。
- 与 HX-6 的上下文水位是两件事：前者约束"这一轮花多少"，后者约束"这一次能装多少"。

### 1.7 拆分边界（HX-12）

```text
turnRunner.ts（编排 + 预算判定）
  ├─ turn/providerStep.ts   请求构造、流解析、用量、取消、错误分类
  ├─ turn/toolBatch.ts      锁、审批、执行、结果写入、重复失败计数
  └─ turn/finalize.ts       终态、审计、事件、结果返回
```

拆分只移动代码与提取参数对象，不改事件顺序、错误码与终态。验收以既有 server 577 项测试 + 一个事件顺序快照为准。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持每步重装配 system，只把 PM2 字段换成稳定值 | 改动最小 | 服务/终端/摘要仍会抖动，前缀仍会失效；每步仍有一次 PM2 RPC | 否 |
| system 完全静态，观察改用尾部「变化才追加」块 | 前缀全稳，状态也新鲜 | 每次变化都在尾部新增消息，上下文缓慢增长，需额外去重逻辑 | 备选（D1 未批准时降级） |
| **Turn 起点快照 + 显式刷新工具**（推荐） | 零每步开销、前缀全稳、语义清晰 | Agent 需多一次工具调用才能拿到最新状态 | 推荐 |
| 新增 `BUDGET_EXHAUSTED` 作为 `TurnStatus` | 语义最直白 | 枚举扩散到 web、e2e、契约、历史数据，迁移成本高 | 否 |
| **保留 status + 新增 `terminal_reason`**（推荐） | 兼容所有既有读取方，可渐进展示 | 需要所有判定方同时改读新字段 | 推荐 |
| 新建 `turn_checkpoints` 表 | 语义干净 | 多一张表与一套清理逻辑，与摘要表的生命周期重复 | 否（HX-7 内可复议） |
| **扩展 `session_context_summaries`**（推荐） | 复用现有查询、脱敏、清理与事件 | 表语义变宽，查询必须带 `scope` | 推荐 |
| 字符截断后补 `[truncated]`（现状） | 实现简单 | 产出非法 JSON，丢失分页信息 | 否 |
| **结构感知裁剪 + 分页指针**（推荐） | 模型能继续读，可校验 | 需要逐工具定义保留字段 | 推荐 |
| 跨 Turn 缓存解密后的秘密明文 | 校验最快 | 延长明文驻留期，扩大泄露面 | 否（D8 默认只收敛查询） |
| 重复失败后自动跳过或放弃该调用 | 省步骤 | 改变执行策略与授权语义，越权风险 | 否（只追加提示） |
| 用步数近似 token 预算 | 不用等 HX-1 | 与实际消耗偏差可达数倍，约束失效 | 否（必须用 Provider 回报） |
| 一次性大重构 turnRunner 并顺带修 bug | 省一轮 | 行为改动与结构调整混在一个提交，回归无法定位 | 否（HX-12 纯机械，禁止夹带） |

## 3. 目录与文件变更

```text
新增：
specs/070-runtime-efficiency/{spec,plan,tasks}.md
docs/adr/ADR-057-runtime-efficiency.md
apps/server/drizzle/0023_runtime_efficiency.sql（HX-3 / HX-7）
apps/server/test/agent/runtime-budget.test.ts（HX-2 / HX-3）
apps/server/test/agent/turn-checkpoint.test.ts（HX-7）

修改：
packages/agent/src/providers/{types,deepseek,compatible,fake}.ts     HX-1
packages/agent/src/tools/registry.ts                                  HX-5（稳定排序）
packages/agent/src/tools/fileTools.ts                                 HX-8（搜索参数）
packages/resources/src/files/fileService.ts                           HX-8（上下文行、扫描预算）
apps/server/src/modules/agent/turnRunner.ts                           HX-2/3/4/5/6/7
apps/server/src/modules/agent/contextAssembler.ts                     HX-5/6
apps/server/src/modules/agent/commandTool.ts                           HX-9（秘密查询收敛）
apps/server/src/modules/agent/turn/{providerStep,toolBatch,finalize}.ts  HX-12（拆分新增）
apps/server/src/modules/agent/contextCompressor.ts                    HX-7（scope 过滤）
apps/server/src/modules/jobs/agentRunner.ts                           HX-3
apps/server/src/modules/sessions/turns.ts                             HX-3（TurnDto.terminalReason）
apps/server/src/db/schema.ts                                          HX-3/7
apps/server/src/modules/service-ops/commandContext.ts                 HX-5（快照构造）
apps/web/src/lib/eventReducer.ts、features/chat/*                    HX-1/3（用量细分与终态显示）
docs/contracts/{ws-events,agent-command-context,rest-api,data-model}.md  HX-1/3/5/7
specs/051-agent-tool-contract/spec.md、specs/064-scheduler/spec.md      HX-3/4/8
```

## 4. 实施步骤

1. **HX-0**：确认 D1–D7，批准 ADR-057，更新契约草案与 `ROADMAP` 状态（本文件提交时已登记为 `draft`）。
2. **HX-1**：先写失败测试（SSE 带 `prompt_cache_hit_tokens`），再扩 `ProviderUsage` 与 `mapUsage`，接 `addUsage`、`model.usage`、`turns.usage_json`、web 时间线；补阶段耗时（排队、装配、首 token、工具、摘要）。
3. **HX-2**：先写「Provider 挂起 60s」的失败测试；引入 deadline 计时器与 `abort` 原因；下发 `timeoutMs/maxOutputTokens/maxRetries`；摘要调用共享 signal。
4. **HX-3**：迁移 + `terminal_reason`；`finalize` 与审计写入；Job 判定；REST DTO 与 web 展示。
5. **HX-4**：先写「超限结果必须是合法 JSON」测试；重写裁剪函数；逐工具补分页/尾部字段。
6. **HX-5**：先写出站前缀一致性测试（红），删每步重装配，工具排序与 Turn 缓存，观察快照移位，新增 `refresh_observations`，更新契约与 system 文本。
7. **HX-6**：校准启发式 + 每步预检；用中文/源码/JSON/转义参数四类样本固定误差门槛。
8. **HX-7**：检查点构建（事实提取）→ 替换 → 持久化 → 事件；集成测试用 30 步长 Turn 验证不触发 `PROVIDER_CONTEXT_LIMIT`。
9. **HX-8**：搜索与命令结果增强、只读并发、工具集对比报告。
10. **HX-12**（建议在 HX-4 之前）：先补事件顺序快照用例锁定现状，再做纯机械拆分，最后比对拆分前后事件序列。
11. **HX-9**：先写"含秘密参数被拒 + 查询次数"用例，再注入 per-turn 秘密列表。
12. **HX-10**：FakeProvider 脚本化 5 次相同失败调用，先断言无干预（红），再实现计数与提示。
13. **HX-11**：`TurnBudget` 增字段 → 预检接入 → 终态矩阵补行；默认值等 D10 确认后才启用。

## 5. 数据与迁移

- schema：`turns.terminal_reason`、`session_context_summaries.{scope,turn_id,reason}`、索引 `idx_summaries_session_scope_created`。
- 兼容：全部为可空或带默认值的新列；旧版本代码读写不受影响（旧查询需补 `scope='session'` 才会忽略新行，HX-7 内一并改）。
- 回滚：先回退代码即可；列保留不删。若需彻底回退，`0023` 的 down 只需 `DROP INDEX` + 不删列（SQLite 不重建表）。

## 6. 回滚策略

- 每个任务独立提交、独立可回退；HX-5 与 HX-7 各自一个提交，便于单独 revert。
- HX-5 若上线后出现状态判断退步：保留 `refresh_observations` 工具与既有查询，仅恢复「Turn 起点快照」逻辑，不影响授权与执行。
- HX-7 若检查点质量不达预期：关闭软水位触发（配置置 1.0）即回到现状，数据新列保留无副作用。
- HX-8 只读并发若引入顺序问题：直接移除并发路径，结果追加顺序一律串行。

## 7. 验证命令

```bash
VITEST_MAX_WORKERS=2 pnpm check
pnpm build
pnpm test:e2e
pnpm test:e2e:auth
LARNESS_DEEPSEEK_SMOKE=1 pnpm --filter @larness/agent test   # 真实 Provider 用量/缓存核对
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 观察移位让 Agent 依据过期状态宣称健康 | 错误的部署/预览结论 | system 明确"声明状态前先刷新"；关键写入工具结果自带最新状态；A7 回归 |
| `terminal_reason` 只改后端未改 UI/Job | 仍出现假成功 | HX-3 验收强制覆盖事件、DTO、UI、Job 四处；契约同步 |
| 中英文混排下估算仍偏差 | 误触发压缩或仍超窗 | 以真实 `inputTokens` 做锚点，启发式只用首请求；误差门槛写入测试 |
| 检查点在工具批次中间切断 | 请求被 Provider 拒绝（tool call/result 不配对） | 触发条件要求批次边界；集成测试显式断言配对完整 |
| 用量字段被写入 prompt 或工具输出 | 违反宪法第六条 | 只写数字与枚举；code review 检查事件 payload schema |
| 前缀测试依赖 AI SDK 序列化细节 | 升级 SDK 后误报 | 测试断言"两次请求前缀关系"而非固定快照；SDK 升级照 DEPS 流程复跑 |
| 每步预检改变既有压缩触发点 | 与 M5-1d 的 70% 规则冲突 | `shouldCompress` 保留为开轮规则；新水位只作用于 Turn 内（spec R-4） |
| 拆分过程中"顺手修 bug" | 行为改动混入结构调整，回归无法定位 | HX-12 明令禁止；发现问题只登记 open-questions |
| 重复失败干预被模型理解为"禁止重试" | 模型改用更危险的方式绕过 | 文案只陈述事实与已试次数，不给替代策略；授权语义不变 |
| token 上限设得过低 | 正常任务被提前截停 | 默认值取基线 P95 的 1.5 倍以上；先只观测（HX-1）再启用（D10） |
| 秘密列表按 Turn 缓存后轮换滞后 | 新秘密在同一 Turn 内不生效 | 接受：凭据变更本就要求新 Turn；在文档与测试中显式记录该边界 |

## 9. 未决事项

- D1 资源观察呈现方式（决定 HX-5 的最终形态）。
- D2 终态表达（决定 HX-3 是否需要新 `TurnStatus`）。
- D5 单条结果预算数值、D6 命中率发布门槛、D7 是否上线只读并发。
- D8 秘密校验收敛方式、D9 重复失败阈值与文案、D10 token 上限默认值（D10 阻塞 HX-11）。
- 中断 Turn 恢复与数据保留不在本切片，见 [071](../071-turn-recovery/spec.md)。
- 关联 [遗留问题](../../docs/open-questions.md) Q-031、Q-032。
