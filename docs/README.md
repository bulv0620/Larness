# 文档索引

`docs/` 存放跨里程碑的稳定知识。具体功能需求与任务从 [规格与工程入口](../specs/README.md) 查找，最高约束见 [工程宪法](../CONSTITUTION.md)。

| 目录 / 文件 | 内容 | 何时阅读 |
|---|---|---|
| [architecture/overview.md](architecture/overview.md) | 系统拓扑、进程边界、模块职责、关键数据流 | 每次开始新里程碑 |
| [architecture/stack.md](architecture/stack.md) | 冻结技术栈、workspace 结构、依赖升级规则 | 选型、加依赖、搭脚手架 |
| [architecture/security.md](architecture/security.md) | 信任模型、审批分级、认证、秘密、预览隔离、失败关闭矩阵 | 涉及认证 / 工具 / 代理 / 审批 |
| [contracts/rest-api.md](contracts/rest-api.md) | REST 约定、错误码、M0 / M1 接口契约 | 写 API 或前端请求 |
| [contracts/ws-events.md](contracts/ws-events.md) | 事件包络、序号、重放、主题与事件类型 | 写实时链路 |
| [contracts/ipc.md](contracts/ipc.md) | 本机 TUI ↔ Server 的 NDJSON 协议、方法与事件 | 写 TUI / IPC |
| [contracts/services-preview.md](contracts/services-preview.md) | 临时 / 持久服务、Terminal 绑定、预览、结果卡片与接口草案 | 写服务 / 预览 / AI 结果入口 |
| [contracts/resource-views.md](contracts/resource-views.md) | 全局资源、窗口、Tab 归属、项目筛选与去重 | 写窗口 / Tab / 终端 / 服务 |
| [contracts/data-model.md](contracts/data-model.md) | SQLite 表、索引、迁移、保留与备份 | 写 migration / repository |
| [adr/DECISIONS.md](adr/DECISIONS.md) | 已冻结 ADR 与新增 ADR 流程 | 需要偏离现有决策 |
| [process/workflow.md](process/workflow.md) | spec 生命周期、任务状态、评审门、提交规范 | 开始与结束每个任务 |
| [process/testing.md](process/testing.md) | 测试分层、必备用例、平台验证 | 设计测试计划 |
| [open-questions.md](open-questions.md) | 待决事项、实现缺口和待验证项 | 遇到 spec 未覆盖的决策 |
| [glossary.md](glossary.md) | 中英术语与易混概念 | 任何时候 |

## 文档维护规则

- 契约变更与代码变更必须在同一任务内完成；不允许“代码先行，文档后补”。
- 新增跨里程碑知识放 `docs/`；单个功能的需求与任务放 `specs/`。
- `larness.md` 的架构内容冻结；产品名已按 ADR-022 统一为 Larness，其他差异通过 ADR 与 spec 表达。
