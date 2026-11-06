# M4-3b 验收记录：服务运维页、日常动作与运维 Agent

> 2026-11-06，分支 `task/m4-3b-service-ops-ui`。实测 macOS arm64、Node 20.19.3、PM2 7.1.2（真实 PM2 测试临时 prefix）。

## 1. 交付

- 唯一迁移 `0014_service_actions`：`service_action_authorizations`（`sauth_`），action start/stop/restart/recover；绑定 target、当前 artifactHash/version，不改变产物/版本；schemaVersion 14。
- 日常动作授权：autonomous 直接 AUTHORIZED；standard/strict PENDING → 人工 decision；readonly DENIED；一次性消费、过期、服务当前版本/产物变化失效。
- `ServiceOpsRuntime.executeAction` 真实 PM2 start/stop/restart/recover；只操作当前版本配置，不替换产物；锁、审计、`service-ops.status` 事件、observed/desired 更新。
- REST：`POST /api/service-ops/services/:id/actions`、`GET/service-actions/:id`、`POST /:id/decision`、`POST /:id/execute`；Cookie/Origin/CSRF、同 clientSession execute。
- Web：左侧「服务运维」入口、`/service-ops` 独立页；正式服务列表、实际状态、版本/PID/健康、发布历史、日志、启停重启、人工审批横幅、运维 Agent 指令输入。页面独立于当前聊天；资源浮窗仍只展示开发服务。
- 独立运维 Agent：`list_formal_services` / `read_formal_service_logs` / `start|stop|restart_formal_service`；opsRegistry 与开发 registry 分离；`POST /services/:id/agent-turns` 写入 `executionContext.domain=service-ops,targetId`；system prompt 明确范围与版本变更限制。
- 跨域：普通开发 Turn 不装配运维工具；运维 Turn 不装配开发工具；直接提交另一域工具名返回 TOOL_NOT_FOUND；正式 ID 调开发 REST、开发 ID 调运维 REST、正式 ID 调预览均被拒绝。

## 2. 验收映射

| 场景 | 结果 |
|---|---|
| D5 autonomous 日常启停/重启 | 服务层/真实 PM2 覆盖；无人工步骤，真实策略/作用域/审计 |
| D9 人/AI 管理同版本受管服务 | 人 REST 与 Agent 工具共用 runtime/授权/锁/审计；真实双客户端 UI 留 M4-4 |
| D13 独立运维页/开发浮窗不混 | 浏览器 E2E 覆盖独立入口与空态；开发浮窗代码未改；有正式服务的浏览器展示留 M4-4 |
| D14 两类模型实际上下文 | context assembler 测试断言工具列表、system prompt、目标绑定；真实模型调用留 M4-4 |
| D15 跨域伪造 ID/tool/上下文 | REST 404、工具 TOOL_NOT_FOUND、伪造开发 Turn 拒绝；预览因 E2E 未启用返回 PREVIEW_DISABLED，完整预览反例留 M4-4 |
| D16 正式/临时身份独立 | 独立 target/表/REST/事件；浏览器同时展示留 M4-4 |

## 3. 测试与检查

- 新增/扩展：service actions 迁移、ServiceOps runtime 动作、REST 授权/审批/执行/跨域、service-ops Agent context/cross-domain、ServiceOpsPage 组件、`e2e-auth/service-ops.spec.ts`。
- `VITEST_MAX_WORKERS=3 pnpm check` 通过：web 125、agent 33（1 skipped）、server 492（8 skipped），合计 650 passed / 9 skipped；`pnpm build` 通过。
- `pnpm test:pm2:m4` 通过（含 start/stop/restart、v1→v2、健康失败回滚、对账、秘密隔离）。
- `LARNESS_E2E_PORT=3330 LARNESS_E2E_WEB_PORT=5330 pnpm test:e2e:auth --grep "service operations"` 1/1 通过（独立入口/页面/空态）。
- 未运行：真实模型 Provider 的运维 Turn、两客户端同时观察正式服务、启用预览的跨域反例、正式服务浏览器列表/审批/日志。以上归 M4-4 集成验收；不能由本记录宣称 D13–D16 全部端到端通过。

## 4. 边界

- 日常动作不改变版本/产物；版本变更仍须计划 + apply。
- 运维 Agent 的 standard/strict 工具审批与 `sauth_` 决策在同一次受控调用中记录；不伪造人工批准。
- 正式服务列表/动作/日志依赖 PM2 可用；PM2 初始化失败时页面显示不可用/空态，不阻塞开发。
- 仅 macOS arm64；跨平台、零停机、主机重启/开机自启未验证。
