# STATUS

> 最后更新：2026-11-20 14:24 (+08:00)
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- **087 联网搜索（WS-5 review）**：2026-11-20；分支 `task/087-web-search`；WS-0～WS-4 完成，自动化检查、构建与 Mock E2E 通过；真实 DeepSeek/GLM Key 手工验证与界面验收待完成，见 [acceptance](specs/087-web-search/acceptance.md)。

## 阻塞与待确认

- **实机验收证据边界（082/083）**：082 已按限定范围验收通过，但真实 Provider A/B、Windows 实机与 083 用户现有 PM2/旧命令数据未在本次环境复跑；不得据此声称这些场景已验证。
- **M5-F2 Ubuntu 实机验证**：Ubuntu 22.04 / 24.04 尚未实机验证；完成后由 M5-F3 更新支持矩阵，未验证前不标支持。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-20 | 086 项目记忆与统一管理弹窗 | 人类审核通过；PM-0～PM-8 完成；指令文件、自动学习、全局偏好、硬预算淘汰、REST/WS、记忆面板；check/build + Mock E2E 24/24；未验证边界见 acceptance | [086 acceptance](specs/086-project-memory/acceptance.md) |
| 2026-11-19 | 085 长任务连续执行 | 人类验收通过；任务级 token/时长/接续深度默认关闭；85% 换页、`continued` 终态、无事实 fallback、600s 请求上限、10 分钟无进展暂停；build + Mock E2E 24/24 | [085 acceptance](specs/085-long-task-continuity/acceptance.md) |
| 2026-11-19 | 084 Agent Profile 收敛与用量 | 人类验收通过；AP-1～AP-13 完成；Profile 收敛 coding/plan、usage API 与缓存命中率、Token 行常驻、过程标题行视觉；check/build + Mock 24/24 + 认证 20/20 + 生产 20/20 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#验收记录2026-11-18macos) |
| 2026-11-19 | AP-13 过程标题行只显示步数 | 外层移除失败/重试计数，只保留步数、耗时与自动继续；失败详情仍在展开过程内；定向 33 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-13-过程标题行只显示步数用户反馈) |
| 2026-11-19 | AP-12 Token 行会话页常驻 | 真实会话加载中也保留 Token 行并显示占位；新建会话页与 Mock 隐藏；定向 24 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-12-token-行在会话页常驻用户反馈) |
| 2026-11-19 | AP-11 会话缓存命中率 | usage API 增加按 `model.usage` 聚合的 `cache`（命中率、命中/未命中、已知/未知请求）；未知请求不进分母；Token 行显示命中率；定向测试通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-11-会话缓存命中率用户反馈) |
| 2026-11-19 | AP-10 过程动画降速 | 星星与文字扫描统一放慢到 1.6 秒一轮，保持同相位与单次扫过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-10-过程动画降速用户反馈) |
| 2026-11-19 | AP-9 动画同步 1 秒一轮 | 两颗星与文字扫描统一 1 秒、同相位；扫描位移修正为每秒恰好一次；视觉待确认 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-9-动画同步为-1-秒一轮用户反馈) |
| 2026-11-19 | AP-8 星光图标与慢速文字扫描 | 一大一小四角星依次闪烁；状态文字灰底、主题前景色约 4.2s 缓慢扫过；完成态无图标与扫描；定向 33 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-8-星光图标与灰底黑扫文字用户反馈) |

> 更早的收口记录（含同日其余 K-5、K-4、MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

## 交付基线

- 最新发布 `0.3.0`（2026-11-16，npm `latest`）；tag `v0.3.0` 已在 `origin/main` 上（2026-11-16 推送）。
- 迁移至 `0036`（schemaVersion 36）。

## 维护记录（已收口）

- **依赖维护**：DEPS-1～DEPS-7 于 2026-11-09 完成（工具链升级、16 个直接依赖、pnpm 固定 10.34.9、Node 22 / 24 双线验证）。明细见归档。
- **文档整理**：DOCS-1～DOCS-4 于 2026-11-08～09 完成（规格导航、Node 支持口径、文档对齐、npm 更新安全）。明细见归档。

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `done` | G2 于 2026-11-05 通过人类统一验收（macOS 范围） |
| M3 | 开发服务与隔离预览 | `done` | G3 人类验收通过（2026-11-05）；M3-0～M3-6 完成 |
| M4 | 持久运行与版本发布 | `done` | 2026-11-07 用户验收 G4 与 M4-R0～R4，见 [M4 收尾](specs/050-deploy/closure.md) |
| M5 | 多模型、自动化与更新 | `done` | M5-1a–e / M5-2 / M5-3 / M5-4 / M5-5 `done`；G5 条件通过（2026-11-08） |
| M6 | 运行时效率与 Turn 恢复 | `done` | 070（HX）与 071（TR）于 2026-11-12 收口；HX-12b 于 2026-11-18 按用户决定废弃 |
| 切片 | 068 / 072 / 073 / 074 / 076 / 077 / 078 / 081 / 082 / 083 / 084 | `done` | UI 修复、错误预算、上下文预算、成果呈现、文件浏览、模型连接、Git 工作流、Agent 内核重构、项目服务与 service-ops、Agent Profile 收敛与用量 |
