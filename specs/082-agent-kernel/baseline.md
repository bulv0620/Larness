# 082 Agent 内核重构：K-1 基线

> 生成日期：2026-11-18（macOS arm64）。
> 目的：在改写工具面、提示、锁与审计之前留下可复现的事实。本文只记录测量结果与决策，不改变产品行为。
> 复现脚本：`apps/server/scripts/kernel-baseline.ts`。

## 1. 方法与范围

- 工具、schema 与 system 数字来自一个**临时空数据库**：运行迁移，登记一个项目、一个 Session、一个 Turn，并按 `bootstrap/start.ts` 的当前生产注册顺序装配 28 个工具，再调用 `assembleContext()`。临时目录在脚本结束时删除。
- 真实使用数字来自本机数据目录 `~/Library/Application Support/larness/larness.db`，以 SQLite `readonly` 模式打开；未写入、未复制业务数据、未输出命令原文、工具参数或秘密。
- 锁与审计调用点来自 `apps/server/src` 静态检索；每个调用点按“保留 / 收敛 / 移除 / 另切片”给出结论。
- 本基线不代表其他平台；Windows / Linux 的行为仍以对应任务与实机记录为准。

复现命令：

```bash
pnpm --filter @larness/server exec tsx scripts/kernel-baseline.ts
LARNESS_BASELINE_DATA_DIR="$HOME/Library/Application Support/larness" \
  pnpm --filter @larness/server exec tsx scripts/kernel-baseline.ts
```

环境：Node `v24.22.2`，pnpm `10.34.9`，Darwin arm64。

## 2. 工具面基线

当前生产注册 **28 个工具**，按名字排序后固定发送。schema 合计 **4 577 token / 17 816 bytes**（估算器见 `tokenEstimator.ts`；与 spec 的“约 4.5k token”一致）。

| 工具 | 风险 | 需要项目 | 默认项目锁 | schema tokens | schema bytes |
|---|---|---:|---:|---:|---:|
| `acquire_terminal_control` | L1 | 否 | 否 | 138 | 533 |
| `apply_patch` | L1 | 否 | 是 | 221 | 869 |
| `git_add` | L1 | 是 | 否 | 108 | 416 |
| `git_branches` | L0 | 是 | 否 | 95 | 361 |
| `git_commit` | L1 | 是 | 否 | 86 | 325 |
| `git_create_branch` | L1 | 是 | 否 | 88 | 333 |
| `git_diff` | L0 | 是 | 否 | 96 | 365 |
| `git_log` | L0 | 是 | 否 | 100 | 382 |
| `git_pull` | L2 | 是 | 否 | 99 | 378 |
| `git_push` | L2 | 是 | 否 | 63 | 235 |
| `git_status` | L0 | 是 | 否 | 97 | 371 |
| `git_switch_branch` | L1 | 是 | 否 | 86 | 328 |
| `interrupt_terminal` | L2 | 否 | 否 | 146 | 567 |
| `list_files` | L0 | 否 | 是 | 106 | 408 |
| `list_services` | L0 | 是 | 否 | 118 | 455 |
| `read_file` | L0 | 否 | 是 | 136 | 525 |
| `read_terminal_output` | L0 | 否 | 否 | 156 | 607 |
| `refresh_observations` | L0 | 否 | 否 | 153 | 593 |
| `register_temporary_service` | L2 | 是 | 否 | 395 | 1 564 |
| `release_terminal_control` | L1 | 否 | 否 | 126 | 485 |
| `resolve_service_preview` | L0 | 是 | 否 | 169 | 657 |
| `run_command` | L2 | 否 | 是 | 345 | 1 365 |
| `search_code` | L0 | 否 | 是 | 189 | 739 |
| `send_terminal_input` | L2 | 否 | 否 | 243 | 954 |
| `start_project_terminal` | L2 | 是 | 否 | 394 | 1 557 |
| `stop_project_terminal` | L1 | 是 | 否 | 148 | 573 |
| `update_plan` | L0 | 否 | 否 | 299 | 1 178 |
| `write_file` | L1 | 否 | 是 | 177 | 693 |
| **合计** | | | | **4 577** | **17 816** |

> K-4 后 10 个 Git 工具已从模型面移除；K-5 后 7 个终端工具也已移除，`workspace` 变为 12 工具 / 2 596 schema token。本表保留 K-1 的重构前基线，便于对照。

### 2.1 按能力分组

| 组 | 工具数 | schema tokens | 占固定工具开销 |
|---|---:|---:|---:|
| 文件与搜索 | 5 | 829 | 18.1% |
| 计划 | 1 | 299 | 6.5% |
| 命令 | 1 | 345 | 7.5% |
| 终端 | 7 | 1 351 | 29.5% |
| Git | 10 | 918 | 20.1% |
| 服务 | 3 | 682 | 14.9% |
| 观察 | 1 | 153 | 3.3% |

> 终端 + Git + 计划合计 **2 568 token**，占固定 schema 的 **56.1%**；这是 082 的主要削减对象。

## 3. System prompt 基线

`PROMPT_VERSION = m6-3`。空项目 Turn 的 system 为 **747 token / 2 987 bytes**，按段落拆分：

| 段落 | tokens | bytes |
|---|---:|---:|
| `Larness prompt version: m6-3.` | 8 | 29 |
| 核心策略（身份、工具、安全、计划、精炼输出） | 290 | 1 160 |
| 服务生命周期契约 | 361 | 1 445 |
| 当前作用域 | 13 | 52 |
| 审批策略与风险决策 | 74 | 293 |
| **合计** | **747** | **2 987** |

真实项目还会追加 Git 可用性、PM2 上下文、项目指令、摘要和截图提示；终端运行时还会追加终端协议。当前空项目 `assembleContext()` 估算总量为 **5 332 token**（system + 当前请求 + 28 工具 schema）。`SERVICE_LIFECYCLE_POLICY` 单独占 system 的 48.3%，是删除/按需注入的头号目标。

### 3.1 K-3 Profile 固定开销对比（2026-11-18）

`apps/server/scripts/kernel-baseline.ts` 在同一个空项目上分别装配三个 Profile：

| Profile | 工具数 | schema tokens | system tokens | 空项目 assembled tokens | 相对 workspace |
|---|---:|---:|---:|---:|---:|
| `coding` | 7 | 1 462 | 253 | 1 727 | **-61.5%** |
| `plan` | 4 | 730 | 379 | 1 121 | **-75.0%** |
| `workspace` | 18 | 3 741 | 741 | 4 492 | 基线 |

`coding` 的 system 不再包含计划、服务生命周期或 PM2；`workspace` 保留后台进程、命名服务与观察能力，但不再包含终端工具或终端观察。`run_shell` 已在 K-12 加入 `core.command`；Git 在 K-4 移除，终端在 K-5 移除，后台进程在 K-6 加入，命名服务在 K-7 加入；上表为 K-7 后的数字。

## 4. 真实使用基线

数据目录：`~/Library/Application Support/larness`（只读）。
Session / Turn 总量：**98 个 Turn**，其中 98 个有事件；**11 个 Turn 出现计划事件**，计划触发率 **11.2%**。这与“计划成为默认行为”的假设不完全一致：计划只在部分 Turn 出现，但一旦出现会持续注入提示与 UI。

工具调用总计 **970 次**（按 `agent_events.type = 'tool.requested'` 的 `name` 统计）：

| 组 | 次数 | 占工具调用 |
|---|---:|---:|
| 文件与搜索（list/read/search/write/patch） | 432 | 44.5% |
| `run_command` | 300 | 30.9% |
| 终端（7 工具） | 120 | 12.4% |
| Git（10 工具） | 33 | 3.4% |
| 服务（含旧正式服务工具） | 55 | 5.7% |
| 计划（`update_plan`） | 25 | 2.6% |
| 观察（`refresh_observations`） | 5 | 0.5% |

单工具前 10：

| 工具 | 次数 |
|---|---:|
| `run_command` | 300 |
| `read_file` | 208 |
| `list_files` | 88 |
| `apply_patch` | 80 |
| `read_terminal_output` | 53 |
| `search_code` | 52 |
| `start_project_terminal` | 34 |
| `update_plan` | 25 |
| `list_services` | 22 |
| `register_temporary_service` | 19 |

其他事实：

- 由 Agent 创建的终端：**30 个**；服务记录：**22 个**。
- 命令执行记录：**281 次**，状态分布 `COMPLETED 239 / FAILED 41 / TIMED_OUT 1`。
- 历史事件中仍出现旧工具 `list_formal_services`、`build_formal_artifact`（各 2 次）；它们已不在当前 28 工具注册中，属于旧会话回放数据，不得删除。

**测量限制**：`command_executions` 只保存 `params_hash`，不保存 `executable`/`args`；`tool.requested` 事件只保存 `toolName` 与 `argsSummary`，`run_command` 的 summary 是通用文案。因此“测试/构建命令占比”**无法从现有持久化数据可靠计算**。本基线不猜测该数字；K-12 若需要该指标，必须在命令执行记录中新增安全的命令摘要（不含 env、stdin、秘密或原始输出），并单独迁移/测试。

## 5. 锁调用点清单与结论

当前实际创建的锁行只有 `resourceType = project` 与 `service`。`ResourceLockType` 还声明了 `file`、`git`、`global-maintenance`，但检索不到对应的 `acquireResourceLock` 调用；旧行仍可能存在于数据库，必须保持可读。

| 锁域 | 调用点 | 当前行为 | K-1 结论 |
|---|---|---|---|
| ProjectWriteLock | `modules/agent/projectWriteLock.ts`；`turnRunner.ts`、`files/service.ts`、`files/actions.ts`、`git/manager.ts` | 包装 `resource_locks` 的 project 锁；TTL 30s、fencing、续租、丢失检测、重叠根检查 | **保留并演进为 ProjectLease 统一入口**；Files/Git/Commands 不再各自实现 acquire/release |
| 直接 project 锁 | `commands/manager.ts:302`、`service-ops/serviceOps.ts:442`、`service-ops/deployments.ts:291` | 直接调用 `acquireResourceLock`，自己续租/释放 | **收敛到 ProjectLease**；保留现有 TTL/fencing/心跳语义 |
| ServiceLease | `service-ops/serviceOps.ts`（部署与运维）、`service-ops/deployments.ts`、`services/manager.ts`（临时服务） | 直接锁同一 service/target；部分路径同时持有 project + service | **保留并收敛为 ServiceLease**；只覆盖同一目标，不与项目写锁混用；固定顺序 project → service |
| `file` / `git` 锁类型 | 类型声明与旧数据 | 无新调用 | **不再创建**；类型保留读取兼容，K-11 决定是否从活动类型移除 |
| `global-maintenance` | 类型声明与宪法锁顺序 | 无当前调用 | **保留为维护/升级预留**，不新增业务写者；不进入 Agent 工具面 |
| Agent 终端租约 | `terminal_leases`、`terminals/manager.ts`、`terminalControlTool.ts` | Agent 与人类共用租约、generation、inputSequence、takeover | **Agent 侧移除**（K-5）；人类终端只保留连接所有权；旧行可读 |
| 人类终端所有权 | `terminals/manager.ts` | 当前用 `terminal_leases` | **保留但简化**：仅多客户端输入归属，不进入模型工具、不做 Agent takeover |
| 项目重叠根 | `locks/repository.ts` 的 `rootHasWriter` | ProjectWriteLock 与直接 project 锁共享 | **保留**；ProjectLease 继续执行同一重叠根规则 |

锁顺序：宪法要求 `global-maintenance → project → service → file/git`。由于 file/git 锁不再新建，K-11 的实际顺序收敛为 `project → service`；`global-maintenance` 仍可在维护路径使用。不得在持有 project 锁时反向获取 service 锁。

## 6. 审计调用点清单与分级结论

当前 `appendAudit` 调用点 **104 处**（不含定义本身），本机数据库累计 **188 170 条**审计记录。真实分布暴露了两个噪声源：

| action | 行数 | 说明 |
|---|---:|---|
| `dev-web.rejected` | 169 061 | 全部为 `UNAUTHENTICATED`，来自开发 Web 轮询/未授权请求 |
| `git.denied` | 13 923 | 多为 `VALIDATION_ERROR` / `GIT_UNAVAILABLE` 的 API 拒绝 |
| `tool.requested` | 1 142 | 每次工具调用双写审计 |
| `tool.completed` | 811 | 每次工具完成再写审计 |
| `terminal.input` | 420 | 每次终端输入都写审计 |
| `command.created/finished/started` | 836 | 命令生命周期 |
| `approval.requested/granted` | 402 | 审批链 |
| `tool.denied` | 151 | 工具拒绝 |

分级结论（K-11 实施）：

| 级别 | 范围 | 失败策略 | 结论 |
|---|---|---|---|
| **required（安全关键）** | 认证、配对、Passkey、设备撤销、会话撤销、审批请求/决定/失效、所有 `*.denied` 授权拒绝、权限/凭据变更、部署授权与审批、服务启停、秘密相关、`storage.cleanup`、`server.shutdown` | **fail-closed**：审计不可用则操作失败 | 保留；不得吞异常 |
| **resource（资源操作）** | 文件写入/保存/动作、命令创建/启动/完成/失败、Git 动作创建/批准/执行/失败、终端 takeover/interrupt/control.released、临时服务登记/注销、项目/会话/Job 生命周期、模型可见性/默认值变更 | 与业务写入同事务；不能同事务则失败关闭；只读查询可 best-effort | 保留；统一 `AuditSink.resource()` |
| **debug（调试）** | `tool.requested`、`tool.completed`、`terminal.input`、`terminal.resize`、`model.catalog.refreshed`、Turn 状态细节、token/耗时 | 只写 `agent_events` / 日志，不写审计 | 从审计移除；事件流已持久化 |

具体判断：

- `tool.requested` / `tool.completed`：**移除审计双写**；`tool.denied` 保留 required。工具请求/完成继续通过 `agent_events` 回放。
- `terminal.input` / `terminal.resize`：**降为 debug**；`terminal.takeover`、`terminal.interrupt`、`terminal.denied`、`terminal.control.released` 保留 resource/required。
- `dev-web.rejected`：保留 required，但必须修复重复轮询或在审计层做**去重/聚合**；不能简单删除安全拒绝记录。169k 条同码记录不构成有效证据。
- `git.denied`：授权拒绝保留 required；`VALIDATION_ERROR` 这类参数错误可降为 debug，避免把模型/客户端错误写成安全审计。
- `turn.started/completed/cancelled`：**降为 debug**，以 `agent_events` 为准；`session.created/deleted`、`session.revoked`、审批与部署继续保留。
- `model.catalog.refreshed`：debug；`credential.*`、`model.default.changed`、`model.visibility.changed` 保留 required/resource。
- 审计条目继续使用稳定 `action`、`decision` 与 `sessionId/turnId/toolCallId/requestId`；不记录秘密、原始命令、env、stdin 或输出正文。

## 7. 契约与 ADR 影响清单

| 文档 / 决策 | 影响 | K-1 结论 |
|---|---|---|
| `specs/051-agent-tool-contract/spec.md` | 工具描述、风险级别、执行契约 | K-3/K-12/K-4/K-5/K-8 逐项更新并跑 `toolContract` 矩阵 |
| `docs/contracts/agent-command-context.md` | 命令上下文、PM2 环境、终端生命周期 | K-12 增加 `run_shell`；K-5 移除 Agent 终端协议；K-7 增加服务契约 |
| `docs/contracts/rest-api.md` | Session Profile、进程/服务 REST、工具面变化 | K-2/K-9 增加 `agentProfile`；K-6/K-7 增加进程/服务入口 |
| `docs/contracts/ws-events.md` | `process.*` / `service.*` 事件；旧事件兼容 | K-6/K-7 新增事件；旧 `terminal.*` / `git.*` / `plan.updated` 保持回放 |
| `docs/contracts/data-model.md` | `sessions.agent_profile`；进程/服务持久化 | K-2 加列；K-7 冻结服务存储；旧表只增不删 |
| `docs/contracts/m2-resources.md` | 终端与资源窗口 | K-5 更新“终端仅人类”；旧 AI 终端转人类终端 |
| `docs/contracts/m3-preview.md` / `services-preview.md` | 服务绑定、预览可选 | K-7 更新；预览默认沿用 ADR-060 |
| `docs/architecture/security.md` | 终端隔离、审计分级、进程组停止 | K-5/K-6/K-11 同步安全边界 |
| `docs/adr/ADR-030` | 临时服务由 Terminal 启动、Agent 通过 PTY 操作 | **替代** Agent 终端服务模型；人类终端与预览保留 |
| `docs/adr/ADR-038` | Agent 终端 Shell 生命周期 | **替代** Agent 交互规则；人类终端 Shell 不受影响 |
| `docs/adr/ADR-048` | 开发服务/正式服务分域 | **不替代**；正式 PM2 运维仍走人工入口 |
| `docs/adr/ADR-059` | 长任务预算与自动接续 | **不替代**；082 不改预算模型 |
| `docs/adr/ADR-060` | 本机预览默认开启 | **不替代**；沿用现有默认 |
| `docs/adr/ADR-067` | Agent 内核轻量化 | **补充**；从文案压缩推进到工具面/内核边界 |

## 8. 迁移方案

已获人类批准：内测版本允许破坏性重构，**存量会话不保留旧能力**。

- `sessions` 增加 `agent_profile`（K-2 冻结列名，建议 `agent_profile`，`text not null default 'coding'`）。
- 新会话与存量会话都归一到 `coding`；不创建 legacy Profile，不做旧能力回填。
- `workspace` 仅作为用户显式选择的 Profile：`coding` + 后台进程 + 命名服务。
- 旧 `plan.updated`、`terminal.*`、`git.*`、服务事件与旧终端/服务记录保留，只读回放；不删除历史表。
- `resource_locks` 结构保留；ProjectLease/ServiceLease 复用它；`terminal_leases` 保留旧行与人类终端兼容，Agent 不再创建。
- 任何新列/表必须有迁移、回滚和旧数据可读测试；禁止静默清理。

## 9. 测试与验证基线

- 现有定向测试参考：`apps/server/test/agent/toolContract.test.ts`、`contextAssembler.test.ts`、`terminalControl.test.ts`、`gitLockOrder.test.ts`、`projectWriteLock.test.ts`、`planReminder.test.ts`、`turnRunner.test.ts`。
- K-1 只新增只读基线脚本；产品代码零变更。
- 2026-11-18 本机 `pnpm check` 结果：biome 678 文件通过；6 个包 typecheck 通过；web 46 文件 / 257 测试通过；agent 7 文件 / 59 测试通过（1 跳过）；server 148 文件 / 730 测试通过（5 文件 / 14 测试跳过）。本轮未出现此前记录的真实子进程/PTY 并行抖动。
- 平台矩阵不在本机外推；Windows / Linux 结果继续按任务记录。

## 10. K-1 结论

1. 固定工具开销 4 577 token，终端 + Git + 计划占 56.1%；移除/按需注入这三组是最大收益。
2. system 747 token，其中服务生命周期 361 token；K-3/K-5/K-7 必须把它移出默认 coding system。
3. 计划触发率 11.2%，但 `update_plan` 仍进入默认 schema；K-8 改为 plan Profile 后，coding 不再支付 299 token 与提醒逻辑。
4. 终端工具调用 120 次（12.4%），服务 55 次（5.7%）；K-6/K-7 的后台进程/服务能力有真实需求，不是凭空新增。
5. 锁只有 project/service 两类实际使用；K-11 可以安全收敛，file/git 锁类型不再新建。
6. 审计 104 个调用点、188k 行；`tool.requested/completed`、`terminal.input/resize`、`turn.*` 应降为 debug，`dev-web.rejected` 与 `git.denied` 的重复拒绝必须去重/聚合，但安全拒绝不能删除。
7. 命令参数未持久化，测试/构建命令占比不可得；K-12 如需该指标，先补安全的命令摘要。
