# M3 评审入口

> 2026-11-02，draft。产品规则 ADR-030 已按人类明确指令接受；M3 未通过 G-Spec / G3，未开始运行代码或 PoC。

- [spec](spec.md)：临时 / 持久服务与 S1–S15。
- [plan](plan.md)：Terminal 唯一控制临时进程，Registry / Proxy 与 PM2 分工。
- [tasks](tasks.md)：9 个顺序实施任务，保留原 M3 ID，全部 todo。
- [服务契约](../../docs/contracts/services-preview.md)：REST / 工具 / 数据 / 预览 / 文件与预览结果卡片草案。
- [ADR-030](../../docs/adr/ADR-030-resource-lifecycle-and-services.md) / [视图契约](../../docs/contracts/resource-views.md)：已确认的窗口 / Tab 与卡片规则，不重复征求产品方向确认。

## G-Spec-M3 待完成

- [ ] Q-002 独立来源 / 票据和 HTTP+WS 安全技术方案；
- [ ] Q-003 PM2 交付 / 命名空间；Q-026 终端执行到端口归属核验及失效时限；
- [ ] Q-027 TUI 退出 / 更新时 PM2 正式服务策略（ADR-023 与正式服务目标的边界）；
- [ ] 细化配置 schema / 参数限制 / 单任务估算，确认 PoC 范围及测试命令；
- [ ] G2 完成后人类批准技术规格与实施，先 M3-0。

临时服务不独立 spawn / 启停；持久的首次生产部署和产物替换不绕过 M4 审批。验收以真实 PTY / 已登记 endpoint / HTTP+WS / PM2 证据为准，S0 Mock 不能证明功能完成。当前仅文档校验，功能验收项均未执行。

## R0-0 文档验证

28 份 Markdown / 136 个本地链接、表格列数、M2 15 / M3 9 项任务编号 / todo 状态 / 依赖顺序、A1–A31 / S1–S15 与 diff 空白检查通过。`pnpm check` 通过（server 297 / agent 32 / web 26，原 live 测试 1 项按环境跳过）。仅文档，无新功能 PoC / build / E2E 结论，无运行代码 / 依赖 / 数据变更。
