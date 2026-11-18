# 实施计划：Agent 内核重构

> 对应 [spec](spec.md) 与 [ADR-068](../../docs/adr/ADR-068-agent-kernel.md)。本文件只讲“怎么做”，不改变需求。ADR 未 accepted 前不进入实现。

## 1. 技术方案

采用绞杀式重构，不一次性重写 `turnRunner`：

1. 先引入 `AgentProfile`、`ToolPack`、`ToolAvailability` 三个边界，让现有工具注册表可以按 Profile 过滤。
2. 把 `coding` 作为第一个新 Profile，只挂核心工具；现有 28 工具路径保留为 `workspace`，用于对照和回退。
3. 按“Git → 终端 → 计划 → 锁/审计收敛 → 后台进程/服务”的顺序把模型工具移出内核；每步先删模型工具，保留人类 UI/API。
4. 新增进程管理器与服务层，接管 Agent 的长任务；不复用 PTY 租约。
5. 锁与审计作为 `ToolExecutor` / `ResourceAdapter` 的能力，不进入 `AgentKernel`；锁域收敛为 ProjectLease + ServiceLease，审计按安全关键/资源操作/调试分级。
6. 最后把纯循环抽到 `packages/agent`，`apps/server` 保留存储、审批、锁、审计、事件、终端/服务 adapter。

目标调用栈：

```text
CLI / Web
  → SessionService（会话、队列、事件、恢复）
  → AgentKernel（profile、loop、context、budget）
  → ToolPack（core / plan / process / service）
  → ToolExecutor adapter（审批、锁、审计、秘密保护）
```

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 在 `turnRunner` 里加 if/profile | 改动最小 | 终端/计划/服务状态机仍耦合，无法真正轻量 | 只作为过渡 |
| 一次重写内核 | 结构干净 | 回归面极大，旧事件/恢复/UI 全部受冲击 | 不采用 |
| 保留 Agent PTY，仅删部分工具 | 迁移平滑 | 仍保留租约/输入协议/终端提示成本 | 不采用 |
| Git 用 shell，UI 独立 | 省 10 个 schema，符合 coding 习惯 | UI 与 Agent 并发需锁 | 采用 |
| 后台进程代替 AI 终端 | 满足 dev server，去掉 PTY 输入协议 | 需要进程组/日志/port 契约 | 采用 |
| 自动意图路由工具包 | 用户无感 | 分类错误、缓存失效、不可预测 | 后续再评估 |

## 3. 目录与文件变更

```text
新增：
packages/agent/src/kernel/
  profile.ts          # AgentProfile / ToolPack 类型
  loop.ts             # 纯循环（后续阶段）
  context.ts          # 稳定 system + 按 pack 注入
  events.ts           # 内核事件类型
apps/server/src/modules/agent/
  profiles.ts         # coding / plan / workspace 装配
  packs/core.ts       # 文件 + 搜索 + run_command / run_shell
  packs/process.ts    # start/read/stop process
  packs/service.ts    # 服务登记/日志/停止
  processManager.ts   # 后台进程组、环形日志
apps/server/src/modules/locks/
  lease.ts            # ProjectLease / ServiceLease 统一入口
apps/server/src/modules/audit/
  sink.ts             # required / resource / debug 审计分级
apps/server/src/api/processes.ts
specs/082-agent-kernel/
  plan.md
  tasks.md

修改：
apps/server/src/bootstrap/start.ts       # 按 profile 注册
apps/server/src/modules/agent/contextAssembler.ts
apps/server/src/modules/agent/turnRunner.ts（逐步减耦）
apps/server/src/modules/terminals/*      # 仅保留人类终端 API
apps/server/src/modules/git/*            # 仅保留 UI/REST 路径
apps/server/src/modules/commands/*       # run_command / run_shell 入口
packages/resources/src/commands/*        # shell 启动、进程树、输出
apps/web/src/...                         # Profile 选择、终端/服务/Git 人类面

删除（模型面）：
createGitTools 注册
createTerminalTools / createTerminalControlTools 注册
planReminder 及 turnRunner 对它的调用
system 中的终端租约/服务生命周期/Git 可用性/计划段落
```

## 4. 实施步骤

1. **基线与 ADR**：记录当前工具数、固定 token、计划触发率、测试命令占比、终端/服务调用次数，以及锁/审计调用点清单；完成 ADR-068。
2. **Profile 抽象**：新增 `AgentProfile` / `ToolPack` / `ToolAvailability`，`providerTools()` 按 Profile 过滤；`coding` 暂时只用于测试。
3. **core pack**：`list_files`、`read_file`、`search_code`、`write_file`、`apply_patch`、`run_command`、`run_shell`；精简 prompt，不包含计划/终端/Git/服务。
4. **命令分面**：`run_command` 保持结构化 `executable + args`；新增 `run_shell`（POSIX `/bin/sh -c`，Windows PowerShell/CMD）；补别名、错误码、stdout/stderr 与跨平台测试。
5. **Git 分面**：从 registry 移除 10 个 Git 工具；保留 `GitManager` 和 UI REST；人类 Git 写操作使用 ProjectLease。
6. **终端分面**：从 registry 移除 7 个终端工具；`TerminalManager` 保留给人类终端；删除终端协议 system 段落与 Agent 终端租约。
7. **锁/审计收敛**：统一 ProjectLease/ServiceLease 入口；Files/Git/Commands/ServiceOps 停止各自 acquire/release；审计分为 required/resource/debug，移除 `tool.requested` 审计双写。
8. **进程层**：实现 `ProcessManager`（spawn、进程组、日志环形缓冲、停止）；新增 `start_process` / `read_process_output` / `stop_process`。
9. **服务层**：在 process 之上实现命名服务、幂等键、端口/健康、日志；预览继续可选；复用或扩展现有 services 存储。
10. **计划可选**：`coding` 不注册 `update_plan`；`plan` Profile 可注册；删除 `planReminder` 与 wrap-up 中的计划要求；旧 plan 事件保留。
11. **workspace Profile**：core + process + service；UI 增加 Profile 选择与当前模式提示。
12. **收口**：旧会话/旧事件回放、锁/审计契约测试、A/B 指标、`pnpm check`、`pnpm build`、E2E 与文档更新。

### 4.1 锁与审计 adapter

标准入口：

```ts
interface LeaseManager {
  acquireProject(input): ProjectLease | null;
  acquireService(input): ServiceLease | null;
  renew(lease): lease | null;
  release(lease): boolean;
}

interface AuditSink {
  required(input): void;   // 失败即抛错，操作关闭
  resource(input): void;   // 与业务同事务；不能同事务则失败关闭
  debug(input): void;      // 只写日志/事件，不写审计
}
```

- `ProjectLease` 统一 Files/Git/Commands/ServiceOps 的写路径；保留 TTL、fencing、过期接管与丢失检测。
- `ServiceLease` 只用于同一 PM2/服务目标的运维串行化。
- 人类终端不使用 `terminal_leases`；多客户端输入冲突用连接所有权解决。
- `AgentKernel` 不 import 锁表或审计表；只发事件。
- 审计安全关键路径必须 fail-closed；资源操作审计与业务同事务，不能同事务则失败关闭；只读查询可 best-effort。
- `tool.requested` 只进 `agent_events`，不再写审计；`tool.denied`、审批与资源生命周期保留审计。

### 4.2 命令工具

```ts
type RunCommand = {
  executable: string;
  args?: string[];       // default []
  cwd?: string;          // project-relative, default "."
  timeoutMs?: number;
};

type RunShell = {
  command: string;       // explicit shell syntax
  cwd?: string;
  timeoutMs?: number;
};
```

- 两者共用现有 `runCommand` 的进程组/进程树停止、输出上限、超时、取消、秘密脱敏与审计。
- `run_command` 继续走 `windowsLaunch`，保留 `.cmd/.bat/.ps1` 的 PowerShell shim。
- `run_shell` 选择：
  - POSIX：`/bin/sh -c`，不带 `-l`，避免加载启动脚本；
  - Windows：`pwsh`（若可用）→ Windows PowerShell 5.1 → `cmd /d /s /c`；
  - 使用 `powerShellArguments` / `powerShellEncodedCommand` 处理引号。
- 结果包含 `shell`、`exitCode`、`stdout`、`stderr`、`reasonCode`、`truncated`。
- 不接受 `env`、`stdin` 或绝对 `cwd` 越界；交互式 TUI 命令明确拒绝。
- 别名（`program`/`arguments`/`workdir`/`timeout`）在 schema 校验前修复；错误码稳定。

## 5. 数据与迁移

- 会话增加 `agent_profile`（名称/存放位置在实现前冻结）。新会话 `coding`；存量会话迁移为 `workspace`，避免升级即失去能力。
- 现有终端/服务/计划数据不删除。旧 AI 终端升级后作为人类终端保留，不自动终止。
- `resource_locks` 保留现有结构，ProjectLease/ServiceLease 复用它；不新增锁表。`terminal_leases` 保留给旧记录/人类终端兼容，Agent 不再创建。
- 审计表结构不变；分级由调用契约表达。若后续需要 `level` 列，单独迁移。
- 进程/服务持久化优先复用 `services`；若需要新表/新列，提供迁移、回滚与旧数据兼容测试。
- 事件类型只增不删；旧 `terminal.*`、`git.*`、`plan.updated` 继续可回放。

## 6. 回滚策略

- 新 Profile 是会话字段：把会话切回 `workspace` 即可恢复旧工具面。
- 保留旧注册表装配路径，出问题可按配置关闭新 Profile 默认值。
- 进程/服务新表或新事件保留兼容读取；回滚不删除历史。
- 回滚不重新创建旧 AI 终端、不自动把人类终端交给 Agent。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
pnpm test:e2e:auth
```

定向验证优先使用 `pnpm --filter @larness/web test:file ...` 与 server vitest 文件；`pnpm check` 作为收口门禁。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 后台进程组停止不可靠 | 残留 dev server / 端口占用 | POSIX 进程组 + Windows `taskkill /T`；停止后探测 PID/端口 |
| 服务/预览语义变化 | 旧 UI 与旧服务记录不一致 | 保留旧记录只读回放；新建服务走新契约；逐步迁移 |
| Git UI 与 Agent Shell 并发 | 索引冲突、意外提交 | UI 写操作 ProjectLease；命令扫描识别 git 写命令；失败明确提示 |
| 锁入口收敛不彻底 | Files/Git/Commands 各自加锁，死锁/遗漏 | K-11 统一 LeaseManager；删除直接 `acquireResourceLock` 调用；契约测试 |
| 审计分级不清 | 安全决策被 best-effort 吞掉，或日志双写 | required/resource/debug 三类；安全关键 fail-closed；移除 tool.requested 审计 |
| 旧会话迁移 | 用户升级后能力变化 | 存量默认 workspace；新会话 coding；显式切换 |
| 终端移除工具后能力缺失 | Agent 无法交互式运行 TUI 命令 | 明确不支持交互式 TUI；要求使用非交互参数；必要时由用户终端处理 |
| `run_shell` 平台语法差异 | 同一命令在 Windows/POSIX 行为不同 | 返回实际 shell；不自动翻译；文档与测试覆盖三平台；复杂命令优先 `run_command` |
| `run_shell` 注入/审批风险 | 任意命令文本扩大攻击面 | 默认 L2、命令扫描、审批、秘密脱敏；不接受 env/stdin |
| Prompt 删除过度 | 模型缺少必要安全/工具指引 | 保留核心安全策略；能力包 hint 按需注入；用失败测试覆盖 |
| ADR-030/038 冻结条款冲突 | 实现与既有文档矛盾 | ADR-068 先 accepted；明确替代范围 |

## 9. 未决事项

- Q-042 默认 Profile 与存量会话迁移。
- Q-043 plan Profile 是否保留 `update_plan`。
- Q-044 进程/服务工具粒度、持久化与 preview 默认值。
- Q-045 Git UI 与 Agent Shell 并发锁。
- Q-048 预览默认值。
- Q-044 / Q-046 ADR-030/038/048/059 的替代边界。
- Q-047 是否在本切片改变项目指令/AGENTS.md 加载方式。

实施前必须把这些默认方案写入 ADR-068 或 spec，并由人类确认。
