# ADR-068：Agent 内核与人类操作面分离

- 状态：**accepted（2026-11-18）**
- 批准记录：2026-11-18 人类确认 082 spec、本 ADR 与 Q-042～Q-050 的全部推荐默认；并明确内测版本允许破坏性重构、存量会话不保留旧能力。
- 关联：[082 spec](../../specs/082-agent-kernel/spec.md)、[K-1 基线](../../specs/082-agent-kernel/baseline.md)、[ADR-030](ADR-030-resource-lifecycle-and-services.md)、[ADR-038](ADR-038-agent-terminal-shell.md)、[ADR-048](ADR-048-service-domain-separation.md)、[ADR-059](ADR-059-long-task-budget-and-continuation.md)、[ADR-067](ADR-067-lean-agent-context.md)

## 背景

当前 Larness 是一个本机 Agent 工作台，Agent 工具面同时包含文件、计划、命令、交互终端、Git 与临时服务。终端既是人类的窗口，也是 Agent 的 PTY 控制器；Git 既有 10 个模型工具，又有独立的人类 UI；计划同时存在于系统提示、工具、运行时提醒和 UI。结果是默认工具面与提示词固定成本高，行为被计划和终端协议持续推动，内核难以独立演进。

用户目标不是继续增加平台能力，而是保留产品功能的同时把 Agent 内核收成“单循环 + 核心工具 + 可插拔能力包”。

## 决策

1. **单循环**：不引入 subagent、多 Agent 编排或并行 Turn；一个 Turn 只运行一个模型循环。
2. **模型/人类操作面分离**：
   - 模型默认只拥有文件读写编辑、代码搜索、有限命令执行。
   - 交互终端只面向人类；Agent 不再获得终端启动、输入、读取、中断和租约工具。
   - Git 模型工具全部移除；Git UI 保持独立的人类 REST/WS 入口。
   - PM2 运维、预览窗口继续作为人类操作面；服务能力仅用于管理 Agent 启动的后台服务。
3. **Profile**：新增 `coding`（默认）、`plan`（只读计划）、`workspace`（core + 后台进程 + 服务）三种会话级 Profile；新会话与存量会话统一归一到 `coding`。内测版本允许破坏性重构，不为存量会话保留旧 Git/终端工具能力；旧事件与人类操作面保留。
4. **后台进程/服务**：Agent 需要长任务时使用非 PTY 的后台进程（启动、游标读取输出、进程组停止）；命名服务绑定项目、进程、命令摘要、端口与日志，预览可选。
5. **计划可选**：`coding` 不注册 `update_plan`，不注入计划陈旧提醒；仅 `plan` Profile 可更新计划元数据。计划事件保留用于历史回放。
6. **提示与工具描述按能力注入**：默认 system 只保留稳定核心策略；终端、服务、计划协议只在对应 Profile/Pack 启用时出现。
7. **保留安全承重层**：文件版本校验、项目锁、审批、审计、秘密保护、事件持久化与回放不变；工具减少不改变后端授权。
8. **锁域收敛**：实际创建的业务锁只保留 ProjectLease（项目根写串行化）与 ServiceLease（单服务运维串行化）；Agent 终端控制不再使用租约或 fencing。ProjectLease 继续保留 TTL、fencing、过期接管、丢失检测与重叠根规则；Files/Git/Commands/ServiceOps 统一走 LeaseManager，不再各自实现。`file` / `git` 锁类型不再创建（保留旧行读取兼容）；`global-maintenance` 仅保留为维护/升级预留，不进入 Agent 工具面。
9. **审计分级**：安全关键事件（认证、配对、审批、拒绝、部署、服务启停、秘密相关）fail-closed；资源操作审计与业务写入同事务，不能同事务则失败关闭；工具请求/完成、token 与耗时等调试信息只进 `agent_events` / 日志，不再双写审计。
10. **锁与审计不进入内核**：`AgentKernel` 只发事件；锁、审批、审计、秘密保护由 `ToolExecutor` / `ResourceAdapter` 承担。审计按 `required`（安全关键，fail-closed）、`resource`（与业务写入同事务）、`debug`（只进 `agent_events` / 日志）三级表达；`tool.requested` / `tool.completed`、`terminal.input` / `terminal.resize` 与 Turn 状态细节不再双写审计。
11. **命令双路径**：`run_command` 保持结构化 `executable + args`，作为跨平台主路径；新增 `run_shell` 处理管道、重定向、通配符与平台 shell 语法。POSIX 使用 `/bin/sh -c`，Windows 优先 PowerShell 7、其次 Windows PowerShell 5.1、最后 CMD；不假设 bash，不自动翻译平台语法。
12. **明确排除**：网络搜索/网页抓取、subagent、PM2 运维工具不在本次内核重构范围内。

## 替代 / 补充关系

- 替代 [ADR-030](ADR-030-resource-lifecycle-and-services.md) 中“临时服务由 Terminal 启动、Agent 通过 PTY 操作终端”的模型：Agent 服务改为后台进程，终端只保留人类使用。ADR-030 中关于人类终端 Tab、窗口与资源视图生命周期的条款继续有效。
- 替代 [ADR-038](ADR-038-agent-terminal-shell.md) 的 Agent 终端交互规则：Agent 不再创建或操作交互式 Shell。人类终端的 Shell 生命周期规则继续有效。
- 保留 [ADR-048](ADR-048-service-domain-separation.md) 的“开发服务/正式服务分域”；正式 PM2 运维仍走人工入口。
- 不修改 [ADR-059](ADR-059-long-task-budget-and-continuation.md) 的预算与自动接续；预算收敛另行评估。
- 补充 [ADR-067](ADR-067-lean-agent-context.md) 的轻量化方向：从文案压缩推进到工具面与内核边界收敛。

## 备选方案

- **继续在 `turnRunner` 中加 Profile 开关**：改动小，但终端/服务/计划的状态机仍耦合在内核，无法得到真正的单循环。
- **保留 Agent PTY，只删部分工具**：仍需要租约、输入协议和终端协议提示，无法解决模型面过重。
- **按用户提问自动路由工具包**：体验看似无感，但引入分类错误、工具集变化破坏前缀缓存和不可预测行为；本 ADR 采用会话级 Profile + 显式切换。
- **直接删除终端/服务/Git 功能**：会丢失产品能力；本 ADR 保留人类操作面与 workspace 能力包。

## 影响

- **产品/UI**：新增 Profile 显示与切换；终端、Git、PM2、预览继续可用；计划仅在 plan Profile 出现。
- **API/事件**：移除模型 Git/终端工具；新增后台进程/服务工具与命令 shell 模式；人类 REST/WS 保留；旧事件可回放。
- **数据**：会话增加 Profile；旧终端/计划/服务数据保留；不删除历史。
- **安全**：Shell、进程启动、文件写入仍按审批/锁/审计执行；Agent 不再持有终端输入权；人类 Git 写操作需要 ProjectLease；终端租约退出模型面；安全关键审计失败关闭；`run_shell` 默认更高审批并复用进程树停止。
- **兼容**：存量会话统一迁移到 `coding`，不保留旧 Git/终端模型工具；旧事件、旧终端/服务记录与旧锁/审计记录保持可读。`workspace` 仅由用户显式选择，人类 Git/终端/PM2/预览入口不受影响。

## 验证与回滚

- 验证：默认 coding 工具面、`run_command`/`run_shell` 三平台矩阵、Shell Git、终端隔离、后台进程组停止、服务/预览、plan Profile、旧事件回放、ProjectLease/ServiceLease、审计分级与失败关闭。
- 回滚：保留 `workspace` Profile 作为显式能力路径；把会话切回 `workspace` 可恢复后台进程/服务能力，但不会恢复已从模型面移除的 Git/终端工具。锁/审计 adapter 的收敛可独立回滚为旧调用路径；回滚不删除数据或历史资源。
- 本 ADR 已于 2026-11-18 获人类确认；082 由 `draft` 进入 `ready`，按 K-1 → K-10 顺序实施。K-1 基线与锁/审计结论见 [082 baseline](../../specs/082-agent-kernel/baseline.md)。
