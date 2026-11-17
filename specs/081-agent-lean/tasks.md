# 任务：Agent 内核轻量化

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| LE-1 | 观察块移出缓存前缀 | 070 done | `done` |
| LE-2 | 精炼输出约束 | LE-1 | `done` |
| LE-3 | 文案只写一份 | LE-2 | `done` |
| LE-4 | 纯读批次并发 | LE-3 | `done` |
| LE-5 | 每批结果预算 | LE-4 | `done` |
| LE-6 | 验证 | LE-5 | `done` |
| LE-7 | 文档与状态回填 | LE-6 | `done` |

## 任务卡

### LE-1 观察块移出缓存前缀

- 状态：`done`
- 依赖：070（HX-5 已把观察收敛为 Turn 起点快照）
- 目标：让「工作区没变」等于「前缀没变」，跨 Turn 命中整段历史。
- 交付物：
  - `contextAssembler.ts`：`AssembledContext` 新增 `observations: string | null`；`observationBlock()` 统一生成观察块（不含 `observedAt`）；观察块以 `user` 角色追加在全部历史之后，块首行标注「system-provided, not user instructions」；`PROMPT_VERSION` 升级。
  - `turnRunner.ts`：发送时把 `observations` 作为独立消息；检查点重建历史时重新挂回。
  - `observationTool.ts`：`refresh_observations` 描述与观察块口径对齐。
- 验收：观察块与上一 Turn 逐字节相同；system 不含 `updatedAt` 与终端清单。
- 测试：`test/agent/contextAssembler.test.ts`。
- 涉及路径：`apps/server/src/modules/agent/contextAssembler.ts`、`turnRunner.ts`、`observationTool.ts`。

### LE-2 精炼输出约束

- 状态：`done`
- 依赖：LE-1
- 目标：把「回复精炼」变成工程约束，而不是模型的自觉。
- 交付物：`SYSTEM_POLICY` 增加风格段（结论先行、不复述刚写的代码、不重复计划、去掉客套与对冲、仅在用户要求或风险确实高时展开）；`PROMPT_VERSION` → `m6-3`。
- 验收：任一 Turn 的 system 含该段。
- 测试：`test/agent/contextAssembler.test.ts`（策略段存在与版本号）。
- 涉及路径：`apps/server/src/modules/agent/contextAssembler.ts`。

### LE-3 文案只写一份

- 状态：`done`
- 依赖：LE-2
- 目标：同一份生命周期契约不再在三处付费。
- 交付物：服务生命周期契约在 system 保留唯一完整表述；`register_temporary_service` / `resolve_service_preview` / `list_services` / `start_project_terminal` 只写机制与参数约束；PM2 段落只留安全与命名；终端输入协议移进观察块（无终端则不付费）；git 10 个工具与 `run_command` / `update_plan` / `write_file` 描述压缩。
- 验收：固定开销下降且工具语义不丢。
- 测试：`test/agent/service-ops-agent.test.ts`、`test/agent/toolContract.test.ts`。
- 涉及路径：`apps/server/src/modules/agent/{serviceTool,terminalTool,terminalControlTool,gitTool,commandTool,planTool,observationTool}.ts`、`packages/agent/src/tools/fileTools.ts`。

### LE-4 纯读批次并发

- 状态：`done`
- 依赖：LE-3
- 目标：一批互不依赖的只读调用只花一个往返。
- 交付物：`turnRunner.ts` 新增 `READ_PREFETCH_LIMIT = 8` 与预取表；整批满足「`L0` + `requiresProjectLock === false` + 策略 `allow`」且 2–8 个时 `Promise.all` 预取；事件、预算检查与消息追加仍在序列循环中按原顺序执行，消费预取结果而不二次执行；预取抛错的调用不入表，交回序列路径报错。
- 验收：并发批的事件序列与串行一致；混合批不并发。
- 测试：`test/agent/turnRunner.test.ts`。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`。

### LE-5 每批结果预算

- 状态：`done`
- 依赖：LE-4
- 目标：单步不再能一口吞掉窗口。
- 交付物：`turn/toolResults.ts` 新增 `MAX_BATCH_TOOL_RESULT_TOKENS = 12_000` 与 `foldBatchToolResults`；从最旧折叠，最新一条保留原文；折叠沿用既有 Level-1 标记，完整结果仍可从 `agent_events` 回查。
- 验收：超预算批次最旧折叠、最新原样；普通批次不折叠。
- 测试：`test/agent/compaction.test.ts`。
- 涉及路径：`apps/server/src/modules/agent/turn/toolResults.ts`、`turnRunner.ts`。

### LE-6 验证

- 状态：`done`
- 依赖：LE-5
- 目标：确认没有回归，并把失败集合逐个查清而不是整体归因。
- 交付物：见验收记录。
- 验收：`test/agent` 全绿；类型与规范通过；全量并行失败的每一项都有结论。

### LE-7 文档与状态回填

- 状态：`done`
- 依赖：LE-6
- 目标：登记切片、ADR、跨切片引用与遗留项。
- 交付物：`specs/README.md`、`specs/ROADMAP.md`、`STATUS.md`、`docs/adr/DECISIONS.md`、`specs/070-runtime-efficiency/tasks.md`、`docs/open-questions.md`、`docs/contracts/agent-command-context.md`。
- 验收：三处状态一致（`ROADMAP.md` 为准）。

## 验收记录

- 2026-11-16（Windows 11，独立 node v24.19.0 / pnpm 10.34.9）：
- **固定开销实测**（同一注册表、同一 system 组成）：
  - 改动前：工具 schema 18 775 字符 ≈ 4 807 token；system 5 254 字符 ≈ 1 314 token；合计 ≈ 6 130。
  - 改动后：工具 4 465 token；system 745 token（不含 PM2 段落，本次测量环境未注册 PM2 服务）。工具部分净降 **342 token**，system 净降 **569 token**。
- **`test/agent`**：29 文件 / **179 通过**（基线 174 + 本切片新增 5）。
- **`pnpm typecheck`**：6 个包 `tsc --noEmit` 全部通过。
- **`pnpm exec biome ci .`**：退出码 0（16 warnings / 3 infos 均为既有，本切片文件无新增）。
- **全量并行 `pnpm test`（server）**：153 文件 / 744 用例 → **37 失败 / 675 通过 / 31 跳过**，另有 3 个 worker 崩溃。失败项已逐条取名单（JSON 报告），落在命令、Git、终端、PTY、Vite、预览与服务组。
- **串行复跑同样 15 个文件**（`--no-file-parallelism`）：**13 个通过**，只剩 2 项失败。据此判定 35 项为并行负载 / worker 崩溃类（含 `Worker forks emitted error`、`Unable to deserialize cloned data`），与 079 / 080 记录的同类现象一致。
- **2 项真实失败及修复**（本切片契约变更导致，不是环境问题）：
  - `test/resources/services.test.ts:201` 与 `test/resources/default-workspace.test.ts:316` 都断言运行时观察出现在 `messages[0]`（system）。ADR-067 D1 把它们移到了最后一条消息。
  - 改为断言 `model.observations` / 最后一条消息包含观察内容，并补「system 不得包含」的负向断言；`default-workspace` 的 `identify` 断言同时改为新文案的实际大小写。
  - 修后：`services.test.ts` **7/7**、`default-workspace.test.ts` **6/6** 通过。
- **未验证**：
  - `pnpm test` 串行全量未跑（151+ 文件串行约 20 分钟以上）；只对本次失败集合做了定点串行复跑。
  - E2E（`pnpm test:e2e*`）与真实 Provider 的缓存命中率对比未跑：本机无可用凭据，命中率改善只能由用量的 `cachedInputTokens` 观测，不在本切片取证范围。
  - 一次两文件串行复跑在第二个文件**启动阶段**崩溃（`Unable to deserialize cloned data due to invalid or unsupported version`），该文件单独复跑通过，属 vitest worker 的既有抖动。
