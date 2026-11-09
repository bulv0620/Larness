> 本文保留早期设计和原始验收清单。现行工程规则从 [宪法](CONSTITUTION.md)、[ADR 索引](docs/adr/DECISIONS.md) 和 [规格入口](specs/README.md) 查阅；当前门禁见 [路线图](specs/ROADMAP.md)。第 31、42.3 章与现行发布范围的对照见 [G5 验收](specs/067-release-hardening/acceptance.md#历史发布清单对照)。

> 当前 M4 修订（2026-11-07）见 [ADR-050](docs/adr/ADR-050-pm2-cli-deployment.md) 和 [050 spec](specs/050-deploy/spec.md)。Agent 使用普通命令工具操作全局安装的 PM2，后端提供私有实例环境与项目关系。本历史设计中 §18.4、§38.2～38.3 的专用发布流水线和禁止 Agent 依赖 PM2 命令格式条款已由该 ADR 替代。

> **2026-11-05 当前设计修订：** [ADR-042](docs/adr/ADR-042-service-deploy-boundary.md)已获用户确认：M3只负责开发服务登记与隔离预览；PM2持久运行/首次正式发布/版本替换/管理恢复整体归M4。autonomous对全部已授权Agent业务动作完全免人工审批/确认，保留计划、鉴权/范围、锁、审计与真实失败处理。下方“生产必须人工批准”等旧正文仅作历史设计，不作为当前自主模式规则；本次只更新文档，M3/M4技术规格仍draft。

> **2026-11-02 资源规则修订：** 以下为历史设计正文；窗口 / Tab 与服务分工如有旧描述，以 [ADR-030](docs/adr/ADR-030-resource-lifecycle-and-services.md)、[资源视图契约](docs/contracts/resource-views.md)、[服务预览契约](docs/contracts/services-preview.md) 为准。关闭 / 最小化窗口仅隐藏；关闭终端 Tab 终止终端进程。临时服务只登记 Terminal 中的进程，退出退登；持久服务由 PM2 管理。服务窗口为项目筛选 + 卡片 / 详情，无服务 Tab；不再独立 NativeProcessAdapter 启停临时服务。正文旧 ADR / S0 记录保留，不作为新规则实现已完成的证据。

# Larness 产品需求、技术架构与边界约束设计文档

> 2026-11-01：仅将产品名统一为 Larness；架构语义未修改（ADR-022）。

> 设计版本：v3.0 · 2026-10-30  
> 状态：**设计方案，尚非已实现功能**  
> 基础材料：《Larness 产品需求文档（PRD）v1.1》；第一篇保留原始需求，第二篇补充最新产品决策与工程落地方案。
> 主要读者：产品负责人、前端/后端工程师、AI 编程 Agent、测试人员。

## 阅读指南与决策优先级

> **最新冻结决策位于第四篇（第 33–44 章），优先级高于前文所有旧版描述。** 本文保留 v1.1 原 PRD 及 v2.0 技术设计作为完整历史基线，同时将最新边界约束正式冻结。

- **第一篇**完整保留上传 PRD 的需求和 UI 规范，作为验收依据。
- **第二篇**是工程设计，包含最新讨论产生的要求；与原 PRD 冲突时，按第二篇「最终决策」执行，并在实施前回写 PRD。
- **第三篇**提供 API、数据结构、执行流程、故障恢复和验收用例的实现约定。
- 未实际实现的功能均为**目标设计**，不应根据 UI Demo 的模拟交互推断已完成。

## 0. 最新决策与原 PRD 差异

| 项目 | 最新确定方案 | 对原 PRD 的影响 |
|---|---|---|
| 使用方式 | **单工作空间，多客户端同时访问**；不存在业务多用户/多租户隔离 | 原“单人开发者”扩展为多个已授权客户端共享同一业务视图；UI 布局独立 |
| 认证 | 首次本机 TUI 初始化；新设备需经 TUI 审批，再使用一次性配对码；支持「本次允许 / 始终允许」 | 替换仅账号密码直接放行的设计；管理密码作为本机初始化/恢复凭据，而非唯一远程认证方式 |
| TUI | `node app.js` 启动服务；`node app.js tui` 通过本机 IPC 连接管理控制台 | 新增设备审核、撤销、运行状态、安全管理能力 |
| 模型 | **DeepSeek 与 GLM 优先**；支持多个 API Key Profile，按下一轮 Turn 切换 | Agent 首选自研 Runtime + Vercel AI SDK 的模型/工具调用能力；不依赖 Codex App Server |
| 服务 | 主要是本机 Node.js 项目；开发进程由 NativeProcessAdapter，长期服务可选内置 PM2 Adapter | 不引入 Docker 或远程部署目标 |
| 预览 | Web 服务使用 iframe + Node.js 内部 HTTP/WS 代理；地址栏可输入本机 `localhost:5173` | 不支持完整 Electron 原生窗口预览/WebRTC 控制，后期再讨论 |
| 更新 | GitHub Releases 检查新版本；独立 Launcher/Updater 负责切换和回滚 | 新增更新状态、签名验证、数据迁移及回滚方案 |
| 视觉 | 苹果应用风三栏、顶部全局工具入口、浮动多 Tab 资源窗口，**无底部 Dock** | 保持原 PRD v1.1 的 UI 约束，不回退到旧的 Dock 设想 |

---

# 第一篇：产品需求（原 PRD v1.1）

> 版本：v1.1（按当前 UI Demo 修订，2026-10-30）  
> 定位：自托管、单机运行、AI-first 的 Web IDE 与本机服务运维工作空间。  
> 范围：以 Node.js 项目为主要目标，使用浏览器远程访问部署 Larness 的这台机器。
> 状态：已有纯前端 UI Demo，视觉与交互待用户验收；真实 AI、文件系统、终端、服务管理及认证等后端能力仍待实现。本文同时描述产品目标与当前展示范围，两者不等同。

## 1. 产品目标与约束

### 1.1 核心目标

用户在一台装有 Node.js 的电脑上启动 Larness，通过网页访问并登录，在一个统一界面内完成：

1. 关联本地项目目录，创建和管理 AI 会话；
2. 利用多个模型提供商的 AI Agent 读写代码、运行命令、查看 Git；
3. 管理本机终端与开发/生产服务；
4. 在内嵌浏览器窗口访问本机开发服务（输入 `localhost:5173` 即可）；
5. 构建、部署、启动、停止、重启和监控本机 Node.js 项目；
6. 创建定时脚本和定时 Agent 任务。

### 1.2 明确范围

- **单机执行**：所有代码、终端、构建、部署和服务均在 Larness 所在电脑上执行；不设计远程主机、SSH 部署集群或分布式 Agent。
- **Web 优先**：用户通过浏览器使用；不要求安装 Electron 客户端。
- **Node.js 优先**：Larness 自身使用 TypeScript/Node.js；优先管理 Node.js 项目，其他语言不是首版目标。
- **最简部署**：目标发布物为单一 JS 入口（`node app.js`）。原生 PTY、PM2 运行时资源等如无法完全打包，允许提供平台相关的附带资源目录；不能以“单文件”为由牺牲核心功能。
- **AI 为主，人可接管**：会话是默认主界面；文件编辑、终端、预览和日志以悬浮窗口呈现。
- **权限有限制**：公网访问必须有身份验证；Agent 不能天然继承所有 Web 登录权限。

### 1.3 非目标（第一版不做）

多机器编排、Docker/Kubernetes、云端 CI/CD、完整 VS Code 插件生态、多人实时协同编辑、任意互联网网页完整浏览器能力、无审批的主机管理员权限。

## 2. 用户与主流程

目标用户为需要在个人电脑、服务器或 NAS 上开发并托管 Node.js 应用的单人开发者。

**核心流程**：启动 Larness → 登录 → 关联项目（或直接新建独立会话）→ 在对话框提出需求 → Agent 修改项目并使用终端 → 用户在文件/终端/浏览器悬浮窗口查看 → Agent 执行测试与构建 → 用户授权部署 → 本机服务持续运行 → 观察日志、Git 和运行状态 → 必要时安排定时任务。

## 3. 信息架构与 UI

### 3.1 主页面：三栏工作台 + 顶部工具入口 + 全局窗口层

| 区域 | 内容 | 行为 |
|---|---|---|
| 左侧栏 | 品牌、新建会话、搜索、项目及其会话、最近会话；底部自动化任务、设置与模型、工作空间及个人信息 | 最近会话是同一 Session 数据的另一种视图，包含项目内和独立会话；不额外设置最左侧图标活动栏 |
| 中央 | 当前会话标题、消息、Agent 计划与工具调用、构建结果、预览产物、部署审批卡片、输入框 | Chat-first；消息区独立滚动，输入区固定在中央栏底部；切换项目/会话不会终止后台资源 |
| 右侧栏 | “项目资源”下的文件、服务、终端、Git 四个分区 | 按当前项目组织；分区独立折叠、独立滚动，通过分隔线调整高度，整栏不设置滚动条 |
| 顶部 | 项目与分支信息；右侧终端、服务、浏览器、文件入口，以及主机 CPU／内存占用、外观切换与通知入口 | 工具入口用于打开、聚焦或恢复对应资源窗口；系统资源使用数值与细进度条展示；设置与模型入口位于左侧栏 |
| 悬浮层 | 文件、终端、服务详情／日志、浏览器预览、Git Diff 等窗口 | 支持拖动、缩放、置顶、隐藏／恢复、最大化／还原及关闭；使用 macOS 风格窗口控制按钮 |

**布局规则**：保留三栏工作台结构，不设置底部工作窗口 Dock，也不模拟桌面应用的顶部系统标题栏。桌面优先；窄屏收起右侧资源栏及必要的左侧栏，仍可通过顶部工具入口打开资源窗口。

**窗口规则**：一个资源可有多个视图；关闭窗口不等于终止终端或服务；已有视图再次打开时优先聚焦或恢复，不重复创建后台资源；切换会话不清理窗口。隐藏后的终端、服务、浏览器和文件窗口从顶部对应工具入口恢复，Git 等视图可从对应资源入口重新打开。

### 3.2 全局资源窗口

- **终端**：窗口顶部多 Tab；项目下拉框支持“全部项目 / 指定项目 / 全局终端”；每个 Tab 归属一个实际 PTY。
- **服务**：项目筛选、多 Tab 或详情视图；包含状态、端口、启动方式、自动重启、日志、打开预览、启停重启。
- **浏览器**：多 Tab、地址栏、刷新、外部打开；主要访问 Larness 主机的开发服务。
- **文件浏览**：可浏览已授权的本机路径；点击文件进入文件预览/编辑窗口，同一文件优先复用已有视图。

以上项目筛选、真实资源与多 Tab 管理属于完整产品目标；当前 Demo 只展示部分 Tab 外观和资源切换，不代表已完成真实多资源管理。

### 3.3 视觉、字体与主题

- **整体风格**：采用苹果应用风格的圆角、轻阴影、低对比边框和适度半透明工具栏；保持开发工作台的信息密度，不照搬 VS Code 的尖锐面板或桌面系统外壳。
- **字体层级**：优先使用平台系统字体；正文与输入文字约 13–14px，导航及资源列表约 12px，辅助信息约 10–11px，主要标题约 20px。路径、命令和代码使用等宽字体，避免普通界面文字过小。
- **图标**：常规工具使用本地 SVG 圆角线框图标，常用尺寸约 16–18px；文件类型可使用彩色文档图标，工具按语义保留少量颜色。图标按钮提供可读名称、悬停提示及键盘焦点状态，不依赖外部图标字体服务。
- **主题切换**：提供浅色、深色、跟随系统三种外观，首次默认浅色。顶部外观菜单与设置内的外观选择同步；浏览器本地保存偏好，刷新后保留；选择跟随系统时响应系统外观变化。
- **主题覆盖**：侧栏、对话区、资源分区、菜单、输入框和浮窗均随主题更新。外观下拉菜单必须完整显示在主内容和资源分隔线上方，不得被遮挡。
- **输入框聚焦**：由外层圆角容器统一显示聚焦边框，内部文本域不再叠加方形焦点轮廓；其他按钮和选择器保留可辨识的键盘焦点提示。

### 3.4 右侧项目资源：可调高分区

- 参考 VS Code 资源管理器的分区交互逻辑，文件、服务、终端和 Git 可以同时展开；整栏高度受工作台约束，标题栏保持可见。
- 内容超出分区高度时，仅该分区内部滚动；滚动文件树不带动其他资源分区，也不产生右侧整栏滚动条。
- 拖动分区之间的水平分隔线，调整相邻展开分区的高度；保留最小可用内容高度，不允许挤掉其他分区标题。
- 收起分区后只保留其标题，释放的空间重新分配给其他展开分区；重新展开时恢复合理的空间占比。分区全部收起时仍显示所有标题。
- 分隔线悬停／拖动时显示高亮；双击均分相邻展开分区；聚焦后用上下方向键微调，Shift + 方向键加大调整步长。
- 当前 Demo 的分区尺寸与折叠状态仅保留在当前页面内，不承诺刷新后恢复。

### 3.5 浮窗控制与对话输入

- 浮窗左上角使用红、黄、绿三个圆形控制按钮：红色关闭视图，黄色隐藏／最小化，绿色最大化／还原。悬停或键盘聚焦时显示操作符号，并提供明确的可访问名称。
- 浮窗标题居中，置顶按钮位于右侧；标题栏可拖动，窗口可缩放。按钮点击不触发窗口拖动；关闭、隐藏与终止后台进程是不同操作。
- 对话输入区上方展示当前项目上下文与工作路径；输入区内提供上下文添加、模型选择、审批策略和发送按钮。模型列表取自配置，不将 Demo 中的模型名称写成固定产品范围。
- Enter 发送、Shift + Enter 换行；Ctrl + K 新建会话，Ctrl + B 切换左侧栏，Escape 隐藏最上层浮窗；打开的菜单优先处理自身的 Escape 关闭行为。
- Agent 消息通过计划进度、工具调用、文件变更摘要、构建结果和可打开的产物卡片表达执行过程；部署审批展示服务名、端口、版本摘要及“暂不部署／批准部署”操作。

## 4. 功能需求

### 4.1 项目管理 [P0]

- 添加、编辑、移除项目与本地目录的关联；验证路径是否存在、是否可访问。
- 每个项目保存名称、路径、创建时间、最近使用时间和默认 Agent/模型配置。
- 识别项目是否为 Git 仓库；无 Git 时隐藏或提示 Git 功能不可用。
- 移除项目只解除 Larness 关联，**不删除磁盘目录**。
- 项目目录支持显式授权路径；防止符号链接越界、路径穿越。

### 4.2 会话与 AI 对话 [P0]

- 项目内可创建多个会话；也可创建不属于项目的独立会话。
- 独立会话分配系统专用工作目录，产物按 Session ID 归档。
- 消息支持文本、流式输出、工具调用状态、任务步骤、错误、审批和产物链接。
- 消息展示与输入区交互遵循 3.5 节；部署审批放在对话过程内，通知入口不替代明确的人工审批。
- 会话持久化，页面刷新或远程重连后恢复消息及事件；后台执行与浏览器连接解耦。
- 会话列表显示标题、更新时间和执行状态；搜索历史会话。
- Agent 执行支持取消；机器重启后的执行是否可恢复需按执行器能力明确标识，不能保证所有进程自动续跑。

### 4.3 多模型与 Agent Runtime [P1，接口 P0]

- 支持多个 Provider、多个 API Key Profile、自定义兼容端点；凭据不传给前端或 LLM 上下文。
- 会话输入框选择模型；**仅从下一轮 Turn 生效**，正在执行的 Turn 不热切换模型。
- Larness 自主管理 Session/Turn/Task/ToolEvent，不把会话模型绑定单一厂商消息格式。
- 适配器声明流式输出、工具调用、视觉、上下文容量等能力；切模型时重构上下文，保留显式任务状态、文件改动和待审批动作。
- 首版只需实现一个可用的 Agent Provider，后续增添 OpenAI/Anthropic/Gemini/OpenAI-compatible 等。

### 4.4 终端 [P0]

- Node.js 后端创建真实 Shell/PTY；前端 xterm.js 展示并提供交互。
- 每个终端拥有 ID、项目归属（可空）、创建来源会话（可空）、cwd、状态和创建时间。
- 全局窗口按项目筛选并多 Tab 管理；项目右栏仅显示当前项目相关终端。
- 终端可断开显示但继续运行；明确区分“关闭 Tab / 隐藏窗口 / 终止进程”。
- Agent 一次性命令以执行事件呈现，不为每条命令新建终端 Tab；长期交互任务可升级为终端资源。
- 跨平台 Windows/macOS/Linux，Shell 通过操作系统适配；原生 PTY 打包进行平台验证。

### 4.5 本机服务与部署 [P0 基础、P1 部署闭环]

- 统一 ServiceManager 管理本机 Node.js 开发服务和生产服务，服务关联 Project ID（可空）。
- 两类生命周期：开发服务（临时、可主动停止）和生产服务（持久、按策略自动重启/恢复）。
- 支持启动、停止、重启、查询状态、端口、实时/历史日志、运行时指标。
- 顶部单独展示 Larness 所在主机的 CPU 使用率与已用／总内存，区别于服务卡片内的单进程指标；正式接入后由后端提供采样数据，当前 Demo 均为固定模拟数值。
- 服务提供启动命令、cwd、环境变量引用、自动重启、构建前置命令及健康检查配置。
- 优先以 **PM2 Adapter** 管理长期运行服务；开发服务可用 Node child_process / PTY；Adapter 层隔离 PM2 实现。
- 部署流程：检查项目 → 构建 → 审批 → 启动/替换服务 → 健康检查 → 记录版本和结果；失败时保留日志与人工恢复入口。
- 生产服务跨主机重启自动恢复需要系统服务管理器/PM2 startup 配置，不是单靠 `node app.js` 就能保证。

### 4.6 文件浏览与编辑 [P1]

- 全局文件浏览针对授权目录；项目右侧提供项目文件树。
- 文件窗口支持 Monaco 编辑、语法高亮、保存、只读预览、Markdown、基础图片展示。
- 同一文件复用 Tab；文件保存冲突时提示外部修改，防止静默覆盖 Agent 修改。
- 文件搜索、文件树刷新和基础增删重命名均受权限校验；大文件分级处理。

### 4.7 Git [P1]

- 显示分支、工作区修改、暂存区与提交历史；Diff 以悬浮窗口展示。
- 支持 add、commit、pull、push、切换分支；高风险操作增加审批。
- 优先使用本机 Git CLI；无法找到 Git 时展示安装提示，其余模块仍可使用。

### 4.8 内嵌浏览器与 Preview Proxy [P1]

- 用户在内嵌浏览器地址栏输入 `http://localhost:5173`，该地址是 **Larness 主机的 localhost**，而不是远程访问者设备。
- 前端解析地址，并向后端请求对应已登记/已授权的本机 Service；代理层转发 HTTP 和 WebSocket（包括 Vite HMR）。
- 地址栏显示输入的 localhost 地址；实际 iframe 访问安全代理 URL。
- **不需要**公开 5173 端口，也不要求 Nginx/Caddy 专门代理该端口。
- 预览页面使用隔离来源（优先不同注册域名），不能与 Larness 管理页面共享特权 Cookie/DOM；避免使用同源 `/preview/*` 展示不可信 JS。
- 普通 iframe 可能受 CSP/X-Frame-Options 限制；不承诺访问任意第三方网站或提供完整浏览器级控制。

### 4.9 自动化任务 [P2]

- 基于 SQLite 持久化的 Cron/定时任务，支持 JS 脚本或受限 Agent 会话任务。
- 提供启停、执行历史、失败通知、并发限制、超时和日志。
- 无人值守任务采用单独、有限范围的权限策略，不能继承一次性人工审批。

### 4.10 安全和公网访问 [P0]

- 默认监听 `127.0.0.1`；支持用户自行通过 HTTPS 反向代理/隧道接入公网。
- 首次初始化管理员；强密码哈希、登录限流、可选 Passkey/TOTP、设备和登录会话撤销。
- Cookie 使用 Secure/HttpOnly/SameSite，并实施 CSRF、Origin、WebSocket 握手鉴权和授权复核。
- Agent 权限由 Larness 后端强制执行：项目内常规动作、跨项目访问、服务部署、系统敏感操作分级审批。
- **不能仅凭命令字符串黑名单实现 Shell 沙箱**；未经隔离的任意命令执行将拥有 Larness 运行账户权限。默认非管理员运行，敏感任务需操作系统级隔离或限制执行能力。
- PM2 不提供文件系统/权限沙箱；项目依赖安装和执行都可能运行任意脚本，必须按不可信代码对待。
- Secret Store 保存 API Keys 和服务凭据，Agent 工具仅以受控方式引用；日志脱敏。
- Preview Proxy 只访问登记的服务，防止端口扫描/SSRF；预览域与主应用隔离。
- 审计日志包含操作者、Session、工具、参数摘要、审批决策与执行结果。

## 5. 资源与数据模型

| 实体 | 关键字段 | 关系 |
|---|---|---|
| Project | id, name, rootPath, settings | 包含多个 Session，可关联终端/服务 |
| Session | id, projectId nullable, workspacePath, title, state | 多个 Turn |
| Turn | id, sessionId, modelProfileId, status | 多个事件与工具调用 |
| AgentEvent | id, turnId, sequence, type, payload, timestamp | 用于断线重放 |
| Terminal | id, projectId nullable, sourceSessionId nullable, cwd, status | 后端 PTY；可多个 Tab 展示 |
| Service | id, projectId nullable, runtime, command, port, status | 本机进程或 PM2 应用 |
| Deployment | id, serviceId, commit, artifact, status, logRef | 追溯部署操作 |
| BrowserTab | id, serviceId, displayUrl, viewState | 前端视图，不拥有服务生命周期 |
| Window | id, type, position, size, tabIds, minimized | UI 状态，不代表后端资源 |
| CredentialProfile | id, provider, label, secretRef | Secret Store 中的密钥引用 |
| ScheduledJob | id, schedule, scope, policy, enabled | 定时执行 |

**基本规则**：资源属于 Larness，全局可按 Project 筛选；Session 可以创建/使用资源，但关闭 Session 不自动删除资源；Window 与 Tab 仅为资源视图。

## 6. 核心技术方案

以下为完整产品的推荐方案；当前 UI Demo 使用无构建依赖的 HTML／CSS／JavaScript、本地 SVG 和浏览器本地主题偏好存储，尚未接入表中的后端组件。

| 层 | 推荐 |
|---|---|
| Web | React + TypeScript + Vite + shadcn/ui + Tailwind |
| 前端状态 | Zustand（窗口、布局）+ TanStack Query（服务器数据） |
| 窗口 | react-rnd 或同类组件 + 统一 WindowManager |
| HTTP | Fastify + REST API |
| 实时 | WebSocket，带事件序号和断线重放机制 |
| 存储 | SQLite（配置、项目、会话、任务、审计） |
| Agent | Larness AgentRuntime + ProviderAdapter + ToolPermissionEngine |
| Terminal | node-pty + xterm.js（多平台原生模块需验证） |
| Services | PM2Adapter（生产）+ NativeProcessAdapter（开发） |
| Files | Node.js fs + Monaco |
| Git | Git CLI |
| Preview | Node.js HTTP/WebSocket proxy + iframe（隔离来源） |
| 构建 | Vite Web 打包 + tsdown/esbuild Server 打包；单 JS 入口为交付目标 |

### 6.1 关键边界

- **API/资源管理**：Web 组件不直接操控进程，而是请求后端 Manager。
- **Agent 工具**：`FileTool`、`GitTool`、`TerminalTool`、`ServiceTool` 与手动 UI 调用同一资源管理层。
- **事件通道**：终端输出、Agent 状态、文件变更、服务状态由后端统一发布，前端按 Project/Session 订阅。
- **权限校验**：所有资源操作在后端判断身份、Project 和工具权限，不能依赖前端隐藏按钮。

## 7. 交互验收标准

### 7.1 UI Demo 验收

1. 页面遵循苹果应用风格，字体与图标尺寸统一；不存在最左侧活动栏、顶部模拟系统标题栏或底部工作窗口 Dock。
2. 浅色、深色、跟随系统可以切换，偏好刷新后保留；外观菜单不被右侧资源内容和分隔线遮挡。
3. 右侧资源整栏无滚动条；四个分区可以独立折叠、独立滚动，展开与收起会重新分配高度，分隔线支持拖动、双击均分及方向键调整。
4. 浮窗红黄绿按钮分别关闭、隐藏、最大化／还原；隐藏后可从对应入口恢复已有视图；拖动和缩放不影响其他窗口。
5. 对话输入框聚焦时仅显示外层圆角聚焦边框，不出现内部方形蓝框；模拟对话、产物预览和部署审批可以展示完整交互流程。
6. 主机指标、命令、模型调用与部署结果均按演示数据理解。开发侧完成必要的语法、加载与关键交互校验，视觉效果与交互体验由用户验收，不将其等同于完整产品验收。

### 7.2 完整产品验收（待后端实现）

1. 一台机器启动 Larness 后，从另一台设备安全登录，可创建/切换多个项目和会话。
2. Agent 正在运行时刷新浏览器，可恢复会话消息与可重放事件，不因 WebSocket 断开而默认结束任务。
3. 在项目中打开终端，切换到“全部项目”仍能找到该终端；隐藏后从顶部终端入口恢复，不重建 PTY。
4. Agent 启动 Vite 服务，右侧服务列表自动更新；点击预览或输入 `localhost:5173` 可在悬浮浏览器中看到该主机服务，5173 无需公开到互联网。
5. 点击文件树中的文件会打开文件预览／编辑视图；同一文件重复点击不会无意义重复创建 Tab。
6. 右栏文件、服务、终端、Git 按 3.4 节独立折叠、滚动与调高；中央对话区不被固定编辑器替代。
7. Agent 修改并构建 Node.js 项目，经人工审批后托管为生产服务；服务窗口能够启停、重启和查看日志。
8. 未授权的项目外文件读取、敏感系统命令或任意代理端口请求被后端拒绝，并生成审计记录。
9. 会话模型切换只影响下一轮 Turn，历史事件与已启动服务不丢失。

## 8. 分阶段交付

| 里程碑 | 范围 | 完成标志 |
|---|---|---|
| UI Demo | 苹果风三栏、主题、模拟对话与审批、资源分区、红黄绿浮窗及顶部工具入口 | 提供纯前端展示 |
| M1 核心工作台 | 认证、项目/独立会话、AI 对话、事件流、SQLite | 用户可安全登录并使用一个模型在项目中工作 |
| M2 开发资源 | 终端、文件树/编辑、Git、可调高资源分区、悬浮窗多 Tab 与顶部入口恢复 | 用户可在 Web 接管终端、查看和编辑项目文件 |
| M3 本机服务 | ServiceManager、PM2、开发服务、Proxy Browser、日志 | AI 启动 Vite，用户输入 localhost:5173 预览 |
| M4 开发部署闭环 | 构建、部署审批、生产保活、版本记录、健康检查 | 从 AI 修改代码到本机部署可完整追踪 |
| M5 扩展 | 多 Provider 全量适配、自动化任务、更多监控与体验优化 | 支持模型切换、定时任务和持续运维 |

## 9. 关键风险与未决决策

- 严格的单 `app.js` 与 `node-pty`、PM2 Daemon/资源文件打包存在冲突：优先保证可运行的 Node 启动入口，后续验证单文件发布。
- 内嵌预览的**独立来源**需要域名/通配路由支持；如果没有独立域名，必须制定明确的功能与安全降级策略。
- 未隔离的 Shell/PM2 不保证项目级文件权限边界；真正的进程隔离方案要根据 Windows/macOS/Linux 分别设计。
- 单机自动恢复需要与 OS 服务管理器集成；PM2 负责项目服务，不能替代 Larness 本身的守护。
- 并发会话编辑同一项目可能冲突：至少需要文件变更检测、执行状态追踪与操作提示。

---

**一句话定义**：Larness 是一个运行在单台计算机上的、可通过 Web 安全远程访问的 AI-first 开发与运维工作空间，用户通过对话驱动本机项目的开发、预览、构建、部署和自动化，同时随时通过窗口化的文件、终端、服务和 Git 工具查看或接管。


---

# 第二篇：系统与技术架构设计

## 10. 架构目标与非功能需求

### 10.1 约束与原则

1. **单机、单工作空间**：仅一份 Project/Session/Service/Terminal 数据库与运行环境；所有已授权客户端访问同一批资源。
2. **资源与视图分离**：Window/Tab 是前端视图；Terminal/Service/AgentExecution 是后端资源。关闭视图不自动杀进程。
3. **Agent 不拥有特权通道**：UI 与 Agent 都经过同一 ResourceManager，所有写入/执行均经过后端授权检查。
4. **独立执行生命周期**：刷新、断线、前端关闭不结束正在运行的 Turn/Service。
5. **安全优先于“完全单文件”**：原生 PTY/PM2 相关资源可随包分发，运行入口仍保持 `node app.js`。
6. **不承诺强沙箱**：没有 OS 级隔离的 Shell、包管理器脚本和 PM2 服务可以读取运行账户有权访问的文件。应用层路径授权仅用于受控工具，不能隔离任意命令。
7. **Web 资源预览与管理域隔离**：预览运行的是项目代码，不得共享管理端同源权限。

### 10.2 工程质量门槛（初始目标，可在压测后调整）

| 指标 | 目标 / 定义 |
|---|---|
| 运行平台 | Windows 10/11、近期 macOS、主流 Linux x64/arm64；分别测试 PTY、Git、守护和更新 |
| Web 启动 | 服务 ready 后应可进入配对页；启动错误通过 TUI/日志明确可见 |
| 断线恢复 | WebSocket 恢复后按事件序号拉取缺失消息；不能静默丢失工具执行事件 |
| 并发 | 多浏览器可同时查看同一会话；同一会话只允许一个执行中的 Turn |
| 可追溯性 | 每一次工具调用与敏感审批都有稳定 ID、执行时间、结果和来源 |
| 数据安全 | SQLite 采用事务；写操作幂等/去重；更新前备份；机密材料不写入会话历史 |
| 兼容性 | 内嵌浏览器优先保证 Vite/常规 HTTP 服务，不能保证所有第三方网页 iframe 可用 |

## 11. 系统拓扑

```text
Remote Browser A ─┐
Remote Browser B ─┼─ HTTPS / Secure Tunnel ─┐
Local Browser ────┘                          │
                                           ▼
                                  Fastify Web + Auth
                                   REST / WebSocket
                                           │
                             ┌─────────────┴─────────────┐
                             ▼                           ▼
                     Workspace Domain              Window UI State
               Project / Session / Turn           Per-browser only
                             │
                 ExecutionOrchestrator ─── EventLog (SQLite)
                             │
               ┌─────────────┼──────────────┐
               ▼             ▼              ▼
            AgentRuntime  ResourceManager  Scheduler
               │         ┌─────┼─────┐       │
       DeepSeek / GLM   File  PTY  Git Service │
                             │         │      │
                             └── Local OS / PM2 ────────┘
                                           │
                                   Preview HTTP/WS Proxy
                                           │
                                     127.0.0.1:port

Local Terminal ── protected local IPC ── Control TUI
Stable Launcher/Updater ── controls ── Larness Server process
```

### 11.1 进程边界

- **Launcher**：稳定入口，读取当前版本、启动 Server；监控进程退出，执行受控重启。若需要开机恢复，由操作系统服务管理器再监督 Launcher。
- **Server**：Fastify、WebSocket、SQLite、Agent Runtime、资源管理、预览代理与任务调度。
- **TUI Client**：仅本机运行，经本机权限受控的 Unix Domain Socket / Windows Named Pipe 连接 Server；服务后台运行时仍可进入 TUI。
- **User Services**：开发进程、PM2 长期服务；独立于 Web 客户端。不假定 Server 意外退出时开发进程一定存活。
- **Updater**：与待更新的 Server 分离，在安全停止之后进行版本切换和健康检查。

### 11.2 目录建议

```text
larness-install/
├── app.js                    # 稳定入口（launcher）
├── current.json               # 当前版本指针 / 校验信息
├── releases/
│   ├── 2.0.0/server.js
│   └── 2.0.1/server.js
├── runtime/                   # 可选的 node-pty/PM2 平台资源
└── updater/                   # 更新执行程序/脚本

<larness-data-dir>/           # 配置项指定，独立于安装目录
├── config.json
├── larness.db
├── secrets/                   # 加密凭据存储
├── sessions/<session-id>/workspace/
├── artifacts/<session-id>/
├── logs/
├── backups/
└── tmp/
```

默认数据目录应采用 OS 标准用户数据目录，不硬编码 `~/.larness`；上述仅为结构示例。数据目录权限限制为 Larness 操作系统账户，禁止公开为静态文件。

## 12. 服务端模块与责任边界

| 模块 | 核心职责 | 明确不负责 |
|---|---|---|
| AuthManager | 设备配对、凭据验证、浏览器会话、撤销 | Agent 操作决策 |
| ControlTUI | 初始化、设备审批、状态、恢复操作 | 绕过后端审计直接执行业务 |
| ProjectManager | 项目目录映射、元数据、路径授权、Git 检测 | 长期管理 PTY 生命周期 |
| SessionManager | Session/Turn 状态、消息与任务索引 | 模型厂商私有历史唯一存储 |
| AgentRuntime | Provider 适配、上下文、工具循环、流式事件 | 直接绕开 ToolRegistry 执行系统命令 |
| ToolRegistry | 工具 Schema、校验、审批、执行路由 | 向模型泄露密钥 |
| TerminalManager | PTY 创建/写入/resize/关闭、控制权 | 项目服务的持久托管 |
| CommandRunner | 非交互短命令、输出截断、取消和超时 | 为每次短命令创建可见 PTY Tab |
| ServiceManager | 服务登记、Runtime 适配、日志、健康检查 | 将 PM2 当作安全沙箱 |
| FileManager | 授权路径读写、保存冲突检测、文件监听 | 对任意 Shell 提供硬文件隔离 |
| GitManager | Git 状态/差异/提交等结构化操作 | 自动推送无审批 |
| PreviewRegistry/Proxy | 注册本机目标、鉴权、HTTP/WS 转发 | 开放任意内网 URL 代理 |
| Scheduler | 任务持久化、触发、限流、失败记录 | 继承人工临时审批 |
| EventLog/EventBus | 先持久化，再增量广播、重放 | 把 WebSocket 当作唯一状态仓库 |
| UpdateManager | 检查版本、签名验证、协调重启 | Server 进程自行覆盖正在执行的二进制 |

## 13. Agent Runtime 详细设计

### 13.1 核心依赖

推荐 TypeScript + Vercel AI SDK（或可替换的模型 SDK 层），首先实现 DeepSeek 与 GLM 适配。Vercel AI SDK 负责 API 调用、流式文本与工具调用循环；Larness 独立实现 Agent 的工程能力。模型接口兼容性以具体 API 版本的联调结果为准，不能假定所有 OpenAI-compatible 端点能力一致。

```ts
type AgentProviderId = 'deepseek' | 'glm' | 'openai-compatible';
interface ModelProfile {
  id: string;
  provider: AgentProviderId;
  model: string;
  credentialProfileId: string;
  endpoint?: string;
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean; contextTokens?: number };
}
interface AgentExecutionContext {
  sessionId: string;
  turnId: string;
  projectId?: string;
  workspacePath: string;
  modelProfile: ModelProfile;
  approvalPolicyId: string;
  abortSignal: AbortSignal;
}
```

### 13.2 Turn 状态机

```text
CREATED → QUEUED → RUNNING ──────────→ COMPLETED
                    │  │  └──────────→ FAILED
                    │  ├─ approval ──→ WAITING_APPROVAL ─→ RUNNING / DENIED
                    │  └─ cancel ────→ CANCELLING ────→ CANCELLED
                    └── restart/crash → INTERRUPTED (not automatically resumed)
```

- 同一 Session 同时最多一个活跃 Turn；不同 Session 允许并行，但资源锁负责协调。
- 切换模型只作用于下一 Turn；当前执行的模型 Profile 固定。
- 工具调用包括 `toolCallId`、参数、结果摘要、超时、审批和取消状态。
- Provider 专用 reasoning/工具状态仅在需要且兼容的同模型调用范围保留，跨模型使用标准化语义消息、任务计划和结果摘要。
- 一个 Turn 设置步骤预算、总时长预算与工具调用预算，防止循环失控；耗尽时产出可继续的部分结果。

### 13.3 工具最小集合

| Tool | 输入 | 返回 | 默认策略 |
|---|---|---|---|
| list_files | root, glob, limit | 文件清单 | 授权项目内允许 |
| read_file | path, range | 内容、版本标识 | 授权项目内允许 |
| search_code | query, paths, limit | 位置、片段 | 授权项目内允许 |
| apply_patch | path, patch, expectedVersion | Diff、结果 | 项目内受控写入 |
| run_command | command, args, cwd, timeout | stdout/stderr/exit | 依据执行身份和命令能力评估 |
| git_status/diff | projectId | 结构化 Git 状态 | 允许读取 |
| git_commit/push | projectId, inputs | 操作结果 | 审批 |
| start_service | serviceConfigId | serviceId、状态 | 开发服务可受限执行，生产部署须审批 |
| get_service_logs | serviceId, cursor | 日志块 | 允许读取已授权服务 |
| deploy_service | deploymentPlanId | 发布记录 | 必须显示计划并审批 |

`run_command` 不以字符串黑名单作为边界；未经 OS 沙箱隔离的任意命令均按高权限能力看待。首版如无法提供隔离，应明确采用「可信个人项目 + 明示授权 Shell」的安全模式，不宣称安全沙箱。

### 13.4 Context Builder

组装顺序：System Safety Policy → Project Instructions → 当前用户需求 → 已保存任务计划/状态 → 最近消息 → 相关代码片段与工具结果 → 历史摘要。限制输出长度、截断长命令日志、去除密钥；只加载相关文件而非整个仓库。压缩必须保存任务目标、已改文件、待办、失败验证、已启动服务 ID 和待审批动作。

## 14. 数据库模型和事务策略

### 14.1 核心表（SQLite，示意）

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  workspace_path TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE turns (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  model_profile_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id),
  seq INTEGER NOT NULL, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(turn_id, seq)
);
CREATE TABLE terminals (
  id TEXT PRIMARY KEY, project_id TEXT, source_session_id TEXT,
  cwd TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE services (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL,
  runtime TEXT NOT NULL, config_json TEXT NOT NULL,
  desired_state TEXT NOT NULL, observed_state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE deployments (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id),
  commit_sha TEXT, artifact_ref TEXT, status TEXT NOT NULL,
  plan_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE device_requests (
  id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
  status TEXT NOT NULL, expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY, credential_id TEXT UNIQUE,
  public_key TEXT, label TEXT, revoked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY, device_id TEXT REFERENCES trusted_devices(id),
  token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
  revoked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, client_session_id TEXT, session_id TEXT,
  action TEXT NOT NULL, resource_id TEXT, decision TEXT,
  details_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
```

另外需要 `model_profiles`（不存明文密钥）、`credential_profiles`、`scheduled_jobs`、`job_runs`、`resource_locks`、`file_versions`、`update_runs` 等表。以上仅为架构骨架，最终迁移要补外键、索引、约束和敏感字段脱敏。

### 14.2 数据一致性

- SQLite 建议启用 WAL、外键、受控事务；每个 Turn 的事件 sequence 在同一事务或可靠写入流程中递增。
- API 写请求提供 `requestId` / 幂等键，避免网络重试重复启动服务、部署或提交。
- 重启时扫描 `RUNNING` 状态：无法证明进程仍存活则标记 `INTERRUPTED`，通过 Runtime 重新发现服务；禁止假装 Agent 自动续跑。
- SQLite 业务数据、用户项目、秘密存储和日志分别安排备份；日志保留周期可配置。

## 15. REST API 与 WebSocket 契约

### 15.1 REST 路由草案

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/bootstrap` | 获取服务器版本、配对/认证状态（不含敏感信息） |
| POST | `/api/pairing/requests` | 申请设备配对，返回 requestId 和校验短码 |
| POST | `/api/pairing/redeem` | 提交一次性配对码并完成凭据注册流程 |
| POST | `/api/auth/logout` | 撤销当前浏览器会话 |
| GET/POST | `/api/projects` | 项目查询与创建 |
| GET/POST | `/api/sessions` | 会话查询与创建 |
| POST | `/api/sessions/:id/turns` | 创建 Turn，支持幂等键 |
| POST | `/api/turns/:id/cancel` | 取消 Agent 执行 |
| GET | `/api/sessions/:id/events?after=...` | 拉取增量事件 |
| GET | `/api/projects/:id/files` | 文件树 |
| PUT | `/api/files/content` | 带版本条件的文件保存 |
| GET | `/api/projects/:id/git/status` | Git 状态 |
| POST | `/api/terminals` | 创建 PTY |
| POST | `/api/terminals/:id/terminate` | 终止 PTY（非关闭视图） |
| GET/POST | `/api/services` | 服务查询与注册 |
| POST | `/api/services/:id/actions` | 启停/重启等动作 |
| POST | `/api/deployments/plan` | 生成部署计划 |
| POST | `/api/deployments/:id/approve` | 审批部署 |
| GET | `/api/preview/resolve?serviceId=...` | 根据登记服务获取安全预览地址 |
| GET | `/api/updates/check` | 检查更新 |
| POST | `/api/updates/install` | 触发受保护的更新工作流 |

**所有业务 API 默认拒绝未授权客户端**；配对 API 仅公开最小必要信息并限制速率。拒绝请求不得泄漏主机目录、活跃项目及设备列表。TUI 审批不通过这些公网路由实现。

### 15.2 WebSocket 事件包络

```ts
interface ServerEvent<T = unknown> {
  eventId: string;
  topic: 'agent' | 'terminal' | 'service' | 'git' | 'file' | 'system';
  projectId?: string;
  sessionId?: string;
  resourceId?: string;
  sequence: number;
  timestamp: number;
  type: string;
  payload: T;
}
```

- 连接完成 Cookie/Origin/CSRF 风格握手校验，订阅资源需要再次授权。
- 客户端保留每个 topic/资源的最后确认序号；断线重连以 REST 或 WS 重放缺失事件，再切回实时推送。
- Agent 消息 delta 可批量聚合；关键状态（审批、工具完成、错误）不得仅存在内存流里。
- PTY 实时数据不能简单全部存为无限增长的数据库事件：使用限长环形缓冲 + 可配置落盘日志 + 游标回放。

## 16. TUI、设备配对与会话安全

### 16.1 启动与初始化

```bash
node app.js             # 启动 Server（前台可输出状态），未初始化则进入安全初始化流程
node app.js tui         # 通过本机受保护 IPC 附加控制台
node app.js status      # 本机只读状态
```

首次启动需设置本机管理凭据、监听地址、数据目录、外网反代提示、更新通道等。初始化状态只能从本机 TUI/受保护 IPC 完成，**不能由公网首次访问抢占注册管理员**。

### 16.2 新设备连接协议

```text
浏览器请求配对
  → Server 生成短期 PendingRequest 与校验编号
  → TUI 显示来源、时间、浏览器信息、编号
  → 本机操作者核对编号并选择 拒绝 / 允许本次 / 始终允许
  → TUI 显示加密随机生成的一次性配对码
  → 浏览器输入配对码（绑定该 requestId + 有效期 + 尝试次数）
  → 服务端颁发短期 Session；若始终允许则完成长期设备凭据登记
  → Cookie 登录并进入唯一 Workspace
```

设备描述/IP/User-Agent 只用于辅助辨认，**不是安全身份**。推荐支持 WebAuthn 凭据；考虑 Passkey 可同步，需独立建立可撤销的客户端设备记录。若首版仅使用随机凭据 Cookie，明确标记为可被窃取重放的低保证方案；长期凭据不放 localStorage。新设备无本机值守时必须等待批准或使用事先离线保存的一次性恢复方案，不能自动放行。

### 16.3 白名单与撤销

- `ALLOW_ONCE`：只创建受限有效期会话，浏览器失效后重新配对。
- `TRUST`：登记长期设备凭据；每次进入仍须完成凭据校验/有效会话验证。
- TUI 支持列出、命名、撤销设备；撤销立即禁用关联 Session 与 WS 连接。
- 临时令牌只存哈希，配对码采用密码学随机源；记录失败次数、速率与异常审计。
- 重要命令的审批**独立于设备配对**，不可将可信设备等同于任意 Shell/部署权限。

### 16.4 访问链路安全

- Larness 默认仅绑定 `127.0.0.1`；公网通过 HTTPS 可信反代/隧道访问。
- 严格配置可信代理列表，避免伪造 `X-Forwarded-*`；强制 TLS、HSTS 视部署环境启用。
- Session Cookie 使用 HttpOnly/Secure/SameSite；状态修改接口校验 CSRF 与 Origin。
- Preview 独立来源和 Cookie 范围；任何未认证请求不得访问 Preview。
- 控制 TUI 的 IPC 用 OS 文件权限保护；本地登录同一账户的恶意进程仍可能攻击它，不能将 TUI 视为超出 OS 账户权限的硬件安全模块。

## 17. 全局资源、并发与锁

### 17.1 归属规则

- 全局 Resource 均可具有 `projectId: null | id`；`sourceSessionId` 只用于追踪创建来源。
- 同一个 Terminal、Service 在不同浏览器客户端可被同时观看；前端各自有独立 Window/Tab/Layout，不自动同步弹窗位置。
- 项目树与最近会话使用相同 Session 数据；不是复制表。

### 17.2 并发策略

| 资源 | 首版规则 |
|---|---|
| 同一 Session | 同时仅一条活跃 Turn，其余请求入队或提示冲突 |
| 项目写操作 | Larness 内进程排队；文件写入使用 expectedVersion 检测外部修改 |
| Git | checkout/reset/commit/pull 等写操作获取项目级 Git 锁 |
| 终端 | 可多人看，同一时刻一方拥有交互输入 Lease；超时可接管 |
| Service | 启动/停止/部署串行；每项操作记录幂等 requestId |
| 浏览器 Tab | 每客户端私有；多个客户端可看同一个已登记服务 |
| 窗口布局 | 客户端本地保存，按需要同步偏好而非实时位置 |

应用层锁不保证屏蔽外部编辑器和 Shell 的修改，因此文件层必须校验文件版本/mtime/hash，并提供冲突处理。

## 18. 终端、命令执行与服务托管

### 18.1 TerminalManager

基于 `node-pty` 创建真实系统终端，输出经 WS 推送；浏览器 `xterm.js` 支持 resize、编码与滚动缓冲。终端状态机：`CREATED → RUNNING → EXITED / TERMINATED`。关闭 Tab 只关闭一个 View；显式 Terminate 才停止 PTY。

### 18.2 CommandRunner

短命令使用 `spawn`，以数组参数执行优先，明确选择何时需要 Shell。必须设置最大执行时间、最大输出大小、工作目录、环境变量白名单、退出码、取消信号，记录命令审计。对不可信项目执行依赖安装时明确展示高权限风险；`cwd` 不是强沙箱。

### 18.3 ServiceManager

```ts
type ServiceRuntimeKind = 'native' | 'pm2';
interface ServiceConfig {
  id: string;
  projectId?: string;
  name: string;
  kind: 'development' | 'production';
  runtime: ServiceRuntimeKind;
  cwd: string;
  executable: string;
  args: string[];
  envRefs: Record<string, string>; // 对密钥存储的引用
  port?: number;
  autoRestart: boolean;
  healthCheck?: { type: 'http' | 'tcp'; target: string; timeoutMs: number };
}
```

- 开发服务由 NativeProcessAdapter 管理，可随开发周期清理。
- 生产服务经 PM2Adapter 托管，连接 PM2 之前必须解决 PM2_HOME、Daemon 隔离、日志路径与多实例冲突。
- 服务状态至少区分 `STOPPED/STARTING/RUNNING/UNHEALTHY/STOPPING/FAILED/UNKNOWN`；不能只依赖进程存活判断健康。
- Larness 主进程自身仍由 Launcher/OS 服务监督，不能靠自己内部 PM2 保证开机恢复。
- V1 主要支持 Node.js 项目；Node 运行时由宿主机提供。端口冲突、环境变量变更与进程树退出需跨平台验证。

### 18.4 部署步骤

`VALIDATE → BUILD → PLAN → WAIT_APPROVAL → STOP/REPLACE → START → HEALTH_CHECK → RECORD → SUCCESS`。失败产生 `FAILED`，保留可追溯日志和恢复入口。回滚只有在先前构建产物和配置完整保留、数据迁移允许的情况下可执行；默认不承诺任意部署可一键回滚。

## 19. 内嵌浏览器与本地代理

### 19.1 用户体验

用户在 Larness Browser 悬浮窗口输入 `http://localhost:5173/dashboard`。BrowserManager 只将显式登记且已授权的本机 Service 解析为安全 Preview 地址，在 iframe 加载；顶部显示原始 localhost URL，不向外开放 5173 端口。

### 19.2 数据流

```text
address: localhost:5173/dashboard
  → BrowserManager normalize
  → PreviewRegistry match(host=localhost, port=5173)
  → API check session + service permission
  → signed/short-lived preview access
  → isolated preview origin
  → Larness HTTP/WS proxy
  → 127.0.0.1:5173/dashboard
```

代理只能访问已绑定的 loopback 地址与已登记目标，防 SSRF、DNS rebinding 与跳转目标漂移；代理请求含 HTTP/WS 权限检查、超时、连接上限、Host/Origin/Cookie 策略。Vite HMR 需要正确代理 Upgrade，必要时为 dev server 配置 HMR host/clientPort。优先采用**独立注册域名**的预览来源；没有可用隔离来源时，默认仅允许可信项目/显式风险确认，禁止把不可信页面作为管理站同源 iframe 直接嵌入。第三方网站 X-Frame-Options/CSP 可能导致预览失败。

### 19.3 非目标

不做 Electron 原生窗口远程显示、不做 WebRTC 窗口控制、不保证任意外网网页能 iframe 嵌入。Agent 浏览器自动化可作为后续独立模块。

## 20. 前端组件与窗口系统

### 20.1 页面组件树

```text
AppShell
├── TopBar (ProjectInfo / HostMetrics / ToolLaunchers / Theme / Alerts)
├── ProjectSidebar (ProjectTree / SessionTree / RecentSessions)
├── ConversationWorkspace (TurnTimeline / ToolCards / ApprovalCard / Composer)
├── ProjectResourceSidebar
│   ├── ResizableSection: Files
│   ├── ResizableSection: Services
│   ├── ResizableSection: Terminals
│   └── ResizableSection: Git
└── WindowLayer
    ├── ResourceWindow: FileEditor (Monaco tabs)
    ├── ResourceWindow: Terminal (xterm tabs + project filter)
    ├── ResourceWindow: ServiceManager (logs/status tabs)
    ├── ResourceWindow: Browser (iframe tabs + address bar)
    └── ResourceWindow: DiffViewer
```

### 20.2 前端状态划分

| Store | 存储内容 | 持久化 |
|---|---|---|
| WorkspaceQuery | 项目、会话、文件、服务、Git、Agent 状态 | 服务端 SQLite，TanStack Query 缓存 |
| WindowStore | 窗口位置、尺寸、置顶、最大化、最小化、Tab 排列 | 浏览器本地，可按客户端保存 |
| NavigationStore | 当前项目、会话、资源分区展开比例 | 浏览器本地 |
| ComposerStore | 草稿、选择模型、审批策略 | 浏览器本地；提交后服务器 Turn |
| RealtimeStore | WS 连接、订阅、事件游标 | 内存 + 必要游标缓存 |

### 20.3 交互不变量

- 左侧项目展开显示子会话，下方最近会话可包括项目内与独立会话。
- 中央始终以 Chat 为主，Agent 工具调用渲染卡片，打开资源时通过 WindowManager 聚焦对应 Tab。
- 右侧四个分区可同时展开，内部独立滚动，分隔条调高，**没有右侧整栏滚动条**。
- Mac 风红/黄/绿控制窗口关闭/隐藏/最大化；**没有底部 Dock**；隐藏窗口由顶部对应入口恢复。
- 顶部提供终端、服务、浏览器、文件全局入口，工具窗口支持项目下拉（全部/指定/全局）+ 多 Tab。
- 多设备同时在线共享业务数据但保留本地窗口位置；不在一个浏览器切换会话时强制其他客户端导航。
- 手机窄屏降级为聚焦对话/资源抽屉，不强求桌面式多浮窗操作。

## 21. 自动化任务

`ScheduledJob` 包含触发器、项目、执行类型（JS script/Agent）、权限策略、并发策略、超时和输出记录。调度器启动时读取 SQLite 任务，按 cron/固定时间触发，所有执行进入 JobRun 表。对错过的触发应定义 skip/run-once 策略，避免启动后同时补跑大量任务。无人值守任务不能自动继承某次手动放行的高权限工具授权。时区、夏令时和重复触发必须测试。

## 22. 更新与恢复设计

### 22.1 原则

- **检查与安装分离**：后台可检查、下载；默认只有经本机 TUI 或已认证高权限 Web 操作显式确认后才能安装。
- **启动器稳定**：Launcher 管理 `current` 指向哪个版本，Updater 在 Server 停止后原子切换版本指针，不能依赖正在运行的 Server 覆盖自己。
- **安装包可信**：校验预置发布公钥对应的签名，SHA-256 仅用于完整性对比，不替代可信签名。
- **数据独立**：版本目录与持久化数据完全分离，升级前备份数据库和关键配置。

### 22.2 状态机

`IDLE → CHECKING → AVAILABLE → DOWNLOADING → VERIFYING → WAITING_SAFE_POINT → SWITCHING → RESTARTING → HEALTH_CHECK → SUCCESS`；失败执行 `ROLLBACK_CODE → RESTART_OLD_VERSION → REPORT_FAILURE`。若数据库已发生不可逆迁移，则需要专门的备份恢复流程，不能假定只切回旧 JS 就能兼容。

### 22.3 行为约定

Agent Turn、部署、文件写入或其他不可中断操作仍在执行时，更新进入等待安全点状态。Web 在更新前收到 `system.update-starting`，并在重启后重连；服务是否继续运行由 PM2/Runtime 独立管理。平台差异需对 Windows 文件锁、macOS 权限和 Linux systemd 特别测试。

## 23. 安全边界与威胁模型

### 23.1 主要威胁与措施

| 威胁 | 主要防护 | 残余风险 |
|---|---|---|
| 陌生人访问公网 URL | HTTPS、默认 loopback、TUI 配对、设备凭据 | 已授权凭据失窃 |
| 配对请求冒领 | 双端编号核对、短时一次性码、失败限流 | 本机操作者误批准 |
| XSS/预览页面攻击管理 UI | 独立预览来源、严格 Cookie 域、CSP | 受信任域配置错误 |
| Agent Prompt Injection | ToolPermissionEngine、敏感操作审批、密钥隔离 | 任意 Shell 被授权时难以限制后续行为 |
| 不可信 npm scripts | 隔离执行账户/沙箱、显示风险 | 单机不隔离运行存在主机访问风险 |
| 伪造 Proxy 目标 | 仅已登记 Service、loopback 固定目标 | 不安全的重定向/Host 处理 |
| API Key 泄漏 | 凭据引用、加密存储、日志脱敏 | 进程内可用密钥仍需保护 |
| 多客户端资源冲突 | Session Turn 锁、文件版本检查、服务锁 | 外部进程可绕过应用锁 |
| 更新供应链攻击 | 签名验证、版本回滚、原子切换 | 签名私钥被盗 |

### 23.2 审批模型

- `SAFE_READ`：在已授权路径内读取项目内容。
- `PROJECT_WRITE`：在受控 FileManager 内写项目文件，记录 Diff 和冲突校验。
- `EXECUTE_CODE`：运行 Shell/包管理器等能执行任意项目代码的能力，不宣称只凭 cwd 即安全；首版至少明确一次可信授权策略。
- `DEPLOY_SERVICE`：创建或替换长期运行服务，必须审批具体部署计划。
- `HOST_SENSITIVE`：读取敏感系统数据、管理员权限、清除重要数据；默认拒绝或重新认证 + 本机批准。

“允许一次/本 Turn/本项目”必须绑定**能力、资源范围、失效时间**，不允许无限扩张为 `sudo *`。审计记录谁（客户端凭据 ID）、何时、哪个 Agent Turn、调用什么能力、审批与结果。

## 24. 测试与验收矩阵

| 类别 | 场景 | 合格标准 |
|---|---|---|
| 初始化 | 未初始化服务被公网访问 | 无法抢先设置管理员；只能看到限流配对/不可用提示 |
| 配对 | 新设备申请，本机 TUI 一次允许 | 正确配对后可进入；关闭/过期按规则失效 |
| 白名单 | 始终允许设备与撤销 | 凭据有效可快捷进入；撤销立即使 HTTP/WS 授权失效 |
| 多设备 | PC 和手机同时连接 | 共享项目/会话/服务实时状态，UI 窗口布局独立 |
| Agent | DeepSeek/GLM 工具循环 | 能读取项目、修改代码、运行测试；可取消与查看审计 |
| 切模型 | GLM → DeepSeek | 当前 Turn 不受影响；下一 Turn 使用新模型且历史可阅读 |
| 恢复 | Agent 运行中刷新/断网 | 重连后补齐事件，后台执行不因 WS 断开自动取消 |
| 并发 | 同一项目两会话同时改同文件 | 无静默覆盖；冲突/排队可见 |
| 终端 | 多 Tab、多项目筛选、隐藏/恢复 | PTY 不重复创建；关闭视图不杀进程 |
| 服务 | 构建并部署 Node 项目 | 审批前不部署；部署后能查看状态、日志和健康检查 |
| 预览 | 远程输入 localhost:5173 | 看到主机 Vite 页面和 HMR；端口无需公网开放 |
| 预览安全 | 未登记任意 localhost 端口 | 拒绝代理与审计，不存在通用内网转发接口 |
| 更新 | 下载到一半、签名错误、健康检查失败 | 不启用坏版本；可恢复旧版本并报告失败 |
| 跨平台 | Win/macOS/Linux | 终端、路径、PM2、启动、更新至少完成平台冒烟测试 |
| UI | 原 PRD 7.1 六条 | 与 Demo 一致，且真实状态不能伪装为执行成功 |

## 25. 开发工作包与依赖顺序

### M0：工程底座与可信启动

- Monorepo：`apps/web`、`apps/server`、`packages/shared`、`packages/agent`、`packages/resources`、`packages/ui`。
- TypeScript、数据库 migration、日志、配置与系统状态检查。
- Launcher/TUI 本机 IPC 基础、受保护初始化、配对请求和认证中间件。
- 验收：新机启动 → 初始化 → TUI 批准浏览器 → 完成认证。

### M1：项目、会话与最小 Agent

- Project/Session/Turn/Event 模型及完整 CRUD。
- DeepSeek/GLM 至少一个 Provider 联通、标准化事件、简单文件工具及审批。
- Web 三栏、聊天实时流、事件补发。
- 验收：新增项目 → 发送任务 → 查看输出 → 刷新后恢复历史。

### M2：开发资源与窗口层

- FileManager、GitManager、CommandRunner、TerminalManager。
- WindowManager、多 Tab、右侧分区、顶部工具恢复。
- 文件冲突检测和终端输入控制 Lease。
- 验收：Agent 运行测试、用户看终端/文件/Git；切换会话资源保持。

### M3：本机服务与 Preview

- NativeProcessAdapter + PM2Adapter + 服务状态/日志。
- PreviewRegistry + 安全内部代理 + 浏览器窗口。
- 验收：Agent 启动 Vite → 服务列表自动出现 → 远程地址栏 `localhost:5173` 预览。

### M4：部署闭环与权限加固

- 构建计划、人工审批、部署记录、健康检查、故障恢复。
- Host/Project 不同能力的权限规则、审计、失败回放测试。
- 验收：Agent 修改 → 测试 → 构建 → 审批 → 持久服务运行。

### M5：多模型、自动化与更新

- 完整 DeepSeek/GLM 配置与 Profile 切换、上下文压缩。
- Cron/JS/Agent Jobs、日志与失败通知。
- Release 发布、签名、Launcher/Updater、升级回滚。
- 验收：切模型无历史丢失；任务可重启恢复调度；错误更新不破坏旧版本。

## 26. 推荐代码目录

```text
apps/
  web/src/
    app/ components/layout/ components/windows/
    features/chat/ features/projects/ features/resources/
    features/git/ features/services/ features/settings/
    stores/ hooks/ lib/
  server/src/
    bootstrap/ auth/ tui/ api/ ws/
    domain/projects/ domain/sessions/
    modules/agent/ modules/resources/ modules/scheduler/
    modules/preview/ modules/updates/
    db/ security/ events/ platform/
packages/
  shared/        # DTO / schema / event types
  agent/         # Provider + context + tool registry
  resources/     # terminal/service/git/file abstractions
  ui/            # Window / Tab / theme primitives (optional)
scripts/
  build/ release/ test-e2e/
```

约定：业务 DTO 使用 Zod/JSON Schema 统一定义，并共享给 API 客户端；Server 不依赖 React；所有 Host/OS 差异收敛至 `platform/` 与 Adapter。

## 27. 开发过程中的决策记录（ADR）

| ADR | 决策 | 理由 |
|---|---|---|
| ADR-001 | 单机、单 Workspace、多设备共享 | 保持产品轻量，不做租户系统 |
| ADR-002 | TUI 设备审批 + 浏览器短期会话 | 外网入口不以密码单独放行 |
| ADR-003 | Session 与 Agent Provider 分离 | DeepSeek/GLM 跨模型切换 |
| ADR-004 | ResourceManager 独立于 WindowManager | 关闭窗口不杀终端/服务 |
| ADR-005 | 生产服务 PM2 Adapter，开发服务 Native | 保活与交互进程按生命周期区分 |
| ADR-006 | 已注册服务的内部代理 + iframe | localhost 输入体验，不暴露开发端口 |
| ADR-007 | 预览与管理端不同来源 | 阻断项目脚本同源访问管理权限 |
| ADR-008 | Launcher/Updater 与 Server 分离 | 更新/回滚无需运行中自覆盖 |
| ADR-009 | 暂不支持 Electron 窗口远控 | 避免原生捕获/WebRTC 跨平台复杂度 |
| ADR-010 | 单 JS 启动入口，容许伴随资源目录 | 兼顾部署简便与 PTY/PM2 可用性 |

## 28. 待验证的工程风险与决策门槛

1. **Provider 兼容性**：DeepSeek/GLM 在所选模型、流式工具调用、思考模式、上下文传递上的差异需通过实际 API 端到端测试确定。
2. **PTY 单入口发布**：`node-pty` 对操作系统/CPU 架构的预编译支持、Node ABI、打包寻址须做独立 PoC。
3. **PM2 随包交付**：实际安装后 PM2 Daemon 所需资源、日志目录、环境变量与进程恢复机制须验证。
4. **Preview 隔离域**：如果只拥有一个域名/无通配 DNS，需解决独立站点隔离与可访问性，不应静默退化到管理页面同源。
5. **执行沙箱**：没有容器的情况下如何真正限制 Agent 运行代码对本机的访问，需根据 Win/macOS/Linux 分别 PoC；优先界定产品的可信代码假设。
6. **TUI 不在线**：后台服务/无显示器主机如何进行本机审批与紧急恢复，必须验收。
7. **安全更新**：签名密钥管理、安装权限、SQLite 迁移与自动回滚需单独演练。

---

# 第三篇：交付、使用与维护约定

## 29. 初始配置示例

```json
{
  "server": { "host": "127.0.0.1", "port": 3210, "trustedProxies": [] },
  "workspace": { "mode": "single", "dataDir": "<OS_USER_DATA>/Larness" },
  "auth": { "deviceApproval": "local-tui", "requireHttpsForRemote": true },
  "agent": { "defaultProvider": "deepseek", "maxConcurrentTurns": 2 },
  "services": { "productionRuntime": "pm2", "developmentRuntime": "native" },
  "preview": { "enabled": true, "registeredServicesOnly": true },
  "updates": { "channel": "stable", "autoCheck": true, "autoInstall": false }
}
```

配置示意中没有 API 密钥，密钥通过本地 Secret Store 管理。远程 HTTPS、预览独立域名与更新源信息需要在首次向导或高级设置中明示。

## 30. 日志与故障排查

建议日志分层：`server.log`、`security-audit.log`、`agent/<turn>.jsonl`、`terminal/<terminal>.log`、`service/<service>.log`、`update/<run>.log`。日志输出明确包含关联 ID、严重等级与时间，不记录完整配对码、Cookie、Token、API Key。提供 TUI `status/logs/doctor` 及 Web 诊断页；Web 诊断页仅对已授权设备显示脱敏信息。

## 31. 发布验收清单

- [ ] Win/macOS/Linux 至少一组可复现安装测试。
- [ ] 未初始化系统不会暴露公网管理初始化接口。
- [ ] 新设备配对、拒绝、始终允许、撤销均通过安全测试。
- [ ] Agent 读取/修改项目、工具审批、日志、取消、断线恢复验收。
- [ ] Native PTY、多 Tab、项目筛选与视图关闭语义验收。
- [ ] PM2 本机生产服务启动、保活、日志、健康检查验收。
- [ ] 内嵌本机 Vite 预览与 WebSocket HMR 验收。
- [ ] 不可信 Preview 无法访问管理端的认证数据。
- [ ] 多客户端共享资源、独立窗口布局、并发冲突处理验收。
- [ ] 更新签名校验、失败回滚、数据库备份与恢复演练。
- [ ] 原 PRD UI Demo 约束保持：三栏、顶部全局入口、可调高右栏、无 Dock。

## 32. 本文的实现界限

本文件给出了目标架构与接口草案，不等于所有工程细节已经验证。特别是 WebAuthn 的具体配对协议、跨平台 PTY/PM2 发布、强执行隔离、预览独立域名和升级回滚，需要在对应里程碑通过独立 PoC、威胁建模与测试后最终定稿。

---

# 第四篇：架构决策冻结与边界约束（v3.0 新增，具有最高优先级）

> 本篇将 2026-10-30 确认的六项推荐决策正式定稿；与前文旧版提法不一致时以本篇为准。本文是**设计与验收依据**，并不表示系统已经实现、经过安全审计或达到生产可用级别。

## 33. 决策基线与适用顺序

### 33.1 已确认决策（不再作为开放问题）

| ID | 范畴 | 冻结决定 | 强约束 |
|---|---|---|---|
| ADR-001 | 用户模型 | **单实例、单工作空间、多授权客户端** | 无业务多用户、角色、租户隔离；不同浏览器的布局互不影响 |
| ADR-002 | Agent 权限 | **可信开发机模式**，项目内常规操作允许；越界和敏感操作审批 | 不得将 cwd、路径过滤或字符串黑名单宣称为 Shell 沙箱 |
| ADR-003 | 并发 | **同项目写任务串行，其他项目可并发** | 同一会话同时只运行一个 Turn；跨项目共享文件/服务仍需资源级协调 |
| ADR-004 | 终端恢复 | **临时 PTY 不跨 Larness 重启恢复** | 重启后原 PTY 标记中断；PM2 生产服务独立持久化 |
| ADR-005 | 生产部署 | **统一构建 → 审批 → PM2 部署 → 健康检查 → 记录** | 生产服务变更不得绕过审批与审计；未经结构化部署登记的任意 Shell 不能被宣传为“受管部署” |
| ADR-006 | 设备准入 | **本机 TUI 审批或预置离线恢复码** | 不允许已有 Web 设备直接批准新设备；TUI 不可用时新设备默认拒绝 |
| ADR-007 | 更新 | **自动检查，手动安装，等待任务安全结束** | 不因更新强杀 Agent 执行；安装由外部 Updater/Launcher 接管 |
| ADR-008 | 模型 | **DeepSeek、GLM 优先**，每 Turn 固定模型 | 支持多 API Key Profile；切模型仅在下一轮执行 |
| ADR-009 | 运行位置 | **所有代码与服务均运行在 Larness 本机** | 不设计 SSH Host、Docker 集群或远程部署节点 |
| ADR-010 | 交互 | **三栏 Chat-first + 顶部入口 + 全局悬浮多 Tab** | 右栏文件/服务/终端/Git 可同时展开；**无底部 Dock** |
| ADR-011 | 浏览器 | **仅本机 Web 服务的内嵌预览** | 地址栏可输 `localhost:5173`，后台内部安全代理；Electron 原生窗口、WebRTC 不纳入首版 |
| ADR-012 | 服务生命周期 | **NativeProcess（开发）与 PM2（长期服务）分开** | Larness 需由 OS 服务管理器/外部守护负责自身启动与恢复 |

### 33.2 需求优先级和“完成”的定义

1. 本篇的冻结决策与安全不变量优先于旧 PRD 或早期讨论中的冲突示例。
2. 原 PRD v1.1 的 UI 详细约束继续有效：浅色默认、主题切换、右侧分区可调整高度、红黄绿窗口按钮、顶部工具入口恢复、无 Dock。
3. P0 = 可靠且安全的最小闭环；P1 = 可用的完整开发部署体验；P2 = 自动化与增强。优先级不代表可以将认证、授权、审计延后。
4. **验证通过**只表示对应测试在特定平台与环境成立；不自动外推到 Windows、macOS、Linux 所有发行版和无头设备。

## 34. 信任模型与权限边界

### 34.1 必须区分的身份与权限

- **Client（客户端）**：通过配对并持有有效凭据的浏览器实例；不是业务用户账户。
- **Operator（本机操作者）**：可访问受 OS 权限保护的 TUI 管理通道，能审批设备、撤销凭据和执行恢复。
- **Agent（模型调用者）**：只提出工具调用请求；不享有 Client 或 Operator 的固有权限。
- **Execution Identity（系统账户）**：执行 PTY、构建脚本、PM2 的实际 OS 身份；这是最后的权限上限。
- **Preview Origin（预览页面）**：不可信项目脚本，绝不能获取管理站点的会话和 privileged API。

**关键边界**：项目目录白名单只可约束 Larness 自己实现的文件工具；只要允许未隔离的任意 Shell、npm lifecycle scripts 或 Node 脚本执行，该代码就可能以 Larness 所在 OS 账户的权限读取非项目文件。因此 V1 的“可信开发机模式”**不是安全沙箱，也不提供对恶意 Agent/恶意项目的强隔离保证**。

### 34.2 统一审批分级

| 级别 | 例子 | V1 行为 | 是否可记忆 |
|---|---|---|---|
| L0 阅读 | 读取已授权项目文件、Git status/diff、查看服务状态 | 默认允许 | 无需记忆 |
| L1 常规开发 | 项目文件编辑、测试、构建、安装项目依赖、启动受控开发服务 | 默认允许，但必须有工具超时、输出限制和审计摘要 | 仅可信项目策略；仍有运行脚本风险 |
| L2 高权限 | 项目外路径、Git push、服务新增/重启/部署、环境变量修改、网络服务暴露 | 逐次明确审批；可对**窄作用域**设置本会话/本项目授权 | 可选、可撤销、有效期有限 |
| L3 极高风险 | 系统账户/权限、防火墙、敏感凭据、删除关键数据、OS 特权命令 | 默认拒绝自动执行；如开放需本机侧再次确认与能力受限的 helper | 不可永久自动记忆 |

> 自动批准不得被解释成“任意 shell 可以保证只影响项目”。对需要真实隔离的用户，应在将来的 OS 沙箱/独立账户方案落地前禁用高风险自动运行，而不是仅增加提示文案。

### 34.3 后端强制授权

- 所有 REST、WebSocket、文件、终端、服务、Git、预览与下载接口均鉴权；前端按钮隐藏不构成授权。
- 每次工具执行必须带 `clientSessionId`（如用户触发）、`agentSessionId`、`turnId`、`projectId`、`policySnapshotId` 与 `approvalId`（如需）。
- 权限决策发生在后端、真正执行前；审批参数与最终执行参数做规范化后的等值/范围校验，防止审批后替换命令、路径或环境。
- `SecretStore` 只能向受控工具按需注入秘密；模型上下文、日志、事件数据、前端 API 响应不能包含明文 Key。一般 shell 子进程读取环境变量/文件的能力需纳入威胁模型。
- 不允许以“管理员已登录”为由直接向 Agent 赋予 Host 全权限。

## 35. TUI 初始化、设备配对与凭据生命周期

### 35.1 本机初始化

1. 首次启动先创建数据目录与 SQLite，校验目录权限；未初始化时不开放业务接口。
2. 本机 TUI 初始化管理员恢复凭据、监听地址、公共访问 URL、更新通道、日志和安全选项。
3. 管理密码使用 Argon2id 等适当的密码哈希；初始化密钥、签名公钥/设备凭据保存在受 OS 权限保护的数据目录。
4. 正常运行：`node app.js` 启动服务；`node app.js tui` 通过**本机受保护 IPC**连接管理端，避免依赖长期占用的交互式 stdin。
5. TUI 未打开时，Larness 仍正常运行、现有可信设备正常工作；新设备申请挂起直到可用的本机审批或有效恢复机制。

### 35.2 设备配对协议（状态机）

`REQUESTED → APPROVED_ONCE | APPROVED_TRUST → CODE_ISSUED → REDEEMED → ACTIVE`；拒绝、超时和撤销分别进入 `DENIED / EXPIRED / REVOKED`。

1. 未认证浏览器只可访问配对和健康受限页；创建带服务端随机 ID 的配对申请；按 IP/会话速率限制。
2. 浏览器展示短请求编号；TUI 显示相同编号、申请时间、客户端自报信息、网络来源（**IP/User-Agent 不作为可信身份**）。操作者核对编号。
3. TUI 选择 `允许本次`、`始终允许` 或 `拒绝`。审批后服务端生成密码学安全随机的一次性高熵配对码，仅向本机 TUI 展示。
4. 浏览器输入配对码；后端校验：绑定请求、短期过期、尝试次数限制、原子消费、防止竞态与重放。
5. `允许本次` 仅签发有明确绝对/空闲期限的会话凭据；`始终允许` 建立可撤销的持久设备凭据（优先 WebAuthn/Passkey；fallback 为随机 opaque cookie Token，并明确其被窃取可重放的风险）。
6. 可信设备以后用持久凭据获取**短期会话**，不直接维持永不过期的访问 Cookie；设置 HttpOnly/Secure/SameSite；同站跨源场景仍须 CSRF 防护。
7. 本机 TUI 可以撤销设备，事务性作废其关联会话与刷新凭据，并强制断开相应 WebSocket；审计记录撤销时间。
8. 恢复码仅在初始化或可信本机 TUI 中创建，离线保管、一次使用、只用于恢复/配对，不允许无限复用；不通过网页提供“忘记密码直接批准”。

**边界**：浏览器指纹无法可靠识别物理设备，Passkey 也可能同步到其他设备；产品应称“可信凭据/浏览器授权”，不承诺物理设备不可复制。若将来要强绑定硬件，需单独引入设备证明并评估平台限制。

### 35.3 公网访问前置条件

- Larness 默认监听 `127.0.0.1`；公网由用户配置 HTTPS 反向代理或受保护隧道，不能把裸 HTTP 管理端暴露公网。
- 设置 Host/Origin 白名单、WebSocket 握手与升级鉴权、登录/配对限速、会话吊销及安全审计。
- 后端必须对 Cookie 会话执行 CSRF 防护；上传、文件写入、命令执行、审批和设备管理都为敏感接口。
- TUI 本机 IPC 权限不得仅依据“请求来自 localhost”认定安全；要使用 OS 文件/管道权限与管理凭据。
- 设备失窃、浏览器凭据窃取、反向代理配置错误为显式剩余风险；具备远程 Shell 的环境建议额外采用 VPN/零信任入口防护。

## 36. 多客户端一致性与并发锁

### 36.1 一致性原则

- 所有认证客户端看到**同一份**项目、会话、任务、服务、终端和 Git 数据；窗口位置、打开 Tab、折叠高度、当前查看会话与主题偏好由各客户端独立保存。
- WebSocket 是事件通知层，SQLite/资源管理器是权威状态层；浏览器断线使用 `lastEventSequence` 补拉差异。事件补拉过期则全量重同步。
- 同一 `AgentSession` 同时最多一个 Running Turn；发送第二个请求时应拒绝或排队并给出明确 UI 状态。
- 跨项目 Agent 可并发，但主机 CPU/内存、端口和同一文件真实路径等共享资源仍实行统一配额与冲突检测。

### 36.2 项目写锁定义

- V1 将**会修改工作区的 Agent Turn**视为一个项目写作业，同一项目同一时刻最多一个写作业；项目级写作业串行，并在操作开始前获取锁。
- 人工文件保存采用文件版本校验（mtime + size 不够可靠，优先内容版本/哈希），发生变化提示 Diff / 重新读取 / 显式覆盖，不进行静默覆盖。
- Git 写操作（checkout/reset/rebase/merge/commit）使用项目独占锁；Git 读取可并发。
- PM2 服务部署、重启、删除按 `serviceId` 独占；端口绑定以 OS 实测为准，服务注册时检查已占用端口。
- 终端允许多客户端观看，**交互输入需控制权租约**；另一个客户端可申请接管或等待租约到期，主动控制权交接有记录。
- 锁必须包含 owner/executionId、过期时间、心跳与 fenced token，进程崩溃时可回收；不能只用一个永久布尔标记。
- 项目锁无法限制用户在系统终端或其他外部程序修改文件，这一限制必须在文档与用户界面说明。

### 36.3 死锁和取消

- 多锁固定顺序：`global-maintenance → project → service → file/git`，避免反向获取造成死锁。
- 取消 Agent 时停止新的工具调用；正在运行的命令尝试优雅终止，超时再升级信号；不可撤销的外部操作必须明确反馈。
- 调度任务、用户请求与后台部署设定公平排队；不能让定时任务无限阻塞互动操作。

## 37. Agent 执行与模型边界

### 37.1 原生 Agent 优先

- 以 DeepSeek / GLM 为首批模型，AI SDK 仅作为模型调用、流式与工具循环基础；Larness 控制上下文、工具、权限、持久化与生命周期。
- `ProviderAdapter` 应声明 tool calling、流式、多模态、reasoning、最大上下文、响应格式等能力；“OpenAI compatible”不等于协议完全一致，须对每个模型做契约测试。
- `Session → Turn → Step/ToolCall → Event` 由 Larness 定义；每个 Turn 记录 provider、model、credentialProfileId、参数与结果，切换模型只影响新 Turn。
- 厂商私有 reasoning 数据不得简单拼接给别的模型；保存结构化任务进度、决策摘要、相关文件与工具结果，以 ContextBuilder 构造可迁移上下文。

### 37.2 执行状态机与持久化

`QUEUED → PREPARING → RUNNING → WAITING_APPROVAL → RUNNING → COMPLETED / FAILED / CANCELLED / INTERRUPTED`。

- 发起执行、工具请求、批准、工具返回、文件变更、终止状态均写入 SQLite 事件日志，事务中递增序号。先持久化关键状态再推送 WebSocket。
- `WAITING_APPROVAL` 持久化审批资源 ID、参数摘要、作用域、过期时间；超时默认拒绝，取消 Turn 作废审批。
- 客户端刷新/断连只改变订阅，不取消执行；Larness 进程崩溃后原 Tool/PTY 是否继续无法假定，启动时把未知状态标记为 `INTERRUPTED` 并执行资源对账。
- Tool 输出限定大小，支持截断与附件化；要防止日志/工具结果无限扩展上下文。
- Agent 应有最大循环次数、最大时长、token/费用预算、命令超时和中断控制，不允许无限自循环。
- 自动化 Agent 只能使用专门授权的有限工具清单，不继承交互会话的一次性批准。

### 37.3 工具控制规则

| 工具 | 默认操作 | 审批/限制 |
|---|---|---|
| Files | 授权项目内的读取/差量编辑/搜索 | 越界路径需要批准；符号链接与 TOCTOU 需专门处理 |
| Command | 可信项目内运行 build/test/lint/dev | 命令可能执行任意代码，不能承诺文件沙箱；限制 OS 身份、时间、进程树及资源 |
| Git | status/log/diff；局部 add/commit 可按项目策略 | push、reset、force、删除分支、变更远端需明确批准 |
| Service | 查询状态、查看日志；受控开发服务 | 生产部署、覆盖、删除、开机启动必须走结构化审批 |
| Preview | 打开已登记服务页面 | 禁止任意地址代理、私网探测及转发管理接口 |
| Secrets | 不向模型直出密钥 | 仅受控工具按具体操作读取，记录 secretRef 而非值 |

## 38. 终端、服务、部署与恢复边界

### 38.1 三种执行资源的定义

| 类型 | 典型操作 | 生命周期 | 重启恢复保证 |
|---|---|---|---|
| CommandExecution | `pnpm test`, `git status` | 短时、单次 | 不保证恢复；结果记录保留 |
| Terminal (PTY) | 用户交互 Bash/PowerShell | 进程存活时可重连/多客户端查看 | Larness 进程重启后不恢复原交互状态 |
| ManagedService | `node dist/main.js` / PM2 | 长期、后台、自启配置 | 需 PM2 与 OS 开机自启配置完成并验证；失败须可见 |

- 关闭资源窗口只是关闭视图；终止 PTY 或 ManagedService 必须发出独立操作。
- Agent 的普通命令不自动产生终端 Tab；只有需要持续交互的任务显式创建终端。
- Larness 更新或重启前，已持久化的 PM2 服务尽量不中断；若无法保证则须展示“此次更新将影响托管服务”的预估影响并要求确认。
- 启动后与 PM2 进程列表进行 reconcile；缺失服务标记异常、不能凭数据库显示“运行中”。

### 38.2 单机生产部署标准流水线

1. `Validate`：确认项目目录、依赖、构建命令、端口、启动文件、已有服务与配置引用。
2. `Build`：在工作目录运行安装/测试/构建；固化执行日志、源码版本（如有 Git）、构建摘要。
3. `Plan`：记录目标服务、预期变化、重启影响、健康检查、可能回滚方案。
4. `Approve`：人工确认**具体部署计划**，批准绑定该计划哈希和有限有效期。
5. `Apply`：通过 ServiceManager → PM2Adapter 启动/更新项目服务，记录版本 ID。
6. `Verify`：检查启动状态、端口/HTTP 健康、日志错误，按超时规则判定结果。
7. `Commit`：成功后标记为当前部署，保存历史；失败显示状态、日志、可操作的恢复路径。

**回滚约束**：只有保留旧构建产物、旧配置和对应依赖时才能可靠回滚应用二进制；数据库迁移、外部数据写入等可能不可逆，不能承诺“一键回滚恢复所有数据”。

### 38.3 PM2 与系统进程约束

- `ServiceManager` 必须提供独立接口，`PM2Adapter` 为可替换实现，禁止 UI/Agent 直接依赖 PM2 命令格式。
- PM2 能托管进程，但不负责主机安全沙箱、容器网络隔离、项目环境依赖隔离。
- Larness 进程不由其自身内部 PM2 自举守护；开机启动与重启需通过 OS 服务管理器或稳定 Launcher。
- Windows/macOS/Linux 支持范围按分平台 PoC 公布；不能假设 PM2 startup 在各 OS 完全一致。

## 39. 预览代理、浏览器与来源隔离

### 39.1 URL 映射

输入：`http://localhost:5173/dashboard?x=1` → 后端识别 `registeredServiceId` → 预览代理 URL → iframe 加载；地址栏仍展示原始 localhost URL。

- 禁止将前端输入直接作为 proxy upstream；目标只能是 ServiceRegistry 中已登记且允许预览的本机 HTTP 服务。
- 代理需要转发 HTTP、WebSocket、重定向、静态资源和 Vite HMR；对绝对资源路径的兼容性需 PoC 验证。
- 不允许预览代理访问 Larness 管理端口、本机 IPC、云元数据端点或任意外部 IP。
- 用户可通过权限校验的服务详情打开预览；任意未登记端口不能当作通用公网 TCP 转发器。

### 39.2 独立来源是上线前置条件

- **安全默认**：预览域名独立于管理站点的站点范围（优先不同注册域），管理 Cookie 不被预览来源接收；预览页面不得拥有管理 API 的 CORS 许可。
- 使用 iframe sandbox、严格 CSP、frame-ancestors 策略并评估开发服务兼容性；不能通过无条件删除安全响应头来“修复一切预览”。
- 预览域的认证可采用短期作用域票据，绑定注册服务和浏览器会话；不得在 URL 长期暴露主账户凭据。
- **如无独立预览来源，首版应选择禁用公网内嵌预览、仅在受控本机环境使用或提示外部打开等安全降级，而非默认同源 iframe 执行不可信 JS。**
- 不支持完整第三方网页浏览器、浏览器内核控制、Electron 原生桌面窗口、WebRTC/VNC。

## 40. 自动更新、数据与备份边界

### 40.1 更新流程与锁

- 每日自动检查更新（允许用户关闭检查）；**下载安装必须由 Web/TUI 人工触发**，不默认自动安装。
- 更新依赖可信发布通道、内置签名公钥与独立 Release 签名；只校验 SHA256 而不校验可信签名不够。
- 执行 `UpdateLock`：禁止启动新 Agent Turn、部署和数据库写迁移；等待现有任务达到安全点并征求用户确认后执行。
- 不得把“安全点”假定为任意 JS await：正在写文件、Git 更新、部署切换、数据库事务等必须先完成或回滚。
- 独立 Launcher/Updater 下载、校验、准备新版本、切换、重启与健康检查；应用自身不可将“覆盖正在运行的 app.js”作为唯一更新策略。
- 失败时回滚**程序版本**并恢复兼容的配置；数据库如果发生不可逆迁移，需要人工修复/备份恢复机制，不能声称所有数据都可自动回滚。
- 重新连接的客户端应看到更新状态和明确的执行中断记录，不把已中断任务显示为完成。

### 40.2 保留与备份

- `data/` 与 `releases/` 分离：SQLite、设备凭据、模型 SecretStore、会话事件、任务、审计、布局配置与用户上传产物不得被更新覆盖。
- SQLite 备份使用一致性备份机制（不可在 WAL 写入时仅复制单一 `.db` 文件就假设数据完整）。
- 项目源码为用户已有目录：**默认不随 Larness 备份、删除或更新**；备份项目源码需要用户明确配置。
- 备份包含高敏感 API Key/设备凭据时必须加密并限制恢复权限；默认保留策略与磁盘上限需在产品设置中可见。
- 删除项目关联不得删除磁盘源码；清理 Session/Artifacts/Logs 分别设置预览与确认。

## 41. 单入口交付与兼容性验收

### 41.1 交付原则

- 对外使用 `node app.js` 作为**稳定入口**；可以有平台原生 `.node` 模块、PTY 运行资源、PM2 文件和独立 Launcher/Updater。**“单入口”不等于“发布目录只允许一个 JS 文件”。**
- 必须支持无公网条件下的本机启动与离线资源管理；LLM API 不可用时 Web 文件管理、终端、Git、服务和 TUI 仍可使用。
- 前端静态文件优先内嵌构建产物，运行数据与项目不嵌入发布包。
- Node、PTY、PM2 在 Windows x64、macOS arm64、Linux x64 各选一台真实机器做 PoC；版本矩阵以实际 CI/发布记录为准。

### 41.2 不作出的保证

- 不承诺 `node app.js` 在没有 Node.js 安装的主机可运行。
- 不承诺所有平台/发行版都有完整 PTY、进程统计、后台保活与开机自启能力。
- 不承诺 Larness 崩溃后临时 PTY、命令执行或未完成 Agent Turn 原状态无损恢复。
- 不承诺项目工作目录能对任意 Shell 提供 OS 级文件访问隔离。
- 不承诺任意互联网地址可在 iframe 中显示。

## 42. 最终验收清单（硬门槛）

### 42.1 可信启动与认证（M0 / P0）

- [ ] 未初始化时业务 API 不开放；初始化必须通过本机可信通道进行。
- [ ] 新客户端无授权只能访问配对页；无论 REST、WebSocket 还是静态文件下载均无法读取项目/会话数据。
- [ ] 两台新设备并发申请时，配对码严格绑定申请、限时、限次且一次消费；错误设备无法兑换别人的批准。
- [ ] `允许本次` 过期不可重用；`始终允许` 可以从 TUI 撤销且立即断开现有会话。
- [ ] TUI 关闭、Web 页面刷新、浏览器断网不会影响已有可信客户端后台 Agent/服务。
- [ ] 公网 TLS、Cookie 安全、CSRF、Origin、WebSocket 权限检查通过安全用例。

### 42.2 Agent、并发与资源（M1–M2 / P0）

- [ ] DeepSeek 和 GLM 至少各有一个可用的工具调用/流式场景；切模型只影响下一轮 Turn。
- [ ] 同会话并发 Turn 被可靠拒绝或排队；同项目两个写任务不会同时进入执行区。
- [ ] 跨项目写作业可以并发，共享目标的 Git/服务/端口冲突仍被阻止或提示。
- [ ] 文件手动保存检测 Agent/外部修改，不会静默覆盖。
- [ ] 两台授权浏览器可以同时观看同一终端，输入控制权交接可见；关闭悬浮窗口不结束 PTY。
- [ ] Agent 被取消后，不再新增工具调用；进行中的命令停止或记录未能停止的真实结果。
- [ ] 服务或模型不可用时，项目、文件、Git、终端等独立功能可继续操作。

### 42.3 部署、预览与更新（M3–M5 / P1–P2）

- [ ] 开发服务可启动、记录端口并从右栏/全局服务列表查看日志。
- [ ] `localhost:5173` 能通过已登记服务在**独立来源**预览 Vite 页面，HMR 可工作，5173 不公开到公网。
- [ ] 未登记端口、被禁止端口或指向 Larness 管理端的代理请求在后端被拒绝。
- [ ] 生产部署必须有持久化计划、明确审批、PM2 执行记录与健康检查；审批参数不可被篡改。
- [ ] Larness 重启后原 PTY 标记已中断；PM2 生产服务实际运行状态经过对账，并按配置进行恢复。
- [ ] 自动更新只有检查而不自动安装；任务运行期间不得无提示强行更新。
- [ ] 更新失败能够恢复先前可运行程序版本；数据库迁移不可逆时明确给出恢复指导。
- [ ] 通过跨平台 PoC 验证发布包，文档公开真实支持范围和已知限制。

## 43. 仍需工程验证、但不阻塞需求冻结的事项

| 议题 | 默认实施方案 | PoC / 决策门槛 | 失败退路 |
|---|---|---|---|
| 终端 PTY 分发 | `node-pty` 原生依赖随平台发布 | Win/macOS/Linux 实际产物可运行并正常 resize/重连 | 外置平台模块或仅提供受限 CommandRunner |
| PM2 内置与守护 | PM2Adapter 内置包 + OS 服务管理器托管 Larness | 主机重启后自启、进程列表对账、日志连续性 | 将 PM2 设为可选依赖或使用系统服务适配器 |
| Preview 域名配置 | 独立站点预览入口 + 安全票据 | HTTPS/WSS、Vite HMR、隔离 Cookie 和 CSP | 禁用公网内嵌预览，提示配置独立预览入口 |
| WebAuthn 可信凭据 | 注册后使用 WebAuthn/Passkey | 跨平台浏览器兼容、恢复与吊销机制 | Opaque Token + 明确提示凭据重放风险 |
| 模型兼容 | DeepSeek/GLM ProviderAdapter | 工具调用、流式、reasoning、错误码和上下文格式逐模型测试 | 能力降级并阻止不支持工具的 Agent 任务 |
| 进程隔离 | V1 可信开发机与最小 OS 用户权限 | 安全测试确认 UI 工具范围与真实 shell 边界 | 强制敏感操作确认；禁止宣称为安全沙箱 |
| 文件并发 | 项目锁 + 文件版本校验 | 断电、崩溃、外部编辑与跨项目共享路径测试 | 进入只读/冲突修复模式，不自动覆盖 |
| 程序更新 | Launcher/Updater + 签名 Release | 更新中断、磁盘满、旧 DB 兼容、回滚演练 | 维持旧版本并提供本机手动恢复 |

## 44. 开发与变更管理规则

- 实施任务按 `M0 → M1 → M2 → M3 → M4 → M5` 拆分；每个任务提供前置依赖、输入、接口变化、迁移、测试与回滚说明。
- 对上表任一 ADR 作修改时，新建 ADR，说明背景、替代方案、风险及对 PRD/UI/API/数据库的影响；不得悄然修改冻结决策。
- 变更涉及认证、Secret、权限、执行身份、Proxy、更新签名时，必须新增滥用场景测试和日志脱敏检查。
- 每一阶段必须交付可运行程序与自动化测试，不以静态 UI Demo、模拟 Agent 输出作为后端完成证据。
- 默认按失败关闭（fail closed）：认证不确定、审批过期、资源归属不明、锁状态异常、目标代理未登记时拒绝操作，并向用户展示可恢复路径。

---

**v3.0 最终定义**：Larness 是运行在一台已安装 Node.js 的主机上的单工作空间 AI-first Web IDE；授权浏览器共享项目、对话、终端、服务和 Git 资源。它以 DeepSeek/GLM 驱动 Agent，复用本机资源管理器完成 Node.js 项目开发、预览、构建与 PM2 部署；新设备由本机 TUI 配对准入，敏感操作按后端策略审批，更新由外部更新器在安全时点执行。V1 是可信开发机模式，**不声称拥有针对恶意 Shell 或项目脚本的 OS 级沙箱能力**。
