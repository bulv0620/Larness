# 全局资源、窗口与 Tab 归属契约

> 状态：accepted（2026-11-01）。适用于 M2 及之后的真实资源窗口；S0 视觉 Demo 只实现简化版。  
> 关联：`larness.md` 3.1、3.2、4.4、4.6、5、17.1、20.3、38.1；`docs/architecture/overview.md` 第 5.4 节。

## 1. 原则

1. **资源全局，视图本地**：Terminal、Service、Browser 预览、File 是 Larness 的资源；Window / Tab / 项目筛选是客户端视图。
2. **全局工具 ≠ 全局权限**：顶部入口对所有已授权客户端可见，但每个资源操作仍在后端按 Project / Session / 能力校验。
3. **来源只用于定位**：`sourceSessionId` / tab origin 只用于展示、分组与筛选，不参与授权。
4. **关闭视图不终止资源**：关闭 Tab / 隐藏窗口不杀 PTY、不停止服务；终止资源必须显式操作。
5. **同一资源默认只有一个视图**：重复打开聚焦已有 Tab；需要第二个视图时显式“在新 Tab 中打开”（P1，默认不提供）。
6. **多客户端各自布局**：两个浏览器看同一资源时，资源状态共享，但 Tab 顺序、激活项、筛选、窗口位置互不同步。

## 2. 资源身份（viewKey）

| 类型 | 资源 ID | viewKey | 说明 |
|---|---|---|---|
| Terminal | `terminalId`（PTY） | `terminal:<id>` | 每个 PTY 一个独立 Tab；关闭 Tab 不终止 PTY |
| Service | `serviceId` | `service:<id>` | 每个服务一个 Tab；概览 / 日志是服务内部的子视图，不占顶层 Tab |
| Browser | 无独立后端资源，绑定已登记 `serviceId` | `browser:<serviceId>:<normalizedUrl>` | 归一化 URL：小写 host、去默认端口、解析 `.`/`..`、保留 path/search、忽略 hash |
| File | 无独立后端资源，绑定 realpath | `file:<realpath>` | 同一 realpath 跨项目 / 来源复用同一 Tab；标签显示当前项目上下文 |
| Git Diff | `projectId + path` | `diff:<projectId>:<path>` | 同一项目同一文件复用；不与其他项目的 Diff 合并 |

- 独立会话的 workspace 文件仍是 `file:<realpath>`；标签来源显示“独立会话”。
- 若同一 realpath 同时属于两个项目，仍视为同一文件视图；切换来源时只更新标签上下文，不创建第二个 Tab。

## 3. Tab 数据

```ts
type OriginType = "global" | "project" | "session" | "agent" | "artifact";

interface ResourceOrigin {
  type: OriginType;
  projectId: string | null;
  sessionId: string | null;   // 仅来源，不用于授权
  label?: string;             // 如 “从部署产物打开”
}

interface WindowTab {
  id: string;
  kind: "files" | "terminal" | "services" | "browser" | "git-diff";
  resourceId: string;
  viewKey: string;            // 第 2 节
  title: string;
  projectId: string | null;   // 资源归属；决定分组/筛选
  origin: ResourceOrigin;
  createdAt: number;
}
```

- `projectId` 取资源自身的归属，不取“当前选中的项目”。
- `origin` 只用于展示、审计和默认筛选；不得用于替代资源归属。
- Tab 标签：`项目名 · 资源名`；`projectId=null` 显示 `全局 · 资源名`；独立会话显示 `独立会话 · 资源名`。完整标签放 tooltip。

## 4. 分组与排序

- 同一窗口内按 `projectId` 分组；`projectId=null` 为“全局”组。
- 组顺序按该组第一个 Tab 的创建时间；组内按创建时间。
- 新建 Tab 插入其所属组的末尾，并激活；已有 Tab 被聚焦时不重排。
- 切换项目、切换筛选不改变 Tab 顺序。
- 不同项目同名资源依靠分组与项目标签区分，不合并。

## 5. 窗口与项目筛选

每个工具窗口（Terminal / Services / Browser / Files）独立保存：

```ts
type ProjectFilter =
  | { mode: "all" }
  | { mode: "global" }                       // 仅 projectId=null
  | { mode: "project"; projectId: string };
```

规则：

1. 顶部 Header 入口：恢复该窗口**上次打开状态**（`filter` + `activeTabId`）；没有历史时默认 `{ mode: "all" }`。
2. 从项目内的具体位置打开（右栏文件 / 服务 / 终端 / Git、项目树、项目内产物）：把该窗口筛选切到对应 `projectId`，聚焦目标 Tab，并记录为新的“上次状态”。
3. 从独立会话 / 全局位置打开：筛选切到 `global`（或保持资源所属筛选），记录来源。
4. 切换左侧当前项目**不影响**任何已开窗口的筛选、Tab 与激活项。
5. 筛选只隐藏 Tab，不停止/暂停资源，也不把资源标记为结束。
6. 筛选后当前激活 Tab 被隐藏时，选择该筛选下第一个可见 Tab；没有可见 Tab 时显示空态“当前筛选下没有 Tab”，窗口不关闭。
7. 显式打开一个被当前筛选隐藏的 Tab 时，自动切到 `all` 并聚焦，不能静默无响应。
8. 筛选状态按客户端持久化；不属于业务数据，不跨设备同步。
9. 筛选控件与 Tab 同排：下拉框在最左，Tab 区域在其右侧横向滚动，计数在最右；不得额外占用一整行纵向空间。

## 6. 去重与打开

| 操作 | 行为 |
|---|---|
| 同一 viewKey 再次打开（顶部 / 右栏 / 会话 / 产物） | 恢复窗口、切到目标项目筛选、激活已有 Tab；不新建资源 |
| 同服务 / 同 terminal / 同文件 | 同上；一个客户端只有一个默认视图 |
| 同浏览器 service + URL | 聚焦已有 Tab（默认）；URL 不同则新建 Tab |
| 显式“在新 Tab 打开” | P1；若实现，需要独立 `viewId`，但资源仍只有一个 |
| Agent 的一次性命令 | 不创建终端 Tab；只发 CommandExecution 事件 |
| Agent 启动服务 | 创建 Service 资源；在 Services 窗口插入 Tab，不自动抢焦点 |
| Agent 产物预览 | 用户点击打开时创建 Browser Tab，origin=artifact |

## 7. 生命周期

- **关闭 Tab**：只移除当前客户端视图；资源继续运行；窗口无 Tab 时隐藏（可从顶部恢复，前提是资源仍存在）。
- **隐藏窗口**：保留全部 Tab、激活项与筛选；顶部入口恢复。
- **终止 PTY / 停止服务**：独立确认操作；资源状态变为 ended/stopped，所有客户端对应 Tab 显示结束状态，Tab 不自动消失，用户可关闭。
- **资源删除 / 文件被删**：Tab 标记 `unavailable`，提供“重新加载 / 关闭”；不得伪造运行状态。
- **刷新 / 重启客户端**：从本地布局恢复窗口与 Tab；资源不存在时标 unavailable，不重建 PTY / 服务。
- **Larness 重启**：临时 PTY 不恢复（标记 interrupted）；PM2 服务按对账结果恢复；Browser Tab 若绑定服务仍存在则保留，否则标 unavailable。

## 8. 多客户端

- 资源与状态共享；一个客户端终止 PTY / 停止服务，其他客户端收到事件并更新 Tab 状态。
- Tab 顺序、激活项、筛选、窗口位置、最大化 / 隐藏状态均为客户端本地，不同步。
- 一个客户端关闭 Tab 不影响其他客户端的视图。
- 多客户端同时打开同一资源时，默认都显示同一状态；终端输入仍受租约控制（M2）。

## 9. 审计与可观测性

- Tab 创建 / 关闭不是安全事件，可记 debug 日志；资源创建 / 终止 / 服务启停 / 预览打开必须审计。
- 审计包含 `projectId`、`sessionId`、`resourceId`、`origin.type`；不记录浏览器 URL 的敏感 query（按脱敏规则）。
- 不在日志中记录 Cookie、Token、预览票据。

## 10. 验收场景

### V1 项目来源自动筛选

```gherkin
Given 终端窗口当前筛选为“全部项目”
When 从项目 larness-web 的右栏点击 pnpm dev
Then 窗口筛选切到 larness-web，pnpm dev Tab 被激活
And 其他项目的终端仍然存在，只是被隐藏
```

### V2 Header 恢复上次状态

```gherkin
Given 上次从项目 docs-site 打开了终端窗口，筛选为 docs-site
When 关闭窗口后点击顶部终端入口
Then 窗口恢复 docs-site 筛选与上次激活的 Tab
Given 从未打开过终端窗口
When 点击顶部终端入口
Then 筛选为“全部项目”
```

### V3 切换项目不影响已开窗口

```gherkin
Given 终端窗口筛选为 larness-web 且处于打开状态
When 左侧切换到 docs-site
Then 终端窗口的筛选、Tab 与激活项不变
```

### V4 去重与分组

```gherkin
Given 窗口已有项目 A 的 terminal-1 和项目 B 的 terminal-2
When 再次从项目 A 打开 terminal-1
Then 只聚焦已有 Tab，不新建
When 新建项目 A 的 terminal-3
Then terminal-3 插入项目 A 组末尾，项目 B 组顺序不变
```

### V5 关闭视图不终止资源

```gherkin
Given terminal-1 正在运行
When 关闭其 Tab
Then PTY 继续运行
When 从顶部终端入口选择 terminal-1
Then 重新显示同一个 PTY，不创建新 PTY
```

### V6 筛选不停止资源

```gherkin
Given 服务窗口有项目 A 和项目 B 的服务
When 筛选切到项目 A
Then 项目 B 的服务 Tab 隐藏但服务继续运行
```

## 11. 非目标

- 不做跨客户端 Tab 位置实时同步。
- 不做同一资源的多个并行视图（P1 可评估）。
- 不把项目筛选当作权限边界。
- 不保证浏览器 URL 的第三方网页可预览（仍受 M3 预览隔离约束）。
