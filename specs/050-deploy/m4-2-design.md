# M4-2 技术冻结：策略授权与条件人工审批

> 2026-11-06，M4-2 开工记录。依赖 M4-1 的 `DeploymentPlanDto` / `verifyPlan` / `verifyArtifact`。G-Spec-M4 产品边界已确认；本文件冻结 M4-2 的授权记录、人工审批、作用域和失败边界。

## 1. 范围

M4-2 交付正式发布计划的**授权层**：

1. 运维领域（`service-ops`）与项目/目标作用域绑定；
2. 四种策略的决策：standard / strict 需人工审批，readonly 拒绝写，autonomous 直接记录策略允许；
3. 人工审批记录与授权记录分离；自主不创建人工 approvalId、不伪造 `approval.granted`；
4. 计划过期/撤销/篡改、产物变化、目标当前版本变化、授权过期/撤销/已消费一律拒绝；
5. 授权一次性消费与幂等键，供 M4-3 apply 前校验；
6. 拒绝复用开发工具审批/上下文/跨域 ID。

明确不在 M4-2：PM2 启动/替换/健康、REST/WS/UI、Agent 工具装配、正式服务日常动作。人工审批的 HTTP/UI 入口归 M4-3/M4-3b；M4-2 的 service 是其后端权威。M4-2 只支持 `action:"apply"`；日常 start/stop/restart/recover 授权随 M4-3b 冻结。

## 2. 数据（唯一迁移 0012_deployment_authorizations）

| 表 | 关键列 | 说明 |
|---|---|---|
| `deployment_authorizations` | `id, plan_id, target_id, project_id, action, actor_type, actor_id, client_session_id, session_id, turn_id, policy, policy_snapshot_id, status, plan_hash, artifact_hash, scope_json, scope_hash, approval_id, request_key, expires_at, decided_at, consumed_at, consume_key, reason_code, created_at` | `UNIQUE(request_key)`；`approval_id` 无 FK（审批表反向引用）；状态 PENDING/AUTHORIZED/DENIED/EXPIRED/REVOKED/CONSUMED/INVALIDATED |
| `deployment_approvals` | `id, authorization_id, plan_id, target_id, project_id, status, plan_hash, artifact_hash, requested_by, decided_by, expires_at, decided_at, created_at` | `UNIQUE(authorization_id)`；状态 PENDING/APPROVED/DENIED/EXPIRED/REVOKED；仅 standard/strict 需要时创建 |

约束：

- 所有哈希 64 hex；`plan_id` 外键到 M4-1 计划；项目/目标外键与业务校验双重。
- `action` 在 M4-2 固定 `apply`，由 CHECK 约束；其他动作不提前伪造。
- 授权 `expires_at` 不超过计划 `expires_at`；人工审批 `expires_at = min(now+5min, 授权到期)`。
- `consume_key` 记录一次性消费的幂等键；同一授权第二次消费只有相同 key 幂等返回。
- ID 前缀 `dauth_` / `dapv_`；与开发服务 `svc_*`、终端、命令、工具审批 `apv_*` 完全不同。
- 迁移非破坏，schemaVersion 11 → 12；旧表/数据/流序号不变。

## 3. 策略决策

| policy | 计划 apply（L2） | 人工步骤 |
|---|---|---|
| standard | `require_approval` | 创建 deployment approval，等待真实批准 |
| strict | `require_approval` | 同上 |
| readonly | `deny` | 不创建可执行授权；记录 DENIED |
| autonomous | `allow` | 直接 AUTHORIZED，`approval_id=null`，无人工审批/确认 |

`decideDeploymentAccess(policy, risk)` 与既有 `decideToolAccess` 语义一致：L0 只读允许；L3 非自主拒绝；autonomous 允许已授权业务动作；standard L1 允许、L2 需审批；strict 非 L0 需审批。M4-2 只使用 apply=L2；构建 L1 的授权由 M4-3b 工具层复用同一函数，不在本任务假装已接入。

## 4. 授权上下文与作用域

`DeploymentAuthorizationContext`（strict）：

```json
{
  "domain": "service-ops",
  "projectId": "prj_…",
  "targetId": "tgt_…",
  "action": "apply",
  "policy": "autonomous",
  "policySnapshotId": "psnap_…",
  "actor": { "type": "human", "id": "client_…" },
  "clientSessionId": "client_…",
  "sessionId": null,
  "turnId": null
}
```

- `domain` 必须精确 `service-ops`；开发 Turn 上下文、开发工具审批 ID、`svc_*`/`trm_*`/`cmd_*` 不能通过。
- human actor 必须有 clientSessionId；agent actor 必须有 sessionId + turnId；actor.id 非空。
- 项目/目标必须与计划一致；ID 必须是正式 `tgt_`/`plan_`/`art_`/`dauth_`/`dapv_`。
- 授权 scope JSON = `{domain, projectId, targetId, planId, action, planHash, artifactHash}`，scopeHash 规范化 SHA-256。
- `policySnapshotId` 由后端上下文生成；M4-2 要求非空并在授权/消费时与记录一致。M4-3b 从真实 Turn/运维入口绑定，禁止前端或模型自报。

## 5. 状态机与校验

```text
authorizePlan:
  READY plan + verifyPlan + matching scope
    ├─ autonomous → AUTHORIZED (approvalId=null)
    ├─ standard/strict → PENDING + deployment approval PENDING
    └─ readonly → DENIED (不执行)

decideDeploymentApproval:
  PENDING + plan still valid
    ├─ approve → APPROVED + AUTHORIZED
    └─ reject  → DENIED + DENIED

verifyAuthorization:
  PENDING → DEPLOY_AUTH_REQUIRED
  DENIED/REVOKED/EXPIRED/INVALIDATED → DEPLOY_AUTH_INVALID
  AUTHORIZED + now≥expiresAt → EXPIRED
  AUTHORIZED + plan/artifact/target 变化 → INVALIDATED
  AUTHORIZED + scope/context mismatch → DEPLOY_AUTH_INVALID

consumeAuthorization:
  AUTHORIZED + verify → CONSUMED (consume_key, consumed_at)
  CONSUMED + same key → idempotent success
  CONSUMED + other key / any invalid state → DEPLOY_AUTH_INVALID
```

- 计划撤销：`revokePlan` 把 READY 计划置 CANCELLED，PENDING/AUTHORIZED 授权置 INVALIDATED，PENDING 审批置 EXPIRED；之后不可授权/执行。
- 计划过期、产物哈希变化、目标 current_artifact/current_version 变化由 M4-1 `verifyPlan` 检出并标记 INVALIDATED。
- 人工审批拒绝、过期、撤销均不可执行；不能通过再次调用 approve 绕过。
- 授权过期与审批过期分别记录 EXPIRED；消费后不可重用。
- 所有状态变化与审计在同一事务提交；失败不伪报成功。

## 6. 错误码

新增：

| 码 | HTTP | 用途 |
|---|---|---|
| `DEPLOY_AUTH_REQUIRED` | 409 | 尚无可用授权 / 仍在等待审批 |
| `DEPLOY_AUTH_INVALID` | 409 | 领域/作用域/actor/policySnapshot/哈希/状态/撤销/已消费不匹配 |
| `DEPLOY_APPROVAL_INVALID` | 409 | 审批不存在、非 PENDING、绑定不匹配、跨域 ID |
| `DEPLOY_APPROVAL_EXPIRED` | 410 | 人工审批过期 |

计划/产物错误沿用 M4-1 `DEPLOY_PLAN_INVALID` / `DEPLOY_PLAN_EXPIRED` / `DEPLOY_ARTIFACT_INVALID`。

## 7. 审计与安全

- 审计动作：`deployment.authorization.requested/granted/denied/expired/revoked/invalidated/consumed`、`deployment.approval.requested/granted/denied/expired`、`deployment.plan.revoked`。
- 审计只含 ID、policy、policySnapshotId、planHash/artifactHash、approvalId、reasonCode；不含秘密、正文、命令环境。
- autonomous 记录真实 actor/scope/policySnapshotId/planHash/artifactHash，不写 `approval.granted`、不创建 `dapv_`。
- 只读策略拒绝写，不能靠审批按钮越权；人工审批只影响 standard/strict 的 PENDING 授权。
- 本任务不新增未鉴权接口；REST 接入时必须复用现有 Cookie/Origin/CSRF/会话守卫（M4-3）。

## 8. 测试计划（先失败）

1. 迁移 0012：空库/v11 升级、表/索引/CHECK、旧数据保留。
2. standard/strict：PENDING + PENDING 审批；批准 → AUTHORIZED；拒绝 → DENIED；批准前/拒绝后消费失败。
3. autonomous：直接 AUTHORIZED、approvalId null、无 `dapv_`、无 `approval.granted`；真实 audit 记录。
4. readonly：DENIED，无审批，消费失败。
5. 计划篡改/过期/撤销、产物篡改、target current 变化：授权或消费失败，状态 INVALIDATED/EXPIRED。
6. 授权过期、审批过期、撤销、重复消费/幂等消费。
7. 领域/项目/目标/actor/policySnapshot/action 不匹配、开发 tool approval ID 冒充、跨项目计划：拒绝。
8. 类型/格式/单元/集成、`pnpm check`、`pnpm build`；无 UI 不跑浏览器，如实记录。
