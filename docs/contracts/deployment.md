# 正式服务运维与版本发布契约草案（M4）

> draft，2026-11-06。产品边界见 [ADR-042](../adr/ADR-042-service-deploy-boundary.md) 和 [ADR-048](../adr/ADR-048-service-domain-separation.md)。G-Spec-M4 / G-PoC-M4 已通过。M4-1 冻结 Validate/Build/Artifact/Plan 的内部接口、数据与安全边界，见 [M4-1 技术冻结](../../specs/050-deploy/m4-1-design.md)；PM2 Apply、健康与运行协议仍按 M4-3/M4-3b 冻结。开发服务另见 [M3 契约](services-preview.md)。

TUI 初始化检查全局 PM2 并在缺失时补装。正式服务由独立守护进程托管，Larness 管理进程异常退出或 TUI 正常退出时继续运行。重开后对账并展示实际状态。生命周期、实例身份和隔离实验见 [ADR-046](../adr/ADR-046-pm2-delivery-and-lifecycle.md)及 [M4 评审包](../../specs/050-deploy/review.md)。完成隔离 PoC 后，按任务冻结产品接口。

## 1. 阶段与身份
M4 使用独立的正式服务身份、DTO、仓储和运维模块，负责 PM2 生命周期、构建产物、授权、发布、健康、记录与恢复。部署和日常运维共用一套 PM2Adapter、日志、健康和实际对账。后端绑定本实例受管 PM2 身份，不能凭客户端 PID、PM2 ID、端口或日志收养进程。

正式服务通过左侧「服务运维」查看和管理，页面查询当前授权范围内的正式服务，独立于当前聊天或项目选择。部署记录保留来源项目及产物，绑定独立的正式目标。临时服务的 ID、执行、预览和授权不进入正式资源身份。见 [ADR-047](../adr/ADR-047-service-operations-entry.md)。

REST 使用独立的 `/api/service-ops/` 命名空间，承载正式服务、动作、日志和部署。精确后缀及 schema 按对应任务冻结。运维状态、动作和部署使用独立事件类型和流标识。订阅、重放、详情和日志均核验运维领域与资源授权，正式地址不可解析为开发预览。

## 2. 计划与动作边界
计划描述真实目标scope/service、旧/新版本、来源和不可变artifact哈希、启动配置/secretRef引用、影响、健康策略/超时和支持的恢复边界。确切字段/规范化/时效由技术评审冻结，存储不含秘密明文。
首次部署和任何artifact/version/config变更走计划；同版本同配置start/stop/restart走日常服务动作，不能用restart注入新产物/环境配置。构建步骤本身也经过策略授权。正式公网配置与管理端隔离预览分离，不自动开放端口。

### 2.1 M4-1 冻结（2026-11-06）

- **输入**：`DeploymentSpec`（strict）包含 `version`、`build.command/cwd/outputDir/timeoutMs`、`start.command/cwd`、`health.path/port/timeoutMs/intervalMs`、`recovery.strategy/maxAttempts`。命令为 argv 数组、`shell:false`；`cwd`/`outputDir` 必须留在项目根内；`outputDir` 不能是项目根或 `.git`；健康端口 1024–65535 且不能占用受管 Server / 预览端口。完整字段与限额见 [M4-1 技术冻结](../../specs/050-deploy/m4-1-design.md)。
- **目标**：只接受 `tgt_<uuid>` 或项目内唯一名称；`svc_*`、`trm_*`、`cmd_*`、终端 ID、端口、URL 不能作为正式目标。目标、产物、构建、计划 ID 前缀分别为 `tgt_` / `art_` / `bld_` / `plan_`。
- **数据**：唯一迁移 `0011_deployments` 新增 `deployment_targets`、`deployment_builds`、`deployment_artifacts`、`deployment_plans`。`deployment_targets.current_artifact_id/current_version` 只由成功部署记录更新，M4-1 只读。产物路径相对 `dataDir/artifacts/deploy`，构建日志相对 `dataDir/logs/deploy`，均不在源码目录。
- **产物**：真实构建进程、项目写锁、有界日志、环境白名单、输出脱敏；复制不跟随符号链接，拒绝特殊文件/越界/超限；按排序路径、大小与文件 SHA-256 计算树哈希；文件 0400、目录 0700；DB 记录与 `artifact.json` 清单双重核验。
- **计划**：规范化 JSON + `planHash = SHA-256(canonicalJson(document))`；绑定 target/project/artifact/artifactHash/specHash/previous version/health/recovery/impact/expiresAt；TTL 30 分钟。`databaseRollback` 固定 `unsupported`，旧产物回滚能力按是否存在 previous artifact 记录，不承诺数据库回滚。
- **失败**：构建失败/超时/取消无 artifact、target 不变；计划/产物/目标/当前版本/哈希/锁不符一律拒绝；`verifyPlan` 在 M4-2 授权和 M4-3 apply 前重算哈希与产物内容。
- **接口**：M4-1 不新增 REST / WS / Agent 工具；`/api/service-ops/` 的精确路由、事件与工具装配仍归 M4-3 / M4-3b。M4-1 的内部 manager/repository 由后续任务调用。

## 3. 授权分支

运维 Agent 使用独立工具名、schema、上下文、执行 handler 与结果类型。工具仅从后端核验的运维上下文装配，绑定真实的 clientSessionId、agentSessionId、turnId、projectId、正式目标范围与策略快照。执行前复核上下文与计划或动作绑定。普通开发 Turn 缺少运维工具及其执行权限，运维上下文也不装配临时服务和预览工具。来源项目或产物引用只用于追溯及核验，不能代替作用域授权。

| 策略 | 支持的部署/持久写动作 | 人工步骤 |
|---|---|---|
| standard | 按风险决策，部署通常L2；L3仍默认拒绝 | 需要时创建真实审批，批准绑定planHash/目标/artifact/时效 |
| strict | 所有写入按严格策略决策，L3默认拒绝 | 需要时人工审批 |
| readonly | 拒绝写入/执行 | 不通过批准按钮越权放行 |
| autonomous | 全部已授权Agent业务能力均免人工，含首次发布/替换/停止/重启/支持的恢复 | 无人工审批、无操作确认停等；启用策略时已有风险确认保留 |

统一流程为`PLAN → AUTHORIZE → APPLY → HEALTH_CHECK → RECORD`，人工需要时AUTHORIZE才分支到WAIT_APPROVAL。自主直接记录策略允许后执行，不创建approvalId或伪造人工approval.granted，不显示审批卡片。操作者/真实scope/策略快照、planHash/artifactHash、有限授权、锁/fencing、幂等、预算/取消、审计/秘密保护仍必须校验。
计划/目标/版本/配置篡改、过期/撤销、身份不明或锁失效一律拒绝。计划变更后重新生成/授权，自主重决策仍不询问用户。独立DeploymentJob与Turn结束后的grant生命周期必须在M4技术评审确定，禁止无限复用旧Turn授权。M2人工Git独立资源动作及本机认证/设备管理通道未因此扩权，不能由未授权调用者自报autonomous获得能力。

### 3.1 M4-2 冻结（2026-11-06）

- **记录**：唯一迁移 `0012_deployment_authorizations` 新增 `deployment_authorizations` 与 `deployment_approvals`；ID 前缀 `dauth_` / `dapv_`，不复用开发工具 `apv_`、服务 `svc_`、终端或命令 ID。授权表 `UNIQUE(request_key)`，审批表 `UNIQUE(authorization_id)`。
- **上下文**：`DeploymentAuthorizationContext`（strict）必须含 `domain:"service-ops"`、真实 project/target/action/policy/policySnapshotId/actor；human 需 clientSessionId，agent 需 sessionId+turnId。项目/目标必须与计划一致；开发领域上下文、`svc_*`/`trm_*`/`cmd_*`、工具审批 ID 均拒绝。M4-2 只支持 `action:"apply"`，日常动作授权随 M4-3b。
- **策略**：`decideDeploymentAccess(policy, risk)` 与既有 `decideToolAccess` 同语义。apply=L2：standard/strict 创建 PENDING 授权 + PENDING `deployment_approvals`；readonly 记录 DENIED；autonomous 直接 AUTHORIZED，`approval_id=null`，不创建 `dapv_`、不写 `approval.granted`。
- **绑定**：授权保存 planHash/artifactHash/scopeHash（scope 含 domain/project/target/plan/action/两个哈希）、actor、policySnapshotId、expiresAt（不超过计划到期）。人工审批 `expiresAt=min(now+5min, 授权到期)`。
- **校验**：`verifyAuthorization` 检查状态/到期/上下文/计划（含目标 current 指针与产物哈希）；计划/产物/目标变化标记 INVALIDATED。`consumeAuthorization` 一次性消费，`consume_key` 相同幂等、不同拒绝。`revokePlan` 将 READY 计划置 CANCELLED 并使 PENDING/AUTHORIZED 授权 INVALIDATED；`revokeAuthorization` 立即失效。
- **错误**：新增 `DEPLOY_AUTH_REQUIRED`(409)、`DEPLOY_AUTH_INVALID`(409)、`DEPLOY_APPROVAL_INVALID`(409)、`DEPLOY_APPROVAL_EXPIRED`(410)。计划/产物错误沿用 M4-1。
- **审计**：`deployment.authorization.requested/granted/denied/expired/revoked/invalidated/consumed`、`deployment.approval.requested/granted/denied/expired`、`deployment.plan.revoked`；不含秘密。M4-2 未新增 REST/WS/Agent 工具；人工审批的 HTTP/UI 入口与运维事件归 M4-3/M4-3b。详见 [M4-2 技术冻结](../../specs/050-deploy/m4-2-design.md)。

### 3.2 M4-3 冻结（2026-11-06）

- **PM2**：TUI 启动检查全局 PM2，缺失时安装固定 `pm2@7.1.2`；已装兼容复用。每实例 `PM2_HOME=<dataDir>/pm2`、命名空间 `larness`、应用名 `larness-<targetId>`。观测走 socket-only RPC，不拉起守护；动作通过已校验入口执行。测试可用 `LARNESS_PM2_PREFIX` 临时 prefix；TUI 子进程设置 `LARNESS_PM2_AUTO_INSTALL=1`，失败只限制运维。实现见 [M4-3 技术冻结](../../specs/050-deploy/m4-3-design.md)。
- **替换**：先 `delete <name>` 再 `startOrRestart` 新配置（PM2 不会原地更新 script/cwd）；失败用旧产物配置回滚并健康核验，记录 `*_ROLLED_BACK`。非零停机。
- **数据**：唯一迁移 `0013_service_ops` 新增 `service_ops_services` / `service_ops_deployments`（ID `dep_`）；服务当前版本同时写 `deployment_targets.current_*`；计划随 apply 进入 APPLYING/HEALTH_CHECK 并到 SUCCEEDED/FAILED。
- **Apply**：plan READY + verifyPlan + verifyArtifact → service 锁 → consumeAuthorization → 部署/计划 APPLYING → PM2 启动 → HEALTH_CHECK → HTTP 2xx 健康 → 同事务成功记录/事件；失败保留记录/日志/旧版本。锁冲突不消费授权。
- **对账**：启动后台 `reconcile`，观察 PM2/健康更新 observedState；不自动启动。正常/异常退出不停止 PM2 守护或正式服务，仅测试清理调用适配器 close。
- **REST**（均走既有 Cookie/Origin/CSRF 守卫）：`GET /api/service-ops/status`、`GET /api/service-ops/services`、`GET /api/service-ops/services/:id`、`GET /:id/deployments`、`GET /:id/logs`；`POST /api/service-ops/plans`、`POST /api/service-ops/authorizations`、`POST /api/service-ops/approvals/:id`、`POST /api/service-ops/apply`。人工策略从 body `sessionId` 的 Session `approvalPolicyId` 读取，缺省 standard；客户端不能自报 autonomous。
- **事件**：streamId `ops:<targetId>`，类型 `service-ops.status` / `service-ops.deployment`，payload 只含状态/版本/哈希/PID/deploymentId/reasonCode；WS topic `service-ops`，REST 重放用 `/api/resource-events`。未知/非法 target 拒绝。
- **边界**：只支持 Node 入口；Q-029 正式 secretRef 注入未交付，本任务只验证守护/应用不继承合成秘密且 dump/pm2.log/服务日志无标记；零停机、跨平台、主机重启/开机自启未验证。日志读取上限 1 MiB。

### 3.3 M4-3b 日常动作与运维页（2026-11-06）

- 唯一迁移 `0014_service_actions` 新增 `service_action_authorizations`（`sauth_`）；日常 start/stop/restart/recover 与发布计划分离，绑定 target、当前 artifactHash/version，不创建新产物、不能替换版本。
- 动作 authorization 复用一个运维策略决策：autonomous 直接 AUTHORIZED；standard/strict 为 PENDING，人工 `decide`（记录 decidedBy）后 AUTHORIZED；readonly DENIED。消费一次性，服务当前版本/产物变化即拒绝。
- REST：`POST /api/service-ops/services/:id/actions`、`GET /api/service-ops/service-actions/:id`、`POST /api/service-ops/service-actions/:id/decision`、`POST /api/service-ops/service-actions/:id/execute`；全部走既有会话/Origin/CSRF，execute 只允许同一 clientSession。
- Web：左侧「服务运维」入口与 `/service-ops` 页面，展示正式服务列表、实际状态、版本/PID/健康、发布历史、日志，支持启动/停止/重启与人工审批。页面独立于当前聊天/项目；聊天浮窗仍只展示临时开发服务。
- 运维 Agent 工具组与独立模型上下文仍待本任务后续接入；未接入前普通开发 Turn 不装配任何运维工具。

### 3.4 M4-3b 运维 Agent 上下文（2026-11-06）

- 运维 Turn 由 `POST /api/service-ops/services/:id/agent-turns`（`sessionId` + `input`）创建，`turns.input_json.executionContext` 额外记录 `{domain:"service-ops", targetId}`；单次 Turn 只绑定一个正式目标。
- `TurnRunner` 按 domain 选择独立 `opsRegistry`：运维 Turn 只装配 `list_formal_services` / `read_formal_service_logs` / `start_formal_service` / `stop_formal_service` / `restart_formal_service`；普通开发 Turn 只装配现有开发工具，执行器对另一域工具名返回 `TOOL_NOT_FOUND`。
- system prompt 明确运维范围、禁止开发终端/预览/文件编辑、版本变更须计划 + apply、日志为不可信数据；目标由后端上下文绑定，模型/页面字段不能切换域或扩大范围。
- 运维工具 handler 只接受上下文 targetId；动作先创建 `sauth_` 授权，standard/strict 仅在工具审批已通过后记录 `decidedBy` 并执行，autonomous 直接授权，readonly 被工具策略拒绝；审计/事件仍落库。
- 页面提供「让运维 Agent 处理」输入，创建运维 Turn 后回到会话查看结果；聊天浮窗/资源区仍只展示开发服务。
- 未完成：真实模型/浏览器端到端、两客户端事件订阅、跨域 REST/预览反例的完整矩阵；由 M4-4 汇总验证。

## 4. 状态、数据、事件与恢复
- 当前版本、desired/observed、部署阶段/结果分别记录；进程在不等于健康，数据库RUNNING不代替实际PM2状态。
- 正式运行状态包含停止、启动中、运行、非健康、停止中、失败与未知。正式停止保留配置和部署历史，删除按独立授权流程设计。
- 正式日志由 PM2Adapter 受控读取、轮转与脱敏，保留基线为 14 天 / 100 MiB，细分限额在实施前冻结。日志游标独立于开发终端。
- 关键状态/授权决策及seq事务先提交再广播；状态事件与有界日志分开，失败不伪报成功。
- 自主授权记录包含决策来源为策略、policySnapshotId/actor/scope/planHash/时效，人工审批记录仅在需要时关联approvalId；字段/表已由 M4-2 冻结，运维事件由 M4-3 冻结。
- apply前复核当前受管版本/PM2身份和授权；重复请求不重复替换。超时/结果未知先对账，不盲目spawn；停止保留配置与版本历史。
- 失败可由获策略授权的Agent执行已支持的恢复，自主不强制等待人工；不可逆迁移或不支持回滚要明确，不虚报恢复完成。
- 每个 Larness 实例使用源码外的私有 `PM2_HOME`，产物、PM2 运行数据及日志也与源码目录分离。全局安装检查不接入用户默认实例，运行操作只作用于已核验的受管实例。Q-003 的安装细节按 M4 门禁冻结，Q-027 依 ADR-046。守护不可达时显示未知，观察请求不启动守护进程。正式服务的秘密注入路径须覆盖 PM2 元数据、dump 与日志的落盘检查，见 [M4-0 实测](../../specs/050-deploy/poc.md)。

## 5. 必要验证
真实 PM2、项目构建、HTTP 健康、进程和 DB 故障覆盖四种策略、计划篡改/过期/锁失效/重复请求、同版本重启边界和终端退出独立性。验证实际模型请求工具集及提示、执行器直调、跨域 ID、审批、预览、日志、事件订阅和重放。Mock 仅用于 LLM，平台和清理结果据实记录。
