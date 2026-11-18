# 083 任务

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| S-1 | 合同、ADR、Profile 与迁移 | — | `done` |
| S-2 | 后台进程模型与 coding 工具面 | S-1 | `done` |
| S-3 | 项目服务窗口与侧栏计数 | S-2 | `todo` |
| S-4 | 按需预览 | S-2 | `todo` |
| S-5 | 服务运维 Profile 与 PM2 投影 | S-1、S-4 | `todo` |
| S-6 | 旧命令锁恢复 | S-2 | `todo` |
| S-7 | 全量验证与收口 | S-1～S-6 | `todo` |


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
