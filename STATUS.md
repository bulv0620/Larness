# STATUS

> 最后更新：2026-11-05 (+08:00)
> 当前阶段：**G-PoC-M3 已通过；M3-1/M3-2 已完成（2026-11-05）；M3-3 预览网关进行中（远程 HTTPS 延后，未验证）**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `done` | G2 于 2026-11-05 通过人类统一验收（macOS范围） |
| M3 | 开发服务与隔离预览 | `in_progress` | G-Spec-M3 通过（2026-11-05）；M3-0 进行中，G3 待验收 |
| M4 | 持久运行与版本发布 | `draft` | 全部PM2/正式发布，依赖G3及Q-003/Q-027 |
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

- M2 / G2：`done`。2026-11-05 用户明确“所有修改内容验收通过，M2阶段也整体通过”，M2-0～28与M2-24b统一关闭；最终行为、范围、测试与遗留边界见 [M2收尾](specs/030-dev-resources/closure.md)。
- M2-29：本次文档/合并发布收尾，分支 `task/m2-29-acceptance-close`；用户已授权合并到main并push。无产品代码变更，延用必要校验要求。
- R0-1文档任务：用户已明确M3开发预览/M4持久发布，以及自主模式部署免人工；仅同步文档，详ADR-042。
- 当前无进行中的M2功能任务。M3：G-Spec-M3 已于 2026-11-05 按推荐批准（040 spec `ready`、ADR-043 `accepted`、Q-002/Q-026 确认），仅 M3-0 已授权，正在实施；G-PoC-M3 通过后才可 M3-1。
- 已知边界保留：认证E2E批量抖动、Monaco CSP unsafe-eval、Git 3秒轮询、macOS单平台验证；不以验收通过宣称这些问题已修复。
- 以下“变更记录”和逐任务启动/交付段落均为历史记录；其中当时的in_progress、待人类或不合并/push要求，已由本次最终验收和明确发布授权替代。

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
| PM2 交付方式 | Q-003在M4 PoC冻结，未默认选择依赖方案 | M4 开始前 |
| 仓库许可证 | 未定，暂不添加 LICENSE | 公开发布前 |

完整列表见 [docs/open-questions.md](docs/open-questions.md)。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-03 | M2-4b 验收通过（人类要求开始 M2-4c）；补跑 check / build / prod 6/6 / Demo 15/15，记录 workspace-write 沙箱 `/bin/ps` 限制 |
| 2026-11-03 | 完成 M2-8 自动化汇总：check / build / Demo / init / unified / TUI 通过，prod 8/9；G2 候选待人类 |
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


## M2-2 启动（2026-11-03 +08:00）

- 人类在 M2-1b 交付后明确“下一步”，M2-1b review 通过并标 done。当前 M2-2 in_progress，分支 `task/m2-2-file-editor`。
- 先红测试，再接真实文件树 / 完整编辑、realpath 去重、监听失效、保存 / 冲突 Diff / 重载 / 手工合并、草稿与关闭确认、授权文件结果卡片；不开始 M2-3。


### M2-2 暂停定位（2026-11-03 +08:00）

- 按 AGENTS §9.5 标 blocked，分支 `task/m2-2-file-editor`；实现未提交，未开始 M2-3。已保留原断言，不删除或跳过测试。
- 已实现待验收：真实目录 / 文件 Query、编辑与内存草稿、版本冲突 / Diff / 手工合并、脏 Tab 关闭提示、文件订阅与补拉失效、Agent file target 与打开卡片、realpath 去重。当前不宣称这些功能已完整通过真实浏览器。
- 已验证：首次红测试缺 actions 模块；草稿 / 去重 2 项与冲突组件 1 项通过，既有 Web 总计 28 项在新增组件前通过；Server TurnRunner 11 项通过（含先红后绿的 file target 断言）；两次构建通过。最新跨 scope 展示修正尚未重跑全量检查 / 构建。
- 真实 Chromium：首次因 Monaco native EditContext 零尺寸输入节点失败；切换公开 textarea 输入后节点可见。其后两次均在“2500 行文件跳至末行”断言失败：ControlOrMeta+End 和按宿主 macOS 选 Meta+ArrowDown 后，`.view-lines` 仍显示 line 0–24，尚未运行保存 / 冲突的后续浏览器步骤。截图在 test-results，运行日志 `/tmp/larness-m2-2-files-e2e.log`。
- 待人类确认：建议继续检查浏览器实际平台 / Monaco 按键映射及焦点，保留末行与真实保存 / 冲突断言；不把静态渲染或单测当 UI 验收，不缩减标准。另一选项为保持暂停、先审查当前未提交差异。


- 2026-11-03 人类明确“继续”，M2-2 恢复 in_progress；继续原断言定位浏览器实际平台 / 焦点，完成后续真实保存和冲突验收，不重复请求相同授权。

### M2-2 交付（2026-11-03）

- 真实文件树懒加载 / 分页与刷新，完整 Monaco 多 Tab / realpath 去重，内存草稿 / BOM / CRLF、版本保存、冲突 Diff / 重载 / 手工合并与脏关闭确认；窗口关闭保留内容，刷新前提示，不存正文到本地布局。
- 已开文件 / 目录订阅与补拉只失效 Query；文件删除后拒绝保存但保留草稿。成功 Agent 修改附 file target，单工具 / 折叠工具组均显示卡片，点击授权打开当前文件并去重，不重执行修改。
- 先按 AGENTS 暂停，经人类“继续”后定位并完成：Monaco 按浏览器 UA 选按键，Diff 先脱离再释放模型；原断言 / 页面错误检查保留。最终验证及失败记录见 acceptance.md。
- check（server 325 / agent 32 / web 31，原 live 1 项按环境跳过）、build、生产浏览器 3/3、Demo 15/15 通过。既有 PoC 原生通知一次超时，原用例单独 4/4 与最终全量复跑均通过，未改 PoC。
- 无新依赖 / 迁移 / 配置 / 认证变更，未修改用户运行数据。状态 review，等待人类 UI 验收；M2-3 未开始。


## M2-3 启动（2026-11-03 +08:00）

- 人类在 M2-2 交付后明确“继续”，M2-2 review 通过并标 done；当前 M2-3 in_progress，分支 `task/m2-3-command-runner`。
- 先红测试，再实现受管命令进程组、环境过滤、超时 / 取消 / 续租失败清理、有界脱敏输出与游标、command_executions 唯一迁移、共同锁 / 写意图 / 重启阻塞及授权状态 / 输出 / 取消 API。Agent 工具与 UI 属 M2-3b。

### M2-3 交付（2026-11-03）

- 命令执行底座：真实子进程组、环境过滤、预算 / 超时 / 取消、跨块脱敏 / 输出上限 / 游标；同一 Turn 工具重试幂等，scope 从真实会话推导。原组长退出后仅经本代成员启动快照复核才继续发信号，无法确认停止保持根阻塞。
- 共同根锁与 inherited Turn 锁 / fencing、持久执行意图及事务事件；重启只读对账，不向持久 PID 发信号。唯一 0006_commands 新表迁移，输出 7 天 / 安全终态元数据 30 天，保留序号；授权状态 / 输出 / 取消 API、command.status 订阅 / 补拉。
- check（server 340 / agent 32 / web 31，原 live 1 项按环境跳过）、build、生产浏览器最终 3/3；首次 M1 右键菜单未出现，原样全套复跑通过，未改 UI / 断言，原因未证实。真实命令 / 子进程树 / SQLite / REST / WS / 失败注入 / 恢复证据及边界见 acceptance.md。
- 仅实测当前 macOS / Node 20；不宣称 OS 沙箱、原子 PID 身份或任意脱组清理。无新依赖 / 配置 / 认证 / IPC 变更，未修改用户运行数据。状态 review，M2-3b 工具 / 审批 / 实时卡片未开始。


## M2-3b 启动（2026-11-03 +08:00）

- 人类明确“下一步”，M2-3 review 通过并标 done；M2-3b in_progress，分支 `task/m2-3b-agent-commands`。
- 先失败测试，再接 run_command 的逐次风险 / 参数审批、真实客户端 / Turn 策略快照、预算 / 取消 / inherited lock；命令状态与有界脱敏输出卡片、实时通知 / 游标补拉和显式取消。不创建终端 Tab，不启动 M2-4。

### M2-3b 交付（2026-11-03）

- run_command 已接真实 Turn：窄 L1 项目脚本分类、默认 L2 逐次审批 / L3 拒绝，规范化参数与真实客户端 / 策略快照 / 根绑定，启动前重验；Turn 剩余预算 / AbortSignal / 有效 inherited lock，运行续租与取消审批失效。
- 持久 tool.command.created 关联先于 spawn；命令结果向模型返回有界脱敏 JSON 摘要。输出落文件后推 command.output，卡片按游标增量读取、250ms 合并失效 / 2s 活动补偿，支持刷新恢复 / 显式取消 / 退出码 / 原因 / 截断 / 缺口；不创建终端 Tab。
- check（server 354 / agent 32 / web 32，原 live 1 项按环境跳过）、build、生产浏览器最终 4/4、Demo 15/15 通过。新增真实 Agent 命令测试 14 项和卡片组件测试 1 项；运行 / 结果画面人工查看通过，详细证据见 acceptance.md。
- 无新依赖 / 迁移 / 配置 / 认证 / IPC 协议或通用命令创建接口，未修改用户运行数据。当前 macOS 范围；不宣称沙箱或任意脱组清理。状态 review，下一任务 M2-4 保持 todo。


## M2-4 启动（2026-11-03 +08:00）

- 人类明确“下一步”，M2-3b review 通过并标 done；M2-4 in_progress，分支 `task/m2-4-terminal-manager`。
- 先失败测试，再实现真实 PTY / 范围与全局 workspace、持久状态 / 游标 / 轮转、连接绑定输入租约与 generation / 重放保护、resize / terminate / 重启恢复；唯一 terminals / terminal_leases 迁移，dev 程序 / 参数 / role 底座。xterm 界面、Agent 启动工具和 AI 输入接管留给后续任务。


### M2-4 交付（2026-11-03）

- 真实 PTY / scope / 全局 workspace、持久幂等 / 状态 / 独立输出游标，内部 dev 程序 / 参数与活跃 role 去重；不长期占源码写锁，活跃资源保护项目登记 / 移除。唯一 0007_terminals / terminal_leases 迁移，旧数据 / fencing / seq 保留。
- 人工输入租约绑定实际客户端 / WS 连接 / 订阅、30s TTL / generation / inputSequence；只接受持有者 input / resize，重放不重复按键；断线 / 登出 / 到期释放输入权而保留 PTY。输出跨块脱敏、短提示符即时显示、1 MiB 环 / 10 MiB 每资源 / 100 MiB 总配额、7 天输出 / 30 天安全终态元数据。
- 核对 PTY session 中的前台 job / 后代组再 TERM→KILL；未知进程 / 结果提交失败 / 重启均保持屏障，终态和屏障双重落库失败时内存根受阻仍阻止新写，不用持久 PID 杀无关进程。Server 关闭先停止真实 PTY并落库，再关 SQLite。
- check（server 373 / agent 32 / web 32，原 live 1 项按环境跳过）、build、生产浏览器 4/4、真实 built 受管入口 PTY / 认证 WS 输入输出 / 清理冒烟通过。16 项终端集成、1 项迁移、2 项新增提示符测试与平台边界见 acceptance.md。
- 无新依赖 / 配置 / IPC / 认证协议，未修改用户运行数据；仅实测 macOS arm64 / Node 20.19.3，不宣称沙箱、强 PID 身份或任意脱组清理。状态 review；M2-4b xterm、M2-4c Agent dev 工具、M2-4d AI 控制 / 接管未开始。

## M2-4b 实施（2026-11-03）

- 人类明确“开始M2-4b任务”，确认 M2-4，当前 M2-4b in_progress。分支 task/m2-4b-terminal-ui，2026-11-03（+08:00）开始。
- 计划：先真实双浏览器失败测试，再接终端列表/创建确认、xterm、连接绑定租约、回放恢复、关闭 Tab 终止；check/build 与浏览器验收，单任务提交。

- 首次暂停时状态：blocked，未提交。check 通过（server 373 / agent 32 / web 33，原 live 1 项跳过）、build 通过；两项先红后绿的测试覆盖关闭窗口保留 Tab、真实写锁占用 DTO。
- 红测试：真实模式没有“打开终端窗口”；窗口 close 丢失 Tab；writeBlocked 字段缺失。已实现入口、列表/创建确认、xterm/租约/回放、Tab 终止失败保留与源码写占用。
- 实现后浏览器第 1 次：getByRole("dialog") 同时匹配创建确认框与终端窗口；已改为创建确认框名称。第 2 次：观察者的“打开终端 term_…”同时匹配侧栏与窗口入口，尚未修改。两次分别停在 terminals.spec.ts 创建确认与观察者打开步骤，尚未验证真实输入/双端回放/终止完整链路。
- 建议继续：将测试选择器限定到明确窗口，保持双客户端/真实 PTY/失败保留原断言；继续检查输入序号在同代租约重新 acquire 时的保持、租约续期失败后的显式释放，补到期/撤销/隐藏恢复证据，完成契约/验收与提交。替代方案为先人工 review 当前未提交 diff，再继续。按 AGENTS §9.5 暂停后未继续编码。
- 本次测试使用独立端口 3324（3210 已有实例，未停止），测试服务器由 Playwright 清理；无用户数据迁移或新增依赖。

- 人类明确“继续”，解除 M2-4b 暂停；保留验收要求，继续定位修复并完成交付。

### M2-4b 交付（2026-11-03）

- 已完成真实列表/创建确认、xterm/resize、只读观察与控制者/到期提示、10s 续租、断线/刷新回放、关闭窗口恢复与关闭 Tab 真实终止；源码写占用来自既有根冲突判断。
- 修复续租失败后无法显式释放的问题，保持同代输入序号；未知停止/恢复状态不移除 Tab。两次人类“继续”后按原验收完成定位；全套测试选择器限定到终端窗口/输出，避免既有会话和已清理项目干扰。
- 最终：check（server 373 / agent 32 / web 34，原 live 1 项跳过）、build、Demo 15/15、生产浏览器 6/6 通过；两浏览器真实 PTY 与真实30s TTL证据见 acceptance.md。
- 状态 review，等待人类 UI 验收；无新增依赖/迁移/配置，未修改用户数据，M2-4c 未启动。仅记录 macOS arm64 / Node 20.19.3 / Chromium。

### M2-4b 验收（2026-11-03）

- 2026-11-03 人类要求开始 M2-4c，M2-4b review 通过并标 done；真实终端 UI / 双客户端 / 租约 / 窗口恢复进入验收记录。
- 复跑证据：`pnpm check`（server 373 / agent 32 / web 34，live 1 项跳过）、`pnpm build`、`pnpm test:e2e:prod` 6/6、Demo 15/15；截图为本机临时验收产物，不进入版本库。
- 环境注意：在 DSH `workspace-write` 沙箱下，子进程无法启动 `/bin/ps`（EPERM），会使终端创建 / 命令停止确认误报为 `STOP_UNCONFIRMED` / INTERRUPTED；在允许进程检查的环境重跑后全部通过，这不是产品回归。验收需在允许该检查的环境执行。
- 无源码 / 配置 / 用户数据变化，工作区保持 `d187ce3`。

## M2-4c 启动（2026-11-03 +08:00）

- 人类明确“开始m2-4c”；M2-4b 验收通过并标 done。分支 `task/m2-4c-agent-terminals`，当前 in_progress。
- 计划：先红测试，再注册 `start_project_terminal` / `read_terminal_output` / `stop_project_terminal`，接真实 Turn 上下文、逐次 L2 启动审批、项目绑定、role 去重、有界游标读取、显式停止确认与发起客户端来源 Tab；不启动 M2-4d。

### M2-4c 交付（2026-11-03）

- 三个工具接入真实 Turn：start L2 逐次审批并绑定规范化程序 / 参数 / cwd / role / 项目 / 会话 / Turn / 客户端 / 策略；read L0 返回脱敏游标页并限制工具 JSON；stop L1 只停止当前项目 Agent 创建的 dev 终端。同项目 role 同参数复用并标 `reused`，不同参数 CONFLICT；human Shell / 跨项目 ID 拒绝。
- 终端工具 opt out 源码写锁（`requiresProjectLock:false`），dev 进程仍按 ADR-029 是主机写者；已交付终端不随 Turn 完成 / 取消停止，创建未交付时 AbortSignal 清理。工具事件附 terminal target 与 `originClientSessionId`；发起客户端实时插入非聚焦 Tab，其他客户端只失效列表，历史重放不复活已关闭 Tab，卡片点击才聚焦。
- 先红后绿：Server 3 项真实 PTY 集成；Web 新增 terminal target / 非聚焦 / 发起客户端过滤测试；新增 `e2e-auth/agent-terminals.spec.ts` 真实双审批、两个来源 Tab、FRONT_READY、只读观察，并在结束时终止 PTY / 移除临时项目。
- 最终：check（server 376 / agent 32 / web 37，live 1 项跳过）、build、生产浏览器 7/7、Demo 15/15。全套复跑出现 auth 撤销跳转 `/pair` 时序抖动（auth 单独稳定，未改认证代码），第 3 次全套 7/7 通过并记录。无新迁移 / 依赖 / 配置，未改用户数据；仅 macOS arm64 / Node 20.19.3 / Chromium。
- 2026-11-03 人类“确认并继续”，M2-4c 验收通过并标 done。

## M2-4d 启动（2026-11-03 +08:00）

- 人类确认 M2-4c 并继续；M2-4c done。分支 `task/m2-4d-agent-control`。
- 计划：先红测试，再接 `acquire_terminal_control` / `send_terminal_input` / `interrupt_terminal` / `release_terminal_control`、agent principal、Turn 结束释放控制、人工原子接管、UI 控制状态；不启动 M2-5。

### M2-4d 交付（2026-11-03）

- Agent principal 租约：30s TTL、活跃 Turn 续租、Turn 完成 / 取消 / 登出 / 过期清除；输入按 generation + inputSequence 去重 / 跳号拒绝，单 Turn 64 KiB/s；输入正文不进审批 scope / 审计 / 事件 / 日志。
- 四个工具接入真实 Turn：acquire L1、send L2、interrupt L2（ETX，不伪报退出）、release L1；中断 / 输入摘要只显示目标与字节数，审批哈希绑定实际 data。Turn 结束只释放控制，PTY 继续；创建未交付仍由 M2-4c 清理。
- 人工接管 `POST /api/terminals/:id/takeover`：仅当前订阅活连接，agent / 空闲租约原子转 human，generation 递增、序号归零；另一 human 拒绝强抢。UI 显示“AI 控制中 / 接管控制 / 你正在控制”，旧 Agent generation 失败且不自动抢回。
- 新增 3 项真实终端控制测试与真实浏览器接管场景；最终 check（server 379 / agent 32 / web 37，live 1 项跳过）、build、生产浏览器 8/8、Demo 15/15。无新迁移 / 依赖 / 配置 / 认证协议，未改用户数据；仅 macOS arm64 / Node 20.19.3 / Chromium。
- 2026-11-03 人类“确认并继续”，M2-4d 验收通过并标 done。

## M2-5 启动（2026-11-03 +08:00）

- 人类确认 M2-4d 并继续；M2-4d done。分支 `task/m2-5-git-manager`。
- 计划：先红测试，再实现 Git 结构化读（status / diff / log / branches）、显式 add / commit / 分支 / ff-only pull / push、人工资源动作审批 / 幂等 / 快照重验、Agent 同 Manager 工具与 `resource_actions` 一份迁移；UI 属 M2-5b。

### M2-5 交付（2026-11-03）

- `packages/resources/src/git`：execFile 无 Shell、环境过滤、禁外部 diff / textconv，porcelain v2 / log / branches 解析，路径 / 分支校验，快照版本；错误映射 GIT_UNAVAILABLE / GIT_CONFLICT / GIT_AUTH_REQUIRED。
- 人工动作 REST：status / diff / log / branches、actions、decision、execute；L1 / L2、5 分钟、单次消费、锁后快照重验、幂等终态；唯一 0008_resource_actions 迁移，v7→v8 保留项目 / 锁 / stream。
- Agent 10 个 Git 工具：读 L0、add / commit / 分支 L1、pull / push L2，经 Turn 审批与同一 Manager；写锁 executionId 带 turn + toolCall，释放后不阻塞后续写。
- 真实仓库 / bare remote 测试覆盖特殊文件名、显式暂存、审批 / 过期 / 快照、ff-only / 非快进 / 脏工作区、外部 diff、锁冲突、Git 不可用与 API 鉴权；最终 check（server 388 / agent 32 / web 37，live 1 项跳过）与 build 通过；全套 E2E 7/8，唯一 auth 既有抖动，Demo 15/15。Git UI / WS 事件 / 浏览器证据留在 M2-5b，状态 review。

## M2-5b 启动（2026-11-03 +08:00）

- 人类确认 M2-5 并继续；M2-5 done。分支 `task/m2-5b-git-ui`，当前 in_progress。
- 目标：Git 资源区（真实 status / staged / unstaged / untracked）、Diff、选择性 add / commit、分支列表与操作、pull / push 计划 / 审批 / 执行 / 失败态；模型离线可用。

### M2-5b 交付（2026-11-03）

- 真实 GitPanel 接 M2-5 API：状态轮询、staged / unstaged / untracked / conflicts、显式路径暂存、仅暂存内容提交、分支创建 / 切换、L2 pull / push 审批 / 拒绝 / 执行一次；错误重查，不自动 stash / merge / reset。
- Diff 窗口只读展示统一 Diff；真实模式不显示服务 / Browser 假入口；组件测试 + 真实 Chromium 仓库流程通过，截图 `larness-m2-5b-git.png`。
- 修复 branches/log 路由未 await 导致服务端 unhandled rejection；最终 check（server 388 / agent 32 / web 39）、build、prod 8/9（唯一 auth 既有抖动）、Demo 15/15。无新依赖 / 迁移 / 配置；git WS 事件仍待 M2-6 统一资源失效。

### M2-6 交付（2026-11-03）

- viewKey / createdAt 覆盖文件 realpath、终端 ID、Git Diff 项目 + 路径；Git staged / worktree 复用同一视图，不同项目同路径独立；布局 v3 迁移补身份、修正 activeTab、移除空窗口，并在真实模式清理 Demo 终端 / 服务 / Browser 与无元数据 Tab。
- 真实模式顶部仅文件 / 终端并恢复已有窗口；Git Diff 关闭 / 窗口隐藏无资源副作用；Git 区仍 3s 轮询。最终 check（server 388 / agent 32 / web 41）、build、Git 真实浏览器通过；全套 / Demo 在 M2-8 汇总。

### M2-7 交付（2026-11-03）

- 新增跨资源锁集成测试：同根文件保存 / Git 动作互斥、无重叠根并行、旧 handle 续租 / 释放失败与新 fencing、释放后重试；既有命令 / 终端 / 文件 / 重启 / TUI 用例作为 A12/A17–A20/A23 证据。
- 无新锁表 / 迁移 / 配置；M2-8 汇总全套并等待人类 G2。

### M2-8 交付汇总（2026-11-03）

- check 389 / agent 32 / web 41、build、Demo 15/15、init / unified / TUI PTY 全部通过；生产浏览器 8/9，唯一失败为既有 auth 撤销 `/pair` 抖动（auth 单独通过，连续全套复跑均出现，未改认证代码）。
- 统一入口 smoke 首次暴露 dev Vite zod eval 与 built Monaco TS worker eval 的 CSP 冲突；dev 允许 `blob:` + `unsafe-eval`，生产允许 `'unsafe-eval'`（无远程脚本）。这是安全姿态变更，需人类 review；未自行放行 G2。
- A1–A31 映射、平台边界与 G2 已知项见 [acceptance.md](specs/030-dev-resources/acceptance.md)。M2 状态保持 `in_progress`，M2-8 review，G2 待人类验收 / 纠错。

## M2-15 验证暂停（2026-11-04 +08:00）
- M2-14已提交2c8d4cc；M2-15主体代码未提交，分支task/m2-15-conversation-ui。中央消息/过程/计划、底部审批、Composer、小资源浮栏已实现；后端审批确认前不乐观成功，跨会话延迟响应隔离，工具调用ID按Turn区分。
- 当前check通过（server403 / agent32 / web58），build通过；新增对话/审批组件及store/reducer15项针对性通过。之后补充了浏览器场景/选择器与末尾计划更新不遮蔽答复修正，最终check/build仍须复验。
- Demo浏览器第1轮14/15：旧演示会话已有pending审批，新发送按钮按批准设计禁用，原测试先发送再批准的顺序超时；已改为先断言禁用、批准、再发送。
- Demo第2轮14/15：同用例在“部署成功”的exact文本定位超时，已批准文本可见；需核查产物标题与描述合并的DOM定位及后续流式最终文本。未删除/跳过/放宽断言。按AGENTS §9.5暂停编码，等待用户确认继续。
- 建议：保持审批禁止发送和真实产物断言，核实标题语义元素/选择器后修复，重跑Demo与生产conversation/command/M1/文件/终端回归、截图检查、最终check/build，再更新验收并提交。M2-15不宣称完成，G2不变。无用户数据迁移/依赖变化。

- 2026-11-04 用户明确“继续”，解除M2-15验证暂停；按原断言完成定位和剩余验收。

### M2-15 交付（2026-11-04）
- 用户确认继续后，修复产物标题语义、既有header/逐轮过程测试定位；相关生产11项分批通过，Demo15/15、最终独立check（403/32/58）、build通过。并行负载触发的3项既有PTY5秒超时在串行check全部通过，未改时限/断言。
- 真实任务计划已在M2-14提交2c8d4cc，M2-15完成中央对话/审批/Composer/资源浮栏与滚动/窄屏；新增命令元数据展示在Manager验证及脱敏后持久化。无新依赖/迁移；G2仍待人类，不进入M3。
- 上述暂停记录为历史，当前无本任务阻塞；实现与测试已交付，等待用户体验反馈。截图及详细边界见036验收。

## M2-16 交付（2026-11-04）
- 保持对话结构，复用外围主题色/浅灰canvas/共享Button/柔和阴影，淡蓝消息、蓝色主操作、语义状态和小型资源图标。无后端/权限/依赖/数据变更。
- 主题一致性先红后绿，check（403/32/58）、build、Demo16/16通过；浅/深/736/390/320px及coarse-pointer44px检查通过。G2仍待用户最终UI/安全验收。

## M2-21 交付（2026-11-04 +08:00）
- `done`；分支 task/m2-21-agent-terminal-close。Agent 成功停止后同步移除发起客户端对应 Tab / 浮栏计数，失败保留；不改变其他客户端布局。按用户要求仅做必要校验，用户自行界面验收。
- stop 成功完成事件附真实关闭目标与发起客户端；实时/补拉/历史加载均核对 GET 终态后移除本地 Tab，最后一个收起，保留其他项目焦点。停止/查询失败不误删；其他客户端保留结束视图。
- 必要校验：前端 34/34、服务端终端工具 3/3、Web/Server 类型及改动文件 Biome/diff 通过；见 specs/043-agent-terminal-close/acceptance.md。无全量检查/构建/E2E，G2 仍待人类。

## M2-22 交付（2026-11-04 +08:00）
- `done`，task/m2-22-agent-shell；Ctrl+C / 初始命令退出后保留终端并进入交互 Shell，显式关闭才清理整个终端。按用户直接授权补 ADR-038；只做相关必要校验，用户自行界面验收。
- 新 Agent dev 使用固定位置参数 Shell 引导，Ctrl+C/初始命令退出后保留同一 PTY 并进入账户默认 Shell；原有终端不重建。明确终端存活不等于服务 ready，role 复用不重跑初始命令。显式关闭/审批/租约/未知停止隔离不变。
- 必要验证：Server 相关资源与 Agent 33/33、Web 关闭/入口 32/32、Server 类型、改动 Biome/diff 通过；见 specs/044-agent-shell/acceptance.md。未跑全量检查/构建/E2E；G2仍待用户。

## 工作区体验续作（2026-11-05 +08:00）
- 用户已授权定时自动实施四项，按 M2-23→26 顺序；当前 M2-23 in_progress，task/m2-23-welcome。必要校验，等待统一验收，不合并/push，不通过 G2。
- M2-23 实现完成：欢迎图形与四个建议，点击只填草稿/聚焦；相关组件 8/8、Web 类型/Biome/diff 通过。待用户统一验收。
- M2-24 in_progress：task/m2-24-window-actions，窗口关闭确认/脏文件和共用最小化动画。
- M2-24 完成：三种文档窗口关闭全部 Tab（确认/草稿保护），所有最小化共用 200ms 收起动画/减少动态兼容；16 项组件和状态测试、Web 类型/Biome/diff 通过，待统一验收。
- M2-25 in_progress：task/m2-25-autonomous-policy；风险确认后的完全自主策略，新 Turn 快照、后端执行与必要边界测试。
- M2-25 完成：完全自主盾牌/风险确认，后端 autonomous 枚举/策略/Turn快照接入；Agent 7、Server 15、Web 10项及三包类型/Biome/diff通过。仍有鉴权/范围/锁/租约/审计与秘密保护，待用户统一安全验收。
- M2-26 in_progress：task/m2-26-compact-git，文件/Git互斥展开、Git目录树/行暂存和底部操作栏。
- M2-26 完成：互斥 flex 分区/折叠动画，Git提交区/分组目录树/行暂存/底部推拉分支刷新，非仓库灰占位；6项相关测试及Web类型/Biome/diff通过。四项均为实现完成待统一验收，README/G2未改，不合并/push。
- M2-24b in_progress：动画复核发现需要保留 react-rnd transform，并使重新打开取消收起；必要小修，独立提交后完成本轮交付。
- M2-24b 完成：保留窗口原位移的收起动画、重新打开取消动画、避免干净文件关闭闪现脏文件框。最终跨四项相关 Web61/61、Agent7/7、Server15/15及三包类型/改动格式/diff通过。全部本地提交，工作区清洁后交用户统一验收；未合并/推送，README里程碑验收状态不变。

## M2-27 交付（2026-11-05 +08:00）
- done，task/m2-27-git-file-actions：保留暂存，增加逐文件放弃（确认）/取消暂存；补真实后端动作与必要测试，统一验收/合并/push仍待用户。
- M2-27完成：行放弃确认与取消暂存，后端真实资源动作/目标内容快照/精确路径，保留index与worktree分层语义；Server12/Web7项、三包类型及改动格式/diff通过。见046验收，仍待用户统一验收，不合并/push。

## M2-28 交付（2026-11-05 +08:00）
- done，task/m2-28-git-feedback：去掉Git空态重试、刷新busy文字行，以原按钮忙状态反馈，实际失败/审批保留。必要校验，统一验收/合并/push仍待用户。
- M2-28完成：Git不可用仅灰占位，刷新忙状态只在图标按钮中呈现，去掉busy整行文字；8项相关组件、Web类型/格式/diff通过。实际失败/审批保留，待统一验收。

## M2-29 / G2 整体关闭（2026-11-05 +08:00）
- 用户明确通过全部修改与M2整体；所有M2切片状态done，文档/契约入口已同步。已授权合并main并push；不自动启动M3。最终验收见030/closure.md，已有测试与已知边界据实保留。
- 收尾必要检查：全仓Biome（458文件，保留4 warning/1 info）、全workspace类型、文档链接110处、M2切片状态与M3 draft一致性、diff检查通过；本次未重跑全量单元/构建/E2E。

## R0-1 M3/M4边界与自主部署文档（2026-11-05）
- done，task/r0-1-service-deploy-boundary；产品方向已批准，ADR-042、规格/计划/任务、契约、架构与文档入口已同步。M3七个活动任务，M4六个，旧M3-5/5b迁移映射保留；完全自主覆盖已授权业务能力，包含部署且无人工关卡。
- 必要文档校验：本地链接、任务依赖无环/编号迁移、策略一致性、草案状态及diff通过；见 [验收记录](specs/048-service-deploy-boundary/acceptance.md)。本次无代码/运行时变更，未运行构建、业务测试或PM2实验。M3/M4仍draft，技术规格/PoC/实现未启动；本次仅本地提交。

## M3-P 技术规格评审（2026-11-05 +08:00）
- done（评审材料），task/m3-p-spec-review；用户要求开始规格审批。已整理Q-002/Q-026推荐方案、接口/数据/配置候选、真实PoC证据与失败回退边界，见[评审包](specs/040-services-preview/review.md)。仅文档；ADR-043 proposed、040 spec draft，等待人类确认G-Spec-M3，仅先授权M3-0；G-PoC后才能M3-1。
- 必要校验：本地链接、Markdown表格、七个实施任务todo/依赖无环、候选/草案状态与diff通过。未运行代码测试/构建/浏览器/进程实验，无新依赖/配置/数据变更。本地提交，不合并/推送。

## G-Spec-M3 通过 / M3-0 启动（2026-11-05 +08:00）
- 人类“按推荐批准吧，远程验证可以放到后续上线实验”。G-Spec-M3 通过：040 spec `ready`、ADR-043 `accepted`、Q-002/Q-026 移入已解决；仅授权 M3-0，G-PoC-M3 确认后才 M3-1。
- 范围分级：M3-0 交 P1/P2 执行与监听身份、P3 本机隔离来源/票据/Cookie、P4 真实 Vite/HMR/开发 API、P5 故障与策略证据；远程独立注册域 HTTPS 延后至上线实验，本轮明确标未验证，不冒充 G-PoC/G3 通过。
- 当前 M3-0 `done`（G-PoC 2026-11-05 人类确认）；M3-1 启动，分支 `task/m3-1-registration`；先失败测试，真实 PTY/loopback/浏览器证据，临时数据与进程结束清理。
- 本次文档同步：040 spec/plan/tasks/review、ADR-043、m3-preview 契约、open-questions、ROADMAP、STATUS。
- M3-0 完成（2026-11-05，`review`）：新增 `apps/server/scripts/m3-poc/{identity,gateway}.ts` 与 4 个 PoC 测试文件；P1–P5 共 12 项真实测试通过（PTY 身份/端口复用、本机隔离来源/票据/Cookie、真实 Vite 7 HMR/相对 API、限额/故障/重启、请求体上限与慢读者隔离、策略映射），证据见 [poc.md](specs/040-services-preview/poc.md)；新增 `pnpm test:poc:m3`。
- M3-0 边界：远程独立注册域 HTTPS 未验证（人类决定延后至上线实验）；check-to-connect 残余窗口已实测；登记策略/慢消费者/真实 DB 属 M3-1。`pnpm check` 暴露的既有 web 关闭断言已按 M2-24 现行行为对齐（仅测试），未改产品代码。G-PoC-M3 未提交，M3-1 未开始。

## G-PoC-M3 通过 / M3-1 启动（2026-11-05 +08:00）
- 人类确认 G-PoC-M3：接受 M3-0 的 12 项真实证据、残余竞态窗口、Vite 7.3.7 实际版本及远程 HTTPS 延后；M3-0 标 done。
- M3-1 `done`（2026-11-05，分支 `task/m3-1-registration`）：登记/查询/退登/幂等、resource-action、Agent 工具、WS 事件与重启失效均完成，见 [验收](specs/040-services-preview/acceptance-m3-1.md)。下一步 M3-2 服务卡片/详情 UI。
- M3-1 完成（2026-11-05）：迁移、共享 schema、身份适配、ServiceManager、resource-action 分派、服务 REST、App/1 秒对账、Agent 工具、WS 事件完成；终端关闭连带退登、重启失效、DB 事件失败回滚均有真实测试；`pnpm check` server 435 / 2 skipped、Web 全通过。
- M3-2 完成（2026-11-05）：服务窗口（卡片/详情/日志/打开终端/结束提示/L2 登记审批）组件测试 + 真实 Chromium E2E 通过；修复项目删除未清理 services/resource_actions 的外键回归。见 [验收](specs/040-services-preview/acceptance-m3-2.md)。
- M3-3 完成（2026-11-05）：PreviewRegistry、HTTP/WS 固定上游、票据/grant、resolve API、`preview.port` 配置与事件撤销通过真实测试；`pnpm check` server 440 / 2 skipped。见 [验收](specs/040-services-preview/acceptance-m3-3.md)。M3-3b 安全矩阵进行中。
