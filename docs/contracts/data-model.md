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
  admin_hash       TEXT NOT NULL,          -- Argon2id
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
| `projects` | `id, name, root_path, real_path, settings_json, git_detected, created_at, updated_at` | `real_path` 为 canonical；删除只删行 |
| `sessions` | `id, project_id?, workspace_path, title, status, model_profile_id?, approval_policy_id, created_at, updated_at, last_activity_at` | 独立会话的 workspace 在 dataDir 下 |
| `turns` | `id, session_id, model_profile_id, provider, model, status, input_json, usage_json, error_json, idempotency_key, created_at, started_at, ended_at` | 一个 Session 同时最多一个活跃 Turn |
| `agent_events` | `id, session_id, turn_id, seq, type, payload_json, created_at`；`UNIQUE(session_id, seq)` | `seq` 在 Session 内递增，事务内分配 |
| `model_profiles` | `id, label, provider, model, credential_profile_id, endpoint, capabilities_json, created_at` | 不含密钥 |
| `credential_profiles` | `id, provider, label, secret_ref, created_at` | 密钥在 SecretStore |
| `secrets` | `id, ciphertext, nonce, tag, created_at` | AES-256-GCM；主密钥在文件系统 |
| `approvals` | `id, turn_id, tool_call_id, tool_name, risk, status, scope_json, params_hash, expires_at, decided_at, decided_by, created_at` | 审批参数绑定与审计 |
| `resource_locks` | `id, resource_type, resource_id, owner, execution_id, fencing_token, expires_at, heartbeat_at, created_at` | M2 使用 |

索引：`agent_events(session_id, seq)`、`turns(session_id, created_at)`、`sessions(project_id, updated_at)`、`projects(real_path)`。

约束：

- `sessions.project_id` 外键可空；项目删除时置空而不是级联删除会话（保留历史）。
- `turns.idempotency_key` 与 `session_id` 建唯一索引，防止重复提交。
- Turn 状态变化必须写事件；重启时把无法证明存活的 `RUNNING` 标记 `INTERRUPTED`。

## 4. M2–M5 表（目标）

| 表 | 里程碑 | 关键列 |
|---|---|---|
| `terminals` | M2 | `id, project_id?, source_session_id?, cwd, shell, status, created_at, ended_at` |
| `file_versions` | M2 | `path, project_id, version_hash, size, mtime, updated_at` |
| `services` | M3 | `id, project_id?, name, kind, runtime, config_json, desired_state, observed_state, created_at` |
| `service_logs` | M3 | `service_id, cursor, chunk, created_at`（或落盘 + 索引） |
| `deployments` | M4 | `id, service_id, commit_sha, artifact_ref, status, plan_json, created_at` |
| `scheduled_jobs` | M5 | `id, name, schedule, scope, policy, enabled, created_at` |
| `job_runs` | M5 | `id, job_id, status, started_at, ended_at, log_ref` |
| `update_runs` | M5 | `id, from_version, to_version, status, started_at, ended_at` |

完整字段在对应 milestone spec 中冻结；不得在实现时静默增加跨里程碑的大表。

`BrowserTab`、`Window`、`WindowTab`、`ProjectFilter` 是**客户端视图状态**，不落服务端数据库；其身份、来源与筛选规则见 [resource-views.md](resource-views.md)。

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
