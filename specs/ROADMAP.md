# 路线图与任务总表

> 状态：2026-10-31 初始化。任务状态：`todo | in_progress | blocked | review | done`。  
> 规则：只执行依赖全部 `done` 的最小任务；一次一个任务；里程碑门禁未过不进入下一阶段（人类明确并行除外）。

## 1. 里程碑

| 阶段 | 名称 | spec | 状态 | 门禁 |
|---|---|---|---|---|
| S0 | 视觉 Demo（纯前端 + Mock） | [000](000-visual-demo/spec.md) | `done` | G-S0 通过（2026-11-01） |
| M0 | 工程底座与可信启动 | [010](010-foundation/spec.md) | `done` | G0 通过（macOS 范围，2026-11-01）；Linux / Windows / CI 后续 |
| M1 | 项目、会话与最小 Agent | [020](020-workspace-agent/spec.md) | `done` | G1 通过（2026-11-01，人类验收） |
| M2 | 开发资源与窗口层 | [030](030-dev-resources/spec.md) | `draft` | G2 |
| M3 | 本机服务与 Preview | [040](040-services-preview/spec.md) | `draft` | G3 |
| M4 | 部署闭环与权限加固 | [050](050-deploy/spec.md) | `draft` | G4 |
| M5 | 多模型、自动化与更新 | [060](060-extension/spec.md) | `draft` | G5 |

关键路径：

```text
D0-1 → … → D0-9 → M0-1 → … → M0-9 → M1-1 → … → M1-15
→ M2-1 → … → M2-8 → M3-1 → … → M3-6 → M4-1 → … → M4-4
→ M5-1 → … → M5-5
```

## 2. S0 视觉 Demo

目标：用真实前端栈构建可交互、可验收的视觉基线；数据全部来自 MockGateway，不实现后端。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| D0-1 | Web 工作区脚手架 | pnpm workspace、`apps/web`、`packages/ui`、`packages/shared`、Tailwind、Biome、Vitest、Playwright、MockGateway 骨架 | — | `done` |
| D0-2 | 应用外壳与三栏布局 | AppShell、TopBar、左侧栏、中央会话区、右侧资源栏骨架、窗口层挂载点 | D0-1 | `done` |
| D0-3 | 主题与视觉系统 | 语义 token、浅 / 深 / 跟随系统、字体层级、图标、菜单层级 | D0-2 | `done` |
| D0-4 | 对话时间线与输入区 | 消息、计划、工具卡片、产物卡片、审批卡片、Composer（上下文 / 模型 / 审批策略） | D0-2 | `done` |
| D0-5 | 右侧资源分区 | 文件 / 服务 / 终端 / Git 四分区、全部 / 单项 Tabs、独立折叠滚动、拖分隔线、双击均分、键盘调整 | D0-2 | `done` |
| D0-6 | 窗口层 | WindowManager、拖动 / 缩放 / 层级 / 置顶 / 最小化 / 最大化 / 关闭、顶部入口恢复 | D0-2 | `done` |
| D0-7 | 资源窗口内容 | 文件（Monaco 只读）、终端（fake 输出）、服务（状态 / 日志）、浏览器（iframe 占位）、Git Diff | D0-6 | `done` |
| D0-8 | 响应式、键盘与可访问性 | 窄屏降级、Ctrl+K / Ctrl+B / Esc、焦点可见、ARIA、无遮挡菜单 | D0-3 ~ D0-7 | `done` |
| D0-9 | Demo 验收与视觉基线 | Playwright 冒烟与截图、验收清单、人类验收记录 | D0-8 | `done` |

## 3. M0 工程底座与可信启动

目标：`node app.js` 可启动；本机 TUI 初始化；浏览器经 TUI 配对准入；`允许本次` 得短期会话，`始终允许` 必须注册 Passkey；所有业务接口默认拒绝。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| M0-1 | Server 与 workspace 扩展 | `apps/server`、`packages/{shared,agent,resources}` 占位、Fastify、统一脚本、CI、`/api/health` | D0-9 | `done` |
| M0-2 | 配置、数据目录与日志 | 数据目录解析、`config.json` + Zod、canonical origin / RP ID 推导、pino、`doctor` / `status` | M0-1 | `done` |
| M0-3 | SQLite、迁移与审计 | Drizzle schema、迁移器、WAL / 外键、审计、Passkey 表、repository 基类 | M0-2 | `done` |
| M0-4 | 本机 IPC 与 TUI 初始化 | UDS / Named Pipe、JSON 协议、init 流程、管理员凭据、TUI 骨架 | M0-3 | `done` |
| M0-5 | 配对申请与准入 | 配对状态机、TUI 审批、一次性码、allow_once 会话、trust enrollment | M0-4 | `done` |
| M0-6 | Passkey 注册与登录 | WebAuthn options / verify、challenge、设备 / credential、TUI 撤销 | M0-5 | `done` |
| M0-7 | 鉴权与传输安全 | Session / CSRF / Origin、限流、WS 鉴权、错误码、失败关闭用例 | M0-6 | `done` |
| M0-8 | Web 认证集成 | `/login`、`/pair`、Passkey 注册 / 登录、路由守卫、登出、撤销跳转 | M0-7 | `done` |
| M0-9 | 稳定入口与 M0 验收 | `app.js`、静态托管、优雅关闭、构建、M0 门禁测试 | M0-8 | `done` |

## 4. M1 项目、会话与最小 Agent

目标：登记项目、创建会话、发送任务，Agent 用文件工具读写项目并流式返回；刷新 / 重连恢复；切模型只影响下一轮。

| ID | 任务 | 主要产出 | 依赖 | 状态 |
|---|---|---|---|---|
| M1-1 | 项目登记与路径授权 | projects 表 / API、realpath 校验、Git 检测、删除仅解除关联 | G0 | `done` |
| M1-2 | 会话、Turn 与事件存储 | sessions / turns / agent_events、seq、重放 API、崩溃标记 | M1-1 | `done` |
| M1-3 | Provider 适配与 FakeProvider | ProviderAdapter、能力声明、FakeProvider、DeepSeek 适配 | G0 | `done` |
| M1-4 | 工具注册与审批引擎 | ToolRegistry、list / read / search / patch、L0–L2、项目写锁、审计 | M1-1, M1-2 | `done` |
| M1-5 | Turn Runner 与状态机 | QUEUED→…→COMPLETED、预算、取消、项目锁续租、事件写入 | M1-2, M1-3, M1-4 | `done` |
| M1-6 | 实时对话 UI | Query + WS、乐观 / 重放、工具卡片、审批卡片、错误态 | M1-5, M0-8 | `done` |
| M1-7 | 模型 Profile 与 SecretStore | 凭据加密、模型配置、下一轮切换、密钥脱敏 | M1-3 | `done` |
| M1-8 | M1 验收与 E2E | 项目 → 任务 → 刷新恢复 → 切模型 → 取消；G1 门禁 | M1-6, M1-7 | `done` |
| M1-9 | 项目目录选择器 | 本机只读目录浏览 API + 项目对话框目录树 | M1-1 | `done` |
| M1-10 | 流式对话与 Markdown | assistant.delta 广播、进行中状态、GFM 渲染 | M1-6, M1-7 | `done` |
| M1-11 | 工作区布局与工具分组 | header 品牌、侧栏重排、工具折叠、资源栏折叠、上下文用量 | M1-6, M1-7 | `done` |
| M1-12 | 自动会话标题 | 首条消息生成标题，保留手动重命名 | M1-2 | `done` |
| M1-13 | 侧栏右键操作 | 项目 / 会话右键重命名、归档 / 移除 | M1-2, M1-9 | `done` |
| M1-14 | 仅展示最终答复 | 中间助手段落折叠隐藏，只保留每 Turn 最终文本 | M1-6, M1-10 | `done` |
| M1-15 | 草稿会话 | 新建先显示本地草稿，首条消息后才创建后端会话 | M1-2, M1-6 | `done` |

## 4.1 G1 后初始化修复（2026-11-02）

按人类要求在 M2 前顺序执行 [015](015-initialization-hardening/spec.md)。

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| I0-1 | 日志真实按天保留 | G1 | `done` |
| I0-2 | 初始化配置保留与崩溃恢复 | I0-1、ADR-024 accepted | `todo` |
| I0-3 | 已有凭据的主密钥启动校验 | I0-2、ADR-024 accepted | `todo` |
| I0-4 | 向导简化与配置自动应用 | I0-3、ADR-024 accepted | `todo` |

## 5. M2 开发资源与窗口层（草案）

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M2-1 | FileManager：文件树、读写、版本冲突、监听 | G1 | `todo` |
| M2-2 | 文件窗口：Monaco、多 Tab、冲突提示 | M2-1 | `todo` |
| M2-3 | CommandRunner：超时、输出上限、取消、环境白名单 | G1 | `todo` |
| M2-4 | TerminalManager：PTY、xterm、多客户端观察、输入租约 | M2-3 | `todo` |
| M2-5 | GitManager：status / diff / add / commit / branch / push 审批 | M2-3 | `todo` |
| M2-6 | 真实资源接入窗口层：顶部入口、来源/项目筛选、分组 Tab、恢复、布局持久化 | M2-2, M2-4 | `todo` |
| M2-7 | 项目锁、fencing、并发与冲突用例 | M2-1, M2-4, M2-5 | `todo` |
| M2-8 | M2 验收与门禁 | M2-6, M2-7 | `todo` |

## 6. M3 本机服务与 Preview（草案）

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M3-1 | ServiceManager + NativeProcessAdapter + 日志 / 状态 | G2 | `todo` |
| M3-2 | 服务 UI：右栏、窗口、启停、日志、指标 | M3-1 | `todo` |
| M3-3 | PreviewRegistry + HTTP / WS 代理 + SSRF 防护 | M3-1 | `todo` |
| M3-4 | 预览隔离、票据、浏览器窗口、Vite HMR | M3-3, Q-002 | `todo` |
| M3-5 | PM2Adapter、对账、打包 PoC | M3-1, Q-003 | `todo` |
| M3-6 | M3 验收与门禁 | M3-2, M3-4, M3-5 | `todo` |

## 7. M4 部署闭环（草案）

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M4-1 | 部署 Validate / Build / Plan 与构建产物记录 | G3 | `todo` |
| M4-2 | 审批：计划哈希、范围、审计、防篡改 | M4-1 | `todo` |
| M4-3 | PM2 执行、健康检查、部署记录、失败恢复 | M4-2, M3-5 | `todo` |
| M4-4 | M4 验收与门禁 | M4-3 | `todo` |

## 8. M5 扩展与加固（草案）

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-1 | GLM / 多 Provider、能力矩阵、上下文压缩 | G4 | `todo` |
| M5-2 | Scheduler：Cron、JS / Agent Job、JobRun、限流 | G4 | `todo` |
| M5-3 | Launcher / Updater、签名、UpdateLock、回滚 | G4 | `todo` |
| M5-4 | Windows / Linux PoC、打包与安装说明 | M5-1 ~ M5-3 | `todo` |
| M5-5 | 安全加固、发布验收清单、文档定稿 | M5-4 | `todo` |

## 9. 门禁

### G-S0 视觉 Demo

- 对齐 `larness.md` 7.1 六条：三栏 / 主题 / 右栏分区 / 红黄绿浮窗 / 输入框聚焦 / Mock 对话与审批；
- 无底部 Dock、无模拟系统标题栏、无最左侧活动栏；
- 桌面 1440×900 与窄屏各有一组截图；人类确认。
- **状态：通过（2026-11-01）**。

### G0 可信启动与认证

对应 `larness.md` 42.1：

- 未初始化时业务 API 不开放；初始化只经本机通道；
- 未授权客户端只能访问配对页；REST / WS / 静态资源均无法读取数据；
- 配对码绑定申请、限时、限次、一次消费；并发兑换只有一个成功；
- `允许本次` 过期不可重用；`始终允许` 必须完成 Passkey 注册，未完成不创建设备 / 会话；
- Passkey 登录、撤销、challenge 重放 / 过期、错误 Origin、IP 来源均有测试；
- 不签发长期设备 Token / refresh token；
- TUI 关闭、页面刷新、断网不影响后台 Agent / 服务；
- TLS / Cookie / CSRF / Origin / WS 鉴权安全用例通过。

### G1 工作区与 Agent

对应 42.2 前半：

- DeepSeek 至少一个可用的流式工具调用场景；FakeProvider 覆盖状态机；
- 同会话并发 Turn 被拒绝或排队；
- 文件版本冲突不静默覆盖；
- 断线重放无缺口、无重复；
- 取消后不再产生新工具调用；
- 切模型只影响下一 Turn。

**状态：通过（2026-11-01，人类验收）。** 记录见 [M1 acceptance](../specs/020-workspace-agent/acceptance.md)。

### G2 开发资源

- 终端多 Tab / 项目筛选 / 隐藏恢复不重建 PTY；
- 两客户端观看同一终端，输入租约可见；
- 文件树、Monaco 编辑、Git Diff 可用；
- 项目写锁生效，跨项目可并发。

### G3 服务与预览

- 开发服务可启动、记录端口、查看日志；
- `localhost:5173` 经独立来源预览，HMR 工作，5173 不公网暴露；
- 未登记端口 / 禁止目标被拒绝并审计；
- PM2 生产服务可启动、保活、对账。

### G4 部署

- 构建 → 计划 → 审批 → PM2 → 健康检查 → 记录闭环；
- 审批参数不可篡改；
- 失败可查看日志并恢复；
- 重启后服务状态经对账，不假装运行。

### G5 发布候选

- 自动检查 / 手动安装更新；任务运行中不强制更新；
- 签名校验、失败回滚、备份恢复演练；
- 三平台 PoC 结果与支持范围公开；
- `larness.md` 31 / 42.3 清单通过。

## 10. 任务卡维护

- 开始任务：`todo → in_progress`，在 `STATUS.md` 登记。
- 完成：更新 `tasks.md`、本节状态、`STATUS.md`，提交。
- 阻塞：`blocked` + 原因 + 需要谁决策；解除后回到 `todo`。
- 新增 / 拆分任务：先改本表与对应 `tasks.md`，保持 ID 稳定；不使用“临时任务”绕过依赖。
