# M4 收尾与 G4 验收

2026-11-07，用户确认 M4 与后续修改全部验收通过，并授权合并到 `main`、推送 GitHub。G4、M4-4 与 M4-R0～R4 均关闭。

| 交付 | 验收记录 |
|---|---|
| M4-R0 普通项目会话通过 PM2 命令部署与管理，系统提供实例环境与项目关联 | [命令部署](acceptance-cli.md) |
| M4-R1 服务运维卡片、详情、日志与人工启停 | [运维界面](acceptance-ui-control.md) |
| M4-R2 人工请求、所属项目登记日志与本机实例查询 | [验收纠错](acceptance-service-fixes.md) |
| M4-R3 系统区分终端预览与 PM2 持久服务 | [生命周期契约](acceptance-lifecycle-contract.md) |
| M4-R4 已删除服务退出当前列表，停止保留，同名恢复原关联 | [删除对账](acceptance-deleted-service-list.md) |

当前方案按 ADR-050～052 运行。M4-0～M4-3b 及原 [M4-4 集成记录](acceptance-m4-4.md) 保存早期实现和兼容接口的证据。正式服务由实例 PM2 托管，退出 Larness 管理面后继续运行。

本次合并前在 macOS 上验证了以下项目。

- `VITEST_MAX_WORKERS=3 pnpm check` 通过，653 项通过，11 项按配置跳过。
- `pnpm build` 通过。
- 4 项定向 PM2 和日志测试通过，涵盖命令部署与项目关联、人工启停、删除与重建、兼容发布与回滚、日志边界。真实 PM2 测试使用临时实例。
- Chromium 定向认证 E2E `e2e-auth/service-ops.spec.ts` 通过，覆盖配对后的运维入口、空态及关闭。全套浏览器矩阵与真实模型未在本次合并前重跑。

用户的整体验收与上述自动化范围分别记录。Q-029 正式秘密注入、远程 HTTPS、主机重启与其他平台仍按各自验证记录处理。
