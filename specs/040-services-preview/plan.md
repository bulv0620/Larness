# 实施计划：M3 两类服务与预览

> draft，2026-11-02。产品规则按 ADR-030，实施仍需 G2 / G-Spec-M3 及 Q-002 / 003 / 026 / 027。一次一个任务，先失败测试、实现、check / build、相关验收、状态更新和单任务提交。

## 1. 职责与复用

TerminalManager 是临时进程的唯一生命周期控制者；ServiceRegistry 订阅精确的 terminal execution / exit，登记已经存在的 endpoint，不再设计 NativeProcessAdapter 去 spawn / stop 临时服务。临时服务日志引用 Terminal 输出，避免日志与进程双重管理。PM2Adapter 仅用于持久服务；ServiceManager 对上统一查询 / 详情，但按 kind 拒绝不适用操作。

复用 M2 scopes、resource_events / operations、事件序号 / 重放、Query 与窗口框架。服务窗口用 filter / selectedServiceId，主体卡片 / 详情，不能复用服务资源 Tab。Browser 仍使用 serviceId + normalized URL 去重的页面 Tab。Agent 与人工共享授权 / 审批 / 锁 / 审计，只有真实来源上下文不同。

## 2. 方案与验证顺序

1. M3-0 先验证 loopback endpoint 与 PTY 该次执行 / 后代进程归属，退出 / 端口复用失效；独立预览来源、Cookie / CSP / HTTPS / WS；PM2 生命周期与 TUI 退出策略由 Q-027 确认。不能核验的 endpoint 不开放预览。
2. M3-1 建临时登记 / 状态、终端退出联动 / 对账和服务查询；业务事务 + seq，路由失效先失败关闭。注册不调用 spawn。状态未知不得 ready。
3. M3-2 实现服务卡片 / 详情与临时日志 / 打开终端入口，不提供临时进程独立启停。关闭详情返回列表，窗口关闭仅隐藏。
4. M3-3 固定 ServiceRegistry 上游、HTTP / WS 代理、票据与来源校验；M3-3b 单独完成 SSRF / 生命周期 / Cookie / 缺口回放安全矩阵。
5. M3-4 接 Browser 与 Agent 预览结果卡片，真实 Vite HMR、前端到后端 API 开发代理验证。卡片点击重新解析，停止后旧卡失效而非重新启动。
6. M3-5 验证 PM2 交付 / 实例命名空间与持久服务配置、动作 / 日志 / 对账；M3-5b 接 AI 与人工统一动作 / 卡片界面，首次部署 / 产物替换不得绕过 M4。
7. M3-6 做真实资源全流程、故障 / 两客户端 / dev+built / 现有回归与 G3 人类验收，记录平台与残留清理。

## 3. 迁移、边界与回滚

M3-1 负责服务基础表 / 临时绑定，M3-5 负责 PM2 持久字段与约束；每任务最多一迁移，不改已应用迁移。配置键在各 PoC 后确定并同步 shared schema / 配置契约，不静默写用户网络配置。旧 Service Tabs 只迁移视图为 selectedServiceId，不触发启停。

临时退登与源进程退出不是同一 DB 事务，路由在源未知 / 退出时先拒绝，然后对账持久结果；日志 / URL / PID 只是核验材料，不能自动授权。临时记录终态可以保留审计，不留活跃转发资格。PM2 动作失败先重查真实状态，未知不反复 spawn；PM2_HOME / 命名空间只操作本实例受管应用。

回滚先停止新代理并明确现有资源影响；临时资源通过终端停止，持久通过已批准的 PM2 策略处理，不清理别的 PM2 应用。不删除用户源码、数据库 / 配置来回退。PM2 跨主机 / TUI 退出行为只按 Q-027 与实测公开，不能从“持久”自动推导。

## 4. 验证

每任务 check / build，相关集成用真实临时 PTY / loopback server / HTTP+WS / 临时证书或域名；PM2 用隔离实例配置。最终跑现有 Demo / auth / prod、初始化 / 统一入口 smoke、TUI PTY（auth / prod 串行），新增 M3 真实资源 E2E。测试数据、日志、证书 / 密钥、PM2_HOME 在源码目录外，结束检查残留进程 / 端口和清理结果。FakeProvider 只替代模型，不替代 Terminal / Registry / Proxy / PM2。

## 5. 风险与技术门禁

Q-026 未验证归属则不开放候选端口；Q-002 未有独立来源则禁用公网内嵌预览；Q-003 未确认交付不能假定 PM2 已安装；Q-027 未明确不能发布持久服务的退出承诺。产品规则已经 ADR-030 接受，不重复要求批准服务无 Tab 或临时归终端。各实现卡估 1–2 工作日，超范围先拆卡，不把 M3 草案当作 ready。
