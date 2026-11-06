# M4-3 技术冻结：持久服务运行、发布执行与对账

> 2026-11-06，M4-3 开工/实现记录。依赖 M4-1 计划/产物与 M4-2 授权/审批。M4-0 的隔离 PM2 证据见 [poc.md](poc.md)。

## 1. 范围

- TUI 启动检查全局 PM2；缺失时安装固定候选 `pm2@7.1.2`，已装兼容则复用；失败只限制正式服务管理，不阻塞开发。
- 每实例私有 `PM2_HOME=<dataDir>/pm2`，命名空间 `larness`；应用名 `larness-<targetId>`。Larness 管理进程正常/异常退出均不停止 PM2 守护与正式服务；重开 `reconcile` 实际状态。
- 正式服务独立仓储、身份、REST `/api/service-ops/`、`service-ops` 事件流与日志。
- 首次运行、版本替换、HTTP 健康、版本/部署记录、失败回滚与对账。
- 不在本任务：服务运维 UI、Agent 运维工具、日常 start/stop/restart 授权（M4-3b）；零停机、跨平台、secretRef 完整注入（Q-029）。

## 2. PM2 初始化与适配器

- `inspectGlobalPm2`：`npm root --global` 定位全局 `pm2`，校验包名/版本 7.1.2、入口/清单为非符号链接普通文件；缺失返回 `missing`，版本/身份/npm 不可用返回 `unavailable`。
- `ensureGlobalPm2`：缺失时 `npm install --global pm2@7.1.2 --ignore-scripts --omit=optional --no-audit --no-fund`；前缀不可写、安装失败返回可处理原因，不启动守护。
- TUI 子进程设置 `LARNESS_PM2_AUTO_INSTALL=1`；测试/离线可用 `0`，`LARNESS_PM2_PREFIX` 仅测试临时前缀。`startServer` 初始化失败记录日志并继续，`serviceOps.available()=false`。
- `Pm2Adapter`：只连接本实例 `PM2_HOME`；观测用 socket-only RPC，不拉起守护；动作通过已校验 PM2 入口的 `startOrRestart/stop/delete`；守护身份用 `pm2.pid` + `/bin/ps` 命令行核对；`PM2_HOME` 目录 0700。
- 版本替换：`startOrRestart` 不会更新已存在应用的 script/cwd，因此先 `delete <name>` 再 `startOrRestart` 新配置；新版本启动/健康失败时用旧产物配置回滚。非零停机。
- 适配器环境只保留 PATH/HOME/TMPDIR/LANG/PM2_*；应用 env 只注入 `PORT`/`NODE_ENV`，不继承 `LARNESS_*`/API Key/Cookie。

## 3. 数据（唯一迁移 0013_service_ops）

| 表 | 关键列 | 说明 |
|---|---|---|
| `service_ops_services` | `target_id, project_id, name, namespace, pm2_name, desired_state, observed_state, current_artifact_id, current_version, config_json, pid, last_health_at, reason_code, created_at, updated_at` | 正式服务运行记录；`pm2_name UNIQUE`；状态 stopped/starting/running/unhealthy/stopping/failed/unknown |
| `service_ops_deployments` | `id, target_id, project_id, plan_id, authorization_id, artifact_id, previous_artifact_id, previous_version, version, status, plan_hash, artifact_hash, actor_type, actor_id, policy, policy_snapshot_id, reason_code, health_json, result_json, started_at, ended_at, created_at` | 发布记录；`plan_id`/`authorization_id` 唯一；状态 APPLYING/HEALTH_CHECK/SUCCEEDED/FAILED/UNKNOWN |

- ID 前缀 `dep_`；旧表/数据/流序号不变，schemaVersion 12 → 13。
- 服务当前版本同时写 `deployment_targets.current_artifact_id/current_version`；计划状态随 apply 从 READY → APPLYING/HEALTH_CHECK → SUCCEEDED/FAILED。
- 事件使用既有 `resource_streams/resource_events`，streamId `ops:<targetId>`，类型 `service-ops.status` / `service-ops.deployment`；payload 只含状态/版本/哈希/PID/deploymentId/reasonCode，不含日志正文或秘密。

## 4. Apply 流程

1. 按 planId 幂等返回已有部署；否则检查 authorizationId 未使用。
2. `getPlan` 必须 READY，`verifyPlan` 校验计划/产物/目标 current 指针，`verifyArtifact` 重算产物。
3. 获取 `service` 资源锁（targetId，60s TTL，20s 续租）；锁冲突不消费授权。
4. `consumeAuthorization` 一次性消费；上下文/领域/目标/哈希不符拒绝。
5. 写部署记录 APPLYING，计划 APPLYING；确保 `service_ops_services` 行。
6. 写 `<dataDir>/service-ops/<targetId>/ecosystem.config.cjs`：Node 入口、cwd、日志 `<dataDir>/logs/deploy/<targetId>.log`、`PORT`、自动重启；只接受 Node 入口形式。
7. PM2 启动/替换；部署 HEALTH_CHECK，计划 HEALTH_CHECK；核对 PM2 应用名/命名空间/script/cwd/interpreter/args。
8. HTTP 健康轮询（2xx，超时/间隔来自计划）。成功：服务/目标/计划/部署同事务更新为成功并写事件。
9. 失败/启动失败/身份不符：有旧产物时用旧配置回滚并健康核验，记录 `*_ROLLED_BACK`；否则停止应用并记录 FAILED/unknown。计划 FAILED，授权已消费。
10. 锁释放在 finally；执行内锁续租失败记 LOCK_LOST。

对账 `reconcile`：读取服务记录，观察 PM2 状态与健康，更新 observedState（不自动启动），变化时写 `service-ops.status` 事件。启动时后台执行一次，不阻塞 HTTP。

## 5. REST / WS / 日志

- `GET /api/service-ops/status`、`GET /api/service-ops/services`、`GET /api/service-ops/services/:id`、`GET /:id/deployments`、`GET /:id/logs`。
- `POST /api/service-ops/plans`、`POST /api/service-ops/authorizations`、`POST /api/service-ops/approvals/:id`、`POST /api/service-ops/apply`。
- 人工策略从 body `sessionId` 对应 Session 的 `approvalPolicyId` 读取；缺省 standard，禁止客户端自报 autonomous。申请/审批/apply 都要求既有 Cookie/Origin/CSRF 守卫；apply 只允许同一 clientSession。
- `GET /api/resource-events?streamId=ops:<targetId>` 重放；WS `{topic:"service-ops",resourceId:targetId,after}` 订阅并核验 target 存在。未授权/未知 target 拒绝。
- 日志读取上限 1 MiB；PM2 日志由适配器受控路径，不在源码目录。

## 6. 退出、失败与边界

- 正常/异常退出不停止 PM2 守护或正式服务；`startServer` 不调用 `Pm2Adapter.close`（仅测试清理使用）。
- 目标/计划/授权/产物/锁不符、未知 PM2 状态、健康失败均不伪报成功；失败保留日志/记录/旧版本。
- 不宣称 OS 沙箱、零停机、跨平台、任意 PM2 版本兼容、数据库迁移回滚。
- Q-029 未完全关闭：本任务验证守护/应用环境不继承合成秘密、dump/日志无该标记；正式 `secretRef` 注入与所有落盘路径仍须 M4-3 后续/评审确认，当前不交付秘密注入。
- 仅 macOS arm64、Node 20.19.3、PM2 7.1.2 实测。

## 7. 测试

- 迁移 0013；无 PM2 的 apply 失败/授权消费/事件/REST/CSRF/未鉴权；WS 订阅/事件/非法 target。
- 真实 PM2（`pnpm test:pm2:m4`，临时 prefix 安装）：兼容复用、TUI startServer 初始化、首次启动、v1→v2 替换、健康失败回滚 v2、PM2 停止后 reconcile、日志、事件、合成秘密不进入应用环境/dump/日志。
- `pnpm check`、`pnpm build`；不新增 UI，不跑浏览器。
