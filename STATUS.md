# STATUS

> 最后更新：2026-11-02 (+08:00)
> 当前阶段：**M1 / G1 已验收，初始化修复 I0-1～I0-6 完成；下一步补全 M2 spec**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `draft` | 仅路线图级范围，启动前补全 spec |
| M3 | 本机服务与 Preview | `draft` | 含预览隔离 PoC |
| M4 | 部署闭环与权限加固 | `draft` | 依赖 M3 |
| M5 | 多模型、自动化与更新 | `draft` | 依赖 M4 |

## 初始化修复（2026-11-02）

I0-1 → I0-2 → I0-3 → I0-4 → I0-5 → I0-6 已按顺序完成，逐任务先测试再实现并提交。

| ID | 结果 | 分支 |
|---|---|---|
| I0-1 | 日志按实际时间保留，跳过无关文件与符号链接 | task/i0-1-log-retention |
| I0-2 | 保留文件配置，事务提交待发布记录，发布失败业务关闭，启动恢复 | task/i0-2-init-recovery |
| I0-3 | 已有加密凭据时密钥缺失/错误拒绝启动，恢复原密钥后可用 | task/i0-3-master-key-validation |
| I0-4 | 取消密码与更新通道询问，沿用有效配置，可选高级网络设置，自动应用配置 | task/i0-4-init-experience |
| I0-5 | 首次日志清理结束后才打开写入器，消除并发删除旧日志的竞态 | task/i0-5-log-startup-order |
| I0-6 | 撤回 IPC v2、开发期协议保持 1；按授权清空本机配置与运行数据 | task/i0-6-dev-reset |

- 最终验收：pnpm check（server 265 / agent 32 / web 26）、pnpm build、真实构建 smoke 通过；I0-4 Demo 15 / auth 2 / prod 2 E2E 通过。[验收记录](specs/015-initialization-hardening/acceptance.md)。
- ADR-024 / ADR-025 已获人类批准；首次不设置密码，历史哈希不变。I0-6 / ADR-026 已按人类要求撤回 IPC v2，开发期协议号保持 1；无 Web 密码登录/恢复入口。
- 默认数据目录及七个子目录保留；开发/生产显式使用独立 LARNESS_DATA_DIR，无破坏性迁移。
- 无进行中的初始化修复任务；M2 保持 draft，待 G-Spec。

## 本地重置记录（2026-11-02 / I0-6）

- ADR-026 已按人类明确指令记录 accepted，撤回 ADR-025 的 IPC v2 条款；不增加旧参数适配。
- 已删除 `/Users/bulv/Library/Application Support/larness`、`/Users/bulv/Library/Application Support/larness-prod` 及 64 项已识别临时测试数据/日志；清理前已确认相关进程退出、会话工作区无源码文件。项目源码和依赖保留。
- check / build / 真实构建 smoke 均通过；测试结束后两数据目录仍不存在，遗留测试数据目录为 0。
- 下次运行需重新初始化、配对浏览器与配置模型凭据。无进行中任务，下一步仍为 M2 G-Spec。

## 当前工作

- 已完成：`M1` — 项目、会话与最小 Agent（M1-1 ~ M1-15）
  - G1 于 2026-11-01 通过人类验收；自动化覆盖 `pnpm check`（agent 32 / server 239 / web 26）、`build`、demo E2E 15、auth + M1 E2E 2、prod E2E 2；
  - 关键交付：项目登记 / 目录选择、会话 / Turn / 事件、文件工具与审批、模型 Profile / SecretStore、实时对话 / Markdown / 工具折叠、草稿会话、侧栏右键操作；
  - 验收记录：[M1 acceptance](specs/020-workspace-agent/acceptance.md)。
- 下一步：补全 `M2` spec（当前 `draft`），经 G-Spec 确认后开始 M2-1（FileManager）。
- 阻塞项：无。
- 待确认：M2 spec 范围（文件树 / Monaco / CommandRunner / PTY / Git / 锁扩展）与 G-Spec 评审时间。

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
| 2026-11-01 | M1-8 自动化通过：真实 DeepSeek live smoke 通过（33 tests / 654ms）；G1 仍需人类按 acceptance 第 7 节验收 |
| 2026-11-01 | M1-9 目录选择器实现：本机目录浏览 API + 项目对话框目录树；server 237 / web 24 测试通过；待人工验收 |
| 2026-11-01 | M1-10 流式对话与 Markdown：assistant.delta 广播、进行中状态、GFM 渲染；server 238 / web 26 测试通过；待人工验收 |
| 2026-11-01 | M1-11 布局与工具分组：工具折叠、资源栏折叠、品牌迁移 header、提示清理、上下文用量；E2E 通过；待人工验收 |
| 2026-11-01 | M1-12 自动会话标题：首条消息命名、手动标题保留、前端即时刷新；待人工验收 |
| 2026-11-01 | M1-13 侧栏右键操作：项目 / 会话重命名、会话归档、项目移除确认；E2E 通过；待人工验收 |
| 2026-11-01 | M1-14 仅展示最终答复：每 Turn 只保留最后一条 assistant 消息，工具组分折叠保留；E2E 通过；待人工验收 |
| 2026-11-01 | M1-15 草稿会话：同项目复用、切走消失、首条消息后创建；E2E 通过；待人工验收 |
| 2026-11-01 | M1-8 ~ M1-15 人类验收通过；G1 关闭，M1 完成 |
