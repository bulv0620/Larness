# M4-2 验收记录：策略授权与条件人工审批

> 2026-11-06，分支 `task/m4-2-plan-authorization`。实测平台 macOS arm64、Node.js 20.19.3。依赖 M4-1 计划/产物校验。

## 1. 交付

- 唯一迁移 `0012_deployment_authorizations` 新增 `deployment_authorizations` / `deployment_approvals`，schemaVersion 12；ID `dauth_` / `dapv_`，与开发工具 `apv_`、服务 `svc_`、终端/命令 ID 分离。
- `DeploymentAuthorizationService`：运维领域 `service-ops` 上下文、项目/目标/actor/policySnapshot 绑定、四种策略决策、人工审批、计划撤销、授权撤销、一次性消费与幂等。
- `decideDeploymentAccess(policy, risk)` 与既有 `decideToolAccess` 同语义；M4-2 只使用 apply=L2。
- standard/strict：PENDING 授权 + PENDING `deployment_approvals`，批准后才 AUTHORIZED；拒绝 DENIED。readonly：DENIED，无审批。autonomous：直接 AUTHORIZED，`approvalId=null`，不创建 `dapv_`、不写 `approval.granted`。
- 授权绑定 planHash/artifactHash/scopeHash（含 domain/project/target/plan/action/两个哈希）、policySnapshotId、actor、expiresAt；`verifyAuthorization` 复核计划、目标 current 指针与产物内容。
- `consumeAuthorization` 一次性消费；同一 consumeKey 幂等，不同 key 拒绝；`revokePlan` 使计划 CANCELLED 并把 PENDING/AUTHORIZED 授权置 INVALIDATED。
- 启动时 `recoverExpired()` 接入 `startServer`；审计动作覆盖 requested/granted/denied/expired/revoked/invalidated/consumed、approval.requested/granted/denied/expired、plan.revoked。
- 共享 Zod schema/DTO、`DEPLOY_AUTH_*` / `DEPLOY_APPROVAL_*` 错误码、部署/数据模型/REST/WS 契约同步。

## 2. 验收场景映射

| 场景 | 结果 | 证据 |
|---|---|---|
| D4 standard/strict 等待真实人工批准；篡改/过期/拒绝后不可执行 | **服务层覆盖**：PENDING 不可消费；真实 `decideApproval` 批准/拒绝；计划篡改、审批过期、目标变化、产物篡改均失败并 INVALIDATED/EXPIRED | 授权测试组 |
| D5 autonomous 全流程无人工审批/确认 | **覆盖**：直接 AUTHORIZED、无 `dapv_` 行、无 `approval.granted`，但保留真实 actor/policy/policySnapshotId/planHash/artifactHash 与 audit | autonomous 测试 |
| D6 未鉴权/scope 错/artifact/planHash 不符/锁失效/取消 | **服务层覆盖**：domain、项目、目标、actor、policySnapshot、action、dev approval ID、跨项目、计划撤销、产物/目标变化全部拒绝且无副作用；HTTP 未鉴权与取消/锁的 REST 层归 M4-3 | 反例测试组 |
| 只读拒绝写 | **覆盖**：readonly 记录 DENIED，无审批，消费失败 | readonly 测试 |
| 授权/审批过期与恢复 | **覆盖**：授权过期、审批过期、`recoverExpired()` | 过期/恢复测试 |

## 3. 测试与检查

- 新增 `deployment-authorizations.test.ts` 11 项、`deployment-authorizations-migration.test.ts` 1 项，共 12 项通过；覆盖四种策略、批准/拒绝、审批前消费、幂等消费、授权/审批过期、计划篡改/撤销、产物篡改、目标变化、作用域/actor/开发审批 ID 反例、启动恢复。
- `VITEST_MAX_WORKERS=3 pnpm check` 通过：Biome 510 文件、全 workspace 类型；web 124、agent 33（1 skipped）、server 483（7 skipped），合计 640 passed / 8 skipped。8 项为既有 M3/M4 PoC 专用命令跳过。
- `pnpm build` 通过。
- 未跑浏览器 E2E：M4-2 无 UI/浏览器行为；未运行真实 PM2、HTTP 健康、部署 apply、REST 未鉴权/CSRF 或 M4-3b 工具装配，不能由本记录宣称端到端 D4–D6 通过。
- 未修改已应用迁移、用户源码/运行数据、配置、认证或 IPC；未安装依赖或 PM2。仅 macOS arm64 实测。

## 4. 边界与后续

- **人工审批真实入口未交付**：M4-2 的 `decideApproval` 是后端权威，测试使用真实 `decidedBy` client session 记录；HTTP/UI 审批入口、CSRF/Origin/会话守卫与运维事件归 M4-3 / M4-3b。D4 的“等待真实人工批准”在服务层成立，不等于浏览器入口已可用。
- **消费与 apply 之间仍有校验窗口**：`consumeAuthorization` 在事务前完成计划/产物校验，M4-3 必须在真实 apply 前再次调用 `verifyAuthorization`/`verifyPlan` 并持锁，不能以 M4-2 通过代替执行前复核。
- **policySnapshotId 仍是后端传入的标识**：M4-2 要求非空并在授权/消费时一致，但真实运维上下文的创建、绑定、撤销归 M4-3b/Q-030；M4-2 不宣称已完成 Turn 结束后的 grant 生命周期。
- M4-2 只支持 `action:"apply"`；日常 start/stop/restart/recover 授权随 M4-3b 冻结，不提前伪造。
- 计划/目标/授权记录保留策略与清理归 M4-3；未删除任何记录。
