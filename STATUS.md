# STATUS

> 最后更新：2026-11-18 (+08:00)
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- 无。

## 阻塞与待确认

- **082 真实模型 A/B**：K-10 已按人类 2026-11-18 确认限定收口；真实 Provider A/B、Windows 实机与人工视觉未运行，不得声称模型成功率已验证。
- **Q-051 命名服务持久化**：082 的命名后台服务为内存 + `agent_events`，Larness 重启后不恢复；现有 `services` 表继续只表示终端临时服务与预览源。是否要求跨重启历史待确认。
- **HX-12b（`turnRunner` 循环体拆分）**：前置是把约 20 个可变闭包状态收敛为显式 `TurnRunState`；仅因改造面大而暂缓，不受环境阻塞。081 明确不动循环体，交付后该文件为 2 416 行，拆分优先级不变。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-18 | K-10 A/B 与全量门禁 | 确定性 10 任务 A/B 10/10；check/build/Mock 24/24/Prod 20/20；真实模型 A/B 未运行，按限定范围收口 | [082 tasks](specs/082-agent-kernel/tasks.md#k-102026-11-18macos真实模型-ab-未运行) |
| 2026-11-18 | K-9 workspace Profile、迁移与 UI | 新增 `sessions.agent_profile` 默认 coding；Session API/Composer Profile 选择；TurnRunner 按会话装配；迁移计数 32 | [082 tasks](specs/082-agent-kernel/tasks.md#k-92026-11-18macos) |
| 2026-11-18 | K-11 锁与审计收敛 | LeaseManager 成为唯一锁入口；AuditSink required/resource/debug；tool.requested/completed 与 terminal input/resize 审计移除；dev-web/git 噪声收敛 | [082 tasks](specs/082-agent-kernel/tasks.md#k-112026-11-18macos) |
| 2026-11-18 | K-8 计划可选化 | coding/workspace 移除 update_plan 与计划提醒；plan Profile 只读+计划；workspace 17 工具 / 3 442 schema token；`PROMPT_VERSION` → `m6-6` | [082 tasks](specs/082-agent-kernel/tasks.md#k-82026-11-18macos) |
| 2026-11-18 | K-7 命名服务 | 新增 NamedServiceManager、3 个 workspace 工具与服务 REST；项目+名称+命令幂等、端口冲突、健康检查与日志；workspace 18 工具 / 3 741 schema token | [082 tasks](specs/082-agent-kernel/tasks.md#k-72026-11-18macos) |
| 2026-11-18 | K-6 后台进程能力包 | 新增 ProcessManager、3 个 workspace 工具与进程 REST；进程组停止、环形输出游标、启动/停止幂等；workspace 15 工具 / 3 175 schema token | [082 tasks](specs/082-agent-kernel/tasks.md#k-62026-11-18macos) |
| 2026-11-18 | K-5 终端与 Agent 模型面分离 | 7 个终端工具与 Agent 租约移除；workspace 12 工具 / 2 596 schema token；人类终端 API/WS 16 项通过；`PROMPT_VERSION` → `m6-5` | [082 tasks](specs/082-agent-kernel/tasks.md#k-52026-11-18macos) |
| 2026-11-18 | K-4 Git 模型工具移除 | 10 个 Git 工具从所有 Profile 移除；workspace 19 工具 / 3 947 schema token；人类 Git UI 与 ProjectLease 保留；Agent 经 shell Git 提交验证 | [082 tasks](specs/082-agent-kernel/tasks.md#k-42026-11-18macos) |
| 2026-11-18 | K-12 run_command / run_shell | `run_shell` 平台 shell、实际 shell 与 stdout/stderr 分离；新错误码与交互命令拒绝；coding 7 工具 / 1 727 token，比 workspace 降 63.3% | [082 tasks](specs/082-agent-kernel/tasks.md#k-122026-11-18macos) |
| 2026-11-18 | K-3 coding Profile 与核心提示 | coding 6 工具、schema 1 174 / system 253 token，比 workspace 降 73%；`PROMPT_VERSION` → `m6-4`；默认仍 workspace | [082 tasks](specs/082-agent-kernel/tasks.md#k-32026-11-18macos) |

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
