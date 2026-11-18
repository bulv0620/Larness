# ADR-069 项目开发服务与全局 PM2 运维分离

- 状态：**accepted（2026-11-18）**
- 批准记录：2026-11-18 人类明确要求：coding 直接用 shell/后台任务启动项目开发服务；项目服务显示这些后台任务；预览手动点击才注册；终端纯人类；workspace 改为服务运维，管理 Larness 隔离 PM2。
- 关联：[083 spec](../../specs/083-service-model/spec.md)、[ADR-068](ADR-068-agent-kernel.md)、[ADR-050](ADR-050-pm2-cli-deployment.md)、[ADR-030](ADR-030-resource-lifecycle-and-services.md)。

## 决策

1. **项目开发服务属于 coding**：`start_process` / `read_process_output` / `stop_process` / `list_processes` 进入 `coding`，不再要求 `workspace`。Agent 不使用裸 `shell &` 管理长任务。
2. **项目服务以真实后台进程为源**：项目侧栏和服务窗口读取 `ProcessManager`，显示数量、状态、端口、PID、日志和停止；不再要求终端登记服务。
3. **删除手动登记**：`register_temporary_service`、`resolve_service_preview`、`NamedServiceManager` 与手动“登记服务”退出产品面；旧 `services` 记录只读。
4. **预览按需**：用户点击运行中任务的预览时才校验项目/进程/端口并签发预览票据；无端口或端口不监听失败关闭。
5. **workspace 改为 service-ops**：`sessions.agent_profile` 的 `workspace` 迁移为 `service-ops`；该 Profile 只管理 Larness 隔离 PM2 的全局服务（列表、日志、启动/停止/重启），不参与项目文件操作。
6. **PM2 投影按名称关联**：Larness 使用独立 `PM2_HOME`；应用名称 `larness:<projectId>:<serviceKey>` 即项目关联，即使 namespace 为 `default` 也显示并标注偏差；无法解析才进入未关联列表。
7. **旧命令恢复**：已确认死亡的 `command.run` 不再永久占用项目锁；无法确认时保留屏障并提示人工处理。

## 后果

- 082 的 `workspace` 开发服务语义被替代；终端与 Git 的人类专属边界不变。
- 项目服务与全局 PM2 运维成为两个独立入口。
- 旧 `services`/`terminal_leases` 数据保留可读，不自动删除。
