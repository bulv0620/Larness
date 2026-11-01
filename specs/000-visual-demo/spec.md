---
id: 000-visual-demo
title: S0 视觉 Demo
milestone: S0
status: active
depends_on: []
owners: [human]
created: 2026-10-31
updated: 2026-10-31
---

# S0 视觉 Demo

> 源设计：`larness.md` 第 3、7.1、20 章；本切片是**第 0 步**，先建立可交互的视觉与交互基线。
> 重要：Demo 的数据全部来自 Mock，不代表任何后端能力已完成；禁止用 Demo 冒充真实功能。

## 1. 背景与问题

源文档描述了完整的三栏工作台、主题、可调高资源分区与全局悬浮窗口，但仓库中没有任何 UI 代码。后续所有里程碑（认证、会话、终端、服务、预览）都需要一个稳定的前端外壳与窗口系统作为落点。

先做视觉 Demo 的原因：

- 以最低成本确认信息架构、视觉密度与交互细节；
- 把窗口管理、分区拖拽、主题等高风险 UI 逻辑提前验证；
- 为 M0 / M1 留下可复用的组件与状态边界，而不是一次性原型。

## 2. 目标

- G-1：`pnpm --filter @harness/web dev` 可启动，浏览器看到完整三栏工作台。
- G-2：实现顶部入口、左侧项目 / 会话树、中央对话、右侧四分区、全局窗口层。
- G-3：浅色 / 深色 / 跟随系统可切换并持久化；字体、图标、间距符合苹果应用风。
- G-4：窗口可拖动、缩放、置顶、隐藏、最大化、关闭，并能从顶部入口恢复。
- G-5：用 Mock 数据演示一次完整对话、工具调用、产物与部署审批。
- G-6：形成可自动回归的 Playwright 冒烟与截图基线，供后续里程碑复用。

## 3. 非目标

- 不实现认证、配对、会话持久化、真实文件 / 终端 / 服务 / Git / 代理。
- 不接入真实模型；不请求外网。
- 不实现 Monaco 编辑保存、xterm 真实 PTY、iframe 真实预览。
- 不做移动端完整功能；只做可用的窄屏降级。
- 不做多语言、插件、主题编辑器。
- 不把 Mock 状态写入后端；只允许浏览器本地保存 UI 偏好。

## 4. 用户故事

- 作为产品负责人，我希望在浏览器里体验完整布局与关键交互，以便在写后端前确认视觉方向。
- 作为开发者，我希望组件、状态与 Mock 边界清晰，以便 M1 只替换数据源而不重写 UI。
- 作为后续 Agent，我希望有明确的窗口 / 分区 / 主题规则与测试，避免每次改动破坏交互。

## 5. 验收场景

### A1 三栏布局

```gherkin
Given 浏览器宽度 ≥ 1280px
When 打开应用根路由
Then 顶部工具栏、左侧栏、中央对话区、右侧资源栏同时可见
And 页面没有底部 Dock、没有模拟系统标题栏、没有最左侧图标活动栏
And 右侧资源栏整体没有滚动条
```

### A2 主题

```gherkin
Given 首次打开，系统为浅色
When 在顶部外观菜单选择“深色”
Then 所有区域切换为深色 token，菜单完整显示在内容之上且不被分隔线遮挡
When 刷新页面
Then 仍为深色
When 选择“跟随系统”并切换系统外观
Then 界面跟随变化
```

### A3 右侧分区

```gherkin
Given 右侧文件 / 服务 / 终端 / Git 四个分区均展开
When 在文件树内滚动
Then 只有文件分区滚动，其他分区与整栏不滚动
When 折叠“服务”分区
Then 只保留其标题，释放的高度分配给其他展开分区
When 双击文件与服务之间的分隔线
Then 两个分区高度均分
When 聚焦分隔线并按上下方向键
Then 高度按固定步长调整，Shift 加速
```

### A4 窗口控制

```gherkin
Given 顶部“终端”入口存在且尚未打开窗口
When 点击入口
Then 打开终端窗口，默认位置不与已有窗口完全重叠
When 拖动标题栏与右下角
Then 窗口移动 / 缩放，内容自适应
When 点击黄色按钮
Then 窗口隐藏，但 Mock 终端仍在运行
When 再次点击顶部“终端”入口
Then 恢复同一个窗口与 Tab，不重复创建
When 点击绿色按钮
Then 最大化；再次点击还原
When 点击红色按钮
Then 只关闭视图，Mock 资源仍存在
```

### A5 输入区聚焦

```gherkin
Given 对话输入框未聚焦
When 点击输入区
Then 只有外层圆角容器显示聚焦边框
And 内部 textarea 不出现方形蓝色 outline
```

### A6 Mock 对话与审批

```gherkin
Given 当前项目与会话
When 输入“帮我启动开发服务器并预览”并发送
Then 追加用户消息，显示计划步骤、工具调用卡片与流式回复
And 到达部署步骤时出现审批卡片，包含服务名、端口、版本摘要
When 点击“批准部署”
Then 卡片变为已批准，并出现部署结果与产物链接
When 点击“暂不部署”
Then 卡片变为已拒绝，不产生部署结果
```

### A7 键盘

```gherkin
Given 焦点在页面任意位置（输入框内除外）
When 按 Ctrl/Cmd+K
Then 新建一个 Mock 会话并聚焦输入框
When 按 Ctrl/Cmd+B
Then 左侧栏折叠 / 展开
When 打开两个窗口并按 Escape
Then 只隐藏最上层窗口
When 打开顶部菜单并按 Escape
Then 先关闭菜单，不隐藏窗口
```

### A8 窄屏降级

```gherkin
Given 视口宽度 < 1280px
When 打开工作台
Then 右侧资源栏收起，顶部入口仍可打开对应窗口
And 视口宽度 < 768px 时左侧栏变为抽屉，中央对话为唯一主区域
```

### A9 视觉基线

```gherkin
Given 1440×900 视口，浅色主题
When 截图
Then 三栏比例、字体层级、圆角、阴影、边框与图标尺寸符合第 6.2 节 token
And 正文不小于 13px，辅助信息不小于 10px
```

### A10 自动化回归

```gherkin
Given CI 环境安装依赖并构建完成
When 运行 pnpm check 与 pnpm test:e2e
Then 组件测试、布局冒烟与视觉截图全部通过（无外网依赖）
```

### A11 资源区单项视图

```gherkin
Given 右侧四个分区均展开
When 点击“文件”视图
Then 只显示文件分区并占满右栏
And 服务 / 终端 / Git 仅保留 Tab，计数与运行状态仍可见
When 点击“全部”
Then 恢复四分区与之前的分隔线高度
```

## 6. 功能需求

### 6.1 布局与信息架构（MUST）

| ID | 需求 |
|---|---|
| R-1 | 顶部栏高 48px，包含项目 / 分支、终端 / 服务 / 浏览器 / 文件入口、CPU / 内存、外观、通知。 |
| R-2 | 左侧栏默认 268px，包含品牌、新建会话、搜索、项目树（含会话）、最近会话、底部自动化 / 设置 / 工作空间 / 用户。 |
| R-3 | 中央为 Chat-first：会话头、可滚动时间线、固定底部输入区；不嵌入常驻编辑器。 |
| R-4 | 右侧栏默认 340px，四分区可同时展开，标题始终可见，整栏无滚动条。 |
| R-5 | 最近会话包含项目内与独立会话，与项目树使用同一 Session 数据，不重复计数。 |
| R-6 | 所有区域在 1280px 以上不重叠；窗口层位于内容之上、顶部栏之下。 |

### 6.2 视觉 token（MUST）

| Token | 浅色 | 深色 |
|---|---|---|
| `--bg` | `#F5F5F7` | `#1C1C1E` |
| `--surface` | `#FFFFFF` | `#242426` |
| `--surface-2` | `#FBFBFD` | `#2C2C2E` |
| `--border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.08)` |
| `--text` | `#1D1D1F` | `#F5F5F7` |
| `--text-2` | `#6E6E73` | `#A1A1A6` |
| `--text-3` | `#86868B` | `#8E8E93` |
| `--accent` | `#0A84FF` | `#0A84FF` |
| `--success` | `#30D158` | `#30D158` |
| `--warning` | `#FF9F0A` | `#FF9F0A` |
| `--danger` | `#FF453A` | `#FF453A` |
| `--shadow` | `0 8px 30px rgba(0,0,0,.08)` | `0 8px 30px rgba(0,0,0,.4)` |

- 圆角：`--r-sm 6px`、`--r-md 10px`、`--r-lg 14px`、`--r-xl 18px`。
- 字体：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif`；等宽 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`。
- 字号：标题 20/28，正文 13.5/20，导航 12/18，辅助 11/16，最小 10.5/14；路径 / 命令 / 代码用等宽。
- 图标：lucide-react，16–18px，线宽 1.75；按钮必须有可读名称与 hover / focus 状态。
- 工具栏可使用 `backdrop-filter: blur(20px)` + 半透明 surface；边框低对比，不使用粗重分割线。

### 6.3 窗口层（MUST）

| ID | 需求 |
|---|---|
| R-7 | 支持类型：files、terminal、services、browser、git-diff；每种可有多个 Tab。 |
| R-8 | 红 / 黄 / 绿分别关闭视图、隐藏、最大化 / 还原；悬停显示符号与 tooltip。 |
| R-9 | 标题栏拖动、边缘 / 角落缩放；按钮点击不触发拖动；最小尺寸 420×280。 |
| R-10 | 打开同一资源时聚焦已有 Tab 或恢复隐藏窗口，不重复创建；顶部入口显示激活状态。 |
| R-11 | 层级：点击置顶；支持“置顶”按钮；关闭最上层后焦点回到次上层。 |
| R-12 | 窗口位置限制在可视区域内；视口缩小时自动 clamp，不留下不可达窗口。 |
| R-13 | 关闭窗口 / Tab 不改变 Mock 资源状态（终端仍“运行”，服务仍“在线”）。 |

### 6.4 对话与输入（MUST）

| ID | 需求 |
|---|---|
| R-14 | 消息类型：用户、助手、计划步骤、工具调用、文件变更摘要、构建结果、产物卡片、错误、审批。 |
| R-15 | 输入区上方显示项目上下文与工作路径；内部提供上下文添加、模型选择、审批策略、发送。 |
| R-16 | Enter 发送，Shift+Enter 换行；发送后清空并保持焦点；流式期间显示停止按钮。 |
| R-17 | 审批卡片展示服务名、端口、版本摘要、影响说明；批准 / 拒绝后状态持久到 Mock store。 |
| R-18 | 工具卡片可折叠，展示参数摘要与结果；长输出截断并提示。 |

### 6.5 主题、响应式与可访问性（MUST）

| ID | 需求 |
|---|---|
| R-19 | 主题三态：浅色（默认）、深色、跟随系统；写入 `localStorage`，刷新保留。 |
| R-20 | 菜单使用 portal / 高层级，不被右侧分区或分隔线裁剪；Esc 先关菜单。 |
| R-21 | 焦点可见：按钮 / 链接 / 分隔线有 `:focus-visible` 环；输入框只显示外层环。 |
| R-22 | 所有图标按钮有 `aria-label`；窗口有 `role="dialog"` 与 `aria-label`；分隔线可键盘操作。 |
| R-23 | 尊重 `prefers-reduced-motion`；关闭非必要动画。 |
| R-24 | 断点：≥1280 全布局；1024–1279 右栏收起；<768 左栏抽屉 + 右栏隐藏。 |
| R-25 | 右侧资源区提供“全部 / 文件 / 服务 / 终端 / Git”视图切换，默认“全部”；单项视图占满右栏，Tab 显示计数与运行状态；切换不重建资源、不改变分区折叠 / 高度状态。 |

### 6.6 Mock 数据（MUST）

- 2 个项目：`harness-web`（Git，当前分支 `feat/agent-runtime`）、`docs-site`（无 Git）。
- 5 个会话：3 个项目内、2 个独立；最近会话按更新时间排序且不重复。
- 1 个运行中 Turn：3 步计划（读取项目 → 修改代码 → 启动服务），2 个工具调用，1 个待审批部署。
- 3 个服务：`web-dev`（5173，运行中）、`api-dev`（3001，运行中）、`web-prod`（8080，未部署）。
- 2 个终端：项目内 `pnpm dev`、全局 `zsh`；保留输出缓冲。
- Git：5 个改动文件、2 个暂存；Diff 内容为静态示例。
- 主机指标：CPU 38%、内存 9.6 / 16 GB；数值可轻微波动但不接真实采样。
- 通知：1 条“部署待批准”。

所有 Mock 数据集中在 `apps/web/src/mocks/`，组件不得内联业务假数据。

## 7. 接口与契约变更

本切片不改变 REST / WS 契约。新增前端内部契约：

```ts
// packages/shared/src/gateway.ts
export interface Gateway {
  bootstrap(): Promise<Bootstrap>;
  listProjects(): Promise<Project[]>;
  listSessions(query?: { projectId?: string }): Promise<Session[]>;
  getSession(id: string): Promise<SessionDetail>;
  sendTurn(sessionId: string, input: string): AsyncIterable<TurnEvent>;
  cancelTurn(turnId: string): Promise<void>;
  resolveApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<void>;
  // M1 扩展；Demo 只实现以上
}
```

- Demo 提供 `MockGateway`；M1 提供 `HttpGateway`，组件只依赖 `Gateway`。
- Mock 事件类型与 `docs/contracts/ws-events.md` 的 `agent` 主题保持一致，避免 M1 重写渲染层。

## 8. 数据与迁移

- 无数据库。
- `localStorage` 键：`harness.theme`（`light|dark|system`）、`harness.window-layout.v1`、`harness.nav.v1`、`harness.composer.v1`。
- 读取失败 / schema 版本不符时回退默认值并清除坏数据；不得因此白屏。
- 不持久化 Mock 会话、消息、审批结果；刷新后重置（Demo 语义）。

## 9. 安全、权限与审计

- 不接入真实数据；fixtures 中不得出现真实 Token / Key / 内网地址。
- 浏览器窗口占位使用 `about:blank` 或纯静态占位，不加载真实 `localhost`，不绕过 iframe 安全属性。
- 不使用 `dangerouslySetInnerHTML` 渲染 Mock 内容；Markdown 渲染如启用必须 sanitize。
- 不引入第三方统计 / 遥测 / 外部字体 / CDN。
- 本切片无鉴权；路由守卫在 M0-8 接入。

## 10. 失败、边界与恢复

| 场景 | 行为 |
|---|---|
| localStorage 损坏 | 回退默认主题 / 布局，控制台仅 dev 警告 |
| 窗口拖出视口 | 松手时 clamp 到可视区，至少保留 80×40 标题栏可见 |
| 视口缩小到窗口之外 | resize 时自动 clamp / 最大化窗口自适应 |
| 分区全部折叠 | 仍显示四个标题，不出现空白大块 |
| 无 Git 项目 | Git 分区显示“未检测到 Git 仓库”，不报错 |
| 审批已处理 | 卡片显示最终状态，按钮禁用，重复点击无副作用 |
| Mock 流被取消 | 停止追加消息，显示“已取消”，不产生半截审批 |

## 11. 可观测性

- 仅开发环境输出结构化 `console.debug`，生产构建移除。
- 无网络请求（除 Vite 资源）；Playwright 断言无外部请求。
- 关键交互（打开窗口、切换主题、发送消息）不写远端日志。

## 12. 测试计划

- 单元：窗口 reducer（open / focus / close / clamp / restore）、分区尺寸计算、主题解析、MockGateway 事件序列。
- 组件：Composer 键盘与焦点、审批卡片状态、窗口控制按钮、分隔线键盘操作。
- E2E：A1–A8 主流程；A9 截图基线；断言无控制台错误。
- 手动：人类按 A1–A9 验收；记录截图与偏差。

## 13. 开放问题

| 问题 | 默认 | 截止 |
|---|---|---|
| 品牌图标形态 | 使用 “H” 单字母圆角方块，后续可替换 | D0-2 |
| Demo 文案语言 | 简体中文，代码标识符英文 | D0-4 |
| 是否展示移动端完整交互 | 仅降级布局，不做全功能 | D0-8 |

## 14. 完成定义

- [ ] A1–A10 全部通过；
- [ ] `pnpm check`、`pnpm build`、`pnpm test:e2e` 通过；
- [ ] 1440×900 浅色 / 深色 / 1280 窄屏截图归档；
- [ ] 无控制台错误、无外网请求、无真实秘密；
- [ ] 人类对视觉与交互验收通过（G-S0）。
