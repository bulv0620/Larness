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
| K-5 | 终端与 Agent 模型面分离 | K-3 | `done` |
| K-6 | 后台进程能力包 | K-5 | `done` |
| K-7 | 命名服务与可选预览 | K-6 | `done` |
| K-8 | 计划可选化 | K-3 | `done` |
| K-11 | 锁与审计契约收敛 | K-2 | `done` |
| K-9 | workspace Profile、迁移与 UI | K-4、K-7、K-8、K-11、K-12 | `done` |
| K-10 | A/B 验证、全量检查与文档回填 | K-9 | `in_progress` |

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

- 状态：`done`（2026-11-18）
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

- 状态：`done`（2026-11-18）
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

- 状态：`done`（2026-11-18）
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

- 状态：`done`（2026-11-18）
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

- 状态：`done`（2026-11-18）
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

- 状态：`done`（2026-11-18）
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

- 状态：`in_progress`（2026-11-18；确定性 A/B、全量门禁与文档已完成，真实 Provider A/B 待 Key/预算）
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

### K-5（2026-11-18，macOS）

- 模型面：删除 `terminalTool.ts` / `terminalControlTool.ts` 与 7 个终端工具注册；`ToolPackId` 移除 `terminal`；`ToolContext` / `ToolExecutor` / `TurnRunner` 移除终止、读取、输入、中断、租约 handler；`workspace` 从 19 工具降为 12 工具，schema 从 3 947 降至 2 596 token。
- 上下文：system 与观察块移除终端租约/输入协议；`refresh_observations` 不再返回终端列表；`PROMPT_VERSION` 升至 `m6-5`。
- 人类终端：`TerminalManager`、REST/WS、输入租约、resize、takeover、断开清理与旧记录保留；删除 `acquireAgent` / `inputAgent` / `interruptAgent` / `releaseAgent` / `releaseAgentLeases` / `renewAgentLeases` 与 `AgentTerminalContext`。旧 Agent 租约在 `expireLeases` 时清理，不再阻塞人类接管。
- 测试：`apps/server/test/resources/terminals.test.ts` 16 项人类终端测试通过；`default-workspace.test.ts` 改为 Agent 文件 + `run_command` 默认工作区测试并通过；`packages/agent` 63 测试通过（1 跳过）；contextAssembler/profiles/toolContract/turnRunner/commandSecret 定向 66 项通过。
- 验证：`pnpm check` 全绿——biome 680 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 729（14 跳过）。
- 未运行：未跑浏览器终端窗口 E2E；API/WS 与真实 PTY 已由 server 测试覆盖，浏览器视觉留到 K-10。

### K-6（2026-11-18，macOS）

- 新增 `ProcessManager`：spawn、项目相对 cwd、POSIX 进程组（Windows 使用进程树终止）、1 MiB / 5000 块环形输出缓冲、cursor / resync、启动幂等键、同名重复启动冲突、启动即退出失败、停止幂等。
- 新增 `start_process`（L2）/ `read_process_output`（L0）/ `stop_process`（L1），仅 `workspace` Profile；`ToolContext` / `ToolExecutor` / `TurnRunner` 绑定完整；`workspace` 从 12 工具升至 15 工具，schema 从 2 596 升至 3 175 token。
- 新增 `GET /api/processes`、`GET /api/processes/:id`、`GET /api/processes/:id/output`、`POST /api/processes/:id/stop`，使用现有认证 / Origin / CSRF 守卫；不开放通用 POST 创建入口。
- 事件：`process.started` / `process.exited` / `process.stopped` 写入 `agent_events` 后再广播；payload 不含原始参数、环境或输出正文。
- 锁边界：后台进程启动时执行授权 / 路径 / 秘密检查，但不长期持有项目写锁，避免 dev server 阻塞源码写；停止失败返回 `STOP_UNCONFIRMED`，不伪报成功。
- 测试：`processes.test.ts` 覆盖真实进程启动、输出游标、重复启动、同名冲突、停止、重复停止、进程组退出、启动即退出、交互命令拒绝与 REST 列表/输出；`toolContract` 矩阵加入 3 个进程工具；`profiles` 断言 workspace 15 工具。
- 验证：`pnpm check` 全绿——biome 685 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 731（14 跳过）。
- 未运行：Windows 实机进程树停止未复测；端口冲突未单独建集成用例（服务登记在 K-7 才引入）。

### K-7（2026-11-18，macOS）

- 新增 `NamedServiceManager`：在 `ProcessManager` 上绑定项目、`processId`、命令摘要、端口、可选 `healthPath` 与状态；同一项目 + 名称 + 命令幂等，不同命令同名冲突，端口占用启动前拒绝，健康检查失败停止进程并失败关闭，进程退出后按需降级状态。
- 新增 `start_service`（L2）/ `read_service_logs`（L0）/ `stop_service`（L1），仅 `workspace`；`list_services` 合并命名进程服务与旧临时终端服务。
- 新增 `GET /api/process-services`、`/:id`、`/:id/logs`、`/:id/stop`，沿用认证 / Origin / CSRF 守卫。
- 持久化边界：命名服务与进程状态保存在内存，生命周期写 `agent_events`，不新建表，也不复用 `services`（该表的 `terminalId` / `executionIdentity` 语义绑定终端预览源）。Larness 重启后临时开发进程不恢复，符合 ADR-004 的临时资源边界；如需跨重启历史，另开迁移。
- 预览边界：进程服务 `previewEligible=false`，预览仍只服务既有终端服务；关闭预览不影响服务运行与日志。该缺口在验收中明确，不冒充进程服务已可预览。
- 测试：`named-services.test.ts` 覆盖真实 HTTP 服务启动/健康检查、重复启动、同名冲突、日志、列表、停止与重复停止、端口占用；`toolContract` / `profiles` 断言 3 个服务工具与 workspace 18 工具。
- 验证：`pnpm check` 全绿——biome 690 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 733（14 跳过）。
- 未运行：浏览器服务卡片与预览 E2E 未跑；留到 K-9 UI / K-10 全量验收。

### K-8（2026-11-18，macOS）

- `coding` / `workspace` 不再包含 `update_plan`，workspace 从 18 工具降为 17 工具，schema 从 3 741 降至 3 442 token；system 不再包含计划策略，`PROMPT_VERSION` 升至 `m6-6`。
- `plan` Profile 保留只读文件 + `update_plan`，不能编辑普通项目文件；计划只在显式 plan 模式出现。
- 删除 `turn/planReminder.ts`、`PLAN_STALE_TOOL_CALLS` 与陈旧提醒测试；TurnRunner 不再维护计划步数/提醒状态，wrap-up 文案不再要求更新计划。
- 旧 `plan.updated` 事件、计划卡与回放保留；`plan.test.ts` 的计划持久化/重放测试改为显式 `agentProfile: "plan"`。
- 测试：plan/contextAssembler/profiles/toolContract/turnRunner 定向 64 项通过；workspace/coding 负向断言与 plan 正向断言覆盖。
- 验证：`pnpm check` 全绿——biome 688 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 727（14 跳过）。

### K-11（2026-11-18，macOS）

- 新增 `LeaseManager`：`acquireProject` / `acquireService` / `renew` / `release` / `releaseById` / `get` / `find`；`ProjectWriteLock`、Commands、ServiceOps、Deployments、Files recovery、Resources recovery 全部改为经它访问 `resource_locks`。检索确认 `modules/locks` 之外没有 `acquireResourceLock` / `renewResourceLock` / `releaseResourceLock` 调用。
- 锁域：ProjectLease 保留 TTL/fencing/过期接管/丢失检测/重叠根；ServiceLease 仅同一目标；人类终端只保留连接所有权；Agent 终端租约已移除。
- 新增 `AuditSink`：`required` 失败抛 `RESOURCE_UNAVAILABLE`（fail-closed）；`resource` 直接写入并让异常传播；`debug` 不写审计表。`tool.denied` 改用 required；`tool.requested` / `tool.completed` / `terminal.input` / `terminal.resize` 审计移除；`dev-web.rejected` 按分钟聚合；`git.denied` 跳过 `VALIDATION_ERROR`。
- 测试：`auditSink.test.ts` 覆盖 required 失败关闭与 debug 不入表；锁/命令/终端/ServiceOps/Deployments/Git 定向 90 项通过；`projectWriteLock`、`gitLockOrder`、`cross-resource-locks` 回归通过。
- 验证：`pnpm check` 全绿——biome 691 文件、6 包 typecheck、web 257、agent 63（1 跳过）、server 729（14 跳过）。
- 说明：既有约 100 个 `appendAudit` 调用点仍保留在各自事务内，基线已按 required/resource/debug 分类；本轮优先移除调试双写与噪声，未机械改写全部调用点，行为上安全关键路径继续失败关闭。

### K-9（2026-11-18，macOS）

- 迁移：`sessions.agent_profile`（`0032_agent_profile.sql`），`NOT NULL DEFAULT 'coding'`；新会话与存量会话统一 `coding`，`workspace` 仅显式选择。迁移计数测试全部从 31 更新为 32。
- 服务端：`SessionDto` / `CreateSessionInput` / `UpdateSessionInput` / Session repository 增加 `agentProfile`；`POST /api/sessions` 与 `PATCH /api/sessions/:id` 接受 `coding|plan|workspace`；TurnRunner 在 Turn 开始时读取 `session.agentProfile` 装配工具集，不再使用全局默认 Profile。`DEFAULT_AGENT_PROFILE` 改为 `coding`。
- UI：Composer 增加 Agent Profile 下拉（Coding / Plan / Workspace）与当前模式图标/提示；草稿会话在创建时提交 Profile；已有会话通过 PATCH 保存。会话详情类型与 API 客户端同步。
- 兼容：旧事件、旧终端/服务记录、旧 Git/计划回放保留；旧客户端不传 Profile 时使用 `coding`。
- 测试：`sessions/service.test.ts` 断言默认 coding 与切换到 plan；`sessions/api.test.ts` 断言创建默认 coding 与 PATCH workspace；`SessionModel.test.tsx` 新增 Profile 保存/恢复用例（12 项通过）；plan/context/profiles 定向通过。
- 验证：`pnpm check` 全绿——biome 692 文件、6 包 typecheck、web 258、agent 63（1 跳过）、server 729（14 跳过）。
- 未运行：浏览器 Profile 切换 E2E 与视觉验收未跑；留到 K-10 全量 E2E / 人工验收。

### K-10（2026-11-18，macOS；真实模型 A/B 未运行）

- 确定性 A/B：[ab.md](ab.md)。10 个脚本化文件/搜索/补丁/命令/混合任务在 coding 与 workspace 均 10/10 成功；同一轨迹下 coding 首次工具 schema 1 462 vs 3 440 token（-57.5%），累计估算输入 52 378 vs 120 238 token（-56.4%）；Provider 调用 29/29、工具调用 19/19、计划 0/0、工具失败 0/0、锁失败 0/0、审批 0/0、命令 3/3 完成。
- K-10 修复：执行层现在按 Profile 拒绝隐藏的内置工具（`disabledToolsForProfile`），不只依赖 schema 过滤；`toolExecutor.test.ts` 覆盖注册但未启用的 `update_plan` 返回 `TOOL_NOT_FOUND` 且不调用 handler。
- E2E：`pnpm test:e2e` 24/24；`pnpm test:e2e:prod` 20/20。修复了四个既有/时序问题：commands 审批框在 Composer 入场动画期间取样、conversation 旧“保留阅读位置”断言与 UI-F28 冲突、m1 等 19 个 pairing 请求触发 10 次/分钟限流、demo Ctrl+B 断言错误地要求动画侧栏卸载。E2E server 通过 `StartServerOptions.rateLimiter` 注入高限流器，生产默认未改变。
- 门禁：`pnpm check` 全绿——biome 689 文件、6 包 typecheck、web 258、agent 63（1 跳过）、server 730（14 跳过）；`pnpm build` 成功。
- 未运行：真实 Provider 的 10 任务 coding vs workspace A/B（无 Key/预算授权）、Windows 实机 `run_shell`/进程树停止、浏览器视觉人工验收。上述项目不得标记通过；真实模型成功率仍需补跑后才能声明“不明显下降”。
