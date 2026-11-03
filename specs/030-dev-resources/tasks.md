# 任务：M2 开发资源与窗口层

> 2026-11-02 G-Spec-M2 / ADR-029 已批准；M2-0 实验已执行，待 G-PoC-M2 人类确认后才允许 M2-1。一次一个任务、一任务一提交，先红测试再实现。

## 状态总表

| ID | 任务 | 依赖 | 预估 | 状态 |
|---|---|---|---|---|
| M2-P | 本次评审草案（仅文档） | 人类起草指令 | — | `done`（文档完成，不代表 G-Spec 通过） |
| M2-0 | 执行与原生资源 PoC | G-Spec-M2 / ADR-029；G1 / 015 / 016 / 017 done | 1–2 | `review` |
| M2-1 | FileManager 与资源持久化底座 | M2-0 done；G-PoC-M2 | 2 | `todo` |
| M2-1b | 文件监听与资源事件补拉 | M2-1 | 1–2 | `todo` |
| M2-2 | Monaco 编辑与冲突恢复 | M2-1b | 1–2 | `todo` |
| M2-3 | CommandRunner 与受管进程协调 | M2-2 | 2 | `todo` |
| M2-3b | Agent 命令工具与实时执行展示 | M2-3 | 1–2 | `todo` |
| M2-4 | TerminalManager 与输入租约后端 | M2-3b | 2 | `todo` |
| M2-4b | xterm 交互与双客户端接管 | M2-4 | 1–2 | `todo` |
| M2-4c | Agent 项目开发终端工具与生命周期 | M2-4b | 1–2 | `todo` |
| M2-4d | AI 终端输入、中断与人工接管 | M2-4c | 1–2 | `todo` |
| M2-5 | GitManager、资源动作与 Agent 工具 | M2-4d | 2 | `todo` |
| M2-5b | Git 资源区、Diff 与审批界面 | M2-5 | 1–2 | `todo` |
| M2-6 | 真实资源统一窗口与布局恢复 | M2-5b/M2-2/M2-4b | 1–2 | `todo` |
| M2-7 | 跨资源锁、fencing 与恢复验收 | M2-6 | 1–2 | `todo` |
| M2-8 | M2 整体交付与 G2 | M2-7 | 1–2 | `todo` |

保留既有 M2-1～M2-8 ID；新增 M2-0 为前置 PoC，M2-1b / 3b / 4b / 4c / 5b 分离事件、Agent 或 UI 接线，避免同一任务吞下整个子系统。拆分与顺序已通过 G-Spec-M2；当前仅 M2-0，后续保持 todo。

## 任务卡

### M2-0 执行与原生资源 PoC

- 状态：`review`
- 依赖：G-Spec-M2 / ADR-029；G1 / 015 / 016 / 017 done；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [x] 先写失败测试并确认失败原因：真实系统资源、故障注入与进程残留检查；记录 Node / OS / 架构，失败不换依赖不缩减验收。
- [x] 交付：node-pty 安装与 built 寻址；真实 PTY resize / 退出；子进程组与锁丢失；文件身份 / watcher；重叠根与 workspace 冲突；poc.md 与 G-PoC-M2 证据。
- [x] 验收：A4/A7/A17/A18/A23；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [x] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [x] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 实际路径：apps/server/scripts/m2-poc/、run-m2-poc.ts、test/resources/m2-poc.test.ts、原生依赖 / pnpm 补丁、文档；未改生产入口。
- [ ] 人类确认 G-PoC-M2 后将本任务改为 done；证据与限制见 [poc.md](poc.md)。
- 本任务无 UI / 产品接口 / 数据迁移；上述 A4/A7/A17/A18/A23 仅完成 PoC 范围证据，产品接线与最终验收归后续任务。

### M2-1 FileManager 与资源持久化底座

- 状态：`todo`
- 依赖：M2-0 done；G-PoC-M2；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：完整换行、版本冲突、路径替换、二进制 / 超限、DB / 文件写故障、空库与升级库。
- [ ] 交付：授权 scope 文件树 / 完整读写；保存锁 / 写意图 / 幂等；file_versions、resource_operations、resource_streams、resource_events 一份迁移；共享 DTO / 错误码。
- [ ] 验收：A1–A5/A16/A20/A21；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/resources/src/files/；apps/server/src/api/；modules/files / resources；db/；packages/shared/。

### M2-1b 文件监听与资源事件补拉

- 状态：`todo`
- 依赖：M2-1；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：真实外部写 / 改名 / 删除、watcher 故障 / 队列溢出、断线缺口、慢消费者；事件先落库后广播。
- [ ] 交付：有界目录 watcher、合并通知 / 失效重扫、资源订阅授权与 REST 重放；手动刷新入口。
- [ ] 验收：A1/A3/A19/A20；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/resources/src/files/；apps/server/src/ws/；modules/resources/。

### M2-2 Monaco 编辑与冲突恢复

- 状态：`todo`
- 依赖：M2-1b；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：组件草稿 / 冲突与真实服务器浏览器保存回读；大文件不能编辑、源内容不被截断。
- [ ] 交付：真实文件树 / 完整编辑、多 Tab / realpath 去重、保存、冲突 Diff、重载 / 手工合并、脏 Tab 关闭确认、文件结果卡片授权打开 / 去重。
- [ ] 验收：A1–A5/A22/A24；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：apps/web/src/features/windows/；components/sections/；lib/。

### M2-3 CommandRunner 与受管进程协调

- 状态：`todo`
- 依赖：M2-2；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：真实非零退出、海量输出、spawn 失败、子进程树、重复 cancel、续租失败、重启 / 残留处理与秘密跨块。
- [ ] 交付：进程组、环境过滤、超时 / 取消、输出上限与游标；真实命令状态 / repository / REST；command_executions 一份迁移；共用锁协调。
- [ ] 验收：A7/A17/A18/A20/A21/A23；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/resources/src/commands/；apps/server/src/modules/commands / locks；db/。

### M2-3b Agent 命令工具与实时执行展示

- 状态：`todo`
- 依赖：M2-3；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：FakeProvider 驱动真实子进程；等审批取消、执行中取消、超时、参数替换、无后续工具调用。
- [ ] 交付：run_command 注册、风险策略与审批、Turn 剩余预算 / AbortSignal / 有效锁传递；命令卡片流式输出 / 取消，无终端 Tab。
- [ ] 验收：A6–A8/A16/A21；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/agent/；apps/server/src/modules/agent/；apps/web/src/features/chat/。

### M2-4 TerminalManager 与输入租约后端

- 状态：`todo`
- 依赖：M2-3b；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：两认证连接争抢 / 重放 / 过期 / 撤销、PTY 退出、隐藏不停止、锁丢失、重启中断和轮转回放。
- [ ] 交付：真实 PTY 生命周期、范围 / 全局 workspace、持久状态 / 游标；输入租约 generation、连接绑定、resize / terminate；dev 启动程序 / 参数、role 活跃唯一；terminals / terminal_leases 一份迁移。
- [ ] 验收：A9/A10/A12/A16–A21/A23；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/resources/src/terminals/；apps/server/src/api / ws / modules/terminals；db/。

### M2-4b xterm 交互与双客户端接管

- 状态：`todo`
- 依赖：M2-4；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：两独立浏览器上下文同 PTY；租约释放 / 到期、撤销、输出一致、断线恢复不重建。
- [ ] 交付：真实终端列表 / 创建确认 / 输入 / resize / 显式终止；只读观察、持有者 / 到期与项目写占用显示。
- [ ] 验收：A9–A12/A22；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：apps/web/src/features/windows/Terminal*；components/sections/TerminalsPanel；e2e-auth/。

### M2-4c Agent 项目开发终端工具与生命周期

- 状态：`todo`
- 依赖：M2-4b；G-Spec-M2 / ADR-029 / G-PoC-M2。
- 预估：1–2 天（启动 / 读取 / 停止）；完整输入 / 中断 / 人机交接拆至 M2-4d，避免本卡超范围。
- [ ] 先写失败测试：FakeProvider 启动真实前后端两个进程；角色 / 参数重试；审批篡改；读日志；Turn 取消前后交付竞态；显式停止。
- [ ] 交付：start_project_terminal / read_terminal_output / stop_project_terminal，项目身份绑定、逐次 L2 启动审批、有界日志、role 去重和来源 Tab。
- [ ] 验收：A25–A27；前后端 dev 与源码编辑并行；已交付资源不随 Turn 结束 / 取消，未交付取消清理；不声称服务 ready。
- [ ] 验证：`pnpm check` / `pnpm build` 与真实浏览器；同步契约 / 状态并逐任务提交。
- 涉及路径：packages/agent/；apps/server/src/modules/agent / terminals；apps/web/src/components/windows；e2e-auth/。

### M2-4d AI 终端输入、中断与人工接管

- 状态：`todo`；依赖 M2-4c，完整技术 schema 需 G-Spec-M2；预估 1–2 天。
- [ ] 先失败测试：真实 PTY 的 Agent acquire / input / interrupt / release、人机单控制者、旧 generation / 重复输入拒绝、Turn 取消、身份撤销、人工接管后 AI 不抢回。
- [ ] 按 m2-resources §10 实现 principal 联合、输入工具策略 / 审计、AI 租约续租、人工显式接管与输入序号；读取不抢控制，终止走独立权限。
- [ ] 验收 A30 / A31；中断不伪报已停止，Turn 结束只释放输入控制，不停止已交付项目资源；不记录输入正文 / 秘密。
- [ ] check / build、FakeProvider + 真实终端 / 两浏览器、UI 与安全 review；同步契约 / 状态、单任务提交。
- 计划路径：apps/server/src/modules/terminals / agent / ws；packages/agent / shared；apps/web/src/features/windows；e2e-auth/。

### M2-5 GitManager、资源动作与 Agent 工具

- 状态：`todo`
- 依赖：M2-4d；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：临时仓库 / 本地 bare remote；特殊文件名、hooks / diff 配置、快照变化 / 审批过期 / 单次消费、脏工作区 / 无上游 / 非快进、Git 不可用。
- [ ] 交付：结构化 status / diff / log / branch；add / commit / 分支 / ff-only pull / push；人工动作审批与幂等；Agent 同 Manager；resource_actions 一份迁移。
- [ ] 验收：A13–A18/A20/A21；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：packages/resources/src/git/；apps/server/src/modules/git / api；packages/agent/；db/。

### M2-5b Git 资源区、Diff 与审批界面

- 状态：`todo`
- 依赖：M2-5；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：真实服务器浏览器流程、批准参数摘要、重复点击、冲突后重查、模型离线可用。
- [ ] 交付：staged / unstaged / untracked、Diff、选择性 add / commit、分支操作、pull / push 计划 / 审批 / 执行与失败态。
- [ ] 验收：A13–A16/A22/A24；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：apps/web/src/components/sections/GitPanel；features/windows/DiffView；features/git/。

### M2-6 真实资源统一窗口与布局恢复

- 状态：`todo`
- 依赖：M2-5b/M2-2/M2-4b；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：关闭 / 最小化窗口、刷新 / 切会话不创建或终止资源；主动关闭终端 Tab 真实 terminate 并处理失败 / 跨客户端终态；文件跨来源去重；资源失效与脏草稿；双客户端布局独立。
- [ ] 交付：viewKey、来源分组、项目筛选同排、顶部资源枚举 / 恢复、本地布局版本与资源对账；真实模式不显示服务 / Browser 假状态。
- [ ] 验收：A11/A22/A24；resource-views V1–V6 的 M2 类型；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：apps/web/src/stores/windowStore；lib/window*；components/windows / layout/。

### M2-7 跨资源锁、fencing 与恢复验收

- 状态：`todo`
- 依赖：M2-6；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：真实并发与假时钟、旧 token 续租 / 写 / 释放、跨项目并发、旧进程未停不能接管、固定顺序无死锁。
- [ ] 交付：集中验证文件 / Agent / 命令 / PTY / Git 共享锁；根包含冲突；续租失败停止 / 阻塞；重启孤儿进程对账；关联问题修正。
- [ ] 验收：A12/A17–A20/A23；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：apps/server/src/modules/locks / agent / resources；packages/resources/；集成测试。

### M2-8 M2 整体交付与 G2

- 状态：`todo`
- 依赖：M2-7；全局还需 G-Spec-M2 / ADR-029；M2-1 起还需 G-PoC-M2。
- 预估：1–2 天；明显超出则先拆分，不绕过门禁。
- [ ] 先写失败测试并确认失败原因：check / build / Demo / auth / prod；初始化 / 统一入口 / TUI 回归；模型离线、未授权、双客户端、清理证据；人类验收。
- [ ] 交付：真实文件 / Git / PTY E2E、Agent 测试命令、dev / built smoke、macOS 平台与 UI 记录、acceptance.md / 契约落地检查。
- [ ] 验收：A1–A31 / G2；完成本任务的真实资源 / 权限 / 失败 / 并发用例。
- [ ] 验证：`pnpm check`、`pnpm build`；UI 增加相关真实浏览器证据；M2-8 执行全套命令。
- [ ] 同步所属 REST / WS / 数据模型 / 测试 / tasks / ROADMAP / STATUS；记录迁移与回滚影响，逐任务提交。
- 涉及路径（计划）：e2e*；scripts/；specs/030-dev-resources/acceptance.md；docs/；STATUS.md。

## 本次 M2-P 说明

2026-11-02：补全 spec / plan / tasks / review、资源契约与 ADR-029 提案，关联路线图与开放问题。未编写资源运行代码、安装依赖、执行 PoC、迁移数据库或修改用户数据。验证记录见 review.md；M2 的完成定义与 G2 仍全部未验收。

## R0-0 文档同步（2026-11-02）

ADR-030 已按人类明确规则记录 accepted；本次补齐终端 Tab 关闭终止、服务无 Tab 卡片布局、临时 / PM2 持久服务分工、文件 / 预览结果卡片。M2 功能任务仍 todo，交互工具技术草案已细化并拆出 M2-4d，schema 仍待 G-Spec-M2，M2 整体仍 draft，不因文档修改视为 S0 / M2 功能验收通过。
