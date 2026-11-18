# STATUS

> 最后更新：2026-11-18 (+08:00)
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- 无。

## 阻塞与待确认

- **HX-12b（`turnRunner` 循环体拆分）**：前置是把约 20 个可变闭包状态收敛为显式 `TurnRunState`；仅因改造面大而暂缓，不受环境阻塞。081 明确不动循环体，交付后该文件为 2 416 行，拆分优先级不变。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-18 | K-12 run_command / run_shell | `run_shell` 平台 shell、实际 shell 与 stdout/stderr 分离；新错误码与交互命令拒绝；coding 7 工具 / 1 727 token，比 workspace 降 69.3% | [082 tasks](specs/082-agent-kernel/tasks.md#k-122026-11-18macos) |
| 2026-11-18 | K-3 coding Profile 与核心提示 | coding 6 工具、schema 1 174 / system 253 token，比 workspace 降 73%；`PROMPT_VERSION` → `m6-4`；默认仍 workspace | [082 tasks](specs/082-agent-kernel/tasks.md#k-32026-11-18macos) |
| 2026-11-18 | K-2 Profile / ToolPack 抽象 | 新增 AgentProfile / ToolPack / ToolAvailability；coding 6 工具、plan 只读+计划、workspace 保持 28 工具；默认仍 workspace | [082 tasks](specs/082-agent-kernel/tasks.md#k-22026-11-18macos) |
| 2026-11-18 | K-1 082 门禁、基线与锁/审计盘点 | spec `ready`、ADR-068 `accepted`、Q-042～Q-050 确认；28 工具 / 4 577 schema token、system 747 token、98 Turn 基线；`pnpm check` 全绿 | [082 baseline](specs/082-agent-kernel/baseline.md) |
| 2026-11-17 | UI-F28 发送后回到底部 | 发送消息立即回到最新输出并恢复自动跟随 | [068](specs/068-ui-fixes/tasks.md#ui-f282026-11-17macos) |
| 2026-11-17 | UI-F27 项目条目标识 | Git 改为图标，运行中终端在 Git 图标左侧显示终端图标；服务端项目响应新增 `runningTerminals` | [068](specs/068-ui-fixes/tasks.md#ui-f272026-11-17macos) |
| 2026-11-16 | LE-1～LE-7 Agent 内核轻量化 | 观察块移出缓存前缀、生命周期文案三处合一处、纯读批并发、批结果 12k 预算、system 精炼输出约束；`test/agent` 179/179 | [081](specs/081-agent-lean/tasks.md#验收记录) |
| 2026-11-16 | UI-F26 定位居中 | 定位目标行滚动到文件列表中段，顶部按边界停靠 | [068](specs/068-ui-fixes/tasks.md#ui-f262026-11-16macos) |
| 2026-11-16 | UI-F25 目录右键新建 | 目录菜单新增新建文件 / 新建文件夹并展开目标目录 | [068](specs/068-ui-fixes/tasks.md#ui-f252026-11-16macos) |
| 2026-11-16 | UI-F24 新建后列表无感 | 创建后保留目录内容与滚动位置，不再跳回顶部 | [068](specs/068-ui-fixes/tasks.md#ui-f242026-11-16macos) |

> 更早的收口记录（含同日其余 MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

## 交付基线

- 最新发布 `0.3.0`（2026-11-16，npm `latest`）；tag `v0.3.0` 已在 `origin/main` 上（2026-11-16 推送）。
- 迁移至 `0031`（schemaVersion 31）。

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
| M6 | 运行时效率与 Turn 恢复 | `done` | 070（HX）与 071（TR）于 2026-11-12 收口；HX-12b 拆分暂缓 |
| 切片 | 068 / 072 / 073 / 074 / 076 / 077 / 078 / 081 | `done` | UI 修复、错误预算、上下文预算、成果呈现、文件浏览、模型连接、Git 工作流、Agent 内核轻量化 |
