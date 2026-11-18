# STATUS

> 最后更新：2026-11-18 22:30 (+08:00)
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- 无。

## 阻塞与待确认

- **084 UI 视觉验收**：AP-1～AP-6 完成且自动化门禁通过；过程标题行、波形、用量行与 Plan 文案待用户视觉确认。
- **实机验收证据边界（082/083）**：082 已按限定范围验收通过，但真实 Provider A/B、Windows 实机与 083 用户现有 PM2/旧命令数据未在本次环境复跑；不得据此声称这些场景已验证。
- **M5-F2 Ubuntu 实机验证**：Ubuntu 22.04 / 24.04 尚未实机验证；完成后由 M5-F3 更新支持矩阵，未验证前不标支持。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-18 | AP-6 全量验证与收口 | check 通过（Web 262 / Agent 63+1 / Server 734+14）；build 通过；Mock 24/24、认证 20/20、生产 20/20；契约与状态同步；UI 视觉待确认 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#验收记录2026-11-18macos) |
| 2026-11-18 | AP-5 过程呈现收敛 | 删除底部状态栏；状态收敛到折叠标题行（波形 + Thinking/Generating/Running/Waiting/Completed/Failed/Stopped + 步数与耗时）；reasoning 不渲染、不触发滚动；聊天定向 67 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-5-过程呈现收敛状态行波形思考) |
| 2026-11-18 | AP-4 输入框用量与速度 | 新增会话用量行：总量常驻、部分统计 `≥`、进行中最后一步 `tok/s`；终态失效重取；Web 定向 29 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-4-输入框下方用量与最后一步速度) |
| 2026-11-18 | AP-3 会话用量与步骤耗时 | 新增 `GET /api/sessions/:id/usage` 与诚实聚合（缺失不补零）；`model.usage` 增 `durationMs`；契约同步；定向 60 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-3-会话用量-api-与步骤耗时) |
| 2026-11-18 | AP-2 Profile 收敛与迁移 | Profile 仅 `coding` / `plan`，两者共享完整工具面，Plan 增计划；取消 PM2 观察注入；迁移 0034 将 `service-ops` 归一 `coding`；定向 96 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-2-profile-收敛提示迁移与选择器) |
| 2026-11-18 | AP-1 规格决议、ADR 与任务卡 | 084 审核通过转 `active`；§12 十项决议固化；新增 ADR-070 取代 ADR-069 的独立 Service Ops Profile；拆分 AP-2～AP-6 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-1-规格决议adr计划与任务卡) |
| 2026-11-18 | M5-F1-W12 Windows 全量 check 存量 shell 失败 | shell 测试补 PowerShell `&` 调用符与平台断言；pnpm test 预算 2s→30s；cmd 兜底夹具移出 %TEMP%（副本执行被主机安全软件杀 worker，已归因）；check 全绿 712 通过 / 31 跳过 | [066 tasks](specs/066-cross-platform/tasks.md#发布后跟踪-m5-f1-w12windows-全量-check-存量-shell-测试失败不计入-m5-完成) |
| 2026-11-18 | M5-F1-W11 Windows 启动结算 /bin/ps 缺陷 | 遗留 STOP_UNCONFIRMED 行导致启动必失败已修复；回归测试 Windows 复现后通过；真实数据目录启动自愈；biome/typecheck 过，全量 check 余 2 个存量 shell 失败（W12 待修） | [066 tasks](specs/066-cross-platform/tasks.md#发布后跟踪-m5-f1-w11windows-启动结算-binps-缺陷不计入-m5-完成) |
| 2026-11-18 | M5-F1-W10 Windows 10 实机复测 | 用户确认通过；安装 / TUI / 终端 / 命令 / PM2；Ubuntu 仍待 M5-F2 | [066 tasks](specs/066-cross-platform/tasks.md#发布后跟踪-m5-f1-w10windows-10-x64-实机复测不计入-m5-完成) |
| 2026-11-18 | S-1～S-7 项目服务与 service-ops | 人类验收通过；coding 直接管理后台开发任务；项目服务改读进程；预览按需生成；service-ops 管理默认 namespace PM2；旧命令释放锁；check/build + Mock 24/24 + Prod 20/20 | [083 tasks](specs/083-service-model/tasks.md#s-72026-11-18macos) |
| 2026-11-18 | K-9 workspace Profile、迁移与 UI | 新增 `sessions.agent_profile` 默认 coding；Session API/Composer Profile 选择；TurnRunner 按会话装配；迁移计数 32 | [082 tasks](specs/082-agent-kernel/tasks.md#k-92026-11-18macos) |

> 更早的收口记录（含同日其余 K-5、K-4、MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

## 交付基线

- 最新发布 `0.3.0`（2026-11-16，npm `latest`）；tag `v0.3.0` 已在 `origin/main` 上（2026-11-16 推送）。
- 迁移至 `0033`（schemaVersion 33）。

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
| 切片 | 068 / 072 / 073 / 074 / 076 / 077 / 078 / 081 / 082 / 083 | `done` | UI 修复、错误预算、上下文预算、成果呈现、文件浏览、模型连接、Git 工作流、Agent 内核重构、项目服务与 service-ops |
