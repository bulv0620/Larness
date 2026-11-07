# M5-2 任务：定时任务与调度器

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 门禁已过：[spec](spec.md) 于 2026-11-07 转 `ready`（D1–D4 确认）。M5-2-1 / M5-2-2 已交付（`review`），下一步 M5-2-3。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-2-1 | 调度核心、脚本任务与 REST | 064 spec ready | `review` |
| M5-2-2 | Agent 定时任务与策略快照 | M5-2-1 | `review` |
| M5-2-3 | 自动化任务 UI 与通知 | M5-2-2 | `todo` |
| M5-2-4 | 调度整体验收 | M5-2-3 | `todo` |

## 任务卡

### M5-2-1 调度核心、脚本任务与 REST

- 状态：`review`
- 依赖：064 spec ready（D1–D4 确认）
- 目标：持久化任务与运行、Cron / 间隔触发、并发 / 超时 / 恢复、脚本执行、REST 与通知。
- 交付物：
  - 迁移 `0022_scheduler`：`scheduled_jobs`、`scheduled_job_runs`、`sessions.origin`；集成迁移计数测试。
  - `modules/jobs/`：repository、schedule（cron-parser、IANA 时区、DST）、scheduler（tick / 认领 / missed / 恢复）、runner（状态机 / 并发 / 超时 / 取消）、scriptRunner、service（校验 / 限额 / 审计）。
  - `api/jobs.ts`：列表 / 详情 / 创建 / 修改 / 删除 / 立即执行 / 运行历史 / 取消 / summary；认证 + CSRF + 项目边界。
  - `workspace.jobs.changed` 系统通知；`shared` 类型与 schema。
  - 运行历史保留 200 条 / 30 天。
- 验收：
  - A1、A2、A3、A4（脚本部分）、A6、A9、A10、A11、A12；Cron / 间隔 / DST 单测通过。
  - 真实 node 子进程成功、非零、超时、超大输出、残留进程清理。
  - 重启后 running / queued 标 `interrupted`，启用任务重算下一次。
- 测试：
  - 单元：表达式解析、下一时间、时区 / DST、missed、overlap、输出截断 / 脱敏、环境白名单。
  - 集成：迁移、repository、REST 认证 / CSRF / 限额、脚本生命周期、恢复、保留。
- 涉及路径：
  - `apps/server/drizzle/0022_scheduler.sql`、`apps/server/src/db/schema.ts`、`apps/server/src/modules/jobs/*`、`apps/server/src/api/jobs.ts`、`apps/server/src/bootstrap/start.ts`、`apps/server/src/app.ts`、`packages/shared/src/jobs.ts`、`docs/contracts/*`
- 交付（2026-11-07）：
  - [x] 迁移 `0022_scheduler`（schemaVersion 22）：两表 + `sessions.origin`；迁移计数与列断言。
  - [x] 调度核心：5 字段 Cron / 间隔、任务时区、DST、missed `skip` / `run_once`、overlap `skipped`、全局并发、超时、取消、恢复、保留。
  - [x] 脚本执行：数据目录临时 `.mjs`、项目真实根目录、`node` 子进程、环境白名单、输出 64 KiB、脱敏、进程组终止。
  - [x] REST / WS：列表、详情、创建、修改、归档、立即执行、运行历史、取消、summary；`workspace.jobs.changed` 通知；认证 + CSRF + 项目边界 + 审计 + 限额。
  - [x] 会话列表默认只显示 `origin='user'`；任务专用会话按 ID 可读。
  - [x] 测试：`test/jobs` 5 个文件 26 项；`pnpm check`（server 549 / 10 skip，web 135，agent 40 / 1 skip）；`pnpm build`。
- 备注：本任务不接 Agent 任务执行；Agent 任务在服务端返回 `VALIDATION_ERROR`，M5-2-2 再启用。Windows 脚本任务暂不支持，留 M5-4。

### M5-2-2 Agent 定时任务与策略快照

- 状态：`review`
- 依赖：M5-2-1
- 目标：Agent 任务使用专用会话与真实 Turn，策略 / 模型 / 凭据随任务固定，支持取消与超时。
- 交付物：
  - 任务创建时建立 `origin=scheduled` 专用会话；会话列表默认隐藏，任务详情可按 ID 打开。
  - `agentRunner`：创建 Turn（幂等键）、入队并等待终态、映射 JobRun、超时取消、错误脱敏。
  - 策略校验：只接受 `readonly` / `autonomous`；保存 / 修改时拒绝其余策略；Turn 快照固定。
  - `TurnQueue.enqueueAndWait`（内部）与相应测试；确认不影响 REST 入队 / 取消语义。
- 验收：
  - A5、A6（Agent 部分）、A7 的会话链接、A12。
  - FakeProvider：成功、失败、取消、超时、审批拒绝、策略快照不随运行中修改变化。
  - 会话列表不显示任务会话；直接打开任务会话仍正常。
- 测试：
  - 集成：任务 → 会话 → Turn → JobRun 全链路；`Idempotency-Key` 不重复创建 Turn；取消 / 超时；错误映射。
  - 单元：策略校验、DTO、错误码。
- 涉及路径：
  - `apps/server/src/modules/jobs/agentRunner.ts`、`apps/server/src/modules/agent/queue.ts`、`apps/server/src/modules/sessions/*`、`apps/server/test/jobs/*`
- 交付（2026-11-07）：
  - [x] Agent 任务创建时建立 `origin=scheduled` 专用会话，标题「自动化 · <name>」，继承默认模型并写入任务策略。
  - [x] `AgentJobExecutor`：幂等键 `job:<runId>` 创建 Turn、入队、轮询终态、超时 / 取消调用 `cancelTurn`、错误映射。
  - [x] 任务详情返回 `sessionId`；会话删除后下次运行重建；任务归档同时归档会话。
  - [x] 策略：只允许 `readonly` / `autonomous`；任务修改同步会话策略，下一次 Turn 生效。
  - [x] 测试：Agent 成功 Turn、readonly 上下文、超时、取消、运行时注入与策略；`pnpm check`（server 553 / 10 skip）与 `pnpm build`。
- 备注：不新增 Agent 工具；模型不能创建 / 修改任务。真实 Provider / 长时间 Agent 任务的取消确认仍待实测。

### M5-2-3 自动化任务 UI 与通知

- 状态：`todo`
- 依赖：M5-2-2
- 目标：左侧「自动化任务」可用；任务管理、运行历史、失败提示与视觉验收。
- 交付物：
  - `features/jobs/`：面板 / 详情 / 新建 / 编辑 / 运行历史 / 立即执行 / 取消 / 启停 / 删除确认。
  - 项目选择、Cron / 间隔、时区、超时、脚本编辑、Agent 提示词 / 模型 / 策略；风险警告与 `autonomous` 二次确认。
  - 左侧入口失败角标；打开面板后本地清除；失败 toast（应用内）。
  - 空态、加载、错误、长列表、窄屏；浅色 / 深色截图。
- 验收：
  - 浏览器可创建脚本任务并立即执行，看到 succeeded / failed 历史与输出。
  - 失败任务角标出现并在打开面板后清除；刷新后服务端记录不变。
  - Agent 任务运行后可从历史打开会话。
- 测试：
  - 组件 / hooks：表单校验、时区显示、状态映射、角标、二次确认、错误态。
  - auth E2E：创建 → 运行 → 历史 → 角标；Agent 任务链接会话。
- 涉及路径：
  - `apps/web/src/features/jobs/*`、`apps/web/src/components/layout/ProjectSidebar.tsx`、`apps/web/src/features/workspace/*`、`e2e-auth/*`、`apps/web/src/mocks/*`
- 备注：不引入第二套 UI 框架；沿用现有 Dialog / 菜单 / token。

### M5-2-4 调度整体验收

- 状态：`todo`
- 依赖：M5-2-3
- 目标：按 spec 验收矩阵做整体验证，记录边界与未验证项。
- 交付物：
  - 验收记录（可作为本切片 `acceptance.md`）：A1–A12 逐项证据。
  - DST / 休眠 / 重启 / 并发 / 超时 / 限额 / 权限负例结果。
  - `STATUS.md`、`ROADMAP.md`、`tasks.md`、契约、ADR 更新。
- 验收：
  - `pnpm check`、`pnpm build`、auth E2E、Demo 通过。
  - 至少一次真实 Agent 任务（有凭据时）；无凭据时明确记录未验证。
  - 运行历史、审计、日志不含脚本 / 提示词 / 输出正文与秘密。
- 测试：
  - 全量回归；定向 `test/jobs`。
- 涉及路径：
  - `specs/064-scheduler/acceptance.md`、`STATUS.md`、`specs/ROADMAP.md`
- 备注：未验证项不得以“通过”表述；Windows / Linux、外部通知、重试 / 退避留给后续切片。
