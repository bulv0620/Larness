# M3 评审入口

> draft，2026-11-05。ADR-042产品边界与完全自主免人工已获用户确认，M2/G2已通过；G-Spec-M3/PoC/实现未获启动授权。

- [spec](spec.md)：开发服务登记/退出失效/隔离预览，S1–S9/S12–S16；旧S10/S11归M4。
- [plan](plan.md)、[tasks](tasks.md)：7个活动任务，旧M3-5/5b仅保留迁移映射。
- [服务契约](../../docs/contracts/services-preview.md)、[ADR-042](../../docs/adr/ADR-042-service-deploy-boundary.md)：M3无PM2、M4完整持久发布；自主无人工步骤。

## G-Spec-M3仍待确认
- [ ] Q-002独立来源/票据/HTTPS/HTTP+WS、Q-026执行到endpoint归属和失效延迟；
- [ ] 具体参数/schema/配置、单任务范围与PoC证据标准；
- [ ] 身份未知、DB失败、端口复用、旧票据/流撤销、策略和秘密保护负例；
- [ ] 人类批准技术规格及先启动M3-0。产品方向确认不等于本项技术门禁。

Q-003/Q-027不阻塞M3；持久服务和正式部署见[050](../050-deploy/spec.md)。服务使用当前项目卡片/详情，无服务Tab；自主免业务审批不免技术规格评审。
