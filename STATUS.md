# STATUS

> 最后更新：2026-11-03 (+08:00)
> 当前阶段：**M2-1 已验收；M2-1b 文件监听与资源事件补拉已实现，待 review**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `in_progress` | G-Spec-M2 / G-PoC-M2 已通过；M2-1 done / M2-1b review |
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

## TUI 配对码停留（2026-11-02 / I0-7）

- 已完成：配对码显示后等待回车再返回控制面板；task/i0-7-pairing-code-pause。
- allow_once / trust 均覆盖；审批失败不等待，取消输入不误报审批失败；配对码有效期及接口无变更。
- 测试先失败后通过；pnpm check（server 269 / agent 32 / web 26）、pnpm build 通过。无进行中补充任务，下一步仍为 M2 G-Spec。

## TUI 页面化实施（2026-11-02）

- T0-3：task/t0-3-reading-pages，2026-11-02（+08:00）开始，现为 done；日志双来源、审计阅读、手动刷新、滚动与失败旧快照已实现，整体回归与脱敏画面记录见 acceptance.md。2026-11-02 人类明确“验收通过”，G-Task 通过，016 切片标记 done。
- T0-3 自动化：check（server 290 / agent 32 / web 26）、build、真实 PTY、初始化 smoke、Demo 15 / auth 2 / prod 2 E2E 均通过；浏览器 auth/prod 因共用 IPC 定位文件串行运行。仅验证 macOS，Linux/Windows 待实机。
- T0-2 已完成：task/t0-2-resource-pages；check（server 283 / agent 32 / web 26）、build、真实 PTY 配对申请/审批/兑换及清理通过。

- 人类完成 spec 后明确指令“开始实现”，G-Spec-TUI / ADR-027 通过；T0-1 → T0-2 → T0-3 先于 M2 实施。
- 已完成 T0-1，分支 task/t0-1-screen-foundation，2026-11-02（+08:00）：独立屏幕、单一输入、初始化适配、概览与退出恢复；T0-2 完成配对列表/操作/确认/码页与设备列表/详情/撤销确认，先测试、再接现有 IPC。
- 验收：check（server 276 / agent 32 / web 26）、build、真实 PTY、初始化 smoke 通过，见 specs/016-tui-experience/acceptance.md。
- 运行依赖只按 ADR-027 显式声明现有版本的两个纯 JS 宽度工具；无原生库/协议/DB 变化。

## 当前工作

- 当前任务：M2-1b `review`，分支 `task/m2-1b-file-watching`，2026-11-03（+08:00）开始并完成实现；M2-1 已获人类“下一步”确认。监听 / 持久事件 / 授权补拉、降级与恢复证据见 [验收记录](specs/030-dev-resources/acceptance.md)。M2-2 保持 todo。

- M2-P（仅文档）已完成起草：2026-11-02（+08:00），分支 `task/m2-spec-draft`。按人类“起草一下 m2 阶段”补齐 030 spec / plan / tasks / review、资源契约草案与 ADR-029 提案；check（server 297 / agent 32 / web 26）及文档链接 / 依赖检查通过；不启动功能实现、不安装依赖、不修改运行数据。

- U0-0（仅文档）已完成：task/u0-0-unified-entry-spec，2026-11-02（+08:00）开始并完成。人类要求“先补充文档”；新增 ADR-028 / 017 spec / runtime-entry 契约草案和任务，不修改运行代码、配置/数据，不把方向认可当成具体设计或实施门禁已批准。
- G-Spec-U / ADR-028 与先于 M2 的排期已获人类“开始实现”确认，当前按任务验收，见 specs/017-unified-entry/review.md。

- 已完成：`M1` — 项目、会话与最小 Agent（M1-1 ~ M1-15）
  - G1 于 2026-11-01 通过人类验收；自动化覆盖 `pnpm check`（agent 32 / server 239 / web 26）、`build`、demo E2E 15、auth + M1 E2E 2、prod E2E 2；
  - 关键交付：项目登记 / 目录选择、会话 / Turn / 事件、文件工具与审批、模型 Profile / SecretStore、实时对话 / Markdown / 工具折叠、草稿会话、侧栏右键操作；
  - 验收记录：[M1 acceptance](specs/020-workspace-agent/acceptance.md)。
- 下一步：M2-1 review 后进入 M2-1b 文件监听与资源事件补拉；本次未启动后续任务。
- 阻塞项：无。
- 待 review：M2-1 文件 / 根冲突锁 / 写意图与恢复 / 迁移契约；无新增设计阻塞，已知外部竞态边界保持不变。

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
| 2026-11-02 | M2-P：补齐 030 spec / plan / tasks / review、资源契约草案与 ADR-029 提案；同步路线图与 Q-021～Q-025。仅文档，M2 仍 draft，待 G-Spec-M2 / G-PoC-M2 |
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
| 2026-11-02 | U0-0：补齐统一 dev/打包入口 ADR-028、017 spec/plan/tasks/review 和入口契约草案；仅文档，待 G-Spec-U/ADR 评审，未改运行代码或数据；check 通过 |

## 统一入口实施（2026-11-02）

- 人类文档完成后明确“开始实现”，G-Spec-U / ADR-028 通过；U0-1 → U0-2 → U0-3 先于 M2。
- 已完成 U0-1：task/u0-1-dev-web-foundation，2026-11-02（+08:00）开始；先验证控制消息、固定上游 HTTP/HMR、安全边界、真实 Vite/CSP，再实现；本任务不切换默认入口。check（server 295 / agent 32 / web 26）与 build 通过，真实 Vite/Chromium 热更新与 CSP 验证通过；见 specs/017-unified-entry/acceptance.md。

- 当前 U0-2：task/u0-2-unified-entry，2026-11-02（+08:00）开始；接线统一地址、私有 ready/attach、实际认证、初始化去 5173 特例和失败清理；不修改用户配置/数据。

- U0-2 暂停编码（AGENTS §9）：两次 pnpm check 的 runtime 2 项均在子进程 ready 前退出；同一文件单独运行 2 项通过。真实 PTY normal / dev-normal 通过，dev-web-failure 退出等待超时。已向人类提问是否继续补充脱敏启动诊断、修复关闭通知顺序并按原断言验收；未开始 U0-3，U0-2 代码未提交。

- 人类已明确“继续定位并修复，按原计划验收”，U0-2 恢复 in_progress；保留原断言，先补脱敏诊断并修复通知顺序，不重问同一已授权问题。

- U0-2 已完成：两轮失败按规则暂停后，经人类明确批准继续，定位为 Vite listen(0) 回退 5173 引发并行冲突；改用公开 HTTP listener 的 OS 端口分配，并提前发关闭通知解除退出等待。check（server 297 / agent 32 / web 26）、build、全部 PTY（含 dev 正常/故障/信号）与初始化 smoke 通过。

- 当前 U0-3：task/u0-3-unified-entry-acceptance，2026-11-02（+08:00）开始；可丢弃工作区/同目录/同浏览器真实 dev→打包→dev、Passkey/数据/密钥、HMR 与业务 WS、HTTPS 反代和整体验收；不改用户源码/配置/数据。

- U0-3 自动化完成、状态 review：同目录 HTTP dev→built→dev、HTTPS dev→built 的真实 Passkey/数据/密钥/业务 WS/worker/CSP/HMR、过期/撤销/锁、legacy 一次对齐、built 禁止加载 Vite 均通过。新增 `pnpm test:smoke:unified` 和 CI 接线。
- 验收修复：大型 vendor 兜底内联 map 超限、主题内联脚本 CSP 拒绝、登出后 HMR 匿名探活无法恢复、启动探测响应未消费和已终止子进程重复等待；安全限制/协议/DB/用户数据不变。同代临时缓存由 supervisor 兜底回收。
- 最终自动化：check（server 297 / agent 32 / web 26）、build、统一入口/初始化 smoke、真实 PTY（含 Vite SIGKILL）、Demo 15 / auth 2 / prod 2 E2E 通过；auth/prod 串行。证据和抽查步骤见 specs/017-unified-entry/acceptance.md。仅 macOS 实测，M2 仍 draft；等待人类验收，不将自动化标为切片关闭。

- T0-4：2026-11-02（+08:00），task/t0-4-init-copy，done；按人类直接反馈删除初始化页“不设置管理员密码。”，只改展示文字，check（server 297 / agent 32 / web 26）与 build 通过，统一入口仍 review。

- 2026-11-02 人类明确“验收通过”：统一入口 U0-3 / 017 切片和初始化文案修正 T0-4 验收完成；同步 done 与 G-Task 记录。无进行中实现任务；下一步为 M2 spec 评审，M2 保持 draft，尚未获实现授权。

## M2 草案评审修订：Agent 开发终端（2026-11-02）

- 人类指出一次性操作用 CommandRunner，前后端 dev 应由 Agent 创建项目 Terminal Tab；已在 030 / 契约 / ADR-029 提案中补入启动、输出读取、显式停止、角色去重与 Turn 独立生命周期。
- 新增 M2-4c 规划任务，实施任务共 14 个，验收扩至 A1–A27；尚未实现或授权安装依赖。
- 撤回初稿“所有 PTY 存活期占项目写锁”的建议；dev 进程与编辑并行所需锁保证边界仍须 ADR-029 / G-Spec-M2 明确批准，不修改冻结原文或运行行为。M2 保持 draft。

## R0-0 资源生命周期与服务分工文档（2026-11-02）

- 分支 `task/r0-0-resource-lifecycle-docs`；人类明确规则后要求“补充和完善好文档”，本次仅文档。
- ADR-030 accepted：关闭 / 最小化窗口保留资源，关闭终端 Tab 终止；服务窗口为项目筛选 + 卡片 / 详情，无服务 Tab。临时服务归终端控制，登记展示 / 预览随源退出撤销；持久服务归 PM2，人和 AI 同后端能力。
- 已同步宪法第八条、资源视图 / 服务预览契约、M2/M3 spec / plan / tasks / review、架构 / 术语 / 契约索引、路线图及历史设计修订入口；冻结旧 ADR 原文和 S0 验收历史保留。
- M2 增 AI 完整输入 / 中断 / 人工接管技术草案，M2-4d 单独任务，现为 15 个实施任务、A1–A31；M3 9 个实施任务、S1–S15，均 todo / draft。
- ADR-029 及 M2/M3 技术门禁仍待评审。Q-026 终端执行 / 端口身份核验和 Q-027 TUI / PM2 退出边界未决，不将产品分工接受误记为技术方案或实施授权。
- R0-0 已完成：28 份 Markdown / 136 个本地链接、表格列数、A1–A31 / S1–S15、M2 15 项 / M3 9 项的编号 / todo 状态 / 依赖顺序及 diff 空白检查通过；pnpm check 通过（server 297 / agent 32 / web 26，原 live 测试 1 项按环境跳过）。本次无运行代码 / 依赖 / 数据 / 进程变更，未运行新功能 PoC / build / E2E，不将现有回归视为新功能已实现。

## M2-0 原生资源 PoC（2026-11-02 +08:00）

- 分支 `task/m2-0-native-resource-poc`；先写失败测试，再安装 node-pty 1.1.0 并实施隔离实验。通过安装期 pnpm 补丁修正 macOS spawn-helper 执行位，未替换原生依赖。
- 真实 PTY 输入 / resize / 中断 / 退出、受控进程树 TERM→KILL、取消 / 超时 / 续租失败、文件身份 / 版本 / 最终竞争窗口、watcher 重扫 / 128 句柄限额、重叠根 / workspace、持久恢复阻塞及旧 fencing 保护通过；源码与复制依赖后的临时 built 产物结果一致。
- check（server 301 / agent 32 / web 26，原 live 1 项按环境跳过）、build、真实 TUI 15 场景回归通过。仅实测当前 macOS arm64 / Node 20；无产品 UI / REST / WS / 配置 / 数据迁移变化，运行数据未改。
- M2-0 `review`，G-PoC-M2 待人类确认；不启动 M2-1。PoC 为原型，不宣称终端产品接线、任意脱组清理、外部原子 CAS 或 PID 复用强身份已完成。

2026-11-03（+08:00）完成 M2-0 文档、差异与清理收尾；G-PoC-M2 仍待人类确认具体报告。

## M2-1 启动（2026-11-03 +08:00）

- 人类明确“开始m2-1”，G-PoC-M2 确认通过、M2-0 done。M2-1 in_progress，分支 `task/m2-1-file-manager`。
- 计划：先红测试；完整 UTF-8 文件 / 目录 API、版本 / 路径 / 文件身份保护、共同根冲突锁、持久写意图 / 幂等 / 恢复、四张资源表及共享 DTO。监听 / WS 补拉属 M2-1b，编辑器 UI 属 M2-2，本任务不扩展。

### M2-1 交付（2026-11-03）

- 完整文本与懒加载目录 API、UTF-8 / 大小 / 版本 / fd 身份、同目录替换与暂存清理；共同根冲突锁接 M1 Turn / 文件保存，独立 workspace 同步保护；活跃写时项目登记 / 移除拒绝。
- 0005_resources 新增四张资源表和锁根字段；写意图 / 幂等 / 结果与事件 seq 事务、失败阻塞与启动只读对账，升级保留既有项目 / 锁 / fencing。无正文进入 DB / 事件 / 审计，已知凭据与运行数据读取拒绝。
- 验证：check（server 316 / agent 32 / web 26，live 1 项按环境跳过）、build、临时端口生产浏览器回归 2/2；真实临时文件 / SQLite / 两次配对证据见 acceptance.md。无 UI / 监听 / WS 补拉交付，未修改运行数据。
- 状态 review；后续 M2-1b / M2-2 保持 todo。

## M2-1b 启动（2026-11-03 +08:00）

- 人类在 M2-1 交付后明确“下一步”，M2-1 review 通过并标 done；当前 M2-1b in_progress，分支 `task/m2-1b-file-watching`。
- 先红测试，再接资源事件 REST / 授权文件订阅、128 目录 watcher / 2000 项有界扫描、故障失效 / 重扫、事件保留与补拉 / 背压。手动刷新复用文件 / 目录 GET，编辑器 UI 属 M2-2。


### M2-1b 交付（2026-11-03）

- 文件 / 目录按连接订阅、共享原生 watcher、有界扫描 / 队列、故障 / 替换 / 限额失效及重挂载；通知仅含路径 / 哈希 / 原因，不含正文或已知凭据。
- API 保存和外部变更事件均事务提交后广播；新增授权 REST 补拉、30 天保留与缺口提示，清理保留 stream 序号；慢消费者断开重放。每次订阅需刷新快照，避免遗漏未监听的外部修改。
- check（server 325 / agent 32 / web 26，原 live 1 项按环境跳过）、build、临时端口生产浏览器回归 2/2 通过；真实文件 / SQLite / WS 与故障注入证据见 acceptance.md。无新迁移 / 依赖 / 配置 / UI，未修改运行数据。
- 状态 review；M2-2 保持 todo。本任务手动刷新后端复用 GET，编辑器接线留在下一任务。
