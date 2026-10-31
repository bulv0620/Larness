---
id: 040-services-preview
title: M3 本机服务与 Preview
milestone: M3
status: draft
depends_on: [030-dev-resources]
owners: [human]
created: 2026-10-31
updated: 2026-10-31
---

# M3 本机服务与 Preview（草案）

> **状态：draft。** 开始 M3 前必须完成 Q-002（预览来源）与 Q-003（PM2 交付）决策，并补全验收场景。  
> 源设计：`larness.md` 第 4.5、4.8、18–19、38–39 章。

## 1. 目标

- ServiceManager：开发服务（Native）与长期服务（PM2）的统一登记、状态、日志、健康检查、对账。
- 服务 UI：右栏服务列表、服务窗口、启停 / 重启、日志、指标。
- Preview：只代理已登记 loopback 服务；地址栏输入 `localhost:5173`；HTTP + WS + Vite HMR。
- 预览隔离：独立来源、短期票据、Cookie 隔离、CSP / frame-ancestors；无独立来源时安全降级。
- 主机指标采样（CPU / 内存）接入顶部栏。

## 2. 非目标

- 生产部署审批流水线（M4）；自动更新（M5）。
- 任意第三方网页浏览、Electron 原生窗口、WebRTC / VNC。
- 通用内网代理 / 端口转发。
- Docker / 远程主机。

## 3. 任务范围（待细化）

| ID | 任务 | 关键交付 |
|---|---|---|
| M3-1 | ServiceManager + Native | 服务表、状态机、启动 / 停止 / 重启、日志、健康检查、端口检测 |
| M3-2 | 服务 UI | 右栏、窗口、多 Tab、日志、启停、错误态 |
| M3-3 | PreviewRegistry + Proxy | 登记、票据、HTTP / WS 转发、超时 / 大小限制、SSRF 防护 |
| M3-4 | 预览隔离与浏览器窗口 | 独立来源 PoC、Cookie 作用域、CSP、地址栏、HMR、降级 |
| M3-5 | PM2Adapter | PM2_HOME、Daemon 隔离、日志、状态、对账、打包 PoC |
| M3-6 | M3 验收 | G3 门禁、E2E、安全用例 |

## 4. 预验收场景（需补全）

- Agent 启动 Vite：服务列表自动出现，端口 5173，日志可读；停止后状态正确。
- 远程浏览器输入 `localhost:5173`：经独立来源看到页面，HMR 生效，5173 不公网暴露。
- 未登记端口 / 管理端口 / 外部 IP / 元数据端点：代理拒绝并审计。
- 预览页面无法读取管理端 Cookie / 调用管理 API。
- PM2 服务重启后状态对账；数据库显示“运行中”但进程不存在 → 标为异常并提供恢复。
- 服务端口冲突、启动失败、健康检查超时：状态与日志可诊断。

## 5. 待决策 / PoC

- Q-002：独立预览域方案；`*.preview.localhost` 在目标浏览器的解析与 Cookie 行为。
- Q-003：PM2 随包 vs 可选；Daemon 与日志目录隔离。
- 代理实现：undici vs 原生 http / ws；WebSocket Upgrade 与 HMR。
- 预览票据格式与有效期；是否与设备 / 会话绑定。
- 主机指标采样：`os.cpus()` / `os.totalmem()`，是否需要采样进程与历史。

## 6. 进入 M3 前必须完成

- [ ] Q-002 / Q-003 决策与 ADR；
- [ ] 预览来源 PoC 通过（HTTPS / WSS、Cookie、CSP、HMR）；
- [ ] 完成代理 SSRF 威胁模型与拒绝矩阵；
- [ ] 补全 REST / WS 契约与验收场景；
- [ ] 人类确认 PM2 打包与平台范围。
