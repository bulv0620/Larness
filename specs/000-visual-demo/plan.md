# 实施计划：S0 视觉 Demo

> 对应 [spec.md](spec.md)。目标是用真实前端栈搭出可验收的 UI 基线，数据全部来自 `MockGateway`。

## 1. 技术方案

- pnpm workspace：根配置 + `apps/web` + `packages/ui` + `packages/shared`。
- React 19 + Vite 7 + TypeScript strict；Tailwind CSS 4（`@tailwindcss/vite`）承载布局与 token。
- `packages/ui`：Radix 原语 + Tailwind 的 Button / IconButton / Tooltip / DropdownMenu / Dialog / Tabs，供 web 复用。
- `packages/shared`：领域类型、`Gateway` 接口、与 `docs/contracts/ws-events.md` 对齐的 `TurnEvent`、稳定错误码常量。
- 状态：Zustand 管窗口 / 导航 / 草稿；TanStack Query 管 `Gateway` 数据（Demo 也用 Query，便于 M1 无缝替换）。
- 窗口：`react-rnd` 提供拖动 / 缩放；WindowManager 维护窗口数组、z-index、Tab、最大化 / 隐藏 / 置顶，几何计算抽成纯函数。
- 分区：自研 `useSectionResizer`，用 pointer capture 调整百分比高度，支持折叠、双击均分、方向键（Shift 加速）。
- 主题：`data-theme` + CSS 变量；`ThemeProvider` 监听 `matchMedia`；localStorage 持久化。
- Mock：`MockGateway` 用异步生成器按脚本产出 `TurnEvent`，支持 `AbortSignal`；fixtures 固定、可复现。
- 测试：Vitest + Testing Library + happy-dom；Playwright 跑布局 / 主题 / 窗口 / 分区 / 键盘，截图基线禁用动画。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 纯静态 HTML/CSS/JS 原型 | 快 | 无法复用，M1 重写 | 不采用 |
| 引入完整组件库（Ant/MUI） | 现成 | 视觉偏离苹果风、体积大 | 不采用 |
| 自研全部原语 | 可控 | 可访问性成本高 | 仅自研布局，交互原语用 Radix |
| 分区用第三方面板库 | 省事 | 难满足双击均分 / 键盘 / 折叠规则 | 自研轻量 hook |
| Demo 用 MSW 拦截网络 | 接近真实 | 增加层与配置 | 用 MockGateway 接口，M1 换实现 |

## 3. 目录与文件变更

```text
新增：
package.json
pnpm-workspace.yaml
tsconfig.base.json
biome.json
playwright.config.ts
apps/web/
  index.html
  vite.config.ts
  vitest.config.ts
  src/main.tsx
  src/app/App.tsx
  src/app/AppShell.tsx
  src/app/routes.tsx
  src/app/ThemeProvider.tsx
  src/components/layout/{TopBar,ProjectSidebar,ConversationWorkspace,ProjectResourceSidebar}.tsx
  src/components/windows/{WindowLayer,WindowFrame,WindowChrome,WindowTabs}.tsx
  src/components/sections/{ResizableSection,SectionSplitter}.tsx
  src/features/chat/{Timeline,MessageItem,PlanSteps,ToolCard,ApprovalCard,Composer,ModelPicker}.tsx
  src/features/projects/{ProjectTree,SessionList}.tsx
  src/features/resources/{FileTree,ServiceList,TerminalList,GitPanel}.tsx
  src/features/windows/{FileWindow,TerminalWindow,ServiceWindow,BrowserWindow,DiffWindow}.tsx
  src/stores/{windowStore,navigationStore,composerStore}.ts
  src/lib/{windowGeometry,layout,format}.ts
  src/mocks/{fixtures,gateway,useMockRuntime}.ts
  src/styles/{tokens.css,global.css}
  src/**/*.test.tsx
  e2e/*.spec.ts
packages/ui/
  src/{button,icon-button,tooltip,dropdown-menu,dialog,tabs,scroll-area,cn}.tsx
packages/shared/
  src/{domain,events,gateway,errors}.ts
  src/index.ts

修改：
README.md（补充 Demo 启动方式）
```

## 4. 实施步骤

1. **D0-1**：初始化 workspace、TypeScript、Biome、Vite、Tailwind、Vitest、Playwright；跑通空页面与占位测试。
2. **D0-2**：实现 AppShell 三栏网格与顶部栏；接入 projects / sessions fixtures；完成静态布局。
3. **D0-3**：落地 token、主题切换、菜单层级、字体与图标规范。
4. **D0-4**：实现时间线组件与 Composer；接入 MockGateway 的流式脚本与审批状态。
5. **D0-5**：实现右侧四分区、拖拽 / 折叠 / 双击 / 键盘与滚动隔离。
6. **D0-6**：实现 WindowManager 纯函数 + react-rnd 外壳 + 顶部入口联动。
7. **D0-7**：填充五类窗口内容（Monaco 只读、fake 终端、服务日志、浏览器地址栏、Diff）。
8. **D0-8**：断点降级、快捷键、焦点管理、ARIA、reduced motion。
9. **D0-9**：Playwright 全量冒烟 + 截图 + 验收记录，交人类评审。

每一步先补对应测试；窗口与分区逻辑必须先写纯函数测试再接 UI。

## 5. 关键实现约定

### 5.1 窗口状态

```ts
type WindowKind = 'files' | 'terminal' | 'services' | 'browser' | 'git-diff';
interface WindowTab { id: string; kind: WindowKind; resourceId: string; title: string; }
interface ManagedWindow {
  id: string; tabs: WindowTab[]; activeTabId: string;
  x: number; y: number; width: number; height: number;
  z: number; minimized: boolean; maximized: boolean; pinned: boolean;
  restore?: { x: number; y: number; width: number; height: number };
}
```

- `open(kind, resource)`：同 `kind + resourceId` 已存在 → 激活 Tab、取消 minimized、置顶；否则新建窗口 / Tab。
- 关闭只删除视图；Mock 资源状态独立存放在 `useMockRuntime`。
- 所有几何变更经 `clampToViewport`；窗口最小 420×280；标题栏至少 80×40 可见。

### 5.2 分区尺寸

- 每个分区保存 `size`（px）与 `expanded`；容器高度 `H`，可用高度 = `H - 标题高度总和`。
- 拖动时只调整相邻两个展开分区，遵守各自最小高度 96px。
- 折叠：移除该分区 height，剩余按比例分配；展开：恢复上次 height 或均分。
- 双击分隔线：两个相邻展开分区均分可用高度。
- 键盘：↑/↓ 调整 16px，Shift 64px；`role="separator"` + `aria-valuenow`。

### 5.3 Mock 事件

发送后按脚本产出：

```text
turn.created → plan.updated → tool.requested(read_files) → tool.completed
→ assistant.delta… → tool.requested(apply_patch) → tool.completed
→ file.changed → tool.approval.required(deploy) → [等待用户]
→ (批准) deployment.status → assistant.message → turn.completed
```

- 延迟 40–80ms；`AbortSignal` 触发后停止并产出 `turn.cancelled`。
- Mock 事件结构与 `docs/contracts/ws-events.md` 一致；渲染层不得依赖 Mock 私有字段。

### 5.4 测试与截图

- 纯函数：`windowGeometry`、`layout`、`theme`。
- 组件：Composer 键盘、ApprovalCard、ResizableSection。
- E2E：`layout.spec.ts`、`theme.spec.ts`、`windows.spec.ts`、`sections.spec.ts`、`keyboard.spec.ts`。
- 截图：1440×900 浅 / 深、1280 窄屏；`animations: 'disabled'`，等待字体加载。

## 6. 数据与迁移

无数据库。localStorage schema 带版本；版本不符丢弃并写默认值。

## 7. 回滚策略

Demo 为新增代码，回滚即回退对应任务提交；不影响任何后端数据。

## 8. 验证命令

```bash
pnpm install
pnpm check
pnpm build
pnpm --filter @larness/web dev
pnpm test:e2e
```

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| react-rnd 与拖拽分隔线 / 输入框事件冲突 | 窗口或分区拖动异常 | 指针事件 `stopPropagation`；纯函数测试几何 |
| 最大化 + 窗口还原状态复杂 | 还原错位 | 显式保存 `restore`；E2E 覆盖 |
| Tailwind 4 与 token 配置不熟 | 样式不生效 | D0-1 先做最小页面验证 |
| Playwright 浏览器下载失败 | CI 无法跑 E2E | 本地先跑；CI 缓存；失败时记录环境问题而非跳过 |
| 视觉主观性 | 反复返工 | D0-3 先确认截图，再继续 |
| Monaco 体积大 | 首屏慢 | D0-7 懒加载；Demo 只读 |

## 10. 未决事项

- 品牌图标细节、Demo 文案语气：按 spec 第 13 节默认执行。
- 是否在 Demo 中展示“无 Git 项目”的空态：展示，覆盖边界。
