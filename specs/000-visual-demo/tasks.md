# 任务：S0 视觉 Demo

> 规则：一个任务一个提交；开始前更新 `STATUS.md`，完成后勾选本表并同步 `ROADMAP.md`。  
> 命令在 `D0-1` 落地；未落地前不要假设脚本存在。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| D0-1 | Web 工作区脚手架 | — | `done` |
| D0-2 | 应用外壳与三栏布局 | D0-1 | `done` |
| D0-3 | 主题与视觉系统 | D0-2 | `done` |
| D0-4 | 对话时间线与输入区 | D0-2 | `done` |
| D0-5 | 右侧资源分区 | D0-2 | `done` |
| D0-6 | 窗口层 | D0-2 | `done` |
| D0-7 | 资源窗口内容 | D0-6 | `done` |
| D0-8 | 响应式、键盘与可访问性 | D0-3 ~ D0-7 | `done` |
| D0-9 | Demo 验收与视觉基线 | D0-8 | `review` |

## 任务卡

### D0-1 Web 工作区脚手架

- 状态：`done`
- 依赖：无
- 目标：建立可安装、可开发、可测试、可构建的前端 workspace，后续任务只写业务 UI。
- 交付物：
  - 根 `package.json`（`dev` / `build` / `check` / `test` / `test:e2e`）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`biome.json`；
  - `apps/web`：Vite + React + TS、Tailwind 4、`index.html`、`main.tsx`、占位 App、`styles/{tokens,global}.css`；
  - `packages/shared`：`domain.ts`、`events.ts`、`gateway.ts`、`errors.ts`、`index.ts`；
  - `packages/ui`：Button / IconButton / Tooltip / DropdownMenu / Dialog / Tabs（Radix + Tailwind）；
  - Vitest + Testing Library + happy-dom 配置；Playwright 配置与一条占位 E2E；
  - `mock` 目录与 `MockGateway` 空实现（接口可编译，数据在 D0-2 / D0-4 填充）。
- 验收：
  - `pnpm install` 成功；`pnpm --filter @harness/web dev` 打开占位页；
  - `pnpm check` 通过（Biome、类型、单测）；
  - `pnpm build` 产出 `apps/web/dist`；
  - `pnpm test:e2e` 的占位用例通过（或明确记录浏览器未安装的环境原因）。
- 测试：占位组件渲染测试；E2E 打开首页断言标题。
- 涉及路径：根配置、`apps/web/`、`packages/ui/`、`packages/shared/`、`playwright.config.ts`。

### D0-2 应用外壳与三栏布局

- 状态：`done`
- 依赖：D0-1
- 目标：搭出与文档 3.1 一致的三栏骨架，数据来自 fixtures。
- 交付物：
  - `AppShell` 网格：顶部 48px、左 268px、右 340px、中央自适应；
  - `TopBar`（项目 / 分支、四个工具入口、主机指标、外观与通知占位）；
  - `ProjectSidebar`（品牌、新建会话、搜索、项目树 + 会话、最近会话、底部入口）；
  - `ConversationWorkspace`（会话头、时间线占位、固定 Composer 占位）；
  - `ProjectResourceSidebar` 四分区标题占位；`WindowLayer` 挂载点；
  - fixtures：2 个项目、5 个会话、最近会话去重排序；React Router 根路由。
- 验收：
  - 1440×900 下三栏同时可见，无底部 Dock / 模拟标题栏 / 最左活动栏；
  - 右侧栏整体无滚动条；
  - 切换项目时左侧会话列表与中央标题变化（本地状态即可）。
- 测试：AppShell 渲染三栏；最近会话去重；项目切换。
- 涉及路径：`apps/web/src/app/`、`components/layout/`、`features/projects/`、`mocks/fixtures.ts`。

### D0-3 主题与视觉系统

- 状态：`done`
- 依赖：D0-2
- 目标：落地 spec 6.2 的 token 与三态主题，确保菜单不被裁剪。
- 交付物：
  - `tokens.css`（浅 / 深两套 CSS 变量）、字体层级、圆角、阴影；
  - `ThemeProvider`：`light|dark|system`，`matchMedia` 监听，`localStorage` 持久化，`data-theme`；
  - 顶部外观菜单（portal / 高层级），当前项勾选；
  - 统一图标尺寸与按钮 hover / focus 样式；系统字体与等宽字体栈。
- 验收：
  - A2 全部通过；刷新保留；跟随系统实时变化；
  - 菜单完整显示在内容与分隔线之上；
  - 1440×900 浅 / 深截图无文字过小、无对比度明显问题。
- 测试：`resolveTheme` 单元测试；E2E 切换 + 刷新；菜单层级断言。
- 涉及路径：`styles/`、`app/ThemeProvider.tsx`、`components/layout/TopBar.tsx`、`packages/ui`。

### D0-4 对话时间线与输入区

- 状态：`done`
- 依赖：D0-2
- 目标：用 Mock 数据完整演示一次 Agent 执行与部署审批。
- 交付物：
  - `Timeline` / `MessageItem` / `PlanSteps` / `ToolCard` / `ArtifactCard` / `ApprovalCard` / `ErrorItem`；
  - `Composer`：项目上下文、路径、附件按钮、模型选择、审批策略、发送 / 停止；
  - 输入区与时间线用留白 / 顶部渐变融合，去掉硬分割线；
  - `MockGateway.sendTurn` 异步生成器：脚本化事件、40–80ms 延迟、AbortSignal、审批等待；
  - 流式追加、自动滚动（用户上滚时暂停）、工具卡片折叠、长输出截断。
- 验收：
  - A6 全部通过；Enter / Shift+Enter 正确；发送后清空并保持焦点；
  - 审批批准 / 拒绝状态稳定，重复点击无副作用；
  - 停止按钮产生 `turn.cancelled`，不再追加消息。
- 测试：Mock 事件顺序；Composer 键盘；审批状态；取消。
- 涉及路径：`features/chat/`、`mocks/gateway.ts`、`stores/composerStore.ts`、`packages/shared/src/events.ts`。

### D0-5 右侧资源分区

- 状态：`done`
- 依赖：D0-2
- 目标：实现可调高、独立滚动、可折叠的四分区。
- 交付物：
  - `ResizableSection` / `SectionSplitter` / `useSectionResizer`；
  - 文件树、服务列表、终端列表、Git 状态四个 Mock 面板；
  - 顶部“全部 / 文件 / 服务 / 终端 / Git”视图切换，默认“全部”；单项视图占满右栏，Tab 显示计数 / 运行状态；
  - 分区标题常驻；折叠后空间重分配；`aria-separator` 与键盘调整。
- 验收：
  - A3、A11 全部通过；整栏无滚动条；折叠后剩余分区填满右栏；文件树滚动不影响其他分区；
  - 全部折叠时仍显示四个标题；无 Git 项目显示空态。
- 测试：尺寸计算纯函数；折叠 / 展开；双击均分；键盘步长。
- 涉及路径：`components/sections/`、`features/resources/`、`lib/layout.ts`、`stores/navigationStore.ts`。

### D0-6 窗口层

- 状态：`done`
- 依赖：D0-2
- 目标：实现可拖动、缩放、置顶、隐藏、最大化、关闭的通用窗口系统。
- 交付物：
  - `windowStore`（窗口、Tab、z-index、最小化 / 最大化 / 置顶）；
  - 纯函数 `windowGeometry`：clamp、级联默认位置、还原；
  - `WindowLayer` / `WindowFrame` / `WindowChrome` / `WindowTabs`，集成 react-rnd；
  - 顶部四个入口与窗口联动：打开 / 聚焦 / 恢复；入口激活态。
- 验收：
  - A4 全部通过；关闭 / 隐藏不删除 Mock 资源；
  - 同一资源不重复建窗；最小尺寸 420×280；窗口不会被拖到不可达区域；
  - 点击窗口置顶；置顶按钮生效。
- 测试：open / focus / close / restore / clamp 纯函数；重复打开去重；E2E 黄绿红按钮。
- 涉及路径：`components/windows/`、`stores/windowStore.ts`、`lib/windowGeometry.ts`、`components/layout/TopBar.tsx`。

### D0-7 资源窗口内容

- 状态：`done`
- 依赖：D0-6
- 目标：让五类窗口有可信的 Mock 内容，验证多 Tab 与窗口内布局。
- 交付物：
  - `FileWindow`：文件树 + Monaco 只读 + 多 Tab；同一文件复用 Tab；
  - `TerminalWindow`：xterm.js + 定时伪造输出 + 多 Tab；
  - `WindowTabs` 同排内联项目筛选：下拉最左、Tab 横向滚动、计数最右；Tab 按项目分组并显示来源色点；
  - `ServiceWindow`：状态、端口、启动方式、日志滚动、启停按钮（仅 Mock）；
  - `BrowserWindow`：地址栏、刷新、外部打开占位、静态占位页（不加载真实 localhost）；
  - `DiffWindow`：文件列表 + 静态 diff 高亮。
- 验收：
  - 五类窗口均可从顶部或右栏打开；标题 / Tab 正确；同资源不重复；
  - 从右栏打开自动筛选到项目；顶部入口恢复窗口当前筛选；筛选只隐藏 Tab，不停止资源；
  - 终端输出持续但可暂停；服务日志可滚动；浏览器不发起真实网络请求；
  - Monaco 懒加载，首屏不阻塞。
- 测试：Tab 复用；窗口内渲染；无外部请求断言。
- 涉及路径：`features/windows/`、`features/resources/`、`mocks/`。

### D0-8 响应式、键盘与可访问性

- 状态：`done`
- 依赖：D0-3 ~ D0-7
- 目标：补齐窄屏降级、全局快捷键、焦点与 ARIA，使 Demo 可被键盘完整操作。
- 交付物：
  - 断点：≥1280 全布局；1024–1279 右栏收起；<768 左栏抽屉；
  - 快捷键：Ctrl/Cmd+K 新建会话、Ctrl/Cmd+B 左侧栏、Esc 最高层窗口 / 菜单；
  - 焦点管理：窗口打开聚焦、关闭归还、菜单 Esc 优先、分隔线键盘；
  - `aria-label` / `role` / `aria-live`（流式消息）、`prefers-reduced-motion`。
- 验收：
  - A7 / A8 通过；仅用键盘可完成打开窗口、切换主题、发送消息、批准审批；
  - 无焦点陷阱；Tab 顺序合理；图标按钮均有名称。
- 测试：E2E 键盘路径；组件焦点测试；手动 a11y 清单。
- 涉及路径：`app/AppShell.tsx`、`components/layout/`、`components/windows/`、`styles/global.css`。

### D0-9 Demo 验收与视觉基线

- 状态：`review`
- 依赖：D0-8
- 目标：把 Demo 固化为可回归的基线，并完成人类验收。
- 交付物：
  - Playwright：布局、主题、分区、窗口、键盘、审批六组用例；
  - 截图：1440×900 浅 / 深、1280 窄屏、窗口打开态；
  - `specs/000-visual-demo/acceptance.md`：场景结果、截图链接、已知偏差；
  - `README.md` 补充 Demo 启动方式；`STATUS.md` 更新。
- 验收：
  - `pnpm check`、`pnpm build`、`pnpm test:e2e` 全绿；
  - 无控制台错误、无外网请求、无真实秘密；
  - 人类按 A1–A9 确认（G-S0）。
- 测试：E2E 全量；截图对比阈值；CI 运行记录。
- 涉及路径：`e2e/`、`playwright.config.ts`、`specs/000-visual-demo/acceptance.md`、`README.md`。
