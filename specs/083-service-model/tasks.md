# 083 任务

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| S-1 | 合同、ADR、Profile 与迁移 | — | `done` |
| S-2 | 后台进程模型与 coding 工具面 | S-1 | `done` |
| S-3 | 项目服务窗口与侧栏计数 | S-2 | `done` |
| S-4 | 按需预览 | S-2 | `done` |
| S-5 | 服务运维 Profile 与 PM2 投影 | S-1、S-4 | `done` |
| S-6 | 旧命令锁恢复 | S-2 | `done` |
| S-7 | 全量验证与收口 | S-1～S-6 | `done` |


## 验收记录

### S-1（2026-11-18，macOS）

- ADR-069 accepted；083 spec/plan/tasks ready。
- `AgentProfileId` / sessions schema / Session API / web Composer 改为 `coding | plan | service-ops`；旧 `workspace` 会话通过 `0033_agent_profile_service_ops.sql` 迁移。
- 迁移计数测试更新为 33；旧命令恢复仍由 S-6 处理。
- 验证：定向 Session / Profile / 迁移测试通过；Web SessionModel 12 项通过。


### S-2（2026-11-18，macOS）

- `ProcessDto` 增加 `port` / `healthPath` / `previewEligible`；`start_process` 接受 port/healthPath；新增 `list_processes`。
- `coding` Profile 增加 process pack：`start_process`、`list_processes`、`read_process_output`、`stop_process`；不再需要 workspace。
- 删除 `NamedServiceManager`、`/api/process-services`、`start_service/read_service_logs/stop_service`、`register_temporary_service`、`resolve_service_preview`、`list_services` 与相关 Agent 绑定。
- `service-ops` 暂时只保留只读 observation；S-5 接入 PM2 工具。
- 测试：进程 port/预览资格/停止后失效、profile 工具面、toolContract、contextAssembler、turnRunner 定向通过。


### S-3（2026-11-18，macOS）

- 项目侧栏新增运行中后台服务图标与数量；项目服务窗口改为 `/api/processes?projectId=`，显示状态、端口、PID、cwd、日志与停止；删除“登记服务”入口与旧 ServicesPanel。
- 服务窗口轮询 2 秒，停止后刷新列表与详情；Mock 模式保留演示列表。
- 测试：Web typecheck、SessionModel/浏览器预览组件回归通过。

### S-4（2026-11-18，macOS）

- `PreviewRegistry` 支持 `processId` 目标；解析时校验进程属于请求项目、RUNNING、声明 port 且端口可连接；ticket/grant 记录目标类型，REST 预览 body 接受 `processId` + `projectId`。
- 进程详情新增“预览”按钮，打开 browser tab 并在点击时才解析预览；`BrowserView` 传递 targetKind。
- 测试：`previews-api.test.ts` 覆盖运行中进程预览成功、停止后 503；预览回归通过。

### S-5（2026-11-18，macOS）

- `ServiceOpsServiceDto` 增加 `namespace` / `namespaceMismatch`；reconcile 接受 `namespace=default` 但名称符合 `larness:<projectId>:<key>` 的应用，并更新投影 namespace；控制、日志、身份检查统一使用受管名称/namespace 判定。
- `service-ops` Profile 新增 `list_service_ops` / `read_service_ops_logs` / `control_service_ops`；TurnRunner 注入 ServiceOpsRuntime，控制操作复用 project/service leases 与 targetId/pm2Name 校验。
- 服务运维弹窗显示 namespace 偏差。
- 测试：`service-ops.test.ts` 覆盖 default namespace 的 Larness 名称仍关联项目；service-ops agent 上下文测试通过。

### S-6（2026-11-18，macOS）

- `CommandManager.reconcileDeadStoppedCommands()`：对 `RECONCILIATION_REQUIRED` 且 `STOP_UNCONFIRMED` 的命令，确认父进程/进程组已退出后标记 FAILED 并释放项目锁；在 `recover()`、每次命令执行和 Turn 获取项目锁前调用。
- 保留进程仍存活或存在逃逸子进程时的屏障，避免误放行。
- 测试：`commands.test.ts` 覆盖死亡进程释放根锁、事件存储失败与逃逸 pipe 仍保持屏障。

### S-7（2026-11-18，macOS）

- 全量门禁：`pnpm check` 通过（biome 683 文件；web 256、agent 63+1 跳过、server 729+14 跳过）；`pnpm build` 通过。
- E2E：`pnpm test:e2e` 24/24；`pnpm test:e2e:prod` 20/20。
- 文档：ADR-069、REST / Agent / 资源 / 数据模型 / 安全契约、051 持续约束、ROADMAP、STATUS、Q-051 已同步。
- 收尾修正：移除 `POST /api/services` 写入口（旧记录只读/停止/删除）；进程预览必须同时提交 `processId` + `projectId` 并校验归属；system prompt 拆分为 coding 的项目后台任务契约与 service-ops 的 PM2 契约，`PROMPT_VERSION` → `m6-7`；ServiceWindow 新增真实进程列表/预览/停止测试并修复日志重复追加；`list_processes` 与项目服务列表只返回 STARTING/RUNNING/STOPPING，结束/失败任务不再保留列表项。修复 TurnRunner 未注入 ServiceOpsRuntime 导致 service-ops 工具全部 FORBIDDEN 的装配缺陷，并补回归测试；明确 service-ops 只运维已有服务，部署从 Coding 项目会话发起。
- 验收：2026-11-18 人类验收通过，083 收工。
- 未在本次环境复跑：用户现有 `todo-list` PM2 应用（namespace=default）与旧 `STOP_UNCONFIRMED` 数据；不得因自动门禁或人类验收而声称这些实机数据已验证。

### 2026-11-25 关闭清理补齐（用户直接要求）

- `startServer` 的 shutdown 现在调用 `ProcessManager.close()`；关闭 TUI 时 `start_process` 启动的后台进程会被停止，不再遗留孤儿进程或端口占用。
- `AgentJobExecutor` 超时/取消会直接 abort 对应 runner controller，不再只改 DB 状态；spawn 5 秒超时会标记 `SPAWN_TIMEOUT` 并终止 child。
- 测试：`process-close` / `processes` 关闭路径、`agentRunner` 取消回调；server 全量通过。
