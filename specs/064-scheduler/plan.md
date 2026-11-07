# M5-2 实施计划：定时任务与调度器

> 对应 [spec](spec.md)。本文件只讲“怎么做”，不改变需求；D1–D4 确认、spec 转 `ready` 后执行。

## 1. 技术方案

调度器是 Server 进程内的单实例运行时，状态全部落 SQLite：

1. **任务定义**：`scheduled_jobs` 保存计划、类型、项目、超时、策略与执行配置；Agent 任务另存专用会话 `session_id`，脚本任务存源码。
2. **触发**：`Scheduler` 每 1 秒查询 `enabled=1 AND archived_at IS NULL AND next_run_at <= now` 的任务；在事务内创建 JobRun 并推进 `next_run_at`，避免同一触发重复。
3. **运行**：`JobRunner` 维护全局并发（默认 2）与每任务不重叠；`queued` 运行在有空位时启动。脚本与 Agent 各有一个执行器，统一状态机：
   `queued → running → succeeded | failed | timed_out | cancelled | interrupted`，未启动的触发可为 `skipped`。
4. **脚本**：源码写入数据目录下 0600 临时 `.mjs`，`spawn(process.execPath, [file], { cwd: project.realPath, shell: false, env: whitelist, detached: true })`；超时 / 取消时终止进程组；stdout/stderr 合并、限长、脱敏后写入 JobRun。
5. **Agent**：每个任务一个 `origin=scheduled` 专用会话；每次运行创建 user 消息与 Turn（`Idempotency-Key=job:<runId>`），经现有 `TurnQueue` 执行并等待终态；任务只允许 `readonly` / `autonomous`，策略随 Turn 快照固定；超时调用 `cancelTurn`。
6. **恢复**：启动时把遗留 `running` 运行标记 `interrupted`，`queued` 标记 `interrupted`；按 missedPolicy 计算 `next_run_at`，需要时创建一个 `catch_up`。
7. **通知**：JobRun 状态变化后发 `workspace.jobs.changed` 系统通知（不带序号），Web 重拉列表 / 详情；失败角标来自 `summary.failedLast24h`。

Cron 解析使用 `cron-parser@5.10.4`（纯 JS，传递依赖 `luxon@3`）；只暴露 5 字段表达式，最短 1 分钟。DST 行为以库的 IANA 时区计算为准，并用固定日期测试锁定：

- 春季不存在的本地时间：不执行，顺延到下一次有效时间；
- 秋季重复的本地时间：只执行一次；
- 保存的 `next_run_at` 始终是绝对 Unix 毫秒，重启后不因本地时区偏移重复。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 每秒 DB 轮询 | 简单、重启可恢复、无内存定时器漂移 | 最多 1 秒延迟 | 采用 |
| 每任务 `setTimeout` | 精确 | 任务多时定时器管理复杂，重启 / 时区变化易错 | 不采用 |
| Cron 自研解析 | 无依赖 | DST / 边界容易出错，测试成本高 | 不采用 |
| 脚本站内 `vm` / worker | 看起来“隔离” | 不是安全边界，易误导 | 不采用；明确子进程 + 非沙箱 |
| 每次 Agent 运行新建会话 | 上下文干净 | 会话列表膨胀、跨运行任务状态丢失 | 不采用；每任务一个专用会话 |
| 每任务独立会话且显示在普通列表 | 好找 | 打扰普通会话 | 专用会话默认隐藏，从任务详情进入 |
| 失败自动重试 | 看似可靠 | 无人值守重复副作用，需退避 / 幂等设计 | 本切片不做 |

## 3. 目录与文件变更

```text
新增：
apps/server/drizzle/0021_scheduler.sql
apps/server/drizzle/meta/0021_snapshot.json
apps/server/src/modules/jobs/repository.ts
apps/server/src/modules/jobs/schedule.ts          # cron / interval / next_run_at / DST
apps/server/src/modules/jobs/scheduler.ts         # tick、认领、missed、恢复
apps/server/src/modules/jobs/runner.ts            # 并发队列、状态机、超时、取消
apps/server/src/modules/jobs/scriptRunner.ts      # 子进程、环境白名单、输出截断
apps/server/src/modules/jobs/agentRunner.ts       # 会话 / Turn / 策略 / 等待终态
apps/server/src/modules/jobs/service.ts           # 校验、CRUD、DTO、限额、审计
apps/server/src/modules/jobs/errors.ts
apps/server/src/api/jobs.ts
apps/server/src/modules/jobs/*.test.ts
apps/server/test/jobs/*.test.ts
apps/web/src/features/jobs/JobsDialog.tsx
apps/web/src/features/jobs/JobsDialog.test.tsx
apps/web/src/features/jobs/api.ts
apps/web/src/features/jobs/api.test.ts
apps/web/src/features/jobs/useJobs.ts
packages/shared/src/jobs.ts
packages/shared/src/jobs.test.ts

修改：
apps/server/src/db/schema.ts                      # 两表 + sessions.origin
apps/server/src/bootstrap/start.ts                # 创建 / 启停 Scheduler，注入 TurnQueue
apps/server/src/app.ts                            # 注册 jobs 路由与依赖
apps/server/src/modules/sessions/repository.ts    # 默认过滤 origin='user'
apps/server/src/modules/sessions/service.ts       # 列表过滤；任务会话按 ID 可读
apps/server/src/ws/publisher.ts                   # workspace.jobs.changed
packages/shared/src/events.ts                     # 通知类型
packages/shared/src/index.ts
apps/web/src/components/layout/ProjectSidebar.tsx # 入口、失败角标
apps/web/src/features/workspace/*                # 可选：打开任务会话
docs/contracts/rest-api.md
docs/contracts/data-model.md
docs/contracts/ws-events.md
docs/adr/ADR-054-scheduler-execution.md
```

## 4. 实施步骤

1. **M5-2-1 核心**：先写失败测试（迁移、schedule、repository），再建表 / 仓储 / Cron 适配；实现 tick、认领、missed、并发、状态机、恢复；脚本执行器；REST + 审计 + 限额；`workspace.jobs.changed`。
2. **M5-2-2 Agent**：先写 FakeProvider 集成测试；实现任务专用会话、Turn 创建 / 入队 / 等待、策略校验与快照、取消 / 超时、错误映射；会话列表过滤。
3. **M5-2-3 UI**：自动化任务面板（列表 / 详情 / 编辑 / 新建）、运行历史、立即执行 / 取消、失败角标与 toast；浅色 / 深色截图。
4. **M5-2-4 验收**：DST、休眠 / 重启、并发、超时、限额、权限负例；全量回归并记录未验证项。

每个任务先红后绿；一个任务一个提交。

### 4.1 调度事务

认领一次触发必须在事务内完成：

```text
SELECT enabled job WHERE next_run_at <= now AND archived_at IS NULL
INSERT scheduled_job_runs(status='queued', scheduled_for=next_run_at)
UPDATE scheduled_jobs SET next_run_at=<next future>, last_run_at=next_run_at
```

内存中的 `runningJobIds` 只用于本轮进程避免重复；权威状态在 DB。若进程在事务后崩溃，重启把 `queued/running` 标 `interrupted`，不会自动重跑。

### 4.2 状态机

```text
queued ──> running ──> succeeded
                  ├──> failed
                  ├──> timed_out
                  ├──> cancelled
                  └──> interrupted
scheduled trigger + overlap ──> skipped
```

- `queued` 只用于全局并发已满；任务重叠直接 `skipped`。
- 手动触发时任务仍在运行：返回 `409 CONFLICT`，不创建运行。
- 超时：从 `running` 起算（排队不计）；脚本杀进程组；Agent 调 `cancelTurn`，等待 Turn 终态后写 `timed_out`。
- 关闭：`Scheduler.stop()` 先停止认领，再取消运行并等待短超时；正常关闭标 `cancelled`。

### 4.3 脚本执行

- 临时文件：`<dataDir>/jobs/runs/<runId>.mjs`，写入后 `chmod 0600`，运行结束删除；不写入项目目录。
- 环境白名单：`PATH`、`HOME`、`TMPDIR`、`LANG`、`LC_ALL`、`TZ`（任务时区）、`LARNESS_JOB_ID`、`LARNESS_JOB_RUN_ID`；其余全部剔除。
- 输出：stdout / stderr 合并流，累计超过 64 KiB 时丢弃最早内容并标记 `truncated`；写入前用现有 `OutputRedactor` 处理已知秘密格式。
- 终止：POSIX `detached: true` + `process.kill(-pid, "SIGTERM")`，5 秒后 `SIGKILL`；Windows 行为归 M5-4，先拒绝脚本任务或标注不支持（按平台检测）。
- 退出码：0 → `succeeded`；非 0 → `failed`；超时 → `timed_out`；主动取消 → `cancelled`。

### 4.4 Agent 执行

- 创建任务时创建会话：`sessions.origin='scheduled'`，`title="自动化 · <name>"`，`projectId`，`approvalPolicyId` 取任务策略；保存到 `scheduled_jobs.session_id`。
- 每次运行：
  1. 插入 JobRun（`queued`）；
  2. `createTurn({ sessionId, input: prompt, model?, credentialProfileId? })`，`Idempotency-Key=job:<runId>`；
  3. `turnQueue.enqueueAndWait(turnId, sessionId)`（新增内部方法，返回完成 Promise；REST 仍不等待）；
  4. 读 Turn 终态映射 JobRun：COMPLETED → succeeded，FAILED → failed，CANCELLED → cancelled，INTERRUPTED → failed/interrupted；
  5. 写入 `session_id` / `turn_id` / 错误码 / 摘要（最终 assistant 文本前 500 字符，脱敏）。
- 策略：`readonly` / `autonomous` 之外的输入在保存时拒绝；Turn 创建后运行中修改任务不改变该 Turn 快照。
- 并发：同一任务不重叠；不同任务共享全局 2 个槽位；TurnQueue 自身仍按会话串行。

### 4.5 恢复与保留

- 启动：`UPDATE scheduled_job_runs SET status='interrupted', ended_at=now WHERE status IN ('queued','running')`，并写错误摘要。
- 对每个启用任务：
  - `next_run_at` 为空或早于 now：按 missedPolicy 决定是否创建一个 `catch_up`；随后计算下一个未来时间。
  - 只补一次，不补多次。
- 运行历史：每次完成后删除该任务第 200 条之后、以及 30 天前的记录；启动时也执行一次清理。

## 5. 数据与迁移

- 迁移 `0021_scheduler`：两表 + `sessions.origin` 可空默认列；`scheduled_jobs.project_id` 可空（NULL = 默认工作区）；只新增，不删除 / 回填。
- `sessions.origin` 默认 `'user'`；旧会话自动为 `user`。`listSessionRows` 默认过滤 `origin='user'`，任务详情 / 直接 ID 查询仍可读 `scheduled`。
- 索引：`(enabled, archived_at, next_run_at)`、`(project_id, updated_at)`、`(job_id, created_at)`、`(status, created_at)`、`(origin, updated_at)`。
- 迁移前沿用现有备份机制；回滚只能回退程序，DB 迁移不回退。

## 6. 回滚策略

- 关闭调度：`LARNESS_SCHEDULER_ENABLED=false` 或删除任务；立即执行仍可用于诊断。
- 新表与列不影响旧功能；旧版本程序忽略新表即可运行（但会停止调度）。
- 脚本任务出现问题时先禁用任务，再排查；不自动重跑。
- Agent 任务策略改为 `readonly` 可立即阻断写入类工具（下一次运行生效）。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e:auth
pnpm test:e2e
```

定向测试：

```bash
pnpm --filter @larness/server exec vitest run test/jobs
pnpm --filter @larness/server exec vitest run src/modules/jobs
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 脚本是任意代码执行 | 以 Larness 账户权限修改文件 / 访问网络 | 明确非沙箱；创建警告；环境白名单；输出脱敏；用户显式启用 |
| `autonomous` 无人值守 | 无逐次确认即可执行工具 | 默认 `readonly`；切换二次确认；策略快照；审计 |
| DST / 时区错误 | 漏跑或重复跑 | `cron-parser` + 固定日期测试；绝对时间存储 |
| 进程崩溃 / 休眠 | 运行卡在 running | 启动恢复标 interrupted；`next_run_at` 重算；不自动重跑 |
| 子进程残留 | 端口 / 文件锁被占 | detached 进程组 + SIGTERM/SIGKILL；启动清理 |
| 输出 / 提示词泄漏秘密 | 数据与日志泄漏 | 不注入秘密；输出限长 + `OutputRedactor`；日志只记元数据 |
| 并发与 TurnQueue 相互等待 | 队列饥饿 | 全局 2 槽；同一任务不重叠；TurnQueue 独立并发上限 |
| 专用会话隐藏后难发现 | 用户找不到运行记录 | 任务详情直接链接会话 / 运行；列表显示最近状态 |
| 历史膨胀 | DB 增长 | 200 条 / 30 天保留；启动清理 |

## 9. 未决事项

- D1–D4 见 [spec §13](spec.md#13-开放问题与待确认决策)，确认后补契约与 ADR。
- Q-009（时区）：本切片落实为「系统时区默认 + 任务显式记录 + DST 测试」，关闭该问题。
- 外部通知、重试 / 退避、任务依赖、Windows / Linux 行为不在本切片。
