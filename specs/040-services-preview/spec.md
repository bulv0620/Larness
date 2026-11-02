---
id: 040-services-preview
title: M3 临时服务登记、持久服务与 Preview
milestone: M3
status: draft
depends_on: [030-dev-resources]
owners: [human]
created: 2026-10-31
updated: 2026-11-02
---

# M3 临时服务登记、持久服务与 Preview

> 产品分工按 [ADR-030](../../docs/adr/ADR-030-resource-lifecycle-and-services.md) 已确认；技术规格保持 draft，不能开始实现。配套 [plan](plan.md)、[tasks](tasks.md)、[review](review.md)、[服务契约](../../docs/contracts/services-preview.md)。G2、Q-002 / Q-003 / Q-026 / Q-027 与 G-Spec-M3 是实施门禁，不因“补文档”自动通过。

## 1. 目标与非目标

- 临时服务：登记 Terminal 中已运行的程序，展示项目 / 来源 / 状态 / 日志 / 地址，为浏览器预览登记转发目标；不 spawn、不交 PM2、不独立启停 / 保活，随源进程退出退登。
- 持久服务：构建后交 PM2 正式运行，AI 与人走同一服务能力进行启停、重启、读日志及实际状态对账；首次生产部署和产物替换仍经 M4 计划审批。
- 服务窗口：左上项目筛选，主体卡片列表，点击看详情；无服务 Tab。关闭窗口 / 详情不停止服务。
- Browser：已登记且验证的 loopback 目标，经独立来源、短期票据进行 HTTP / WS 预览与 HMR；AI 可以给出点击打开预览的结果卡片。
- 主机 CPU / 内存采样与服务状态分开，不把模拟指标作为交付。

非目标：独立 NativeProcessAdapter 管理临时进程；临时服务自动转 PM2；通用端口扫描 / 任意 URL 代理；远程主机 / Docker；生产部署闭环（M4）；第三方网页浏览；宣称 PM2 自带 OS 隔离或无条件跨主机重启恢复。

## 2. 用户流程

AI 在项目 frontend / backend 两个终端启动 dev → 提交监听候选 → 后端核验归属和实际监听 → 登记临时服务 / 列表卡片 → 预览 ready 后给出卡片 → 用户点击打开 Browser → 代理到 Larness 主机 loopback。

终端中只停止 frontend 的源进程 → frontend 退登、票据 / 代理连接失效，backend 仍运行。关闭终端 Tab 终止该 PTY 及受管进程树、撤销其所有临时服务。关闭 / 最小化终端窗口或服务窗口无启停副作用。Shell 活着而 dev 命令已退出时，不能保留 RUNNING 服务。

构建并经 M4 批准 → PM2 启动产物 → 持久服务卡片显示实际状态 / 正式访问地址；人和 AI 后续通过同一后端能力操作。停止保留配置 / 部署历史，不等同删除；卡片关闭详情没有停止含义。正式公网地址与管理端隔离预览地址分别配置，不自动开放端口。

## 3. 验收场景

| ID | Given | When | Then |
|---|---|---|---|
| S1 | 同项目两个真实 dev 终端已监听 | 登记 frontend / backend | 两张 temporary 卡片绑定原进程，无第二次 spawn、无 PM2 应用 |
| S2 | 服务窗口有多项目临时 / 持久服务 | 筛选项目、点详情、关闭详情 / 窗口 | 卡片 / 详情切换，无服务 Tab，不停止资源，顶部恢复本地状态 |
| S3 | 前端登记成功且目标 ready | 点击 AI 预览卡片或输入登记地址 | 独立来源打开页面，HTTP / WS / HMR 可用，业务端口无需公网暴露 |
| S4 | frontend 进程运行在交互 Shell 中 | Ctrl+C 使该命令退出，Shell 保留 | 自动退登 frontend、立即拒绝旧预览；backend 不受影响 |
| S5 | 一个 PTY 有多个登记 endpoint | 主动关闭其终端 Tab | terminate 确认后全部退登；失败保留终端 Tab / 错误，不假报关闭成功 |
| S6 | 源进程已退出 / 端口被别的程序复用 | 用旧 serviceId / 票据访问 | 失败关闭，不串绑新进程、不自动复活旧注册 |
| S7 | 未登记 / 禁止目标或不可信日志 URL | 登记 / 解析 / 重定向 / WS | SSRF、管理端口、IPC、元数据和任意外部目标均拒绝并审计 |
| S8 | 预览中运行不可信项目代码 | 访问管理 API / Cookie | 无管理 Cookie、无管理 API CORS 权限；独立来源不可用时禁用公网内嵌预览 |
| S9 | 临时服务状态未知或 DB / 监听核验失败 | 登记或发生源退出 | 不显示 ready、不开放预览；已有预览先拒绝，恢复后对账持久状态 |
| S10 | PM2 已有经授权的正式产物配置 | 人工或 AI 请求启停 / 重启 | 同后端策略 / 锁 / 审批 / 审计，真实执行、日志可读；不通过任意 PM2 CLI 绕过 |
| S11 | 持久服务 DB 写 RUNNING，实际进程不在 / 不健康 | 重启对账 / 健康检查 | 显示 stopped / failed / unknown / unhealthy，不伪造运行；配置与部署记录保留 |
| S12 | 管理端重启 / 客户端断线 | 恢复资源与卡片 | 临时服务先失效且不恢复 PTY，持久按 PM2 实际对账；客户端布局不启动资源 |
| S13 | 登出、撤销、坏 Origin / CSRF、资源归属伪造 | 服务 / 预览 API / WS / 动作 | 后端拒绝，输入来源 / 项目筛选不授权；票据不进日志、事件、卡片 |
| S14 | 前端需要访问后端 API | 通过预览访问前端 | 项目开发代理 / 相对路径配置有真实验证，不假定登记端口自动解决 API / CORS |
| S15 | 预览目标停止，或日志 / 事件游标过期 | 查看旧卡片 / 重连 | 明确不可用 / 需重同步，不重启服务、不伪造完整历史 |

## 4. 契约、数据与配置

REST / 工具 / DTO / 事件 / 表结构见 [services-preview](../../docs/contracts/services-preview.md)。复用 M2 resource_events / resource_operations 底座；M3-1 新增临时绑定和状态，M3-5 增持久字段 / 约束，每任务最多一份迁移。服务窗口状态是客户端 filter / selectedServiceId，不创建服务 Tab 表。

预览源、域名 / 票据、PM2_HOME / 实例命名空间配置须 PoC 后写入共享 schema 与配置契约；不在本文猜测已冻结键名。现有管理端 canonical origin / Cookie / IPC / 统一入口不变。持久进程配置仅用 secretRef，受控执行层注入，日志 / 响应 / 模型不含明文。

## 5. 安全、失败与恢复

终端身份、该次执行与 endpoint 实测绑定；cwd、日志 URL、PID 单字段不构成授权。无法核验时不登记可预览目标。每次转发重新核对活跃登记 / generation，退登关闭已有流和新请求。后端授权、事件先落库、幂等动作、参数审批及固定锁顺序仍适用。

临时退登不杀其他终端、无关主机进程或删除源码；进程结束与服务退登可能跨组件，路由先失败关闭，持久状态失败则对账恢复，不广播虚假提交。持久动作结果不确定时先查询 PM2，禁止盲目重复启动。TUI 对 PM2 的退出策略 Q-027 未决，不能默认沿用临时进程清理或默认常驻。

## 6. 测试与完成定义

真实 PTY / endpoint / 本地 HTTP+WS 服务、隔离预览域 / HTTPS、PM2 实机进程构成集成与浏览器证据；FakeProvider 仅替代 LLM。负例覆盖源退出、端口复用、SSRF / 重定向、错误 Origin / CSRF、票据重放 / 过期、DB 故障、慢日志、重启对账。UI 验证卡片列表 / 详情无服务 Tab、关闭窗口无停止副作用；两客户端状态一致、布局独立。

- [ ] Q-002 / Q-003 / Q-026 / Q-027 明确，技术 PoC 与 G-Spec-M3 人类确认；
- [ ] S1–S15 提供真实自动化证据，UI / 安全人工验收；
- [ ] 每任务 check / build，整体 Demo / auth / prod / 初始化 / 统一入口 / TUI 回归；
- [ ] G3 通过、平台边界 / 契约 / STATUS 更新；M4 仍单独验收。
