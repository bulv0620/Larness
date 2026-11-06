# M4-3 验收记录：持久服务运行、发布执行与对账

> 2026-11-06，分支 `task/m4-3-pm2-runtime`。实测平台 macOS arm64、Node.js 20.19.3、PM2 7.1.2。真实 PM2 测试使用 `pnpm test:pm2:m4`（临时 npm prefix，需网络安装）。

## 1. 交付

- `Pm2Adapter` / 全局 PM2 检查与补装：固定 `pm2@7.1.2`，兼容复用、缺失安装、前缀不可写/安装失败返回可处理原因；每实例私有 `PM2_HOME=<dataDir>/pm2`，命名空间 `larness`，应用名 `larness-<targetId>`。
- TUI 子进程 `LARNESS_PM2_AUTO_INSTALL=1`；`startServer` 完成全局检查/安装并暴露 `pm2Global`/`serviceOps`。失败只限制运维，不阻塞开发；TUI PTY 测试显式关闭自动安装。
- 唯一迁移 `0013_service_ops`：`service_ops_services` / `service_ops_deployments`，schemaVersion 13；`service-ops` 事件流 `ops:<targetId>`。
- `ServiceOpsRuntime`：计划/授权/产物/锁校验、一次性消费、APPLYING→HEALTH_CHECK→SUCCEEDED/FAILED 状态、真实 PM2 启动/替换、HTTP 健康、失败回滚、服务/目标/计划/部署记录、审计与事件、`reconcile` 实际状态对账。
- REST `/api/service-ops/`：状态、服务列表/详情、部署历史、日志、计划、授权、人工审批、apply；沿用 Cookie/Origin/CSRF；人工策略从 Session `approvalPolicyId` 读取，缺省 standard，禁止客户端自报 autonomous。
- WS `{topic:"service-ops",resourceId:targetId,after}` 订阅、`GET /api/resource-events?streamId=ops:<targetId>` 重放；非法/未知 target 拒绝。
- 退出策略：`startServer` 关闭不停止 PM2 守护或正式服务；适配器 `close` 仅测试/实验清理。
- PM2 环境过滤：守护/应用不继承 `LARNESS_*`/合成秘密；应用 env 仅 `PORT`/`NODE_ENV`；测试检查 dump、pm2.log、服务日志无标记。

## 2. 验收场景映射

| 场景 | 结果 | 证据 |
|---|---|---|
| D2 首次部署有效产物/计划 | **真实 PM2 覆盖**：v1 启动、HTTP 健康、版本/结果记录 | `service-ops-pm2.test.ts` |
| D3 v1→v2 | **真实 PM2 覆盖**：plan previous=v1、替换后 v2 健康、目标指针更新 | 同上 |
| D6 未鉴权/scope/planHash/取消/锁 | **覆盖**：REST 401/CSRF、M4-2 授权/审批、apply 前 verify、service 锁；真实 WS 非法 target 拒绝 | REST/WS/授权测试 |
| D7 健康失败/替换中断 | **真实覆盖**：v3 健康失败后用 v2 回滚，记录 `HEALTH_FAILED_ROLLED_BACK`，目标保持 v2；PM2 不可用返回 FAILED/unknown，不伪报成功 | `service-ops-pm2.test.ts`、无 PM2 测试 |
| D9 人/AI 管理同版本受管服务 | **部分**：human REST 同一 apply/adapter/授权/审计；独立 Agent 工具组与运维上下文归 M4-3b | 本任务 REST |
| D10 DB RUNNING 与实际不符 | **覆盖**：真实 PM2 停止后 `reconcile` 更新为 failed | 同上 |
| D11 退出/重开对账 | **部分**：M4-0 已真实验证管理进程退出后同 PID/健康；M4-3 不关闭守护并新增启动对账；完整重开 HTTP 路径在 M4-4 集成 | [M4-0](poc.md)、reconcile |
| D12 restart 替换产物/临时收养 | **覆盖**：只有 plan apply 可换版本；未提供 restart 路由；正式目标独立 ID，不收养终端/临时服务 | 路由/契约 |
| TUI 全局 PM2 初始化 | **覆盖**：真实临时 prefix 下 `startServer`（TUI 子进程入口）复用已装 PM2，`pm2Global=ready`、`serviceOps.available()=true` | `service-ops-pm2.test.ts` |

## 3. 测试与检查

- 新增：`service-ops.test.ts` 3 项、`service-ops-ws.test.ts` 1 项、`service-ops-migration.test.ts` 1 项（常规 check）+ `service-ops-pm2.test.ts` 1 项（真实 PM2，专用命令）。
- `VITEST_MAX_WORKERS=3 pnpm check` 通过：Biome 518 文件、全 workspace 类型；web 124、agent 33（1 skipped）、server 488（8 skipped），合计 645 passed / 9 skipped。跳过项为既有/新增需真实 PM2/网络的 PoC 专用测试。
- `pnpm build` 通过。
- `pnpm test:pm2:m4` 通过：临时 prefix 首次安装并复用 7.1.2、TUI 入口初始化、v1 启动、v2 替换、v3 健康失败回滚、真实 PM2 停止后对账、日志/事件、合成秘密不进入 dump/pm2.log/服务日志。
- 未跑浏览器 E2E/运维 UI：M4-3 无新 UI；M4-3b 才交付运维页与 Agent 工具。未验证零停机、跨平台、任意 PM2 版本、主机重启/开机自启、正式 `secretRef` 注入。

## 4. 边界与后续

- **D9/D11 未端到端**：Agent 运维上下文/工具、两客户端运维页、完整重开 HTTP 验证归 M4-3b/M4-4；本记录不宣称通过。
- **日常 start/stop/restart 未交付**：M4-3 只有 apply/回滚；同版本动作与授权随 M4-3b，未提供可绕过方案的 restart 路由。
- **Q-029 未关闭**：合成秘密隔离通过，不等于正式 `secretRef` 注入路径全部验证；在 M4-3b 产品秘密注入前仍需专项评审/测试。
- 应用只支持 Node 入口；`start.command` 非 Node 形式返回 `DEPLOY_SPEC_INVALID`。非零停机替换；旧进程删除后新进程启动失败时依赖回滚，不承诺业务无中断。
- 真实 PM2 测试会安装到临时 npm prefix 并清理；未改动全局 PM2、用户默认 PM2 实例或用户数据。测试数据在临时目录。
- 仅 macOS arm64 实测；Linux/Windows、PM2 升级、主机重启和系统启动项未验证。
