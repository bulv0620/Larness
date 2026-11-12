# 数据模型与迁移

> 当前迁移版本为 22。表格为索引，完整字段以对应的迁移和下文实施条款为准。
> 实现：SQLite + Drizzle ORM；迁移由 drizzle-kit 生成，启动时执行。

## 1. 约定

| 项 | 约定 |
|---|---|
| 引擎 | SQLite（WAL、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`） |
| ID | TEXT，`<prefix>_<uuidv4>` |
| 时间 | INTEGER，Unix 毫秒 UTC |
| 布尔 | INTEGER 0 / 1 |
| JSON | TEXT，写入前 Zod 校验；读取后解析 |
| 迁移 | 只前进；已应用迁移不得修改；破坏性变更先备份 |
| 敏感字段 | 只存哈希 / `secretRef`；不存明文 Token、Key、密码 |
| 删除 | 业务数据软删除优先；项目源码永不删除 |

## 2. M0 表（可信启动与认证）

```sql
-- 由 drizzle-kit 管理的迁移表（示意，实际表名以工具为准）
-- __drizzle_migrations(version, hash, applied_at)

CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 关键键：initialized_at、schema_version、instance_id

CREATE TABLE auth_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  admin_hash       TEXT NOT NULL,          -- 历史 Argon2id 原样保留；ADR-025 新实例为空标记，不可认证
  admin_updated_at INTEGER NOT NULL,
  initialized_at   INTEGER NOT NULL
);

CREATE TABLE device_requests (
  id                    TEXT PRIMARY KEY,      -- pair_…
  short_code            TEXT NOT NULL UNIQUE,  -- 6 位，供 TUI 核对
  status                TEXT NOT NULL,         -- pending|approved|denied|expired|enrollment_pending|redeemed
  decision              TEXT,                  -- allow_once|trust
  client_label          TEXT,
  user_agent            TEXT,
  ip                    TEXT,
  client_origin         TEXT,                  -- 申请时的 Origin，用于判断能否注册 Passkey
  poll_token_hash       TEXT NOT NULL,         -- SHA-256
  code_hash             TEXT,                  -- SHA-256(配对码)
  code_expires_at       INTEGER,
  attempts              INTEGER NOT NULL DEFAULT 0,
  enrollment_token_hash TEXT,                  -- SHA-256(enrollment Cookie)
  enrollment_expires_at INTEGER,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  decided_at            INTEGER,
  redeemed_at           INTEGER
);
CREATE INDEX idx_device_requests_status ON device_requests(status, expires_at);

CREATE TABLE trusted_devices (
  id                   TEXT PRIMARY KEY,       -- dev_…
  label                TEXT NOT NULL,
  created_by_request_id TEXT REFERENCES device_requests(id),
  user_agent           TEXT,
  created_at           INTEGER NOT NULL,
  last_seen_at         INTEGER,
  revoked_at           INTEGER
);

CREATE TABLE webauthn_credentials (
  id              TEXT PRIMARY KEY,            -- cred_…
  device_id       TEXT NOT NULL REFERENCES trusted_devices(id),
  credential_id   TEXT NOT NULL UNIQUE,        -- base64url
  public_key      TEXT NOT NULL,               -- base64url (COSE)
  counter         INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  aaguid          TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  backup_state    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  revoked_at      INTEGER
);
CREATE INDEX idx_webauthn_credentials_device ON webauthn_credentials(device_id);

CREATE TABLE webauthn_challenges (
  id          TEXT PRIMARY KEY,                -- chl_…
  type        TEXT NOT NULL,                   -- registration|authentication
  challenge   TEXT NOT NULL,                   -- base64url
  request_id  TEXT REFERENCES device_requests(id),
  device_id   TEXT REFERENCES trusted_devices(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);

CREATE TABLE browser_sessions (
  id            TEXT PRIMARY KEY,              -- bs_…
  device_id     TEXT REFERENCES trusted_devices(id), -- allow_once 为 NULL
  token_hash    TEXT NOT NULL UNIQUE,          -- SHA-256(会话 Token)
  kind          TEXT NOT NULL,                 -- once|passkey
  ip            TEXT,
  user_agent    TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX idx_browser_sessions_device ON browser_sessions(device_id);

CREATE TABLE audit_logs (
  id                TEXT PRIMARY KEY,      -- aud_…
  client_session_id TEXT,
  session_id        TEXT,
  action            TEXT NOT NULL,         -- auth.pairing.redeemed 等
  resource_type     TEXT,
  resource_id       TEXT,
  decision          TEXT,                  -- allow|deny|info
  details_json      TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at);
```

`app_meta` 在 M0 同时承担初始化标记与实例 ID；不把配置写入数据库（配置在 `config.json`，秘密在 SecretStore）。

Passkey 的 RP ID / Origin 来自配置，不入库；`webauthn_challenges` 由定时任务清理，过期挑战不可复用。`trusted_devices` 不再保存任何长期 Token。

## 3. M1 表（工作区与 Agent）

| 表 | 关键列 | 说明 |
|---|---|---|
| `projects` | `id, name, root_path, real_path, settings_json, git_detected, created_at, updated_at` | `real_path` canonical 且唯一；`settings_json` 含默认模型 / 指令 / ignore；删除只删行 |
| `sessions` | `id, project_id?, workspace_path, title, status, model_profile_id?, credential_profile_id?, model?, thinking?, approval_policy_id, created_at, updated_at, last_activity_at` | `status`: `active / archived`；归档不删 workspace；独立会话 workspace 在 dataDir 下；`model` / `thinking` / `credential_profile_id` 为 M5-1 当前选择（可空，旧行无值） |
| `turns` | `id, session_id, model_profile_id, credential_profile_id?, provider, model, thinking?, context_window?, status, input_json, usage_json, error_json, terminal_reason?, resumed_from_turn_id?, idempotency_key, created_at, started_at, ended_at` | 一个 Session 同时最多一个活跃 Turn；provider / model / thinking / 窗口 / 凭据在 Turn 运行时快照；`thinking` 取值 `off / on / low / medium / high`（旧行可能是 `default`） |
| `agent_events` | `id, session_id, turn_id, seq, type, payload_json, created_at`；`UNIQUE(session_id, seq)` | `seq` 在 Session 内递增，事务内分配 |
| `model_profiles` | `id, label, provider, model, credential_profile_id, endpoint, capabilities_json, created_at` | 不含密钥；M5-1 起旧档案被忽略，行保留，不再进入选择器 |
| `model_catalog_cache` | `credential_profile_id`（主键）, `provider, endpoint, models_json, synced_at, last_attempt_at, last_error_code` | M5-1 官方目录缓存，按凭据隔离；`models_json` 只含展示字段；`last_error_code` 只存稳定错误码 |
| `session_context_summaries` | `id, session_id, covered_up_to_seq, summary, tokens_before, tokens_after, degraded, created_at` | 每个会话可有多条；只使用最近一条非降级且非空摘要；随会话级联删除；摘要正文不写事件 / 日志 |
| `model_visibility` | `id, credential_profile_id, model_id, visible, updated_at` | 唯一键 `(credential_profile_id, model_id)`；默认 `visible=1`；只控制会话选择器，不改变 Provider 能力 |
| `model_defaults` | `id, credential_profile_id, model, thinking, updated_at` | 单行 `id='default'`；全局默认模型，用于新会话；删除凭据级联删除；会话内仍可覆盖 |
| `credential_profiles` | `id, provider, label, secret_ref, created_at` | 密钥在 SecretStore |
| `secrets` | `id, ciphertext, nonce, tag, created_at` | AES-256-GCM；主密钥在文件系统 |
| `approvals` | `id, turn_id, tool_call_id, tool_name, risk, status, scope_json, params_hash, expires_at, decided_at, decided_by, created_at` | `status`: `pending / approved / denied / expired`；审批参数绑定与审计 |
| `resource_locks` | `id, resource_type, resource_id, owner, execution_id, fencing_token, expires_at, heartbeat_at, created_at`；`UNIQUE(resource_type, resource_id)` | M1 最小项目写锁；M2 扩展 file / git / service |

索引：`agent_events(session_id, seq)`、`turns(session_id, created_at)`、`sessions(project_id, updated_at)`、`projects(real_path)`。

`turns.terminal_reason`（迁移 `0023`，M6-3）取值 `normal / budget / output_truncated / provider_error / error / cancelled / interrupted`，只加可空列、不回填：旧 Turn 为 `NULL`，读取方必须按 `normal` 处理。`sessions.pinned_at`（迁移 `0026`，M6 TR-4）非空表示用户显式保留该会话，保留期清理会跳过它；默认 `NULL`，不回填。

`turns.resumed_from_turn_id`（迁移 `0025`）只在接手产生的新 Turn 上写入，指向来源 Turn。两种来源：用户恢复被中断的 Turn（原 Turn 保持 `INTERRUPTED` 且该列为空），以及预算分片结束后的自动接续（ADR-059，原 Turn 为 `COMPLETED` + `terminal_reason=budget`）。

它记录「为什么结束」，与 `status` 正交——`status=COMPLETED` 且 `terminal_reason=budget` 表示预算停止而不是正常完成。

约束：

- `sessions.project_id` 外键可空；项目删除时置空而不是级联删除会话（保留历史）。
- `turns.idempotency_key` 与 `session_id` 建唯一索引，防止重复提交。
- Turn 状态变化必须写事件；重启时把无法证明存活的活跃 Turn（QUEUED / PREPARING / RUNNING / WAITING_APPROVAL / CANCELLING）标记 `INTERRUPTED`。
- `resource_locks` 每个资源只保留一行；释放写 `expires_at = 0`，回收时递增 `fencing_token`，旧 token 的续租 / 释放 / 写入必须失败。

## 4. M2–M5 表索引

| 表 | 里程碑 | 关键列 |
|---|---|---|
| `terminals` | M2 | `id, project_id?, source_session_id?, cwd, shell, status, created_at, ended_at` |
| `file_versions` | M2-1 已实施 | `scope_key, path, real_path, version_hash, size, mtime, updated_at`；scope + path 唯一，不存正文 |
| `resource_operations` | M2-1 已实施 | 写意图、幂等结果、规范化根 / 版本、锁 / fencing；字段及状态见 m2-resources §11 |
| `resource_streams` / `resource_events` | M2-1 已实施 | stream 序号事务递增，事件不含正文；通知 / 补拉属于 M2-1b |
| `services` | M3 开发服务 | 保存终端、执行和端点绑定、状态及预览资格。日志引用终端输出 |
| `deployment_targets` | M4-1 已实施 | 独立正式目标：`id, project_id, name, current_artifact_id, current_version, created_at, updated_at`；`UNIQUE(project_id,name)` |
| `deployment_builds` | M4-1 已实施 | 真实构建：`id, target_id, project_id, request_key, requested_by, status, spec_json, spec_hash, reason_code, log_ref, started_at, ended_at, created_at`；`UNIQUE(request_key)` |
| `deployment_artifacts` | M4-1 已实施 | 不可变产物：`id, build_id, target_id, project_id, version, artifact_hash, artifact_path, size_bytes, file_count, spec_json, spec_hash, source_json, created_at`；`UNIQUE(build_id)`、`UNIQUE(target_id,version)` |
| `deployment_plans` | M4-1 已实施 | 发布计划：`id, target_id, project_id, artifact_id, previous_artifact_id, previous_version, version, plan_json, plan_hash, status, expires_at, request_key, requested_by, created_at`；`UNIQUE(request_key)` |
| `deployment_authorizations` | M4-2 已实施 | 运维授权：`id, plan_id, target_id, project_id, action, actor_type, actor_id, client_session_id, session_id, turn_id, policy, policy_snapshot_id, status, plan_hash, artifact_hash, scope_json, scope_hash, approval_id, request_key, expires_at, decided_at, consumed_at, consume_key, reason_code, created_at`；`UNIQUE(request_key)`；仅 `action='apply'` |
| `deployment_approvals` | M4-2 已实施 | 人工审批：`id, authorization_id, plan_id, target_id, project_id, status, plan_hash, artifact_hash, requested_by, decided_by, expires_at, decided_at, created_at`；`UNIQUE(authorization_id)` |
| `service_ops_services` | M4-3 已实施 | 正式服务运行：`target_id, project_id, name, namespace, pm2_name, desired_state, observed_state, current_artifact_id, current_version, config_json, pid, last_health_at, reason_code, created_at, updated_at`；`pm2_name UNIQUE` |
| `service_ops_deployments` | M4-3 已实施 | 发布记录：`id, target_id, project_id, plan_id, authorization_id, artifact_id, previous_artifact_id, previous_version, version, status, plan_hash, artifact_hash, actor_type, actor_id, policy, policy_snapshot_id, reason_code, health_json, result_json, started_at, ended_at, created_at`；`plan_id`/`authorization_id` UNIQUE |
| `service_action_authorizations` | M4-3b 已实施 | 日常动作授权：`id, target_id, project_id, action, actor_type, actor_id, client_session_id, session_id, turn_id, policy, policy_snapshot_id, status, artifact_hash, version, scope_json, scope_hash, request_key, expires_at, decided_at, decided_by, consumed_at, consume_key, reason_code, created_at`；`UNIQUE(request_key)`；action start/stop/restart/recover |
| `scheduled_jobs` / `scheduled_job_runs` | M5-2 已实施 | 任务与运行历史，字段见迁移 0022 |

完整字段在对应 milestone spec 中冻结；不得在实现时静默增加跨里程碑的大表。

`BrowserTab`、`Window`、`WindowTab`、`ProjectFilter`、服务窗口的 `selectedServiceId` 是**客户端视图状态**，不落服务端数据库；其身份、来源与筛选规则见 [resource-views.md](resource-views.md)。

## 5. 迁移规则

1. 每个任务最多引入一个迁移（可包含多张相关表）。
2. 迁移文件与 schema 定义一起提交；CI 在空库与上一版本库上各跑一次。
3. 启动时先检查迁移；失败则拒绝启动并输出可操作错误，不进入半初始化状态。
4. 每次升级（已应用迁移数 > 0 且 < 预期数）在迁移前自动 `VACUUM INTO` 到 `<dataDir>/backups/pre-upgrade-<from>-<to>-<timestamp>.db`，0600，保留最近 5 份；备份失败拒绝迁移。数据库 schema 高于程序时拒绝启动。
5. 迁移必须可在 30 秒内完成（大数据量除外，需单独评估）。

## 6. 事务与一致性

- 单进程、单写者；写事务使用 `BEGIN IMMEDIATE`，避免升级锁失败。
- 事件写入与 `seq` 分配必须在同一事务；失败则整个 Turn 状态变更回滚。
- 幂等键在事务内检查并写入；重复请求返回首次结果。
- 资源锁的获取 / 续约 / 释放均为独立事务；持有者崩溃后由过期时间回收。

## 7. 保留与备份

| 数据 | 默认保留 | 备份 |
|---|---|---|
| `agent_events` | 30 天（可配置） | 随 DB |
| `audit_logs` | 180 天 | 随 DB |
| 终端输出 | 环形缓冲 + 7 天落盘 | 否 |
| 服务日志 | 14 天 / 100 MiB 轮转 | 否 |
| 会话 artifacts | 手动清理 | 可选 |

- 备份使用 SQLite 一致性备份（`VACUUM INTO` / backup API），不能在 WAL 写入时直接复制 `.db`。
- 备份含秘密材料时必须加密；恢复需要本机 TUI 确认。
- 项目源码默认不备份、不删除、不更新。

## 初始化发布恢复（I0-2 / ADR-024）

`app_meta.init_pending` 保存经 Zod 校验的 `{ version: 1, config: AppConfig }`，不含密码、哈希或 API Key。初始化事务同时写入 auth_settings、initialized_at、auth.init 审计和该记录；事务失败不改变 config.json。事务提交后以 0600 临时文件、fsync、rename 发布 config.json，POSIX 同步父目录后才删除待发布记录。

存在待发布记录时 initialized=false，业务 API 返回 NOT_INITIALIZED；启动持有实例锁后先完成迁移与发布恢复，再加载配置、启动 IPC/HTTP。恢复记录无效或发布失败拒绝启动。发布和记录清理可重放，不删除用户数据。

## 主密钥与备份（I0-3）

`secrets` 的 ciphertext / nonce / tag 与 `<dataDir>/secrets/master.key` 必须配套。启动校验所有记录；有记录时缺失密钥不自动生成，无法解密则拒绝启动。恢复应保留原数据库与密钥，备份数据库本身不能替代密钥备份；密钥不得明文外传。

## M2 资源实施契约入口

文件 / 命令 / PTY / Git 的接口、资源事件与回放、数据迁移、锁与错误码见 [m2-resources.md](m2-resources.md) 的实施章节，配套 [030 spec](../../specs/030-dev-resources/spec.md)。

## ADR-030 服务与资源生命周期补充（2026-11-02）

[资源视图契约](resource-views.md) 已按人类确认修订：关闭 / 最小化窗口只隐藏，主动关闭终端 Tab 经 terminate 结束资源；服务无资源 Tab。临时服务仅登记 Terminal 源执行并在退出时自动退登，持久服务由 PM2 管理，详情、预览 / 结果卡片与接口 / 事件 / 数据见 [services-preview.md](services-preview.md)。M2/M3 已交付，当前证据见 [M2 收尾](../../specs/030-dev-resources/closure.md) 与 [M3 收尾](../../specs/040-services-preview/closure.md)。

M2-1（2026-11-03）：0005_resources 已落地四张资源表和 resource_locks.root_real_path，现 schemaVersion=5。字段与恢复 / fencing 语义见 [m2-resources §11](m2-resources.md#11-m2-1-实施契约2026-11-03)；旧 M2 目标摘要以该详细契约为准。


M2-1b（2026-11-03）：沿用 0005_resources，无新迁移。resource_events 按 created_at 保留 30 天，清理不删除 resource_streams.last_seq；清空历史后继续递增，补拉遇缺口要求刷新。watcher 快照 / 句柄 / 连接引用仅驻内存，不持久化正文。详见 [资源契约 §12](m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。

M2-3（2026-11-03）：0006_commands 唯一新增 command_executions，operation_id 唯一外键指向共同 resource_operations；保存项目 / 独立 workspace / session / Turn / toolCall / policy、参数哈希、状态、退出信息、有限进程身份与 output_cursor，原始参数 / 环境 / 输出不入库。command.run 复用共同根锁与写意图，Turn + toolCall 派生幂等键；文件版本字段为空且不参与命令语义。输出 7 天、安全终态元数据 30 天，未知执行屏障不清除；回滚保留新表 / 数据。详见 [资源契约 §14](m2-resources.md#14-m2-3-命令执行后端2026-11-03)。

M2-3b（2026-11-03，无迁移）：turns.input_json 新增仅后端写入的 executionContext `{clientSessionId?, policySnapshotId, policy}`，创建时固定真实发起客户端及策略，REST TurnDto / 模型上下文仍只公开 text；缺客户端上下文的旧 Turn 不能执行 run_command。审批参数哈希增加规范化命令与 session / Turn / client / 策略快照 / 根绑定，审批 scope 只保存脱敏摘要；command_executions 沿用 0006，Agent tool.command.created 持久关联 commandId，输出仍不进入 SQLite。

M2-4（2026-11-03）：唯一 0007_terminals 新增 terminals / terminal_leases。Terminal 除 §7 字段外增加 reason_code / output_cursor；lease 保留 generation，并增加 owner_session_id / input_sequence，人机 principal 字段预留，只有人类连接路由已接入。活跃 dev 项目 + role 部分唯一索引；创建 ledger 与状态 / seq 同事务，输入只记序号 / 长度，不存输入正文，输出正文不进 SQLite。运行终端不长期持源码锁，创建 ledger 完成不代表资源结束；非持锁占位与重启 / 不确定屏障见 m2-resources §16。脱敏启动摘要与原参数哈希分开，不从摘要重启进程。旧项目 / 锁 / fencing / stream 迁移保留，30 天后只清理安全终态元数据，保留序号；无破坏性回滚。

### M2-9 迁移 0009_terminal_title

`terminals.title TEXT NULL`：共享显示名称；不复用 dev role、不改变活动 role 唯一索引。旧行自动 null；改名事务同时写审计与递增 terminal resource stream seq，再广播。非破坏迁移，无配置变化。

### M2-10 共享默认目录（无迁移）

新 sessions.project_id=null 行使用既有全局终端目录 dataDir/sessions/global-terminal/workspace；多个会话的 workspace_path 可以相同。原独立会话行、目录与文件保持不变。DTO workspaceKind 是派生字段，无新增列。File cache / operation / stream 的 scope_key 可为 workspace:default；真实默认写作业按相同根互斥。默认终端 workspace_session_id 为 null，创建来源与资源生命周期不变。共享目录不可随创建失败、归档、草稿切换或隐藏视图删除。

## M2-13 内建默认项目
prj_default 由固定系统描述提供，不插入可修改 / 删除的 projects 用户登记行；kind=default，固定名称 / 默认共享根，createdAt / updatedAt 为 0。默认 sessions.project_id / terminals.project_id 的 null 值、workspace:default 事件与资源操作键保持。默认项目 HTTP scope 别名规范化到该既有域，无数据库迁移。

## ADR-042：分阶段服务与部署记录（2026-11-05，draft）
按 [ADR-048](../adr/ADR-048-service-domain-separation.md)，`services` 保持 M3 开发绑定和历史。M4 在同一业务数据库新增独立正式仓储及部署记录，部署目标引用正式 ID，来源项目和产物用于追溯及授权校验。运维日志和事件流独立，业务事件仍与 seq 事务提交。审批与策略记录分别绑定领域及作用域，只有人工分支关联 approvalId。表、列、约束、迁移与留存按对应任务冻结。见 [部署契约](deployment.md)。

## M5-1d 迁移 0016_multi_provider（2026-11-07）

`sessions` / `turns` 增加可空 `credential_profile_id`，schemaVersion 15 → 16。Turn 快照所选 Key，Provider 解析按快照选择 DeepSeek / GLM；旧 Turn 无值，回退到最新 DeepSeek 凭据。

## M5-1d 迁移 0021_context_summaries（2026-11-07）

新增 `session_context_summaries`，schemaVersion 20 → 21。压缩触发时保存 `covered_up_to_seq`、摘要、压缩前后估算 tokens 与 `degraded`；后续上下文使用「system + 最近摘要 + seq 之后的最近消息 + 当前 Turn」。失败保存 `degraded=1` 空摘要，上下文回退截断。

## M5-1d 迁移 0020_compatible_context（2026-11-07）

`credential_profiles` 增加可空 `context_window`，schemaVersion 19 → 20。仅 `openai-compatible` 使用，默认 128K、范围 1K–10M；目录刷新把该值写入模型窗口，未知窗口不再禁用。端点写入前由 API 运行 `assertSafeEndpoint`（HTTPS、公网、拒绝重定向与内网）。

## M5-1d 迁移 0019_credential_endpoint（2026-11-07）

`credential_profiles` 增加可空 `endpoint`，schemaVersion 18 → 19。GLM 凭据在创建或 PATCH 时选择官方端点（标准 / Coding Plan，国内 / 国际）；目录刷新与对话都使用该端点。任意第三方 URL 仍归 d-2c，不允许写入此列。

## M5-1d 迁移 0018_model_defaults（2026-11-07）

新增 `model_defaults`（单行 `id='default'`，`credential_profile_id` 外键级联），schemaVersion 17 → 18。保存全局默认模型与默认思考档位；新会话创建时写入 `sessions.model / thinking / credential_profile_id`，旧会话不变。

## M5-1d 迁移 0017_model_visibility（2026-11-07）

新增 `model_visibility`（`id, credential_profile_id, model_id, visible, updated_at`，唯一键 `credential_profile_id + model_id`），schemaVersion 16 → 17。只保存用户对「会话选择器是否显示」的偏好，默认可见；删除凭据级联删除，不改目录缓存或历史 Turn。

## M4-1 迁移 0011_deployments（2026-11-06）

新增 `deployment_targets` / `deployment_builds` / `deployment_artifacts` / `deployment_plans`，schemaVersion 10 → 11。旧表、旧数据、资源流序号与锁/fencing 不变。产物与构建日志位于 `dataDir/artifacts/deploy`、`dataDir/logs/deploy`，不在源码目录；DB 只存元数据、规范化 spec、哈希与相对路径，不含秘密或构建输出正文。`deployment_targets.current_artifact_id/current_version` 是最近一次成功部署指针，M4-1 只读，M4-3 成功后更新。精确列/约束见 [部署契约 §2.1](deployment.md#21-m4-1-冻结2026-11-06) 与 [M4-1 技术冻结](../../specs/050-deploy/m4-1-design.md)。

## M4-3 迁移 0013_service_ops（2026-11-06）

新增 `service_ops_services` / `service_ops_deployments`，schemaVersion 12 → 13。旧表/数据/流序号不变；服务运行状态 `stopped/starting/running/unhealthy/stopping/failed/unknown`，部署状态 `APPLYING/HEALTH_CHECK/SUCCEEDED/FAILED/UNKNOWN`。事件复用 `resource_streams/resource_events`，streamId `ops:<targetId>`。PM2 守护、socket、dump 与日志位于 `dataDir/pm2`、`dataDir/logs/deploy`，不在源码目录；DB 不存 PM2 明文秘密。详见 [部署契约 §3.2](deployment.md#32-m4-3-冻结2026-11-06) 与 [M4-3 技术冻结](../../specs/050-deploy/m4-3-design.md)。

## M4-3b 迁移 0014_service_actions（2026-11-06）

新增 `service_action_authorizations`，schemaVersion 13 → 14。日常 start/stop/restart/recover 使用独立 `sauth_` 授权，绑定 target/当前 artifactHash/version；不改变发布计划与 M4-2 授权表。授权状态 PENDING/AUTHORIZED/DENIED/EXPIRED/REVOKED/CONSUMED；审批决策记录在同一条授权的 `decided_by`，不创建人工 plan approval。详见 [部署契约 §3.3](deployment.md#33-m4-3b-日常动作与运维页2026-11-06)。

## M3 早期技术候选（历史）
[m3-preview](m3-preview.md)限定M3-1只新增temporary服务及必要action kind迁移：terminalExecutionId/generation由后端产生、与输入租约独立；原始身份仅内部、日志引用终端存储。票据/grant只保存短期内存hash，重启撤销，业务事件和seq事务持久化；不加入PM2字段或明文凭据，精确DDL在PoC后冻结。

## ADR-050 PM2 CLI 观察投影（2026-11-07）

复用 deployment_targets 的 project_id/name 唯一键和 service_ops_services 记录。通过已登记项目的 PM2 名称创建目标和观察投影，当前产物/版本可以为空，config_json 标记 source=pm2-cli。旧表、版本历史与迁移保留。新方案没有新增数据库列或迁移，服务 DTO 的项目名称由项目仓储读取。完整名称、实际状态、观察时间与事件按 [当前部署契约](deployment.md) 更新。

### M4-R1 人工控制意图

不新增表或列。复用 resource_operations，kind=service.control，scopeKey=project:<id>，path=完整 PM2 名称，paramsHash 绑定 targetId/action/name，expectedVersion/targetVersion 保存不含 PID 的配置身份哈希。幂等唯一键沿用 clientSessionId/kind/idempotencyKey。WRITING 在副作用前持久化；COMPLETED 与服务状态/事件/审计事务提交；FAILED 禁止同键重放。观察流程将租约过期的中断控制标为 FAILED，不补发命令。resultJson 仅含 targetId/action，不保存环境或命令输出。

### M4-R4 PM2 存在性

`service_ops_services.config_json` 复用内部可选 `pm2Present` 保存最近一次确定的应用存在性。可靠快照确认缺失才记 false，未知或冲突不改变存在性，旧 `PM2_MISSING` 行兼容。确认重现恢复 true。存在性变化与状态/事件事务提交；无迁移、历史记录不删除。

## M5-1 迁移 0015_model_catalog（2026-11-07）

新增 `model_catalog_cache`，schemaVersion 14 → 15；`sessions` 增加可空 `model` / `thinking`，`turns` 增加可空 `thinking` / `context_window`。只加表与可空列，不删除、不回填 `model_profiles` / `credential_profiles`，旧 Session / Turn 读取不变；`agent_events` 复用既有表承载 `model.usage`（payload 只含展示字段，推理正文不落库）。迁移前自动备份，失败拒绝启动。详见 [061 spec](../../specs/061-deepseek-integration/spec.md) 与 [ADR-053](../adr/ADR-053-model-catalog-thinking.md)。

## M5-2 迁移 0022_scheduler（2026-11-07）

新增 `scheduled_jobs` / `scheduled_job_runs`，schemaVersion 21 → 22；`sessions` 增加 `origin TEXT NOT NULL DEFAULT 'user'`（`user` / `scheduled`）。只加表与默认列，不删除、不回填旧数据；旧会话自动为 `user`，普通会话列表默认只返回 `origin='user'`，任务专用会话仍可按 ID 读取。

```sql
CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = 默认工作区
  kind TEXT NOT NULL,                       -- script | agent
  schedule_type TEXT NOT NULL,              -- cron | interval
  cron_expression TEXT,
  interval_seconds INTEGER,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  overlap_policy TEXT NOT NULL DEFAULT 'skip',
  missed_policy TEXT NOT NULL DEFAULT 'skip', -- skip | run_once
  timeout_seconds INTEGER NOT NULL DEFAULT 600,
  script_source TEXT,
  agent_prompt TEXT,
  agent_model TEXT,
  agent_credential_profile_id TEXT REFERENCES credential_profiles(id) ON DELETE SET NULL,
  agent_thinking TEXT,
  agent_approval_policy TEXT,               -- readonly | autonomous
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX idx_scheduled_jobs_due ON scheduled_jobs(enabled, archived_at, next_run_at);
CREATE INDEX idx_scheduled_jobs_project ON scheduled_jobs(project_id, updated_at);

CREATE TABLE scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,                    -- scheduled | manual | catch_up
  status TEXT NOT NULL,                     -- queued|running|succeeded|failed|timed_out|cancelled|interrupted|skipped
  scheduled_for INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  exit_code INTEGER,
  output TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_scheduled_job_runs_job ON scheduled_job_runs(job_id, created_at);
CREATE INDEX idx_scheduled_job_runs_status ON scheduled_job_runs(status, created_at);
CREATE INDEX idx_sessions_origin ON sessions(origin, updated_at);
```

- 任务删除采用 `archived_at` 归档；运行历史保留。只有所属项目被删除时才级联删除任务与运行。
- 每个任务保留最近 200 条运行且不超过 30 天；清理不删除任务。
- 迁移前自动备份；迁移只前进。详见 [064 spec](../../specs/064-scheduler/spec.md)。
