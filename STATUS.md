# STATUS

> 最后更新：2026-11-11 (+08:00)
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。下方的阶段交付与变更记录保留当时状态。

## 当前任务

- **UI-F10 最终答复气泡**：`done`（2026-11-11），分支 `task/ui-f10-final-answer-bubble`。仅为已结束轮次的最终答复正文恢复主题气泡。Web 类型、对话组件和主题浏览器定向检查通过。

- **UI-F9 新对话布局**：`done`（2026-11-11），分支 `task/ui-f9-new-chat`。已实现居中空态、快捷建议和首发 290 ms 落位，必要校验通过，视觉由用户验收。[验收记录](specs/068-ui-fixes/tasks.md#ui-f9-2026-11-11windows)

- **UI-F8 对话执行展示**：`done`（2026-11-11），分支 `task/ui-f8-agent-loop`。沿用工作区主题实现固定状态、工具分类摘要、失败详情入口和正文层级。全量检查、生产构建、Demo 浏览器及认证命令和对话回归通过。[验收记录](specs/068-ui-fixes/tasks.md#ui-f8-2026-11-11windows)

- **UI-F7 操作失败消息**：`done`（2026-11-11），分支 `task/ui-f7-error-messages`。操作失败采用共享浮动消息。文件、Git、自动化与服务登记的认证回归、全量检查、构建和浏览器复验通过。UI-F1～UI-F7 全部完成，详见[验收记录](specs/068-ui-fixes/tasks.md#验收记录)。

- **UI-F6 表单组件统一**：`done`（2026-11-11），分支 `task/ui-f6-form-controls`。10 个业务下拉改为现有 Radix 单选菜单。文本输入、多行输入和复选框使用共享样式。相关浏览器和全量检查通过。

- **UI-F5 自动化空态**：`done`（2026-11-11），分支 `task/ui-f5-jobs-empty-state`。空态在列表可用区域居中，首次读取失败显示错误提示。浏览器和全量检查通过。

- **UI-F4 Header 版本**：`done`（2026-11-11），分支 `task/ui-f4-header-version`。显示启动响应的实际版本，覆盖版本缺失、开发与生产构建浏览器及全量检查。

- **UI-F3 服务关联终端输出**：`done`（2026-11-11），分支 `task/ui-f3-service-terminal-output`。服务日志纯文本视图过滤 VT 序列，分块、刷新和重开回归及 Windows ConPTY 定向 E2E 通过。

- **UI-F2 完全自主确认按钮样式**：`done`（2026-11-11），分支 `task/ui-f2-autonomous-hover`。已采用共享危险按钮样式，亮暗主题悬停、键盘焦点回归及全量检查通过。

- **UI-F1 添加 Key 后刷新**：`done`（2026-11-11），分支 `task/ui-f1-key-refresh`。保存后自动同步目录及失败提示已通过回归、认证定向 E2E 和全量 check。[验收记录](specs/068-ui-fixes/tasks.md#验收记录)
- **M5-F1-R1 Windows 部署产物提交**：`done`（2026-11-11），分支 `task/m5-f1-r1-artifact-rename`。Windows 暂存目录原子重命名偶发 EPERM 时有限重试。部署和运维定向测试 35 项通过，`VITEST_MAX_WORKERS=3 pnpm check` 通过。解除 UI-F1 的部署测试阻塞。

- **M5-F1 Windows 原生支持**：`done`（2026-11-10，Windows 11 x64 实机），分支 `task/m5-f1-windows-support`。
- 范围：Windows 10/11 x64 原生安装、TUI/Server/Web、ConPTY 终端、命令执行、文件/Git/路径、临时服务与预览、PM2 正式服务、定时脚本、锁与日志。
- 结果：Windows 11 build 26200、Node 24.9.0 下 `pnpm check`（server 549、agent 42、web 141 通过；31 个平台条件跳过）、`pnpm build`、平台冒烟、`npm pack` 临时全局安装、源码与 dist TUI、ConPTY 终端、命令、服务/预览、真实 PM2 生命周期、定时脚本、文件/Git 均通过；Mock E2E 19/19、Auth E2E 18/18、生产构建 E2E 18/18。
- 剩余：`M5-F1-W10` Windows 10 x64 1809+ 实机复测（同一实现，仅使用 Windows 10 自带 ConPTY/CIM/taskkill/Get-NetTCPConnection）；Ubuntu 见 `M5-F2`。未验证项不标通过。

## 依赖维护

- DEPS-7 `done`（2026-11-09，`task/deps-7-pnpm`）。比较 pnpm 10 与 12 候选。12 的默认发布年龄策略暂时拒绝现有锁项，验证 10.34.9。 固定 pnpm 10.34.9。pnpm 12.18.0 默认最短发布年龄策略拒绝 5 个未满 24 小时的锁项，保留策略并延后 12。Node 22.23.4 / 24.22.2 冻结锁、check（各 752 通过、11 跳过）、构建、平台冒烟与 npm 临时安装通过。Node 22 并行首轮文件监听超时，单独复跑通过。Node 24 真实浏览器统一入口 HTTP / HTTPS 模式切换通过。最终 outdated 仅余为 Node 22 保留的 @types/node。

- DEPS-6 `done`（2026-11-09，`task/deps-6-toolchain`）。依次验证 TypeScript 7、Vitest 5、tsdown 0.23 后组合升级，保持严格类型、测试语义及四个 Server 产物布局。 TypeScript 7.0.2 移除旧 baseUrl，保留显式 paths；Vitest 5.1.0 定向与全量回归通过；tsdown 0.23.7 保持四入口和原生模块外置。Node 22.23.4 / 24.22.2 冻结锁、check（各 752 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。Node 24 并行首轮文件监听超时，单独复跑通过；生产 Chromium Passkey 通过。

- DEPS-5 `done`（2026-11-09，`task/deps-5-react-router`）。升级 React Router，并按 ADR-056 统一 Node 22 最低版本为 22.22.0。保持配对、鉴权跳转及 SPA 回退。 Node 22.23.4 / 24.22.2 冻结锁、check（各 752 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过；新增 Node 最低版本正反例。Chromium 开发 Passkey 与生产 Passkey / SPA 会话回归通过。

- DEPS-4 `done`（2026-11-09，`task/deps-4-vite`）。升级 Vite 和 React 插件，保持既有浏览器构建目标、受管前端代理和页面行为。 Node 22.23.4 / 24.22.2 冻结锁、check（各 750 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。保留 Vite 7 的浏览器构建目标。Node 24 真实 Chromium 受管 HMR/CSP、Mock E2E 19 项、开发预览和生产 Passkey 定向测试通过。

- DEPS-3 `done`（2026-11-09，`task/deps-3-sqlite`）。升级固定的 better-sqlite3 版本与安装说明，保持应用迁移、数据格式和恢复流程。 Node 22.23.4 / 24.22.2 冻结锁、check（各 750 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。SQLite 12 临时库经 13 读写及 VACUUM INTO 备份后，12 可读回并通过完整性检查。pnpm 跳过其隐式 node-gyp，使用上游包内 Node-API 二进制。Windows / Ubuntu 未实测。

- DEPS-2 `done`（2026-11-09，`task/deps-2-ai-sdk`）。按已批准 ADR-056 升级 AI SDK 与 Provider 包，维持 Agent 执行契约。 Node 22.23.4 / 24.22.2 冻结锁安装、check（各 750 通过、11 跳过）、构建、平台冒烟与 npm 临时安装通过。实际 SDK 的本地 SSE 测试先复现系统消息拒绝，再验证系统消息、工具 schema、续跑结果与用量。真实 Provider 无可用凭据，未运行。

- DEPS-1 `done`（2026-11-09，`task/deps-1-compatible-upgrades`）。当前 semver 范围内升级 16 个直接依赖，另将 tsdown 声明对齐已锁定的 0.21.10。Node 22.23.4 / 24.22.2 冻结锁安装、check（各 748 通过、11 跳过）和平台冒烟通过；Node 24 构建、npm 临时安装、Mock E2E（19 通过）通过。auth / prod E2E 各 15 通过、3 失败：旧计划选择器在升级前锁文件复现，两个终端用例单独复跑通过。跨主版本及跨 0.x 次版本候选见 [ADR-056](docs/adr/ADR-056-dependency-major-upgrades.md)。

## 文档整理

- DOCS-4 `done`（2026-11-09，`task/docs-4-npm-update-security`）。用户明确批准 ADR-055；宪法 1.2 第十二条、ADR-007 索引及升级/恢复指引已同步，更新规范差异关闭。Node 24.22.2 下 `pnpm check`（748 通过、11 跳过）及文档链接检查通过。本任务仅文档。

- DOCS-3 `done`（2026-11-09，`task/docs-3-document-alignment`）。现行契约、阶段、测试、技术栈与历史门禁索引已同步；npm、doctor、平台冒烟统一使用 `22.x || >=24`。Node 24.22.2 下 `pnpm check`（748 通过、11 跳过）、`pnpm build`、`pnpm test:platform`、`pnpm verify:pack` 通过；236 份 Markdown 相对链接与锚点校验通过。未复跑浏览器 E2E、安装或跨平台实机。更新规范冲突已登记为 ADR-055，批准与落实见 DOCS-4。

- DOCS-2 `done`（2026-11-09，`task/docs-2-node-support`）。现行文档统一为 Node.js 22 / 24+，保留实测版本与历史验收记录。npm 查询有 24 个直接依赖存在新版；依赖版本、锁文件、`engines.node` 和 doctor 检查未变。Node 24.22.2 下 `pnpm check`（743 通过、11 跳过）、`pnpm build`、`pnpm verify:pack` 通过。未复跑浏览器 E2E、安装冒烟或跨平台实机。

- DOCS-1 `done`（2026-11-08，`task/docs-1-spec-navigation`）。拆分产品门户与工程入口，核对产品说明、规格状态和当前实现。差异与未验证项见 [遗留问题](docs/open-questions.md)。
- 校验：入口范围、切片索引、改动中的相对链接和 `git diff --check` 通过；Node 24.22.2 下 `pnpm check`（743 通过、11 跳过）、`pnpm build`、npm 包内容验证通过。初次检查使用 Node 20，与本机原生模块 ABI 不匹配，切换 Node 24 后通过。浏览器 E2E、真实 Provider、平台实机未重跑。

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `done` | G2 于 2026-11-05 通过人类统一验收（macOS范围） |
| M3 | 开发服务与隔离预览 | `done` | G3 人类验收通过（2026-11-05）；M3-0～M3-6 完成 |
| M4 | 持久运行与版本发布 | `done` | 2026-11-07 用户验收 G4 与 M4-R0～R4，见 [M4 收尾](specs/050-deploy/closure.md) |
| M5 | 多模型、自动化与更新 | `done` | M5-1a–e / M5-2 / M5-3 / M5-4 / M5-5 `done`；G5 条件通过（2026-11-08） |

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

## 历史交付摘要

- M5-2 `done`（2026-11-08 用户确认当前范围先过）：调度器、脚本 / Agent 任务、自动化面板与验收记录已关闭；Agent 创建 / 修改定时任务明确不在范围。
- M5-2-3 `done`（2026-11-08 当前范围）：自动化任务面板、表单、运行历史、失败角标与 pinned 会话链接已交付；auth E2E `jobs` 通过。
- M5-2-2 `done`（2026-11-08 当前范围）：Agent 定时任务、专用会话、策略快照、超时 / 取消已交付。
- M5-2-1 `done`（2026-11-08 当前范围）：迁移 `0022_scheduler`、调度核心、脚本执行、REST / WS、审计与限额已交付。
- M5-1d `done`（2026-11-07 人类验收）：跨 Provider 上下文中性、切换提示、圆环 hover、回归与验收记录（`specs/063-multi-provider/closure-d4.md`）；M5-1d-1 / 2a / 2b / 2c / 2d / 3 / 4 全部关闭。
- M5-1c `done`（2026-11-07 人类验收，随 M5-1d 关闭）：每次模型请求写 `model.usage`，圆环按所选模型的单次输入 / 同次窗口计算；无统计显示「暂无统计」。
- M5-1e `done`（2026-11-07，分支 `task/m5-1e-process-view`，人类验收）：思考过程默认折叠、单行预览，展开只显示计划与工具；不落库。
- M5-1b `done`（2026-11-07，分支 `task/m5-1b-tool-continuation`，人类验收）：真实 Key PoC 通过；思考模式工具续跑在 Turn 内存回传推理数据，不落库。
- M5-1a `done`（2026-11-07，分支 `task/m5-1a-model-catalog`，人类验收通过）：官方目录、模型与思考档位选择、Turn 快照与 Provider 参数、Composer 两级菜单与设置页已交付。
- M5-1 规格补全（2026-11-07）：用户确认三项决策——旧模型档案全部忽略（保留数据不删除）、思考默认开启、推理数据先实测再定；[061 spec](specs/061-deepseek-integration/spec.md) 转 `ready`，[ADR-053](docs/adr/ADR-053-model-catalog-thinking.md) 记录决策，契约与 [ROADMAP](specs/ROADMAP.md) 已同步。
- M4 / G4 `done`（2026-11-07）。用户确认 M4 与后续修改全部验收通过，并授权合并到 `main`、推送 GitHub。M4-4 与 M4-R0～R4 关闭。当前 Agent 通过普通项目会话执行 PM2 命令，服务运维提供人工控制与当前列表。最终范围与检查见 [M4 收尾](specs/050-deploy/closure.md)。
- M4-3b `done`（2026-11-06，历史实现）。旧接口与工具设计见 [原验收](specs/050-deploy/acceptance-m4-3b.md)，当前命令路径由 ADR-050 定义。

- M4-3 `done`（2026-11-06，分支 `task/m4-3-pm2-runtime`）。交付全局 PM2 检查/补装与私有 `PM2_HOME`、唯一 PM2Adapter、`service_ops_services`/`service_ops_deployments`（schemaVersion 13）、`ServiceOpsRuntime` 首次/替换/健康/回滚/对账、`/api/service-ops/` REST、`service-ops` WS/事件与日志，TUI 受管入口自动初始化。真实 PM2 测试（`pnpm test:pm2:m4`）通过：临时 prefix 复用 7.1.2、TUI 入口、v1→v2、v3 健康失败回滚 v2、停止后对账、日志/事件、合成秘密未进入应用环境/dump/日志。`VITEST_MAX_WORKERS=3 pnpm check`（web 124、agent 33/1 skip、server 488/8 skip；645 passed/9 skipped）与 `pnpm build` 通过。D9/D11 端到端、日常 start/stop/restart、运维 UI/Agent 工具归 M4-3b/M4-4；Q-029 正式 secretRef 注入仍未关闭。详见 [验收](specs/050-deploy/acceptance-m4-3.md)。
- M4-3 边界：只支持 Node 入口、非零停机；真实 PM2 测试安装到临时 prefix 并清理，未改动全局/用户默认 PM2。

- M4-2 `done`（2026-11-06，分支 `task/m4-2-plan-authorization`）。交付独立运维授权/人工审批表与唯一迁移 `0012_deployment_authorizations`（schemaVersion 12）、`DeploymentAuthorizationService`、四策略决策、项目/目标/actor/policySnapshot 作用域、计划撤销/授权撤销/一次性消费/幂等/过期恢复；standard/strict 真实人工批准、readonly 拒绝、autonomous 无审批记录。新增 12 项测试；`VITEST_MAX_WORKERS=3 pnpm check`（web 124、agent 33/1 skip、server 483/7 skip；640 passed/8 skipped）与 `pnpm build` 通过。REST/UI 人工审批入口、apply 前复核、PM2 运行仍归 M4-3/M4-3b，未冒充端到端通过。详见 [验收](specs/050-deploy/acceptance-m4-2.md)。
- M4-2 边界：`consumeAuthorization` 与真实 apply 之间仍有校验窗口，M4-3 必须在持锁执行前再次 `verifyAuthorization`/`verifyPlan`；policySnapshotId 与运维上下文的真实创建/撤销归 M4-3b/Q-030。

- M4-1 `done`（2026-11-06，分支 `task/m4-1-validate-build-plan`）。交付正式目标/构建/不可变产物/发布计划的内部 manager、仓储与唯一迁移 `0011_deployments`（schemaVersion 11）；真实构建、失败/超时/取消、符号链接/限额、环境秘密与日志脱敏、项目锁、Git 来源、计划哈希/过期/篡改/旧新版本、启动恢复共 20 项新测试通过。`VITEST_MAX_WORKERS=3 pnpm check`（web 124、agent 33/1 skip、server 471/7 skip；628 passed/8 skipped）与 `pnpm build` 通过。D2/D3 的 PM2 启动/替换/真实健康、D8 恢复执行仍归 M4-3，未冒充端到端通过；M4-1 无 UI，未跑浏览器。详见 [验收](specs/050-deploy/acceptance-m4-1.md)。
- M4-1 环境说明：DSH `workspace-write` 沙箱拒绝 `/bin/ps` 会使既有 `runCommand` 返回 `STOP_UNCONFIRMED`；最终在允许进程检查的环境复跑通过，与既有 M2-4b 记录一致。

- 2026-11-06 用户确认 G-PoC-M4 通过，并要求按 M4-1 → M4-4 逐任务完成、每个任务提交后继续。M4-0 标 `done`；当前 M4-3 `in_progress`，分支 `task/m4-3-pm2-runtime`，先冻结 PM2Adapter、正式资源/仓储、REST/事件、健康/对账与恢复边界，再写失败测试。

- M4-P 分域规格补充（2026-11-06，分支 `task/m4-p-service-domain-separation`）。按用户要求分离会话开发服务和正式运维的资源、协议、事件、Agent 工具与执行上下文。补充 [ADR-048](docs/adr/ADR-048-service-domain-separation.md) 及 D14–D16，按 M4-1～M4-4 任务落地。文档校验与 `VITEST_MAX_WORKERS=3 pnpm check` 通过，本次为设计更新。

- M4-P 规格补充（2026-11-06，分支 `task/m4-p-service-operations`）。按用户要求将正式 PM2 服务规划为左侧与「自动化任务」同级的「服务运维」，聊天浮窗只展示临时开发服务。已补充 [ADR-047](docs/adr/ADR-047-service-operations-entry.md) 和 D13 验收，UI 归 M4-3b。文档校验和 `VITEST_MAX_WORKERS=3 pnpm check` 通过，本次仅修改规格与契约。

- M4-0 `done`（2026-11-06 20:47 +08:00 开始，分支 `task/m4-0-pm2-poc`）。先写失败测试，后在 macOS arm64 跑通 P1–P5。正常退出和实际 Server SIGKILL 后正式服务保持同一 PID 与 HTTP 健康，重开后从 PM2 重新核验并展示给实验调用者。临时实例已清理。2026-11-06 用户确认 G-PoC-M4 通过。见 [M4-0 证据](specs/050-deploy/poc.md)。
- M4-0 验证通过 `pnpm test:poc:m4`、`VITEST_MAX_WORKERS=3 pnpm check`、`pnpm build`。PM2 信号退出写 dump 的行为已记录为 Q-029，产品秘密注入在 M4-3 开工前处理。

- M4-P `done`（2026-11-06，分支 `task/m4-p-spec-review`）。按用户指定方向更新 ADR-046 与 P1–P5：TUI 初始化检查全局 PM2，缺失时补装；Larness 管理进程异常退出时正式服务继续运行。用户随后确认正常退出也继续运行，重开可查看实际状态。见 [M4 评审包](specs/050-deploy/review.md)。
- M4-P 本轮文档校验通过：本地链接、任务状态、门禁、`git diff --check` 和 `VITEST_MAX_WORKERS=3 pnpm check`（608 通过，3 跳过）。无运行时代码改动，未安装 PM2 或运行 PoC。

- M3-11 `done`（2026-11-06 用户确认本轮前端修改全部验收通过）。交付窗口置顶与收起动画、最小化保留 DOM、右侧资源区点击豁免、终端选 Tab 与画面恢复、预览底栏和成果位置。实现提交 `4f47b3e` 至 `686f649`。见 [验收记录](specs/052-workspace-polish/tasks.md)。

- M3-10 `done`（2026-11-06 用户验收通过，实现提交 `1d9447b`）。已修正 Agent 策略与作用域、终端与服务说明、登记文案和 Git 执行边界。模型上下文与执行层回归列入规格门禁。check、build、Demo 17 项及定向认证 E2E 5 项通过。见 [验收记录](specs/051-agent-tool-contract/tasks.md)。

- 2026-11-06 用户确认 M3-7～M3-9 全部验收通过。汇总见 [M3 收尾记录](specs/040-services-preview/closure.md#g3-后工作区优化验收)。

- [061 DeepSeek 官方接入与上下文用量](specs/061-deepseek-integration/spec.md) 排入 M5-1，依赖 M4 通过 G4。草案待确认默认模型迁移和推理数据保留方案。

- M3-9 `done`（2026-11-06 09:18 +08:00 开始，`task/m3-9-defer-turn-results`）。会话成果在对应 Turn 结束后显示。验证见[任务记录](specs/036-conversation-experience/tasks.md)。

- M3-8 `done`（2026-11-06 09:07 +08:00 开始，`task/m3-8-plan-terminal-state`）。Turn 结束后，计划内最后上报为进行中的步骤停止转圈，显示红叉和「未完成」。验证见[任务记录](specs/036-conversation-experience/tasks.md)。

- M3-7 `done`（2026-11-05 22:54 +08:00 开始，`task/m3-7-workspace-sidebar`）。已修正会话活动指示、每项目折叠与浮栏层级，验证见[任务记录](specs/049-workspace-sidebar/tasks.md)。

- M2 / G2：`done`。2026-11-05 用户明确“所有修改内容验收通过，M2阶段也整体通过”，M2-0～28与M2-24b统一关闭；最终行为、范围、测试与遗留边界见 [M2收尾](specs/030-dev-resources/closure.md)。
- M2-29：本次文档/合并发布收尾，分支 `task/m2-29-acceptance-close`；用户已授权合并到main并push。无产品代码变更，延用必要校验要求。
- R0-1文档任务：用户已明确M3开发预览/M4持久发布，以及自主模式部署免人工；仅同步文档，详ADR-042。
- 已知边界保留：认证E2E批量抖动、Monaco CSP unsafe-eval、Git 3秒轮询、macOS单平台验证；不以验收通过宣称这些问题已修复。
- 以下“变更记录”和逐任务启动/交付段落均为历史记录；其中当时的in_progress、待人类或不合并/push要求，已由本次最终验收和明确发布授权替代。

## M5-1a 启动（2026-11-07 +08:00）

- 用户确认“开始 M5-1a”。分支 `task/m5-1a-model-catalog`，2026-11-07（+08:00）开始。
- 计划：先红测试；迁移 `0015_model_catalog`（目录缓存 + sessions/turns 可空列）、官方目录同步与 REST、Session/Turn 的 model/thinking 校验与快照、Provider `thinking` / `reasoningEffort` 参数、Composer 模型/档位浮层与设置页目录。旧 Profile 保留不删、不再展示。
- 范围：A1–A4、A8–A10；推理数据落库与单次圆环属 M5-1b / M5-1c，本任务不实现。

### M5-1a 交付（2026-11-07）

- 迁移 `0015_model_catalog`：`model_catalog_cache` + `sessions.model/thinking` + `turns.thinking/context_window`，只加表与可空列，旧 Profile 行保留。
- 目录：固定官方端点、Secret Store 取凭据、Zod 校验、按凭据缓存与 `stale` / `lastRefreshError`；`GET /api/models/catalog`、`POST /api/models/catalog/refresh`（认证 + CSRF）；新增 `MODEL_CREDENTIAL_MISSING` / `MODEL_CATALOG_INVALID` / `MODEL_UNSUPPORTED`。
- 选择：Composer 模型 / 档位浮层（默认开启思考，初始「中」；档位 关/低/中/高），设置页凭据 + 目录 + 默认标记；会话保存选择，Turn 快照 provider/model/thinking/window；旧 `modelProfileId` 仅兼容解析。
- Provider：`thinking` / `reasoningEffort`（enabled/disabled；`low`→`low`、`medium`→`high`、`high`→`max`），非法值在调用上游前拒绝。
- 验证：`pnpm check` 通过（server 501 通过 / 10 跳过、agent 34 通过 / 1 跳过、web 130 通过）；`pnpm build`；Demo 19/19；auth E2E `m1` + `conversation` 通过；prod E2E `m1`（首次右键菜单既有抖动，原样复跑通过）+ `conversation` 通过。
- 未验证：真实官方端点同步与真实思考参数——本机无 `DEEPSEEK_API_KEY`，未使用用户已存凭据；思考模式工具续跑与推理数据回传属 M5-1b PoC；单次请求圆环属 M5-1c（当前圆环分母改为目录窗口，分子仍为整轮累计）。
- 偏差：`/api/models` 保留为旧 Profile 查询（UI 不再使用）；项目默认模型档案不再影响新会话；设置页不提供全局默认模型，选择写入当前会话（spec 5.5 已同步）。
- UI 调整（2026-11-07，同任务）：按用户要求精简——底部药丸（模型 + 档位）打开两级菜单：`模型`（按 Key 名称分组的模型列表）与 `思考等级`（关/低/中/高）；不使用滑杆、不显示推荐分组文案。视觉沿用现有菜单 token、字号与圆角。单测覆盖两级选择与模型切换，浅色 / 深色 mock 截图目视通过；2026-11-07 人类验收通过。

## M5-1b 启动与交付（2026-11-07 +08:00）

- 分支 `task/m5-1b-tool-continuation`；用户授权使用本机已配置 DeepSeek Key 做真实 PoC。
- PoC（[证据](specs/061-deepseek-integration/poc-m5-1b.md)，真实 `deepseek-flash`）：同轮工具续跑在回传 / 省略 / 空串 `reasoning_content` 三种请求下均返回 200 `stop`；跨轮历史不带 reasoning 仍可用；流式适配器首步拿到 49B 推理与 `echo` 工具调用，续跑 `finish=stop`。未记录密钥、prompt 或推理正文。
- 实现：`ProviderChunk` 增加 `reasoning-delta`；`ModelMessage.assistant.reasoning` 经 AI SDK `reasoning` part 回传；TurnRunner 每步在内存累积并随 assistant 消息回传给同一 Turn 的后续请求；事件、Turn、日志与 UI 均不含推理正文。
- 验证：`pnpm check` 通过（web 130、agent 35 通过 / 1 跳过、server 502 通过 / 10 跳过）；`pnpm build` 通过。
- 未验证：仅真实验证 `deepseek-flash`；其他模型 / 端点的续跑要求未测。进程重启会中断 Turn，不恢复推理数据。

## M5-1e 交付（2026-11-07）

- 分支 `task/m5-1e-process-view`；用户确认：思考仅当前 Turn 可见、统一执行过程区、默认折叠、折叠行单行预览，展开不渲染完整思考。
- 服务端：新增临时事件 `assistant.reasoning.delta`（无 `sequence`、不写 `agent_events`、不重放），只发给订阅该会话的已认证客户端；TurnRunner 在收到 `reasoning-delta` 时广播，同时继续在同轮内存回传。
- Web：计划与工具合并为「执行过程」区，默认折叠；运行中折叠行显示「正在思考 · <尾部单行预览>」，结束后为「执行了 N 项操作 · X秒」；展开只显示计划与工具，不渲染完整思考。前端仅保留 ≤240 字符的单行预览，不保留完整推理正文。
- 安全：推理正文不写入 SQLite、日志、审计，不进入其他会话或跨模型上下文；刷新 / 重连后消失。
- 验证：`pnpm check` 通过（web 134、agent 35 通过 / 1 跳过、server 502 通过 / 10 跳过）；`pnpm build`；auth E2E `m1`；Demo 19/19。
- 未验证：真实应用目视与截图待用户验收；mock/Demo 未注入 reasoning，仍不显示思考块。

## M5-1c 交付（2026-11-07）

- 分支 `task/m5-1c-request-usage`；每次模型请求完成且有 usage 时，TurnRunner 在事务内写入 `model.usage` 事件（seq 递增）并广播，payload 只含 `turnId/model/inputTokens/outputTokens/totalTokens/contextWindow`。
- Web 维护按模型的最新单次用量；圆环使用「所选模型的最近一次单次输入 ÷ 同次窗口」，无匹配时显示「暂无统计 · 模型窗口 X tokens」；整轮累计仍由 `turn.completed.usage` 提供。
- 验证：auth E2E `m1` 断言 `单次输入：12,000 / 1,048,576`（E2E Provider 现在回传 usage 与目录窗口）；Demo 19/19；`pnpm check` 通过（web 135、agent 35 通过 / 1 跳过、server 503 通过 / 10 跳过）；`pnpm build` 通过。
- 未验证：真实官方端点的 usage 口径（PoC 未覆盖流式 usage）；旧会话无 `model.usage` 时按「暂无统计」处理。

## M5-1d 规格草案（2026-11-07）

- 分支 `task/m5-1d-multi-provider-spec`；新增 [063 规格](specs/063-multi-provider/spec.md)、[plan](specs/063-multi-provider/plan.md)、[tasks](specs/063-multi-provider/tasks.md)，仅文档。
- 范围：GLM / OpenAI-compatible Provider、多 Key 分组与凭据绑定、能力矩阵、上下文压缩（70% 触发 + 结构化摘要 + 降级）、跨模型切换。
- 待确认：D1 是否新增 `@ai-sdk/openai-compatible`；D2 兼容端点是否允许任意公网 HTTPS；D3 压缩阈值 / 摘要模型；D4 是否允许跨 Provider 迁移。
- 未写代码、未迁移数据库；D1–D4 确认后转 `ready` 并开始 M5-1d-1。

## M5-1d-1 交付（2026-11-07）

- 分支 `task/m5-1d-multi-provider-spec`；D1–D4 确认后 063 转 `ready`。
- 依赖：`@ai-sdk/openai-compatible@2.0.91`（兼容 ai 6 / Node 20；先前 v3 要求 Node 22 已回退）。
- Provider：`createCompatibleProvider`（GLM / 通用兼容）复用现有 `streamText` 与消息 / 工具映射；GLM 固定 `https://open.bigmodel.cn/api/paas/v4`；缺 Key 失败关闭；禁止 HTTP 重定向。
- 端点安全：`assertSafeEndpoint` 校验 HTTPS、凭据、环回 / 私网 / 链路本地 / 元数据 / 内部域名，并对 DNS 解析结果逐一检查；测试覆盖 IPv4 / IPv6 / 混合解析。
- 枚举：`ModelProviderId`、凭据 API、Web 类型扩展 `glm`。
- 验证：`pnpm check`（web 135、agent 38 通过 / 1 跳过、server 507 通过 / 10 跳过）；`pnpm build`。
- 未验证：真实 GLM 端点 / 目录与工具调用（待 Key）；端点安全尚未接入凭据 / Profile 创建与目录刷新（d-2）。

## M5-1d-2a 交付（2026-11-07）

- 分支 `task/m5-1d-multi-provider-spec`；迁移 `0016_multi_provider`：`sessions/turns.credential_profile_id` 可空列（schemaVersion 16）。
- 目录：`GET /api/models/catalog` 增加 `groups`（保留扁平字段指向最新组）；刷新遍历所有 DeepSeek / GLM 凭据，按组记录 `stale` / `lastRefreshError`，失败不覆盖旧缓存；GLM 目录走官方兼容端点（内置窗口表，未知窗口不可选）。
- 绑定：`PATCH /api/sessions/:id` 与 `POST /api/sessions/:id/turns` 接受 `credentialProfileId`；Turn 快照凭据，Provider 解析按快照选择 DeepSeek / GLM 适配器；同一模型出现在多个 Key 时要求显式选择。
- 验证：`pnpm check`（web 135、agent 39 通过 / 1 跳过、server 510 通过 / 10 跳过）；`pnpm build`；auth E2E `m1`；Demo 19/19。
- 未验证：真实 GLM 端点 / 目录；多 Key 选择 UI、能力矩阵与自定义兼容端点（d-2b）。

## M5-1d-2b 交付（2026-11-07）

- 分支 `task/m5-1d-multi-provider-spec`；模型选择器按 `catalog.groups` 渲染「Provider · Key」分组，选择同时绑定 `credentialProfileId`；设置页同步分组，并可切换 DeepSeek / GLM 添加 Key。
- 能力展示：模型行显示窗口与思考档位（未知窗口不可选）；GLM 暂按“不支持思考档位”展示，能力矩阵细化留待后续。
- 选择与发送：Session / Turn 携带凭据；切换 Key 后圆环按该模型最近一次用量显示，不串用其他 Key。
- 验证：`pnpm check`（web 135、agent 39 通过 / 1 跳过、server 510 通过 / 10 跳过）；`pnpm build`；auth E2E `m1`；Demo 19/19。
- GLM 实测（2026-11-07）：官方目录只返回 id / object / created / owned_by，不含窗口；已按官方文档补齐内置窗口（4.5/4.5-Air 128K；4.6/4.7/5/5.1 200K；5.2/5.3 1M），仍未收录的 5-turbo/5.3-flash* 保持未知并禁用。真实对话返回 429，上游内容为 `1113 余额不足或无可用资源包`，已映射 `PROVIDER_QUOTA_EXHAUSTED`（402）并显示充值提示，不再误报限流。
- 设置弹窗按服务运维风格重构为全局「Key 列表 → Key 详情 / 添加 Key」，只管理 Key、模型显示与默认模型（`model_defaults`，新会话继承），不再读写会话；模型行眼睛图标控制是否出现在会话选择器（迁移 0017 `model_visibility` + PATCH 接口），输入框选择器过滤隐藏模型；窗口未知的模型默认从列表和会话选择器隐藏，可点「显示不可用」查看。
- 未验证：GLM 真实工具调用（账户需充值 / 资源包）；自定义兼容端点（d-2c）。

## M5-1d-2d 交付（2026-11-07）

- 思维模式：`CatalogModel.thinking.mode` 支持 `toggle`（关/开）、`levels`（关/低/中/高）、`mandatory-levels`（低/中/高，不能关）。
- GLM 映射：4.5 / 4.5-Air / 4.6 / 4.7 / 5 / 5.1 为开关；5.2 为档位；5.3 为强制档位（低/中/高 → `low` / `high` / `max`）。
- 服务端默认值：开关默认开、强制档位默认高、普通档位默认中；切换模型时 UI 自动修正非法档位。
- 请求：兼容适配器通过 providerOptions 发送 `thinking: { type }`，档位模型附加 `reasoning_effort`；DeepSeek 路径不变。
- 验证：`pnpm check`（web 135、agent 40 通过 / 1 跳过、server 512 通过 / 10 跳过）；`pnpm build`；auth E2E `m1`；Demo 19/19。
- 真实目录刷新验证：4.5/4.5-Air 128K；4.6/4.7/5/5.1/5-Turbo 200K；5.2/5.3/5.3-Flash/FlashX 1M；思考模式分别为 toggle / levels / mandatory-levels。GLM 目录模型现已全部可选。
- 未验证：GLM 真实对话（账户余额不足），只验证了请求组装与目录能力。

## GLM 对齐审计（2026-11-07）

- 逐项核对官方文档与代码：12 个模型的窗口、思考模式、默认值和请求参数已锁定在 `GLM_BUILTIN_CATALOG`，并由 `catalog.test.ts` 全表断言防漂移。
- 4.7：开启时强制思考，但允许 `thinking.type=disabled`（4.7 页面示例），因此保持 `toggle`；5.3 / 5.3-Flash / 5.3-FlashX / FlashX-Legal 不允许关闭，使用 `mandatory-levels`（默认高 → `max`）；5.2 支持 `reasoning_effort`，使用 `levels`。
- 适配器：GLM `reasoning: true`、`vision: false`（图片输入未开放）；`maxContextTokens` 128K 仅作保守缺省，实际窗口来自目录。
- 文档：063 spec 转 `ready` 并补 GLM 能力表；REST 契约更新 `groups` / `thinking.mode` / `visible`；GLM 固定端点为 bigmodel.cn，z.ai 区域 Key 归 d-2c。
- 未验证：真实 GLM 对话仍受账户余额限制；真实工具调用待充值后复测。

## GLM Coding Plan 端点修复（2026-11-07）

- 根因：用户 Key 是 Coding Plan 套餐。标准端点 `open.bigmodel.cn/api/paas/v4` 返回 `429 / 1113 余额不足`，Coding 端点 `open.bigmodel.cn/api/coding/paas/v4` 与 `api.z.ai/api/coding/paas/v4` 均 200。
- 新增 `credential_profiles.endpoint`（迁移 0019）与 `PATCH /api/credentials/:id`；设置页 Key 详情可切换「标准 / Coding Plan × 国内 / 国际」。审计确认设置切换本身写入成功；真正的问题是 `start.ts` 的 ProviderResolver 漏传 `endpoint`，导致对话仍走默认标准端点。已修复并加回归测试（`providerResolver.test.ts`）。
- 真实冒烟（本机 Coding Key，经真实 resolver + 工具）：GLM-4.6 回复「正常」、reasoning 正常；`echo` 工具调用 1 次、0 错误；GLM-5.3 / 5.3-Flash 均返回正常。
- 配额错误不再附加端点提示文案（按用户要求移除）。
- 验证：`pnpm check`（web 135、agent 40/1、server 516/10）、`pnpm build`、auth E2E `m1`。

## 长任务被 120 秒超时截断修复（2026-11-07）

- 现象：GLM 生成 SVG / 长推理时在约 120–126 秒出现「已停止当前执行」。
- 根因：Provider 默认 `timeout` 为 120 秒；AI SDK 超时被归类为 `PROVIDER_ABORTED`，Turn 再把它当成用户取消，显示「已停止当前执行」。
- 修复：DeepSeek / 兼容 Provider 默认超时提升到 10 分钟；非用户取消的 `PROVIDER_ABORTED` 改为 `FAILED / PROVIDER_UNAVAILABLE`，提示「执行超时或连接中断，请重试」；用户主动停止仍为 CANCELLED。新增回归测试。
- 验证：`pnpm check`（web 135、agent 40/1、server 517/10）、`pnpm build`。

## M5-1d-2c 交付（2026-11-07）

- 兼容 Provider：`credential_profiles.endpoint`（0019）+ `context_window`（0020，默认 128K）；设置页可添加 / 编辑端点、窗口，目录与对话都使用该端点。
- 安全：创建 / 修改端点经 `assertSafeEndpoint`（HTTPS、公网、拒绝凭据与重定向），Turn 开始前再次校验；目录请求同样校验。
- 目录：兼容 `/models` 解析后以凭据窗口补齐；未知窗口不再禁用；模型可选、可设默认、可控制显示。
- 验证：`pnpm check`（web 135、agent 40/1、server 519/10）、`pnpm build`、auth E2E `m1`。
- 未验证：真实第三方兼容端点（无凭据）；工具调用能力取决于上游，未做能力探测。

## M5-1d-3 交付（2026-11-07）

- 触发：上下文估算 ≥ 窗口 70% 且存在可压缩历史（保留最近 12 条）；同一 Turn 只压缩一次。
- 摘要：当前 Turn 模型、无工具、20 秒超时；输出结构化段落（目标 / 已完成 / 待办 / 失败验证 / 资源 ID / 待审批）；保存 `session_context_summaries`，事件 `context.compressed` 先持久化再广播。
- 拼装：`system + 最近非降级摘要 + covered_up_to_seq 之后的最近消息 + 当前 Turn`；失败保存 `degraded=1` 空摘要并沿用截断，UI 显示「上下文已压缩（降级）」。
- 安全：摘要经 `OutputRedactor` 处理后存储；不写事件、日志或审计正文；会话删除级联清理。
- 验证：`pnpm check`（web 135、agent 40/1、server 522/10）、`pnpm build`、auth E2E `m1`。
- 未验证：真实长会话触发的端到端 UI / 摘要质量（单元测试覆盖触发、成功、降级、无历史）。

## M5-1d-4 交付（2026-11-07）

- 跨模型切换：Composer 选择器显示「已切换到 …」提示；Session / Turn 快照新模型与凭据；上下文只使用 user / assistant 文本，不含推理或厂商私有字段。
- 圆环：hover 显示单次输入 / 模型窗口 / 百分比的简单提示（Radix Tooltip），未知统计显示「暂无统计 · 模型窗口」。
- 回归：`pnpm check`（web 135、agent 40/1、server 523/10）、`pnpm build`、auth E2E `m1`、Demo 19/19。
- 验收记录：`specs/063-multi-provider/closure-d4.md`；真实第三方兼容端点、GLM 图片输入、真实长会话压缩质量列为未验证。

## M5-1d 验收（2026-11-07）

- 用户确认 M5-1d 验收通过；M5-1d-1 / 2a / 2b / 2c / 2d / 3 / 4 由 `review` 转 `done`，063 spec 关闭。
- 验收依据：[closure-d4.md](specs/063-multi-provider/closure-d4.md) 的矩阵；`pnpm check`（web 135、agent 40 通过 / 1 跳过、server 523 通过 / 10 跳过）、`pnpm build`、auth E2E `m1`、Demo 19/19。
- 保留未验证边界：真实第三方兼容端点、GLM 图片输入、真实长会话压缩质量；不以验收通过宣称已验证。
- M5-1c 随本轮验收一并关闭（2026-11-07 人类确认）。

## M5-2 规格确认与启动（2026-11-07）

- D1–D4 已确认：脚本内联源码 + 子进程 node；Agent 默认 `readonly`、`autonomous` 二次确认；每任务一个隐藏专用会话；错过触发默认 `skip`、可按任务 `run_once`。
- [064 Scheduler](specs/064-scheduler/spec.md) 转 `ready`；`cron-parser@5.10.4` 与仅应用内通知随之采用。ADR-054 与 REST / WS / 数据模型契约同步。
- M5 验收（2026-11-08）：用户确认全部验收通过，M5-1a–e / M5-2 / M5-3 / M5-4 / M5-5 关闭，G5 条件通过。Windows / Ubuntu 支持承诺保留；实机验证与 Windows 终端/命令/PM2 实现列为发布后跟踪（M5-F1/F2/F3），未验证项不标通过。
- M5-5 `done`：[安全复核](docs/security/review.md)、[发布清单](docs/process/release.md)、[已知限制](docs/known-limitations.md)、安装文档与 [G5 记录](specs/067-release-hardening/acceptance.md)。
- M5-4 `done`（2026-11-08）：macOS 当前范围通过，发布后任务见 [遗留问题](docs/open-questions.md#发布后任务与待验证项)。
- M5-3 `done`（2026-11-08）：`larness@0.1.0` 已发布到公共 npm；包发布、TUI 更新提示、升级前备份、Node 20/22/24 与安装冒烟通过。
- M5-3-3 `done`（2026-11-08）：迁移前自动备份、5 份保留、备份失败中止、schema 降级拒绝已交付。
- M5-3-1 `done`（2026-11-08）：公共 npm `larness@0.1.0`、MIT、`bin`、files、根运行时依赖、发布模式与 `npm pack` / 临时全局安装冒烟已交付。

## M5-2 验收（2026-11-08）

- 用户确认当前范围先过；M5-2-1 / 2-2 / 2-3 / 2-4 全部关闭，064 spec 转 `done`。
- Agent 创建 / 修改定时任务保持非目标（NG-7）；本轮询问后不追加该能力。
- 未验证项保留：真实 Agent Provider 定时任务、人工取消时延、系统休眠 / 唤醒、失败角标 E2E、100 任务上限、浅色 / 深色视觉；不以验收通过宣称已验证。

## M5-2-4 整体验收记录（2026-11-07）

- [验收记录](specs/064-scheduler/acceptance.md)：A1–A12 矩阵；`pnpm check`（web 141、agent 40/1、server 553/10）、`pnpm build`、Demo 19/19、auth E2E `jobs` 通过。
- 全量 auth E2E 15/18：2 个 terminals 用例单独重跑通过（既有批量抖动）；`conversation.spec.ts` 仍是 M5-1e 之前的计划选择器，单独重跑失败，属既有测试债务，未在本切片修复。
- 未验证：真实 Agent Provider 定时任务、人工取消时延、系统休眠 / 唤醒、失败角标 E2E、100 任务上限、浅色 / 深色视觉。
- M5-2 于 2026-11-08 按当前范围关闭；未验证项保留。

## M5-2-3 交付（2026-11-07）

- 面板：左侧「自动化任务」打开列表 / 详情；支持创建、编辑、启停、立即执行、删除确认、运行历史、取消运行、失败角标。
- 表单：项目、Cron / 间隔、IANA 时区、超时、错过策略、脚本源码、Agent 提示词 / 策略 / 模型；`autonomous` 必须确认风险。
- 通知：`workspace.jobs.changed` 使 Web 重拉任务；失败角标来自 `summary.failedLast24h`，打开面板后本地清除。
- Agent 运行可从历史打开专用会话（pinned session，普通工作区同步不会重置）。
- 验证：Web 141 项、auth E2E `jobs`（创建 → 立即执行 → 刷新后历史 → 删除）通过；`pnpm check` / `pnpm build` 待 M5-2-4 汇总。
- 未验证：浅色 / 深色截图、人工视觉验收、真实 Agent 任务 UI 运行。

## M5-2-2 交付（2026-11-07）

- Agent 任务创建时建立 `sessions.origin='scheduled'` 专用会话，标题「自动化 · <name>」，继承默认模型并写入任务策略；普通会话列表不显示，任务详情可按 ID 打开。
- `AgentJobExecutor` 用 `job:<runId>` 幂等键创建 Turn，经 TurnQueue 执行并轮询终态；超时 / 取消调用 `cancelTurn`，映射 succeeded / failed / timed_out / cancelled / interrupted。
- 策略只允许 `readonly` / `autonomous`；修改任务同步会话策略，下一次 Turn 生效；任务归档同时归档会话。
- 测试：Agent 成功 Turn、readonly 上下文、超时、取消、运行时注入；`pnpm check`（web 135、agent 40/1、server 553/10）与 `pnpm build` 通过。
- 未验证：真实 Provider 长时间任务、真实人工取消确认；UI 已由 M5-2-3 交付，待人工验收。

## M5-2-1 交付（2026-11-07）

- 迁移 `0022_scheduler`（schemaVersion 21 → 22）：`scheduled_jobs`、`scheduled_job_runs`、`sessions.origin`；只新增，旧会话默认 `user`。
- 调度：5 字段 Cron / 间隔、IANA 时区、DST、`skip` / `run_once`、overlap `skipped`、全局并发 2、超时、取消、启动恢复、200 条 / 30 天保留。
- 脚本：内联源码写数据目录临时 `.mjs`，`node` 子进程在项目真实根目录执行；环境白名单、输出 64 KiB + 脱敏、POSIX 进程组终止；明确非沙箱。
- REST：`/api/jobs` 列表 / 详情 / 创建 / 修改 / 归档 / 立即执行 / 运行历史 / 取消 / summary；认证 + CSRF + 项目边界 + 审计 + 限额；`workspace.jobs.changed` 通知。
- 会话：普通列表默认过滤 `origin='user'`；任务专用会话按 ID 可读。
- 验证：`pnpm check` 通过（web 135、agent 40 通过 / 1 跳过、server 549 通过 / 10 跳过）；`pnpm build` 通过；`test/jobs` 26 项通过。
- 边界：Windows 脚本任务不支持（M5-4）；休眠 / 真实任务 UI 尚未验证；真实 Provider 长时间 Agent 任务待 M5-2-4。

## 已冻结

- 产品与安全边界：`CONSTITUTION.md`
- 技术栈：`docs/architecture/stack.md`
- 决策记录：`docs/adr/DECISIONS.md`
- 任务顺序与门禁：`specs/ROADMAP.md`
- **可信设备凭据：Passkey / WebAuthn（ADR-021）；不签发长期设备 Token**
- **全局资源与 Tab 归属：`docs/contracts/resource-views.md`（2026-11-01）**
- **产品名与内部命名空间：Larness / `@larness` / `LARNESS_*`（ADR-022）**

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-07 | M5-1 规格补全：061 转 `ready`，ADR-053 记录模型目录 / 思考档位决策，契约与路线图同步 |
| 2026-11-06 | 用户验收 M3-11 工作区前端交互优化，完成任务收尾 |
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
- M3-3 完成（2026-11-05）：PreviewRegistry、HTTP/WS 固定上游、票据/grant、resolve API、`preview.port` 配置与事件撤销通过真实测试；见 [验收](specs/040-services-preview/acceptance-m3-3.md)。
- M3-3b 完成（2026-11-05）：Host/路径/重定向/管理 API 与 Cookie/票据重放过期/会话撤销/退登/限额/请求体/WS 无 grant 负例通过；DB 故障仅以会话撤销验证，见 [验收](specs/040-services-preview/acceptance-m3-3b.md)。
- M3-4 完成（2026-11-05）：独立 iframe 预览、票据 POST、Browser Tab 去重/布局恢复、Agent `resolve_service_preview` L0 与时间线卡片完成；真实 Vite 7 E2E 验证 HMR、相对 `/api`、无直连端口与预览后 Ctrl+C 退登。见 [验收](specs/040-services-preview/acceptance-m3-4.md)。
- ADR-045（2026-11-05）：临时服务支持独立“删除登记”（不杀进程）与“停止服务”（终止已验证监听进程树、保留 Shell）；新增 DELETE/stop API 与 UI 确认。
- ADR-044（2026-11-05）：按人类要求，登记不再限制绑定地址；通配监听可登记，预览按已核验地址拨号，访问失败显示不可用；身份/票据/隔离不变。
- M3-6 历史 review（2026-11-05，已被 G3 通过取代）：整体材料见 [closure.md](specs/040-services-preview/closure.md)；`pnpm check`、build、服务与预览 E2E 单项通过；红测修复完成；conversation 最终答复隐藏的真实 UI 回归已修；services/files/default-workspace/git 与 Demo 旧断言已对齐现行行为。auth E2E 15/15（含两客户端）、Demo 16/16。

## M3 完成 / G3 通过（2026-11-05 +08:00）
- 人类确认 G3 通过：M3-6 标 `done`，M3 关闭；远程独立注册域 HTTPS 仍标未验证，留待上线实验。
- 最终证据：`pnpm check` 446 / 2 skipped、`pnpm build`、auth E2E 15/15、Demo E2E 16/16；服务/预览真实 Chromium E2E 通过。
- 收尾材料见 [closure.md](specs/040-services-preview/closure.md)；分支 `task/m3-1-registration` 已合并回 `main`（45f343e）并推送 `origin/main`。
- 下一步：M4 规格评审，不在本轮自动开始实现。
