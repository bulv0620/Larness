# 083 实施计划

1. **S-1 合同与迁移**：ADR-069、spec ready、Profile `service-ops`、迁移 0033、文档入口。
2. **S-2 进程模型**：`ProcessManager` 增加 port/health/previewEligible；新增 `list_processes`；process pack 进入 coding；删除 NamedServiceManager 与 service 工具包。
3. **S-3 项目服务 UI**：项目侧栏计数、服务窗口改为进程列表、日志/停止/预览；删除登记入口。
4. **S-4 按需预览**：PreviewRegistry 支持 processId；校验项目/存活/端口；API 与 UI。
5. **S-5 服务运维**：PM2 投影接受 default namespace；service-ops Profile 与工具；弹窗显示偏差。
6. **S-6 命令锁恢复**：检测已死亡 command 操作，释放项目锁；补测试。
7. **S-7 全量验证**：check/build/E2E/生产 E2E、文档、STATUS、ROADMAP、验收记录。
