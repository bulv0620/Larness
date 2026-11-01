# STATUS

> 最后更新：2026-11-01 14:56 (+08:00)
> 当前阶段：**M0 进行中；M0-5 完成，下一步 M0-6**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `in_progress` | M0-1 ~ M0-5 完成；M0-6 可开始 |
| M1 | 项目、会话与最小 Agent | `ready` | spec 已细化，进入前需复核 |
| M2 | 开发资源与窗口层 | `draft` | 仅路线图级范围，启动前补全 spec |
| M3 | 本机服务与 Preview | `draft` | 含预览隔离 PoC |
| M4 | 部署闭环与权限加固 | `draft` | 依赖 M3 |
| M5 | 多模型、自动化与更新 | `draft` | 依赖 M4 |

## 当前工作

- 进行中：无
- 刚完成：`M0-5` — 配对申请与准入（分支 `task/m0-5-pairing`）
  - 配对状态机、10 字符 Crockford 配对码、5 次尝试 / 5 分钟 TTL / 原子兑换、allow_once 会话与 trust enrollment；
  - REST 配对接口（申请 / 轮询 / 兑换）、`/api/auth/session`、会话 / CSRF 基础、TUI 待审批列表与审批（含一次性码展示）；
  - 125 项 server 测试；并发兑换仅一个成功，错误 5 次后限流作废。
- 刚完成：`M0-4` — 本机 IPC 与 TUI 初始化（分支 `task/m0-4-ipc-tui`，已合入 main）
  - UDS / Named Pipe、0600 socket + Token 定时比较握手、NDJSON / Zod、1 MiB 帧 / 30 分钟空闲 / 8 连接；
  - `system.status` / `system.doctor` / `init.status` / `init.apply` / `logs.tail` / `audit.tail` / `server.shutdown`；Argon2id 管理员凭据；config 0600 原子写入 + 审计；TUI 初始化向导 / 仪表盘 / 日志 / 关闭确认；status CLI 优先 IPC；
  - 96 项 server 测试；初始化并发仅一个成功，Web 无初始化接口。
- 刚完成：`M0-3` — SQLite、迁移与审计（分支 `task/m0-3-sqlite-migrations`，已合入 main）
  - Drizzle 八张 M0 表 + `0001_auth` 迁移、启动 migrator、WAL / 外键 / busy_timeout / synchronous；
  - 八组 repository、审计脱敏与 fail-closed、`BEGIN IMMEDIATE` 事务辅助、过期清理调度、`VACUUM INTO` 备份；
  - `status` / `doctor` 接入 DB 完整性、schemaVersion 与迁移进度；62 项 server 测试。
- 刚完成：`M0-2` — 配置、数据目录、日志与诊断（分支 `task/m0-2-config-paths-logging`，已合入 main）
  - 数据目录 0700 / 子目录 / 权限收紧、`config.json` Zod + 环境变量覆盖、canonical origin / RP ID 推导（拒绝 IP 与远程 http Passkey）；
  - pino + pino-roll 日志（0600、按日 / 100m 轮转、脱敏）、`larness.lock` 单实例、幂等关闭、`status` / `doctor`。
- 下一个任务：`M0-6` — Passkey 注册与登录
- 阻塞项：无
- 待确认：CI 首次 push 结果（仓库暂无 remote）。

## 已冻结

- 产品与安全边界：`CONSTITUTION.md`
- 技术栈：`docs/architecture/stack.md`
- 决策记录：`docs/adr/DECISIONS.md`
- 任务顺序与门禁：`specs/ROADMAP.md`
- **可信设备凭据：Passkey / WebAuthn（ADR-021）；不签发长期设备 Token**
- **全局资源与 Tab 归属：`docs/contracts/resource-views.md`（2026-11-01）**
- **产品名与内部命名空间：Larness / `@larness` / `LARNESS_*`（ADR-022）**

## 待人类确认（不阻塞 D0）

| 问题 | 默认方案 | 截止 |
|---|---|---|
| 通过 `127.0.0.1` / 局域网 IP 访问时 Passkey 不可用 | 仅支持 `localhost` 或 HTTPS 域名；IP 访问提示改用 localhost / 域名 | M0-6 |
| 所有 Passkey 丢失且 TUI 不可用时如何恢复 | V1 不提供 Web 恢复；TUI 撤销后重新配对；离线恢复码为 P1 | M4 |
| 是否允许可同步 Passkey | 允许，展示 backup 标志，不承诺物理设备绑定 | M0-6 |
| 预览独立来源方案 | 开发用 `*.preview.localhost`，生产要求独立域 | M3 开始前 |
| PM2 交付方式 | 随包依赖 + 可选外部安装 | M3 开始前 |
| 仓库许可证 | 未定，暂不添加 LICENSE | 公开发布前 |

完整列表见 [docs/open-questions.md](docs/open-questions.md)。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-31 | 初始化 spec 工程：宪法、Agent 手册、架构/契约、路线图、S0–M1 详细 spec、M2–M5 草案 |
| 2026-10-31 | 改用 Passkey / WebAuthn 作为 V1 可信凭据（ADR-021）；移除长期设备 Token / refresh；M0 拆为 9 个任务 |
| 2026-11-01 | 完成 S0 视觉 Demo（D0-1–D0-8）：三栏、主题、窗口层、资源分区、Mock 对话/审批、Monaco/xterm/预览占位；E2E 9 项通过 |
| 2026-11-01 | 右侧资源区增加“全部 / 文件 / 服务 / 终端 / Git”Tabs；默认全部，单项占满右栏；E2E 10 项通过 |
| 2026-11-01 | 移除资源头部加号/三点、左侧添加项目、服务重启等无效占位控件；补齐上下文添加菜单与文件树折叠；E2E 11 项通过 |
| 2026-11-01 | 修复资源分区折叠后底部留白：按展开分区归一化高度，折叠时其他分区自动填满；移除分区标题 hover 的无效“·”；E2E 12 项通过 |
| 2026-11-01 | 新增 `docs/contracts/resource-views.md`：全局资源 Tab 身份/来源/分组/项目筛选/去重/关闭语义；M2 按此实现 |
| 2026-11-01 | UI Demo 窗口加入项目筛选栏与来源分组；从右栏打开自动筛选，顶部入口恢复；E2E 13 项通过 |
| 2026-11-01 | 筛选下拉与 Tab 合并为同一行（下拉最左、Tab 横向滚动、计数最右），节省 32px 纵向空间 |
| 2026-11-01 | 输入区与时间线去除硬分割线，改为留白 + 顶部渐变融合；E2E 14 项通过 |
| 2026-11-01 | 左右侧栏加入可拖拽宽度、双击复位、方向键调整与宽度持久化；E2E 15 项通过 |
| 2026-11-01 | 侧栏与资源分区分隔线的悬停 / 聚焦由强调色改为中性灰度，去掉彩色覆盖层 |
| 2026-11-01 | 恢复分隔线蓝色 hover；把侧栏拖拽手柄从 6px 透明条改为 1px 线 + 透明扩大点击区，消除线左侧异色窄带 |
| 2026-11-01 | 人类视觉验收通过，D0-9 / S0 关闭，G-S0 通过；M0-1 成为下一个可执行任务 |
| 2026-11-01 | 产品名与命名空间全量统一为 Larness：包名、Cookie、环境变量、数据目录、Socket、DB、localStorage、UI、Mock、测试与截图（ADR-022） |
| 2026-11-01 | 完成 M0-1：新增 `apps/server`（Fastify 5、`createApp()`、`/api/health`、请求 ID、契约错误处理）、`packages/{agent,resources}` 占位、shared config/errors 类型、根 `dev`/`build` 脚本与 CI；server 6 项测试通过 |
| 2026-11-01 | 完成 M0-2：数据目录与权限、Zod 配置 + 环境变量覆盖、canonical origin / RP ID 推导、pino 轮转脱敏日志、单实例锁、`status` / `doctor`、幂等关闭；server 43 项测试通过 |
| 2026-11-01 | 完成 M0-3：Drizzle 八表 + `0001_auth`、启动迁移、WAL / 外键、repository、审计脱敏与 fail-closed、清理调度、备份、`status` / `doctor` DB 检查；server 62 项测试通过 |
| 2026-11-01 | 完成 M0-4：本机 IPC（UDS / Named Pipe、Token、NDJSON、限额）、初始化方法（Argon2id、config 0600、审计、并发唯一成功）、TUI 向导 / 仪表盘、status 优先 IPC；server 96 项测试通过 |
| 2026-11-01 | 完成 M0-5：配对状态机、一次性码与限次、allow_once 会话、trust enrollment、REST 配对接口、会话 / CSRF 基线与 TUI 审批；server 125 项测试通过 |
