---
id: 064-scheduler
title: 定时任务与调度器
milestone: M5
status: done
depends_on: [050-deploy, 063-multi-provider]
owners: [human]
created: 2026-11-07
updated: 2026-11-07
---

# 定时任务与调度器（M5-2）

> 状态：`done`（2026-11-08 用户确认当前范围先过）。D1–D4 已于 2026-11-07 确认；M5-2-1～4 全部交付。Agent 创建 / 修改定时任务仍不在范围（NG-7），未验证项保留在 [acceptance](acceptance.md)。
> 源设计：[larness.md](../../larness.md) §4.9、§21；左侧栏已有「自动化任务」入口但无后端。

## 1. 背景与问题

Larness 需要在本机长期运行，按计划自动执行重复工作（检查、构建、整理、汇报）。当前只有人工发起的会话与 Turn，没有持久化任务、触发器、运行记录或失败提示；`ProjectSidebar` 的「自动化任务」是无效占位。

本切片补齐：

- 任务定义的持久化、启停与下一次触发计算；
- Cron / 固定间隔触发，时区与夏令时（DST）行为确定；
- 两类执行：受限 JS 脚本与 Agent 会话 Turn；
- 每次执行的 JobRun、超时、取消、并发与失败可见；
- 重启恢复、错过触发策略与运行历史保留。

## 2. 目标

- **G-1 持久调度**：任务存 SQLite，重启后恢复 `next_run_at`；错过的触发有明确策略，不集中补跑。
- **G-2 两类执行**：脚本任务与 Agent 任务共用调度、并发、超时、取消和运行记录。
- **G-3 可审计运行**：每次触发产生 JobRun；脚本输出有界、脱敏；Agent 运行可进入会话时间线。
- **G-4 无人值守的权限边界**：任务不能继承一次性人工审批；策略在任务上显式固定，创建时说明风险。
- **G-5 可用界面**：左侧「自动化任务」提供列表、创建 / 编辑、启停、立即执行、运行历史与失败提示。

## 3. 非目标

- **NG-1 沙箱**：不提供 OS 级隔离、文件系统、网络或权限沙箱；脚本与 Agent 仍以 Larness 运行账户权限执行。
- **NG-2 外部通知**：本切片只做应用内提示 / 角标；不做系统通知、邮件、Webhook、IM。
- **NG-3 复杂编排**：不做任务依赖 DAG、跨任务传参、失败重试 / 指数退避、分布式执行。
- **NG-4 秒级 Cron**：只支持 5 字段 Cron（分钟粒度）；不提供秒级表达式。
- **NG-5 多用户 / 多租户**：沿用单工作空间、单管理身份；任务没有独立 owner。
- **NG-6 跨平台承诺**：只验证 macOS；Windows / Linux 行为归 M5-4。
- **NG-7 模型自动改任务**：Agent 工具不能创建 / 修改 / 启停定时任务；只有已认证 Web 操作可以。

## 4. 用户故事

- 作为操作者，我希望每天定时跑一段脚本并看到结果，以便不手动执行重复检查。
- 作为操作者，我希望定时让 Agent 在项目里完成一个任务，并能回看当次会话，以便核对它做了什么。
- 作为操作者，我希望错过的触发不要在我打开电脑时一起炸开，以便系统保持可预测。
- 作为操作者，我希望任务失败时有明显提示，以便及时处理。
- 作为操作者，我希望无人值守任务只拥有我明确授予的范围，以便不扩大本机权限。

## 5. 验收场景

### A1 Cron 脚本任务

```gherkin
Given 已登记项目 P 与启用中的 Cron 脚本任务 J（每分钟，时区 Asia/Shanghai）
When 到达下一次触发时间
Then 创建一条 JobRun 并启动 node 子进程，cwd 为 P 的真实根目录
And 进程结束后 JobRun 记录 succeeded / failed、退出码、耗时与有界输出
And 下一次触发已持久化，重启后不会重复执行同一次触发
```

### A2 固定间隔与错过触发

```gherkin
Given 间隔任务 J（每 5 分钟，missedPolicy=skip）且 Larness 关闭了 2 小时
When Larness 重新启动
Then 不会补跑错过的 24 次触发，只计算下一次未来触发
And 若 J 的 missedPolicy=run_once，则只补跑 1 次并标记 trigger=catch_up
```

### A3 并发与重叠

```gherkin
Given 任务 J 上一次运行仍在执行
When 下一次触发到达
Then 不启动第二个并发运行，记录一条 skipped 运行（原因 overlap）
And 其他任务不受影响，全局同时运行数不超过配置上限
```

### A4 超时与取消

```gherkin
Given 脚本任务 J 的 timeoutSeconds=5，脚本进入长时间等待
When 超时到达
Then 子进程组被终止，JobRun 为 timed_out，错误信息不含脚本正文或秘密
And 操作者在 UI 点击取消运行中的 Agent 任务时，Turn 进入取消流程，JobRun 为 cancelled
```

### A5 Agent 任务权限

```gherkin
Given Agent 任务 J 的 approvalPolicy=readonly
When J 触发并尝试写文件
Then 工具被拒绝，Turn 记录拒绝原因，JobRun 失败或完成但不产生写入
And 将 J 改为 autonomous 并确认风险后，下一次运行按 ADR-040 执行已登记工具，无逐次人工审批
```

### A6 重启恢复

```gherkin
Given 运行中的 JobRun 在 Larness 被强制终止时尚未结束
When Larness 重启
Then 该 JobRun 标记为 interrupted，不自动重跑
And 所有启用任务重新计算 next_run_at，调度继续
```

### A7 失败提示

```gherkin
Given 任务 J 在最近一次运行失败
When 操作者打开工作台
Then 左侧「自动化任务」显示失败角标，任务详情显示失败原因与时间
And 打开自动化任务面板后角标清除（仅本地已读状态，不改变服务端记录）
```

### A8 时区与 DST

```gherkin
Given Cron 任务 J 使用 America/New_York，表达式 30 2 * * *
When 进入春季 DST 跳过的本地 02:30
Then 该次顺延到当天最近的有效本地时间 03:30，不重复执行
And 秋季重复的本地 01:30 只执行一次
And Asia/Shanghai 等无 DST 时区不受影响
```

### A9 鉴权与项目边界

```gherkin
Given 未认证客户端或缺少 CSRF 的已认证请求
When 创建 / 修改 / 删除 / 立即执行任务
Then 分别返回 UNAUTHENTICATED / CSRF_INVALID，且不产生审计以外的副作用
And 引用未登记项目或不存在的任务返回 VALIDATION_ERROR / NOT_FOUND，不泄漏其他资源
```

### A10 输出、环境与脱敏

```gherkin
Given 脚本任务输出超过上限或包含已知秘密格式
When 运行完成
Then 只保留末尾有界输出，秘密被替换，日志 / 事件 / API 不包含完整输出或环境变量
And 子进程环境不包含 Larness Secret Store 明文、Cookie、会话 Token 或 PM2 管理变量
```

### A11 限额

```gherkin
Given 已存在任务数达到上限，或同一任务在短时间内重复「立即执行」
When 再次创建 / 触发
Then 返回 VALIDATION_ERROR / RATE_LIMITED，不创建任务或运行记录
And 正常操作不受影响
```

### A12 生命周期

```gherkin
Given 已启用任务 J
When 操作者禁用 J
Then 不再产生计划触发，但运行历史保留；立即执行仍可用并标记 trigger=manual
And 删除 J 后任务从列表消失、运行中的运行被取消，历史保留供审计
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 支持 5 字段 Cron 表达式（分 时 日 月 周），最短 1 分钟；创建 / 修改时校验。 |
| R-2 | MUST | 支持固定间隔，范围 60 秒–7 天；间隔从任务保存 / 上次计划时间计算，不使用漂移累积。 |
| R-3 | MUST | 每个任务显式保存 IANA 时区；默认取系统时区，UI 显示。 |
| R-4 | MUST | 持久化 `next_run_at`；启用状态变化、计划变化、启动时重新计算。 |
| R-5 | MUST | 错过的触发按任务策略处理：`skip`（默认，不补跑）或 `run_once`（最多补 1 次）。 |
| R-6 | MUST | 同一任务不重叠执行；触发时若仍在运行，记录 `skipped` 运行（原因 overlap）。 |
| R-7 | MUST | 全局同时运行的 JobRun 上限为 2；超出的运行进入 `queued`，不丢弃。 |
| R-8 | MUST | 每个任务有超时（60–3600 秒，默认 600），从运行进入 `running` 起算；排队等待不计入；超时终止脚本进程组或取消 Turn。 |
| R-9 | MUST | 脚本任务以 `node` 子进程运行，cwd 固定为任务所属项目真实根目录，不使用 shell。 |
| R-10 | MUST | 脚本环境只含白名单变量；不注入 Larness / PM2 / Secret Store 凭据。 |
| R-11 | MUST | 脚本 stdout / stderr 合并后有界（默认 64 KiB），先脱敏再落盘，只保留末尾。 |
| R-12 | MUST | Agent 任务使用独立会话与真实 Turn；提示词、模型、凭据、思考档位、审批策略随任务保存。 |
| R-13 | MUST | Agent 任务的审批策略只能是 `readonly` 或 `autonomous`；`standard` / `strict` 拒绝，因为无人应答审批。 |
| R-14 | MUST | Agent 任务在创建 Turn 时固定策略快照；运行中修改任务只影响下一次运行。 |
| R-15 | MUST | 每次触发创建 JobRun，状态为 `queued / running / succeeded / failed / timed_out / cancelled / interrupted / skipped`。 |
| R-16 | MUST | 运行历史按任务保留最近 200 条且不超过 30 天；清理不删除任务。 |
| R-17 | MUST | 任务增删改、立即执行、取消、启停写审计；审计不含提示词 / 脚本正文 / 输出正文 / 秘密。 |
| R-18 | MUST | REST 变更接口要求已认证 + CSRF；所有任务操作按项目边界校验；`projectId=null` 仅表示默认工作区。 |
| R-19 | MUST | 脚本源码只在任务详情返回；列表与通知不含源码。 |
| R-20 | MUST | 应用内通知：任务失败后左侧入口显示角标；面板打开后本地清除。 |
| R-21 | MUST | 任务数上限 100；同一任务手动触发最短间隔 10 秒，超出返回 `RATE_LIMITED`。 |
| R-22 | MUST | 关闭 / 重启时，运行中的 JobRun 标记 `cancelled`（正常关闭）或 `interrupted`（异常终止）；不自动重跑。 |
| R-23 | SHOULD | 任务列表显示下次运行时间、最近状态、最近耗时；相对时间每分钟刷新。 |
| R-24 | SHOULD | 脚本任务创建页显示「以本机账户权限运行，不是沙箱」警告；Agent `autonomous` 需二次确认。 |

## 7. 接口与契约

### 7.1 REST

所有接口前缀 `/api`，已认证；变更请求带 `x-csrf-token`。时间均为 Unix 毫秒。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/jobs` | 任务列表（不含脚本源码），含 `nextRunAt` / `lastRun` |
| GET | `/api/jobs/summary` | 角标汇总：`total / enabled / running / failedLast24h` |
| POST | `/api/jobs` | 创建任务 |
| GET | `/api/jobs/:id` | 任务详情（脚本任务含源码） |
| PATCH | `/api/jobs/:id` | 修改名称、计划、启停、超时、策略等 |
| DELETE | `/api/jobs/:id` | 归档任务并取消运行中的运行；历史保留 |
| POST | `/api/jobs/:id/run` | 立即执行（允许已禁用任务；同一任务仍在运行返回 `CONFLICT`） |
| GET | `/api/jobs/:id/runs` | 运行历史，`?limit=&cursor=` |
| GET | `/api/job-runs/:id` | 运行详情（含脱敏输出 / Agent 会话链接） |
| POST | `/api/job-runs/:id/cancel` | 取消运行中的运行 |

任务 DTO（列表）：

```json
{
  "id": "job_…",
  "name": "每日检查",
  "projectId": "prj_…",
  "kind": "script",
  "schedule": { "type": "cron", "expression": "0 9 * * *", "timezone": "Asia/Shanghai" },
  "enabled": true,
  "timeoutSeconds": 600,
  "overlapPolicy": "skip",
  "missedPolicy": "skip",
  "nextRunAt": 1790000000000,
  "lastRunAt": 1789990000000,
  "lastStatus": "succeeded",
  "createdAt": 1789000000000,
  "updatedAt": 1789990000000
}
```

`projectId=null` 表示默认工作区。

Agent 任务详情额外包含：

```json
{
  "agent": {
    "prompt": "检查依赖并运行测试，汇总失败项",
    "model": "deepseek-flash",
    "credentialProfileId": "cred_…",
    "thinking": "medium",
    "approvalPolicy": "readonly",
    "sessionId": "ses_…"
  }
}
```

运行 DTO：

```json
{
  "id": "run_…",
  "jobId": "job_…",
  "trigger": "scheduled",
  "status": "failed",
  "scheduledFor": 1790000000000,
  "startedAt": 1790000000100,
  "endedAt": 1790000005100,
  "durationMs": 5000,
  "exitCode": 1,
  "sessionId": null,
  "turnId": null,
  "output": "[Redacted] …",
  "errorCode": "JOB_SCRIPT_FAILED",
  "errorMessage": "脚本以退出码 1 结束"
}
```

错误沿用现有稳定码：`VALIDATION_ERROR`、`UNAUTHENTICATED`、`FORBIDDEN`、`CSRF_INVALID`、`NOT_FOUND`、`CONFLICT`、`RATE_LIMITED`。本切片不新增 REST 错误码；运行详情内部的 `errorCode` 可使用 `JOB_SCRIPT_FAILED` / `JOB_TIMEOUT` / `JOB_RUN_CANCELLED` / `JOB_AGENT_FAILED` / `JOB_INTERRUPTED` / `JOB_OVERLAP` 作为展示字段。

### 7.2 WebSocket

不新增带序号的事件流。调度器变更通过 `system` 主题通知：

```json
{ "kind": "notification", "type": "workspace.jobs.changed", "timestamp": 1790000000000 }
```

Web 收到后重拉 `/api/jobs` 与当前详情；失败角标由 `summary.failedLast24h` 计算。通知不携带脚本、提示词、输出或错误正文。

### 7.3 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `LARNESS_SCHEDULER_ENABLED` | `true` | 关闭后不触发计划运行；立即执行仍可用（用于测试 / 诊断） |
| `LARNESS_SCHEDULER_MAX_CONCURRENT` | `2` | 全局同时运行上限，1–4 |
| `LARNESS_SCHEDULER_TICK_MS` | `1000` | 调度轮询间隔，仅内部配置，不暴露给普通用户 |

## 8. 数据与迁移

迁移 `0022_scheduler`（schemaVersion 22），只新增表与可空列，不删除 / 回填旧数据。

```sql
CREATE TABLE scheduled_jobs (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  project_id                TEXT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = 默认工作区
  kind                      TEXT NOT NULL,              -- script | agent
  schedule_type             TEXT NOT NULL,              -- cron | interval
  cron_expression           TEXT,
  interval_seconds          INTEGER,
  timezone                  TEXT NOT NULL,
  enabled                   INTEGER NOT NULL DEFAULT 1,
  overlap_policy            TEXT NOT NULL DEFAULT 'skip',
  missed_policy             TEXT NOT NULL DEFAULT 'skip', -- skip | run_once
  timeout_seconds           INTEGER NOT NULL DEFAULT 600,
  script_source             TEXT,
  agent_prompt              TEXT,
  agent_model               TEXT,
  agent_credential_profile_id TEXT REFERENCES credential_profiles(id) ON DELETE SET NULL,
  agent_thinking            TEXT,
  agent_approval_policy     TEXT,                        -- readonly | autonomous
  session_id                TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  next_run_at               INTEGER,
  last_run_at               INTEGER,
  last_status               TEXT,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  archived_at               INTEGER
);
CREATE INDEX idx_scheduled_jobs_due ON scheduled_jobs(enabled, archived_at, next_run_at);
CREATE INDEX idx_scheduled_jobs_project ON scheduled_jobs(project_id, updated_at);

CREATE TABLE scheduled_job_runs (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  trigger        TEXT NOT NULL,                          -- scheduled | manual | catch_up
  status         TEXT NOT NULL,
  scheduled_for  INTEGER NOT NULL,
  started_at     INTEGER,
  ended_at       INTEGER,
  duration_ms    INTEGER,
  session_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  turn_id        TEXT REFERENCES turns(id) ON DELETE SET NULL,
  exit_code      INTEGER,
  output         TEXT,
  error_code     TEXT,
  error_message  TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_scheduled_job_runs_job ON scheduled_job_runs(job_id, created_at);
CREATE INDEX idx_scheduled_job_runs_status ON scheduled_job_runs(status, created_at);

ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'; -- user | scheduled
CREATE INDEX idx_sessions_origin ON sessions(origin, updated_at);
```

- 归档任务保留运行历史；永久清理不在本切片。
- 迁移前沿用现有启动备份；失败回滚到上一版本程序，数据库只前进。
- 任务删除项目时级联删除任务与运行记录；会话只解除引用。

## 9. 安全、权限与审计

- **身份**：沿用 Web 会话与 CSRF；任务没有独立 Token / 对外回调地址。
- **项目边界**：任务必须引用已登记项目，或显式使用默认工作区（`project_id=NULL`）；脚本 cwd 与会话项目都取服务端解析的真实路径，不接受客户端任意 cwd。
- **无沙箱声明**：脚本与 Agent 均以 Larness 运行账户权限执行；UI、文档、验收记录必须明确，不能写成“安全隔离”。
- **Secret**：任务定义不接受 API Key / Token / Cookie；Agent 只存 `credentialProfileId`；脚本环境不注入 Secret Store、`LARNESS_*`、PM2 变量。
- **审批**：Agent 任务只允许 `readonly` / `autonomous`；拒绝 `standard` / `strict`，因为无人应答；策略快照进入 Turn，运行中不可改。
- **审计**：`job.created` / `job.updated` / `job.deleted` / `job.run_requested` / `job.cancelled`；只记录 jobId、kind、projectId、结果，不记录提示词 / 脚本 / 输出正文。
- **日志**：`jobId` / `runId` / `kind` / `status` / `durationMs` / `exitCode`；不记录输出正文、环境或秘密。
- **失败关闭**：任务配置校验失败不保存；凭据缺失时不调用 Provider；项目被删除 / 不可写时该次失败，不改其他任务。
- **限额**：100 个任务；手动触发 10 秒限流；全局并发 2；输出 64 KiB；脚本 64 KiB；提示词 10 KiB。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| Cron 表达式非法 / 时区非法 | 创建 / 修改返回 `VALIDATION_ERROR` | 指出字段，不保存 |
| 任务已归档 / 不存在 | `NOT_FOUND` 或 `CONFLICT` | 不泄漏其他任务 |
| 所属项目已删除 | 任务随项目级联删除；默认工作区任务不受影响 | 列表不再显示 |
| 计划触发时上次仍在运行 | 记录 `skipped`（overlap），不排队第二个 | 历史显示“已跳过：上次仍在运行” |
| 手动立即执行时仍在运行 | 返回 `CONFLICT`，不创建运行 | “任务正在运行” |
| 全局并发已满 | 运行保持 `queued`，有空位再启动 | 显示排队中 |
| 脚本启动失败（node 缺失） | `failed`，`JOB_SCRIPT_FAILED` | “无法启动脚本进程” |
| 脚本非零退出 / 被信号终止 | `failed` / `timed_out` | 退出码 / 超时，不显示完整输出 |
| 脚本输出超限 | 截断到末尾 64 KiB | “输出已截断” |
| Agent Provider 失败 / 额度不足 | Turn `FAILED`，JobRun `failed`，沿用 Provider 错误码 | 失败原因与会话链接 |
| Agent 需要审批但策略只读 | 工具拒绝，Turn 继续或失败 | 会话中可见拒绝 |
| 运行中禁用 / 删除任务 | 禁用不取消当前运行；删除取消当前运行 | 状态更新 |
| Larness 正常关闭 | 运行标记 `cancelled`，不重跑 | 历史显示已取消 |
| Larness 异常退出 | 重启后标记 `interrupted`，不重跑 | 历史显示已中断 |
| 系统休眠 / 时钟跳变 | 唤醒后按 `next_run_at` 与 missedPolicy 处理，不补跑大量；不重复同一触发 | 历史按策略记录 |
| 任务会话被删除 | 下次运行创建新会话；历史保留但会话链接失效 | 提示会话已重建 |

## 11. 可观测性

- 任务列表：启用状态、下次运行、最近状态 / 耗时。
- 运行历史：触发来源、状态、开始 / 结束、耗时、退出码、有界输出、会话链接。
- `GET /api/jobs/summary` 供角标：总数、启用数、运行中、24 小时失败数。
- 结构化日志字段：`jobId`、`runId`、`kind`、`trigger`、`status`、`durationMs`、`exitCode`；不含正文。
- 审计入口：现有审计页面能按 `job.*` 过滤。

## 12. 测试计划

- **单元**：Cron 解析与下一次时间（含 DST 春跳 / 秋重、无 DST、非法表达式）；间隔计算；missedPolicy；overlap；超时状态机；DTO 校验；输出截断 / 脱敏；环境白名单。
- **集成**：迁移与 repository；REST 认证 / CSRF / 项目边界；真实 node 子进程成功 / 非零 / 超时 / 大量输出；Agent 任务用 FakeProvider 创建 Turn、策略快照、取消、失败映射；重启恢复与 `interrupted`；运行历史保留 200 条；限额与限流。
- **E2E**：认证浏览器创建脚本任务 → 立即执行 → 看到成功历史；失败任务显示角标；Agent 任务链接到会话。
- **手动 / 视觉**：浅色 / 深色截图；面板空态、长列表、窄屏；系统休眠后恢复；真实 Agent 任务一次（有凭据时）。
- **回归**：`pnpm check`、`pnpm build`、auth E2E `m1`、Demo 19/19；既有 Turn / 服务运维 / 模型选择不受影响。

## 13. 开放问题与待确认决策

| ID | 问题 | 决定（2026-11-07 人类确认） |
|---|---|---|
| D1 | 脚本任务的源码与执行方式 | 内联源码存 DB，运行时写入数据目录临时 `.mjs`，以子进程 `node` 在项目根目录执行；不提供项目内脚本文件路径 |
| D2 | Agent 任务默认审批策略 | 默认 `readonly`；创建 / 修改为 `autonomous` 时二次确认风险 |
| D3 | Agent 任务会话组织 | 每个任务一个专用会话（`sessions.origin=scheduled`，不在普通会话列表显示），每次运行追加 Turn，可回看 |
| D4 | 错过触发默认策略 | 默认 `skip`；任务可改 `run_once`（最多补 1 次） |
| D5 | Cron 解析依赖 | 新增 `cron-parser@5.10.4`（纯 JS，传递依赖 `luxon@3`，Node ≥18），不自研 Cron / DST；随 D1–D4 一并采用 |
| D6 | 通知范围 | 仅应用内角标 / 面板；不接系统通知、邮件、Webhook；随 D1–D4 一并采用 |

D1–D4 已于 2026-11-07 确认：本 spec 转 `ready`；契约已补，调度器执行边界见 [ADR-054](../../docs/adr/ADR-054-scheduler-execution.md)。

## 14. 完成定义

- [ ] A1–A12 验收场景通过；
- [ ] `pnpm check`、`pnpm build`、auth E2E 与 Demo 通过；
- [ ] 契约、数据模型、STATUS、ROADMAP、tasks 已更新；
- [ ] 未验证项（真实长时间休眠、Windows / Linux、外部通知）如实记录；
- [ ] 人类验收通过。
