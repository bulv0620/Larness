# 任务：Agent 内核重构

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。  
> 前置门禁：spec 从 `draft` 转 `ready`，ADR-068 accepted，人类确认默认 Profile、进程/服务契约与锁/审计分级后，才能开始 K-1 之后的实现。> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| K-1 | ADR-068、基线、锁/审计与契约盘点 | — | `done` |
| K-2 | Profile / ToolPack 抽象 | K-1 | `done` |
| K-3 | coding Profile 与核心提示 | K-2 | `done` |
| K-12 | run_command/run_shell 跨平台执行 | K-3 | `done` |
| K-4 | Git 模型工具移除与人类 UI 分面 | K-3 | `done` |
| K-5 | 终端与 Agent 模型面分离 | K-3 | `todo` |
| K-6 | 后台进程能力包 | K-5 | `todo` |
| K-7 | 命名服务与可选预览 | K-6 | `todo` |
| K-8 | 计划可选化 | K-3 | `todo` |
| K-11 | 锁与审计契约收敛 | K-2 | `todo` |
| K-9 | workspace Profile、迁移与 UI | K-4、K-7、K-8、K-11、K-12 | `todo` |
| K-10 | A/B 验证、全量检查与文档回填 | K-9 | `todo` |

## 任务卡

### K-1 ADR-068、基线、锁/审计与契约盘点

- 状态：`done`（2026-11-18）
- 依赖：无
- 目标：把 ADR-068 从 proposed 推进到 accepted，并建立重构前基线。
- 交付物：
  - ADR-068 终稿与人类确认记录（2026-11-18：全部推荐默认、内测允许破坏性重构、存量不保留旧能力）；
  - [baseline.md](baseline.md)：当前 28 工具、固定 token、system 段落、计划触发率、终端/服务调用统计；
  - 锁/审计调用点清单：ProjectWriteLock、命令/Git/Files/ServiceOps 的锁入口、终端租约、appendAudit 调用与失败策略；
  - 受影响的工具契约、REST/WS、数据模型、ADR-030/038/048/059/060/067 清单；
  - “coding / plan / workspace”默认与存量迁移方案：新会话与存量统一 `coding`，`workspace` 仅显式选择；
  - 复现脚本 `apps/server/scripts/kernel-baseline.ts`。
- 验收：
  - 基线可在 [baseline.md](baseline.md) 复现，脚本可重复运行；
  - 每个锁域和审计级别都有“保留 / 收敛 / 移除 / 另切片”的结论；
  - 所有冲突条款有明确结论；
  - ADR-068 状态为 accepted，或 spec 继续 draft。
- 测试：
  - 只读统计脚本或 SQL；文档 lint / 链接检查。
- 涉及路径：
  - `docs/adr/ADR-068-agent-kernel.md`
  - `specs/082-agent-kernel/*`
  - `docs/contracts/*`、`docs/architecture/*`
- 备注：未获人类确认前不得开始 K-2。

### K-2 Profile / ToolPack 抽象

- 状态：`done`（2026-11-18）
- 依赖：K-1
- 目标：引入按 Profile 过滤工具面的最小抽象，不改变现有默认行为。
- 交付物：
  - `AgentProfile`、`ToolPack`、`ToolAvailability` 类型；
  - `providerTools()` 按 Profile / Pack 过滤；
  - 保留当前 28 工具路径作为 `workspace`；
  - 新增 `coding` 装配，但暂不作为默认。
- 验收：
  - 同一会话可显式选择两套工具面；
  - 现有工具顺序、事件、审批、锁不变；
  - 未启用 pack 的 schema 不进入请求。
- 测试：
  - 单元：Profile 过滤、空 pack、未知 pack、requiresProject；
  - 回归：现有 agent 工具契约矩阵。
- 涉及路径：
  - `packages/agent/src/kernel/*`（新增）
  - `apps/server/src/modules/agent/profiles.ts`（新增）
  - `contextAssembler.ts`、`bootstrap/start.ts`
- 备注：此任务不做行为删除，只做装配边界。实际实现：`packages/agent/src/kernel/profile.ts` 提供类型与解析；`apps/server/src/modules/agent/profiles.ts` 提供具体 pack 目录；`contextAssembler` / `turnRunner` 接受 `agentProfile`，默认仍为 `workspace`。`run_shell` 在 K-12 加入 `core.command`。

### K-3 coding Profile 与核心提示

- 状态：`done`（2026-11-18）
- 依赖：K-2
- 目标：让默认 coding 只含核心工具，并验证行为与 token 基线。
- 交付物：
  - coding 工具集：`list_files`、`read_file`、`search_code`、`write_file`、`apply_patch`、`run_command`（`run_shell` 在 K-12 加入）；
  - coding system 提示：不包含计划、终端租约、Git 可用性、服务生命周期；
  - `PROMPT_VERSION` 升版；
  - 固定开销对比报告。
- 验收：
  - A1 通过；
  - 模型工具列表精确匹配；
  - prompt 不含被移除协议；
  - 读写/搜索/命令回归通过。
- 测试：
  - 单元：工具清单、prompt 负向断言；
  - 集成：文件读写、搜索、命令审批。
- 涉及路径：
  - `contextAssembler.ts`、`profiles.ts`、`packs/core.ts`
  - `apps/server/test/agent/contextAssembler.test.ts`
- 备注：默认是否切到 coding 由 K-9 最终确认。

### K-12 run_command/run_shell 跨平台执行

- 状态：`done`（2026-11-18）
- 依赖：K-3
- 目标：让结构化命令成为跨平台主路径，shell 只作为显式逃生口。
- 交付物：
  - `run_command`：`args` 默认 `[]`；别名修复；错误码；stdout/stderr 分离；
  - `run_shell`：命令字符串；POSIX `/bin/sh -c`；Windows PowerShell 7/5.1/CMD；返回实际 shell；
  - 复用现有超时、进程组/进程树停止、输出上限、秘密脱敏与审批；
  - 交互式 TUI 命令明确拒绝；
  - 三平台测试矩阵。
- 验收：
  - A13/A14 通过；
  - `run_command` 不要求 shell 字符串；
  - `run_shell` 不假设 bash，平台语法差异有可操作错误；
  - 超时/取消不残留进程。
- 测试：
  - 单元：schema/别名/错误码/shell 选择；
  - 集成：macOS/Linux/Windows PowerShell/CMD、空格路径、UTF-8、管道、重定向、进程树停止。
- 涉及路径：
  - `packages/shared/src/commands.ts`
  - `packages/resources/src/commands/*`
  - `apps/server/src/modules/commands/*`
  - `packages/agent/src/tools/*`、`packs/core.ts`
- 备注：如果 `run_shell` 的平台差异导致选错工具，再评估合并为 `mode` 字段；当前采用两个清晰工具。

### K-4 Git 模型工具移除与人类 UI 分面

- 状态：`done`（2026-11-18）
- 依赖：K-3
- 目标：模型只通过 shell 使用 Git；人类 Git 面板保持独立。
- 交付物：
  - 从所有 Profile 的模型 registry 移除 10 个 Git 工具；
  - `GitManager` 与人类 Git REST/WS 保留；
  - 人类 Git 写操作使用 ProjectLease；
  - command scanner 对 Agent `git` 写命令的串行化策略。
- 验收：
  - A2 通过；
  - Agent 仍能通过 `run_command` 完成 status/diff/add/commit；
  - Git UI 全流程不回归；
  - 并发写不会静默破坏索引。
- 测试：
  - 单元：工具移除、Git 参数分类、锁等待/冲突；
  - 集成：Agent shell Git + 人类 Git UI 并发；
  - E2E：Git 面板提交/推拉。
- 涉及路径：
  - `gitTool.ts` 注册移除
  - `git/*`、`api/git.ts`、web Git 面板
- 备注：Git 工具代码可保留为人类路径的内部实现，不再进入模型 schema。

### K-5 终端与 Agent 模型面分离

- 状态：`todo`
- 依赖：K-3
- 目标：交互终端只属于人类；Agent 不再创建、读取、输入或停止终端。
- 交付物：
  - 从模型 registry 移除 7 个终端工具；
  - `TerminalManager` 保留给人类 UI/REST/WS；
  - 删除 system 中的终端租约/输入协议；
  - 删除 Agent 终端租约/takeover；人类多客户端只用连接所有权；
  - 旧 AI 终端资源升级后作为人类终端保留。
- 验收：
  - A3 通过；
  - 人类终端创建、输入、关闭、刷新恢复不回归；
  - Agent 工具列表无终端工具；
  - 旧终端事件可回放。
- 测试：
  - 单元：registry 负向断言、prompt 负向断言；
  - 集成：人类终端 API/WS；Agent Turn 与终端并发；
  - E2E：终端窗口输入、关闭、重连。
- 涉及路径：
  - `terminalTool.ts`、`terminalControlTool.ts` 注册移除
  - `contextAssembler.ts`、`terminals/*`、web 终端窗口
- 备注：本任务不删除终端后端能力，只切换消费者。

### K-6 后台进程能力包

- 状态：`todo`
- 依赖：K-5
- 目标：为 Agent 提供非 PTY 的后台进程启动、输出读取与进程组停止。
- 交付物：
  - `ProcessManager`：spawn、cwd、环境、进程组、输出环形缓冲、游标；
  - `start_process`、`read_process_output`、`stop_process`；
  - 幂等键与重复启动策略；
  - 失败/退出/超时/强制停止事件。
- 验收：
  - A4 通过；
  - 停止后无残留子进程/端口；
  - 输出有界且可续读；
  - Windows / macOS 命令与进程组策略有测试。
- 测试：
  - 单元：状态机、环形缓冲、幂等、进程组停止；
  - 集成：真实子进程、端口冲突、启动即退出；
  - E2E：Agent 启动 dev server 并停止。
- 涉及路径：
  - `processManager.ts`（新增）
  - `packs/process.ts`（新增）
  - `api/processes.ts`（新增）
- 备注：交互式 TUI 命令明确不支持，必须使用非交互参数。

### K-7 命名服务与可选预览

- 状态：`todo`
- 依赖：K-6
- 目标：在后台进程上提供命名服务、日志与可选预览。
- 交付物：
  - `start_service` / `list_services` / `read_service_logs` / `stop_service`；
  - 服务绑定项目、processId、命令摘要、端口、健康检查；
  - 幂等：项目 + 名称 + 命令 hash；
  - 预览开关沿用现有配置，不默认开启新语义。
- 验收：
  - A5 通过；
  - 重复启动返回原服务或冲突；
  - 进程退出后服务状态正确降级；
  - 预览关闭不影响服务运行与日志。
- 测试：
  - 单元：幂等、绑定、状态迁移；
  - 集成：服务启动/停止/日志/预览；
  - E2E：服务卡片与预览入口。
- 涉及路径：
  - `packs/service.ts`（新增）
  - `services/*`、`api/services.ts`、`previews/*`
- 备注：是否复用现有 services 表由 K-1 plan 确认；旧临时服务记录只读回放。

### K-8 计划可选化

- 状态：`todo`
- 依赖：K-3
- 目标：计划不再是 coding 默认行为；保留历史与显式 plan Profile。
- 交付物：
  - coding 不注册 `update_plan`；
  - plan Profile 只读文件 + 计划元数据；
  - 删除 `planReminder` 与 wrap-up 中的计划更新要求；
  - 旧 `plan.updated` 事件与 UI 回放保留。
- 验收：
  - A6 通过；
  - coding 不产生计划事件、不注入提醒；
  - plan Profile 计划可用且不能编辑普通文件；
  - 旧计划时间线不变。
- 测试：
  - 单元：registry、prompt、reminder 删除；
  - 集成：plan Profile 工具/权限；
  - E2E：旧计划回放、plan 切换。
- 涉及路径：
  - `planTool.ts`、`turn/planReminder.ts`、`turnRunner.ts`、`profiles.ts`
  - web 计划卡
- 备注：`update_plan` 是否仅 plan Profile 保留见 Q-043。

### K-11 锁与审计契约收敛

- 状态：`todo`
- 依赖：K-2
- 目标：把锁收敛为 ProjectLease + ServiceLease，把审计分为安全关键/资源操作/调试三级；锁与审计不进入内核。
- 交付物：
  - `LeaseManager` 统一 acquire/renew/release；Files/Git/Commands/ServiceOps 不再各自维护锁语义；
  - ProjectLease 保留 TTL、fencing、过期接管、丢失检测与重叠根规则；
  - ServiceLease 只覆盖同一服务目标；
  - Agent 终端不再使用 `terminal_leases`；人类多客户端只保留连接所有权；
  - `AuditSink`：required（fail-closed）、resource（尽量同事务）、debug（只写日志/事件）；
  - 移除 `tool.requested` 审计双写，保留 `tool.denied`、审批与资源生命周期审计。
- 验收：
  - A11/A12 通过；
  - 项目写、Git UI、命令、服务操作全部经 ProjectLease/ServiceLease；
  - 安全关键审计不可用时操作失败；
  - 审计 action/decision/关联 ID 稳定，无秘密与原始输出。
- 测试：
  - 单元：租约过期/接管/丢失、重叠根、服务锁隔离、审计分级；
  - 集成：Git UI 与 Agent shell 并发、文件保存与命令并发、审计失败关闭；
  - 回归：现有 projectWriteLock / gitLockOrder / cross-resource-locks 测试。
- 涉及路径：
  - `modules/locks/*`、`modules/agent/projectWriteLock.ts`、`modules/agent/toolExecutor.ts`
  - `modules/files/*`、`modules/git/*`、`modules/commands/*`、`modules/service-ops/*`
  - `db/repositories/audit.ts`、`api/*`
- 备注：锁/审计只做 adapter 收敛，不把锁表或审计表引入 AgentKernel。

### K-9 workspace Profile、迁移与 UI

- 状态：`todo`
- 依赖：K-4、K-7、K-8、K-11
- 目标：保留后台进程/服务能力作为显式 `workspace` Profile，并完成会话迁移与 UI 展示；不保留旧 Git/终端模型工具。
- 交付物：
  - `workspace` = coding + process + service；
  - 会话 `agent_profile` 持久化与迁移（新会话与存量统一 coding；不做旧能力回填；workspace 仅显式选择）；
  - UI Profile 选择、当前模式与能力提示；
  - 旧会话/旧事件/旧资源兼容。
- 验收：
  - A7/A9 通过；
  - 旧会话升级后使用 coding，历史事件与人类操作面仍可回放；
  - 切换 Profile 不重启未完成 Turn；
  - 人类终端/Git/PM2/预览入口不回归。
- 测试：
  - 迁移测试、E2E Profile 切换、旧数据回放、UI 视觉验收。
- 涉及路径：
  - `sessions/*`、`api/sessions.ts`、`workspaceApi.ts`、web 会话设置
- 备注：迁移策略已于 2026-11-18 确认：存量不保留旧能力；`workspace` 仅显式选择。

### K-10 A/B 验证、全量检查与文档回填

- 状态：`todo`
- 依赖：K-9
- 目标：证明轻量没有牺牲成功率和关键功能。
- 交付物：
  - 同一组 10 个 coding 任务的 coding vs workspace 对比；
  - 固定 token、步数、工具调用、计划次数、测试命令占比、审批等待、锁等待/丢失、审计失败、命令模式分布/失败率、成功率；
  - `pnpm check`、`pnpm build`、相关 E2E；
  - 契约、架构、STATUS、ROADMAP 与 acceptance 记录。
- 验收：
  - 轻量指标达成，成功率不明显下降；
  - 未通过项有原因和后续任务；
  - 人类验收。
- 测试：
  - 全量门禁 + 定向 E2E + 人工视觉。
- 涉及路径：
  - `specs/082-agent-kernel/*`、`STATUS.md`、`docs/contracts/*`
- 备注：若指标不达标，回退默认 Profile，不删除已交付能力。

## 验收记录

### K-1（2026-11-18，macOS）

- 门禁：082 spec `ready`；ADR-068 `accepted`；Q-042～Q-050 全部确认并记录于 [open-questions](../../docs/open-questions.md#已解决)。
- 基线：[baseline.md](baseline.md)。28 工具 / 4 577 schema token；system 747 token；真实数据 98 Turn、970 次工具调用、计划触发率 11.2%、终端 120 次、服务 55 次。
- 锁：实际只创建 project/service 两类；ProjectWriteLock 覆盖 Agent Turn、Files、Git，Commands/ServiceOps 直接 acquire；file/git/global-maintenance 无活动写者；terminal_leases 仅剩人类终端与旧数据。
- 审计：104 个调用点、188 170 行；`tool.requested/completed`、`terminal.input/resize`、Turn 细节降为 debug；`dev-web.rejected`（169 061）与 `git.denied`（13 923）需去重/聚合，但安全拒绝不删除。
- 验证：`pnpm check` 全绿——biome 678 文件、6 包 typecheck、web 257、agent 59（1 跳过）、server 730（14 跳过）。
- 结论：K-2 可以开始；实现前不再需要新的产品决策。

### K-2（2026-11-18，macOS）

- 新增 `packages/agent/src/kernel/profile.ts`：`AgentProfileId`、`ToolPackId`、`ToolPack`、`AgentProfile`、`ToolPackCatalog`、`ToolAvailability`，以及 `profileToolNames()` / `toolAvailability()`。
- 新增 `apps/server/src/modules/agent/profiles.ts`：core.read（3）、core.write（2）、core.command（1）、plan（1）、git（10）、terminal（7）、service（3）、observation（1）；coding = core 三包，plan = core.read + plan，workspace = 全部 8 包。
- `contextAssembler` 按 Profile 过滤工具；`turnRunner` 接受 `agentProfile`；生产默认仍为 `workspace`（`DEFAULT_AGENT_PROFILE`），K-9 再切默认并持久化。
- 测试：`packages/agent/test/kernel/profile.test.ts` 覆盖 coding/workspace/未知 profile/未知 pack/project-required/disabled；`apps/server/test/agent/profiles.test.ts` 覆盖同一 Session 的 28 工具 workspace 与 6 工具 coding、plan 只读面、无项目过滤；contextAssembler/toolContract/turnRunner 回归 60 项通过。
- 说明：`run_shell` 尚未存在，K-12 加入 core.command；K-3 的 A1 负向断言在 K-12 后补齐最终工具清单。

### K-3（2026-11-18，macOS）

- coding 工具面：6 个核心工具（`apply_patch`、`list_files`、`read_file`、`run_command`、`search_code`、`write_file`）；system 不含计划、服务生命周期、Git 可用性、PM2 或终端租约；`PROMPT_VERSION` 升至 `m6-4`。
- 固定开销：coding 6 工具 / 1 174 schema token / 253 system token / 空项目 1 440 token，比 workspace 5 332 降低 73.0%；plan 4 工具 / 730 / 379 / 1 121，降低 79.0%。见 [baseline §3.1](baseline.md#31-k-3-profile-固定开销对比2026-11-18)。
- 默认仍为 `workspace`；K-9 再切换默认并持久化，避免在进程/服务能力就绪前改变现有会话。
- 测试：`profiles.test.ts` 覆盖 coding/plan/workspace 工具清单、system 负向断言、PM2/Git 观察隔离；contextAssembler/toolContract 回归通过。
- 未完成：A1 的最终工具清单还缺 `run_shell`，由 K-12 补齐并复跑负向断言。

### K-12（2026-11-18，macOS）

- `run_command`：`args` 默认 `[]`；`program` / `arguments` / `workdir` / `timeout` 在 schema 前归一；错误码补 `COMMAND_NOT_FOUND` / `INVALID_CWD`。
- `run_shell`：新增工具；POSIX `/bin/sh -c`，Windows 选择顺序 `pwsh` → Windows PowerShell 5.1 → `cmd /d /s /c`；返回实际 `shell`、`exitCode`、分离的 `stdout`/`stderr`、`reasonCode` 与 `truncated`。
- 安全与执行：两种命令共用超时、进程组/进程树停止、输出上限、秘密脱敏、项目锁与审批；`INTERACTIVE_COMMAND` 拒绝 TUI/裸 shell；`SHELL_UNAVAILABLE` 失败关闭。
- 固定开销：coding 7 工具 / 1 462 schema token / 253 system token / 空项目 1 727，比 workspace 5 619 降低 69.3%；见 [baseline §3.1](baseline.md#31-k-3-profile-固定开销对比2026-11-18)。
- 测试：`commands.test.ts` 覆盖真实 `run_shell`、stdout/stderr 分离、别名与默认值；`command-runner.test.ts` 覆盖 shell 成功、缺失 shell、缺失可执行文件；`command-guard.test.ts` 覆盖 TUI/裸 shell/Git 交互；`toolContract` 矩阵加入 `run_shell`；`commands.test.ts` 资源测试覆盖 `INTERACTIVE_COMMAND` 与 `INVALID_CWD`。
- 回归修正：`service-ops.test.ts` 的 preview 拒绝用例此前依赖默认预览端口，单跑返回 400、全量偶发因端口占用返回 503；本任务把测试固定到空闲端口，并断言正式 `tgt_` 不是合法 `svc_` preview ID（400 `VALIDATION_ERROR`）。
- 验证：`pnpm check` 全绿——biome 686 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 740（14 跳过）。
- 平台说明：macOS 实机通过；Windows PowerShell 7/5.1/CMD 逻辑有单元/集成测试，但本轮未在 Windows 实机复测，不冒充三端通过。A1 的最终 coding 工具面已补齐。

### K-4（2026-11-18，macOS）

- 模型面：删除 `gitTool.ts` 与 10 个 Git 工具注册；`ToolPackId` 移除 `git`；`ToolContext` / `ToolExecutor` / `TurnRunner` 移除 `gitRead` / `gitAction` 绑定；`GitManager.runAgentAction` 与 `AgentGitContext` 删除。`workspace` 从 29 工具降为 19 工具，schema 从 4 865 降至 3 947 token。
- 人类面：`GitManager`、Git REST/WS、逐次审批与 ProjectWriteLock 保留；`apps/server/test/git/manager.test.ts` 全流程通过。
- 并发：`run_command` / `run_shell` 均 `requiresProjectLock: true`，与人类 Git 写操作共用同一把 project 锁；因此 Agent shell Git 与 Git UI 写操作继续串行，不需要单独的 Git 命令扫描器。`gitLockOrder.test.ts` 改写为真实 `apply_patch` → `git add` → `git commit`，并断言模型注册表没有 `git_commit`。
- 上下文：system 不再注入 Git 可用性；`refresh_observations` 的 Git 探测保留给人类侧栏自愈，不暴露 Git 工具。
- 验证：`pnpm check` 全绿——biome 684 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 739（14 跳过）。定向覆盖 contextAssembler、profiles、toolContract、Git shell commit 与人类 Git manager。
- 未运行：本轮未跑 Playwright Git 面板 E2E；留到 K-10 全量 E2E 与人工视觉验收。
