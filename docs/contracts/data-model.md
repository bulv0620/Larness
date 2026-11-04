# 数据模型与迁移

> 状态：M0 表已冻结；M1–M5 为目标结构，字段可在对应 spec 中细化。
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
| `sessions` | `id, project_id?, workspace_path, title, status, model_profile_id?, approval_policy_id, created_at, updated_at, last_activity_at` | `status`: `active / archived`；归档不删 workspace；独立会话 workspace 在 dataDir 下 |
| `turns` | `id, session_id, model_profile_id, provider, model, status, input_json, usage_json, error_json, idempotency_key, created_at, started_at, ended_at` | 一个 Session 同时最多一个活跃 Turn；provider / model 在 Turn 运行时快照 |
| `agent_events` | `id, session_id, turn_id, seq, type, payload_json, created_at`；`UNIQUE(session_id, seq)` | `seq` 在 Session 内递增，事务内分配 |
| `model_profiles` | `id, label, provider, model, credential_profile_id, endpoint, capabilities_json, created_at` | 不含密钥 |
| `credential_profiles` | `id, provider, label, secret_ref, created_at` | 密钥在 SecretStore |
| `secrets` | `id, ciphertext, nonce, tag, created_at` | AES-256-GCM；主密钥在文件系统 |
| `approvals` | `id, turn_id, tool_call_id, tool_name, risk, status, scope_json, params_hash, expires_at, decided_at, decided_by, created_at` | `status`: `pending / approved / denied / expired`；审批参数绑定与审计 |
| `resource_locks` | `id, resource_type, resource_id, owner, execution_id, fencing_token, expires_at, heartbeat_at, created_at`；`UNIQUE(resource_type, resource_id)` | M1 最小项目写锁；M2 扩展 file / git / service |

索引：`agent_events(session_id, seq)`、`turns(session_id, created_at)`、`sessions(project_id, updated_at)`、`projects(real_path)`。

约束：

- `sessions.project_id` 外键可空；项目删除时置空而不是级联删除会话（保留历史）。
- `turns.idempotency_key` 与 `session_id` 建唯一索引，防止重复提交。
- Turn 状态变化必须写事件；重启时把无法证明存活的活跃 Turn（QUEUED / PREPARING / RUNNING / WAITING_APPROVAL / CANCELLING）标记 `INTERRUPTED`。
- `resource_locks` 每个资源只保留一行；释放写 `expires_at = 0`，回收时递增 `fencing_token`，旧 token 的续租 / 释放 / 写入必须失败。

## 4. M2–M5 表（目标）

| 表 | 里程碑 | 关键列 |
|---|---|---|
| `terminals` | M2 | `id, project_id?, source_session_id?, cwd, shell, status, created_at, ended_at` |
| `file_versions` | M2-1 已实施 | `scope_key, path, real_path, version_hash, size, mtime, updated_at`；scope + path 唯一，不存正文 |
| `resource_operations` | M2-1 已实施 | 写意图、幂等结果、规范化根 / 版本、锁 / fencing；字段及状态见 m2-resources §11 |
| `resource_streams` / `resource_events` | M2-1 已实施 | stream 序号事务递增，事件不含正文；通知 / 补拉属于 M2-1b |
| `services` | M3 | `id, project_id?, name, kind(temporary/persistent), terminal_id?, terminal_execution_id?, endpoint_generation?, pm2_identity?, config_ref?, desired_state?, observed_state, endpoint_json?, preview_eligible, created_at, updated_at`（kind 约束见服务契约） |
| `service_logs` | M3 | `service_id, cursor, chunk, created_at`（或落盘 + 索引） |
| `deployments` | M4 | `id, service_id, commit_sha, artifact_ref, status, plan_json, created_at` |
| `scheduled_jobs` | M5 | `id, name, schedule, scope, policy, enabled, created_at` |
| `job_runs` | M5 | `id, job_id, status, started_at, ended_at, log_ref` |
| `update_runs` | M5 | `id, from_version, to_version, status, started_at, ended_at` |

完整字段在对应 milestone spec 中冻结；不得在实现时静默增加跨里程碑的大表。

`BrowserTab`、`Window`、`WindowTab`、`ProjectFilter`、服务窗口的 `selectedServiceId` 是**客户端视图状态**，不落服务端数据库；其身份、来源与筛选规则见 [resource-views.md](resource-views.md)。

## 5. 迁移规则

1. 每个任务最多引入一个迁移（可包含多张相关表）。
2. 迁移文件与 schema 定义一起提交；CI 在空库与上一版本库上各跑一次。
3. 启动时先检查迁移；失败则拒绝启动并输出可操作错误，不进入半初始化状态。
4. 破坏性迁移（删列 / 改类型 / 清空）前自动备份到 `<dataDir>/backups/`，并在 TUI / 日志中提示。
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

## M2 详细草案入口（2026-11-02，未冻结）

文件 / 命令 / PTY / Git 的接口、资源事件与回放、数据迁移、锁与错误码拟细化于 [m2-resources.md](m2-resources.md)，配套 [030 spec](../../specs/030-dev-resources/spec.md)。本文件中原 M2 摘要只作范围索引；细化提案须经 G-Spec-M2 / ADR-029 确认后才生效，实施时同步 Zod schema 与测试，不改变 M0 / M1 已实现契约。

## ADR-030 服务与资源生命周期补充（2026-11-02）

[资源视图契约](resource-views.md) 已按人类确认修订：关闭 / 最小化窗口只隐藏，主动关闭终端 Tab 经 terminate 结束资源；服务无资源 Tab。临时服务仅登记 Terminal 源执行并在退出时自动退登，持久服务由 PM2 管理，详情、预览 / 结果卡片与拟议接口 / 事件 / 数据见 [services-preview.md](services-preview.md)。产品规则已接受，M2/M3 技术 schema / 迁移 / 代码尚未实施，既有认证和事件权威性不变。

M2-1（2026-11-03）：0005_resources 已落地四张资源表和 resource_locks.root_real_path，现 schemaVersion=5。字段与恢复 / fencing 语义见 [m2-resources §11](m2-resources.md#11-m2-1-实施契约2026-11-03)；旧 M2 目标摘要以该详细契约为准。


M2-1b（2026-11-03）：沿用 0005_resources，无新迁移。resource_events 按 created_at 保留 30 天，清理不删除 resource_streams.last_seq；清空历史后继续递增，补拉遇缺口要求刷新。watcher 快照 / 句柄 / 连接引用仅驻内存，不持久化正文。详见 [资源契约 §12](m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。

M2-3（2026-11-03）：0006_commands 唯一新增 command_executions，operation_id 唯一外键指向共同 resource_operations；保存项目 / 独立 workspace / session / Turn / toolCall / policy、参数哈希、状态、退出信息、有限进程身份与 output_cursor，原始参数 / 环境 / 输出不入库。command.run 复用共同根锁与写意图，Turn + toolCall 派生幂等键；文件版本字段为空且不参与命令语义。输出 7 天、安全终态元数据 30 天，未知执行屏障不清除；回滚保留新表 / 数据。详见 [资源契约 §14](m2-resources.md#14-m2-3-命令执行后端2026-11-03)。

M2-3b（2026-11-03，无迁移）：turns.input_json 新增仅后端写入的 executionContext `{clientSessionId?, policySnapshotId, policy}`，创建时固定真实发起客户端及策略，REST TurnDto / 模型上下文仍只公开 text；缺客户端上下文的旧 Turn 不能执行 run_command。审批参数哈希增加规范化命令与 session / Turn / client / 策略快照 / 根绑定，审批 scope 只保存脱敏摘要；command_executions 沿用 0006，Agent tool.command.created 持久关联 commandId，输出仍不进入 SQLite。

M2-4（2026-11-03）：唯一 0007_terminals 新增 terminals / terminal_leases。Terminal 除 §7 字段外增加 reason_code / output_cursor；lease 保留 generation，并增加 owner_session_id / input_sequence，人机 principal 字段预留，只有人类连接路由已接入。活跃 dev 项目 + role 部分唯一索引；创建 ledger 与状态 / seq 同事务，输入只记序号 / 长度，不存输入正文，输出正文不进 SQLite。运行终端不长期持源码锁，创建 ledger 完成不代表资源结束；非持锁占位与重启 / 不确定屏障见 m2-resources §16。脱敏启动摘要与原参数哈希分开，不从摘要重启进程。旧项目 / 锁 / fencing / stream 迁移保留，30 天后只清理安全终态元数据，保留序号；无破坏性回滚。

### M2-9 迁移 0009_terminal_title

`terminals.title TEXT NULL`：共享显示名称；不复用 dev role、不改变活动 role 唯一索引。旧行自动 null；改名事务同时写审计与递增 terminal resource stream seq，再广播。非破坏迁移，无配置变化。

### M2-10 共享默认目录（无迁移）

新 sessions.project_id=null 行使用既有全局终端目录 dataDir/sessions/global-terminal/workspace；多个会话的 workspace_path 可以相同。原独立会话行、目录与文件保持不变。DTO workspaceKind 是派生字段，无新增列。File cache / operation / stream 的 scope_key 可为 workspace:default；真实默认写作业按相同根互斥。默认终端 workspace_session_id 为 null，创建来源与资源生命周期不变。共享目录不可随创建失败、归档、草稿切换或隐藏视图删除。
