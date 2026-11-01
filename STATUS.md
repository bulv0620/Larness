# STATUS

> 最后更新：2026-11-01 19:10 (+08:00)
> 当前阶段：**M1 自动化验收通过；真实 DeepSeek 冒烟待 Key（G1 未关闭）**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `in_progress` | M1-8 自动化完成；真实 DeepSeek 冒烟待 Key |
| M2 | 开发资源与窗口层 | `draft` | 仅路线图级范围，启动前补全 spec |
| M3 | 本机服务与 Preview | `draft` | 含预览隔离 PoC |
| M4 | 部署闭环与权限加固 | `draft` | 依赖 M3 |
| M5 | 多模型、自动化与更新 | `draft` | 依赖 M4 |

## 当前工作

- 待关闭：`M1-8` — M1 验收与 E2E（分支 `task/m1-8-acceptance`）
  - 新增 M1 全链路 E2E：配对 → 添加项目 → 新建会话 → 工具 → 严格审批 → 补丁 → 刷新恢复 → 切模型 → 添加 Key（掩码）→ 停止；
  - E2E Server 注入 FakeProvider；TurnQueue / 工具 / 审批 / SQLite / 事件 / WS 均为真实实现；
  - 自动化：`pnpm check`（agent 32 / server 236 / web 23）、`pnpm build`、demo E2E 15、认证 + M1 E2E 2、生产 E2E 2 全部通过；
  - 验收记录：[M1 acceptance](specs/020-workspace-agent/acceptance.md)；A1–A14 与 G1 逐项映射；
  - **剩余人工项**：真实 DeepSeek 工具调用冒烟（无 `DEEPSEEK_API_KEY`，未执行）；G1 不关闭，暂不进入 M2。
- 刚完成：`M1-7` — 模型 Profile 与 SecretStore（分支 `task/m1-7-secrets`）
  - `0004_models` 迁移：`secrets` / `credential_profiles` / `model_profiles`；启动时幂等 seed `deepseek-default`；
  - SecretStore：AES-256-GCM、随机 nonce、主密钥 `secrets/master.key`（0600）、错误密钥 / 篡改 fail closed；
  - API：`GET/POST /api/models`、`GET/POST/DELETE /api/credentials`；密钥只写不读，响应仅掩码与 secretRef；引用中的凭据拒绝删除；
  - 解析：Turn 按 `modelProfileId` 解析模型与最新 provider 凭据，缺失 / 解密失败返回 `PROVIDER_AUTH_FAILED`；Turn 记录 provider / model 快照；
  - 会话切换模型审计 `model.changed`；项目默认模型用于新会话；设置界面支持添加 / 删除 Key、查看掩码、选择当前会话或项目默认模型；
  - 验收：A9、A10；agent 32 / server 236 / web 23 测试，`pnpm check` / `build`、demo E2E 15、认证 E2E 1 通过；
  - 偏差：`POST /api/models/:id/test` 未实现（契约标记可选）；真实 DeepSeek 冒烟仍在 M1-8。
- 刚完成：`M1-6` — 实时对话 UI（分支 `task/m1-6-chat-ui`）
  - 真实工作区数据：项目 / 会话来自 API，模型列表暂用内置 DeepSeek Profile（M1-7 改为 `/api/models`）；
  - 项目管理：添加项目对话框、项目内新建会话、新建 / 重命名 / 归档会话；
  - `useSessionEvents`：首屏 REST 事件 + `agent:<sessionId>` WS 订阅 + 事件去重 / 缺口补拉 / 断线重连；
  - 事件 reducer：消息、工具卡片、文件变更、审批、错误、取消；纯函数测试覆盖；
  - Composer：模型 / 审批策略在发送前 PATCH 到会话，发送 Turn、停止、失败重试；审批卡片调用真实 `/api/approvals/:id`；
  - 认证：工作区会话撤销监控、退出登录、401 统一回登录；
  - 验证：web 23 项（新增 5 项 reducer）、server 227 项、agent 32 项；`pnpm check` / `build`、demo E2E 15 项、真实认证 E2E 1 项通过；
  - 偏差：真实 Agent 全链路 E2E 留在 M1-8；`assistant.delta` 仍未广播。
- 刚完成：`M1-5` — Turn Runner 与状态机（分支 `task/m1-5-runner`）
  - `TurnQueue`：全局并发 2、同会话串行、排队 / 取消 / 关闭时等待在途 Turn；
  - `TurnRunner`：QUEUED → PREPARING → RUNNING → WAITING_APPROVAL → COMPLETED / FAILED / CANCELLED；上下文构建、Provider 单步循环、工具事件、usage 与审计；
  - 预算：30 步 / 50 工具 / 10 分钟 / 上下文 80%（可注入覆盖）；
  - 审批挂起与恢复：批准后按参数哈希执行，拒绝 / 超时结果回传模型；项目写锁在写工具前获取 / 续租 / 释放；
  - 事件：`turn.status` / `assistant.message` / `tool.*` / `file.changed` / `tool.approval.*` / `turn.completed|failed|cancelled` 先落库后广播；WS 新增 `agent:<sessionId>` 订阅；
  - API：创建 Turn 自动入队，取消通过队列 abort Runner；生产入口默认启用 Runner，真实 Key 暂用 `DEEPSEEK_API_KEY`（M1-7 移除）；
  - 验收：A3、A4（后端）、A5、A6、A9、A12；agent 32 / server 227 / web 18 测试，`pnpm check` 通过；
  - 偏差：`assistant.delta` 尚未广播（M1-6 实时 UI 时补），真实 DeepSeek 冒烟仍在 M1-8。
- 刚完成：`M1-4` — 工具注册与审批引擎（分支 `task/m1-4-tools`）
  - `packages/resources` 文件服务：`list_files` / `read_file` / `search_code` / `apply_patch`，realpath 根内校验、SHA-256 版本、行范围、1 MiB / 2000 行上限、二进制 / 超大 / 符号链接逃逸拒绝；
  - `packages/agent`：`ToolRegistry` + Zod schema + L0/L1 风险 + 结果规范化；`standard` / `strict` / `readonly` 审批策略映射；
  - 审批：规范化参数哈希、pending / approved / denied / expired、超时拒绝、参数篡改检测、`GET/POST /api/approvals/:id`、清理任务自动过期与审计；
  - `ProjectWriteLock`：project 资源锁、TTL / fencing / 续租 / 释放，旧 token 拒绝；写 Turn 接线留给 M1-5；
  - `ToolExecutor`：策略拦截、审批请求 / 校验、`tool.requested` / `tool.completed` / `tool.denied` 审计；路径越界记录拒绝；
  - 验收：A7、A8；agent 32 项 + server 210 项 + web 18 项测试，`pnpm check` 通过。
- 刚完成：`M1-3` — Provider 适配与 FakeProvider（分支 `task/m1-3-provider`）
  - `packages/agent`：`ProviderAdapter` / `ProviderChunk` / 能力声明 / 稳定错误分类；`FakeProvider` 支持脚本化文本、工具调用、错误、延迟与 abort；
  - `DeepSeekProvider`：基于 AI SDK 的流式文本 + 工具调用映射，消息 / 工具 schema 转换，Key 按调用注入，超时与 401 / 429 / 上下文超限 / 内容过滤分类，不泄漏上游原文；
  - 模型 Profile：内置 `deepseek-chat` 与 Fake 默认 Profile（无密钥，M1-7 换为持久化 repository）；
  - 共享错误码新增 `PROVIDER_AUTH_FAILED` / `PROVIDER_RATE_LIMITED` / `PROVIDER_CONTEXT_LIMIT` / `PROVIDER_CONTENT_FILTERED` / `PROVIDER_UNKNOWN` 并同步契约；
  - 契约测试确认 FakeProvider 与 AI SDK 映射对同一脚本产出一致；真实 DeepSeek 冒烟测试由 `LARNESS_DEEPSEEK_SMOKE=1` + `DEEPSEEK_API_KEY` 门控，无 Key 时跳过（记录移入 M1-8）；
  - 验收：A3 的模型部分、A11（分类）；agent 15 项 + server 202 项 + web 18 项测试，`pnpm check` 通过。
- 刚完成：`M1-2` — 会话、Turn 与事件存储（分支 `task/m1-2-sessions`）
  - `0003_workspace` 迁移：`sessions` / `turns` / `agent_events` / `approvals` / `resource_locks`，含 `UNIQUE(session_id, seq)`、`UNIQUE(session_id, idempotency_key)`、资源锁唯一约束与外键；
  - 会话：独立会话创建空 workspace、项目会话复用 `realPath`、列表 / 项目筛选 / limit、详情含活跃 Turn、重命名 / 下一轮模型、归档（不删源码，活跃 Turn 409）；
  - Turn：事务内幂等创建与活跃校验、`user.message` + `turn.created` 事件、取消骨架（`CANCELLING`）；审计 `turn.started` / `turn.cancelled`；
  - 事件：事务内 Session 级 `seq`、`GET /events?after=&limit=` 增量分页（`nextSeq` / `hasMore`）、`ServerEvent` 包络；
  - 启动修复：所有无法证明存活的活跃 Turn → `INTERRUPTED` 并写 `turn.interrupted`，重启集成测试覆盖；
  - 资源锁：获取 / 续租 / 释放 / 过期回收与 fencing token，软释放保持 token 单调；
  - 验收：A2、A4（后端）、A5、A12、A13；server 200 项测试（新增 23 项），`pnpm check` 通过。
- 刚完成：`M1-1` — 项目登记与路径授权
  - `0002_projects` 迁移、projects repository / API、pathGuard、Git 检测、项目设置、删除仅解除关联、审计；
  - server 176 项测试；项目写锁规划已从 M2-7 提前到 M1-4/M1-5。
- 刚完成：`M0-9` — 稳定入口与 M0 验收（分支 `task/m0-9-entry`，状态 `done`）
  - 已完成：TUI 受管前台入口（[ADR-023](docs/adr/ADR-023-tui-as-managed-entry.md)）——`pnpm dev` / `node app.js` 启动 Server（开发另起 Vite）并进入 TUI；启动页显示数据目录 / Server / Web / IPC 检查；关闭 TUI 优雅停止全部；`l` 查看 Server 日志与 Vite 输出；
  - 已完成：`app.js` status / doctor / version、静态托管 + SPA 回退 + 缓存 / CSP、四入口构建、关闭审计、IPC 契约校准、[G0 验收记录](specs/010-foundation/acceptance.md)；
  - 安全修复：远程 HTTP 强制拒绝（`HTTPS_REQUIRED`）、Fastify `trustProxy` 仅信任 `trustedProxies`、WS 过期重校验、会话活跃时间节流更新（排除轮询）、TUI IPC 5 分钟保活 + 断线重连；
  - 验证：server 170 项、web 18 项；开发/生产启动页与关闭清理手工冒烟通过；
  - macOS 人工验收：已通过（真实 Touch ID / Safari、TUI 初始化 / 审批 / 撤销、安全评审）；
  - G0 按 macOS 范围关闭；Linux / Windows / CI 首次远端结果列为后续平台验证，不阻塞 M1；
  - M1 前置：项目写锁与 M1 `apply_patch` 的规划冲突需在 M1 开工前解决。
- 刚完成：`M0-8` — Web 认证集成（分支 `task/m0-8-web-auth`）
  - `/login`、`/pair`、`useSession` / `RequireAuth`、登出、空态工作台；Passkey options 预取与用户手势调用；
  - Vite `/api` + `/ws` 代理；默认真实认证，`VITE_USE_MOCKS=1` 保留 S0 Demo；
  - 17 项 Web 测试；Playwright 虚拟认证器完成 配对 → 注册 → 登录 → 撤销跳转 全流程。
- 刚完成：`M0-7` — 鉴权与传输安全（分支 `task/m0-7-security`，已合入 main）
  - 全局守卫：会话解析、CSRF、Origin / Host、默认拒绝、安全响应头、`/api/bootstrap`、登出；
  - 限流（配对申请 / 轮询 / 兑换、WebAuthn、会话）+ 审计；WebSocket 握手鉴权、`system` 订阅、心跳、撤销 1 秒内 1008 关闭；IPC `sessions.list/revoke`；
  - 154 项 server 测试；未认证业务 API 401、未初始化 409、限流 429。
- 刚完成：`M0-6` — Passkey 注册与登录（分支 `task/m0-6-passkey`）
  - SimpleWebAuthn 注册 / 认证 options / verify、challenge 一次性消费、设备 + credential + 会话、TUI 设备列表 / 撤销；
  - 备份标志、counter（0 / 回退仅审计）、AAGUID / transports 入库；注册失败不产生设备 / 会话；
  - 143 项 server 测试；软件认证器覆盖注册 / 登录 / 重放 / 重复 credential / 撤销。
- 刚完成：`M0-5` — 配对申请与准入（分支 `task/m0-5-pairing`，已合入 main）
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
- 下一个任务：等待真实 DeepSeek 冒烟；G1 关闭后进入 M2（需先补全 M2 spec）
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
| 通过 `127.0.0.1` / 局域网 IP 访问时 Passkey 不可用 | 已按默认实现：仅支持 localhost / HTTPS，IP 来源返回 ORIGIN_INVALID；Web 提示待 M0-8 | 已实现（M0-6） |
| 所有 Passkey 丢失且 TUI 不可用时如何恢复 | V1 不提供 Web 恢复；TUI 撤销后重新配对；离线恢复码为 P1 | M4 |
| 是否允许可同步 Passkey | 已按默认实现：允许，存储并展示 backupEligible / backupState | 已实现（M0-6） |
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
| 2026-11-01 | 完成 M0-6：SimpleWebAuthn 注册 / 登录、challenge 生命周期、设备与 credential、备份标志 / counter、TUI 设备撤销；server 143 项测试通过 |
| 2026-11-01 | 完成 M0-7：全局会话 / CSRF / Origin / Host 守卫、限流与审计、bootstrap / logout、WebSocket 鉴权 / 订阅 / 撤销即断、IPC sessions；server 154 项测试通过 |
| 2026-11-01 | 完成 M0-8：`/login`、`/pair`、路由守卫、登出、空态工作台、Vite 代理；虚拟认证器 E2E 通过；web 17 项测试、demo E2E 15 项保留 |
| 2026-11-01 | M0-9 实现完成：`app.js`、生产静态托管 / SPA 回退、四入口构建、关闭审计、IPC 契约校准；G0 自动化通过，人工验收待完成 |
| 2026-11-01 | ADR-023：TUI 改为受管前台入口，`pnpm dev` / `node app.js` 自动启动 Server + Web 并进入 TUI；关闭 TUI 停止全部，不提供 headless；server 测试增至 161 项 |
| 2026-11-01 | 启动保护：开发/生产 canonical origin 与 Web 端口不一致时拒绝启动（避免误显示 5173 且 Web 登录被 Origin 拒绝）；新增 3 项测试 |
| 2026-11-01 | 配对页刷新复用 sessionStorage 中的未过期申请，避免每次刷新产生新待审批记录；支持刷新恢复 enrollment 阶段；新增 1 项 Web 测试 |
| 2026-11-01 | 安全修复：远程 HTTPS 强制、trustedProxies 接入、WS 过期重校验、会话 idle TTL 活跃更新、TUI IPC 保活与重连；server 169 / web 18 测试；CI 增加 Playwright E2E |
| 2026-11-01 | dev 模式 3210 关闭静态 Web，只保留 API/WS；前端仍只经 Vite 5173；新增静态开关测试 |
| 2026-11-01 | M0 验收关闭：macOS 范围 G0 通过；Linux / Windows / CI 首次远端结果列为后续验证；下一步先修 M1 项目写锁规划 |
| 2026-11-01 | M1-1 完成：projects 迁移 / API / pathGuard / Git 检测 / 设置 / 审计；项目写锁提前到 M1-4/M1-5；server 176 项测试 |
| 2026-11-01 | M1-2 完成：`0003_workspace` 五表 / repository；会话 workspace / 列表 / 重命名 / 归档；Turn 幂等创建、活跃校验、取消骨架；事务内 seq 与事件分页；启动 INTERRUPTED 修复；资源锁 fencing；server 200 项测试 |
| 2026-11-01 | M1-3 完成：ProviderAdapter / FakeProvider / DeepSeek 适配与错误分类；内置模型 Profile；共享 Provider 错误码；agent 15 / server 202 / web 18 测试；真实 DeepSeek 冒烟待 M1-8 |
| 2026-11-01 | M1-4 完成：文件工具 / 版本校验 / 输出上限；ToolRegistry 与审批策略；审批服务与 API、超时与篡改检测；ProjectWriteLock；ToolExecutor 审计；agent 32 / server 210 / web 18 测试 |
| 2026-11-01 | M1-5 完成：TurnQueue / TurnRunner 状态机、上下文与预算、审批挂起恢复、取消、项目写锁、agent WS 广播；创建 Turn 自动入队；agent 32 / server 227 / web 18 测试 |
| 2026-11-01 | M1-6 完成：真实项目 / 会话 / 事件 / 审批 UI；项目与重命名对话框、新建 / 归档会话、WS 补拉 reducer、Composer 发送 / 停止、真实审批；web 23 / server 227 / agent 32 测试；demo 与认证 E2E 通过 |
| 2026-11-01 | M1-7 完成：`0004_models`、AES-256-GCM SecretStore、模型 / 凭据 API 与设置界面、默认模型、密钥脱敏与删除引用保护；agent 32 / server 236 / web 23 测试 |
| 2026-11-01 | M1-8 自动化完成：M1 全链路 E2E（项目 / 工具 / 审批 / 刷新 / 切模型 / 停止）、验收记录；check / build / demo E2E / auth+prod E2E 全绿；真实 DeepSeek 冒烟待 Key，G1 未关闭 |
