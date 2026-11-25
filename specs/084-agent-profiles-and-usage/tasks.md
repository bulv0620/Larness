# 任务：Agent Profile 收敛与会话 Token 统计

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| AP-1 | 规格决议、ADR、计划与任务卡 | — | `done` |
| AP-2 | Profile 收敛、提示、迁移与选择器 | AP-1 | `done` |
| AP-3 | 会话用量 API 与步骤耗时 | AP-1 | `done` |
| AP-4 | 输入框下方用量与最后一步速度 | AP-3 | `done` |
| AP-5 | 过程呈现收敛（状态行、波形、思考） | AP-1 | `done` |
| AP-6 | 全量验证、契约与状态回填 | AP-2～AP-5 | `done` |
| AP-7 | 过程标题行视觉细化（用户反馈） | AP-5 | `done` |
| AP-8 | 星光图标与灰底黑扫文字（用户反馈） | AP-7 | `done` |
| AP-9 | 动画同步为 1 秒一轮（用户反馈） | AP-8 | `done` |
| AP-10 | 过程动画降速（用户反馈） | AP-9 | `done` |
| AP-11 | 会话缓存命中率（用户反馈） | AP-3、AP-4 | `done` |
| AP-12 | Token 行在会话页常驻（用户反馈） | AP-4、AP-11 | `done` |
| AP-13 | 过程标题行只显示步数（用户反馈） | AP-5 | `done` |

## 任务卡

### AP-1 规格决议、ADR、计划与任务卡

- 状态：`in_progress`
- 依赖：无
- 目标：把 2026-11-18 的审核结论固化为 spec 决议、ADR-070、实施计划与可执行任务卡。
- 交付物：
  - `spec.md` 状态 `active`，§12 改为已确认决议；
  - `docs/adr/ADR-070-agent-profiles-and-usage.md`（accepted）；
  - `plan.md`、`tasks.md`；
  - ROADMAP §8.10 任务行、STATUS「当前进行中」。
- 验收：
  - Profile、`plan` 语义、PM2 观察、usage 显示与旧会话处理都有明确决议；
  - ADR-070 明确取代 ADR-069 的独立 Service Ops Profile 决策。
- 测试：仅文档；链接与状态一致性检查。
- 涉及路径：`specs/084-agent-profiles-and-usage/*`、`docs/adr/ADR-070-agent-profiles-and-usage.md`、`specs/ROADMAP.md`、`STATUS.md`。
- 备注：不写产品代码。

### AP-2 Profile 收敛、提示、迁移与选择器

- 状态：`todo`
- 依赖：AP-1
- 目标：Profile 只剩 `coding` / `plan`，两者共享完整工具面，`plan` 仅多计划能力；旧 `service-ops` 会话迁移为 `coding`。
- 交付物：
  - `AgentProfileId` 与数据库类型收敛；
  - `TOOL_PACK_CATALOG`：`coding` = read/write/command/process/serviceOps，`plan` = 同前 + plan；
  - 系统提示：两者都有后台任务与 PM2 契约，`plan` 加计划策略；Coding 加验证比例原则；
  - 不再注入 PM2 观察快照；`refresh_observations` 退出模型面；
  - REST 枚举、Web 选择器、脚本与测试夹具更新；
  - 迁移 `0034` 与 schemaVersion 断言。
- 验收：A1、A2、A3、A7。
- 测试：Profile catalog 正反例、旧值归一、迁移、上下文组装、Web 选择器。
- 涉及路径：`packages/agent/src/kernel/profile.ts`、`apps/server/src/modules/agent/{profiles,contextAssembler,turnRunner}.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/modules/sessions/*`、`apps/server/src/api/sessions.ts`、`apps/web/src/features/chat/Composer.tsx`、`apps/web/src/lib/workspaceApi.ts`、`apps/server/drizzle/*`。
- 备注：不改审批策略语义；`plan` 不是权限边界。

### AP-3 会话用量 API 与步骤耗时

- 状态：`todo`
- 依赖：AP-1
- 目标：提供会话级 usage 聚合与模型步骤耗时，供前端诚实展示。
- 交付物：
  - `GET /api/sessions/:id/usage`，返回 input/output/total/cache 已知值、缺失 Turn 数、partial 标记与更新时间；
  - 聚合纯函数：只统计终态 Turn，解析 `usage_json`，缺失不补零；
  - `model.usage` 增加 `durationMs`；
  - 契约文档同步（REST、WS 事件、数据模型、051）。
- 验收：A4、A5、A6 的服务端部分。
- 测试：多 Turn 聚合、缺失 usage、无 Turn、404；`model.usage` 正反例。
- 涉及路径：`apps/server/src/modules/sessions/{usage,service}.ts`、`apps/server/src/api/sessions.ts`、`apps/server/src/modules/agent/turnRunner.ts`、`docs/contracts/*`。
- 备注：不新增表；不记录消息内容。

### AP-4 输入框下方用量与最后一步速度

- 状态：`todo`
- 依赖：AP-3
- 目标：输入框下方常驻会话累计 Token，进行中显示最后一步实测速度；缺失时明确标注。
- 交付物：
  - `SessionUsageLine` 组件与格式化函数；
  - 会话用量查询与终态失效接线；
  - 速度从 `model.usage.outputTokens / durationMs` 计算，只在 streaming 时显示；
  - 缺失 usage 只用 `≥` 前缀，缺失轮数在 Hint 中显示「缺失 N 轮」（2026-11-24 按用户要求不再显示「部分统计」字样）。
- 验收：A4、A5、A6。
- 测试：格式化、`≥` 与缺失 Hint、无 usage 隐藏、速度正反例、会话切换。
- 涉及路径：`apps/web/src/features/chat/{Composer,SessionUsageLine}.tsx`、`apps/web/src/lib/{queries,workspaceApi,eventReducer}.ts`、`apps/web/src/stores/timelineStore.ts`。
- 备注：不做字符估算与逐字速度。

### AP-5 过程呈现收敛（状态行、波形、思考）

- 状态：`todo`
- 依赖：AP-1
- 目标：删除底部独立状态栏，把执行状态收敛到过程折叠标题行；reasoning 只显示 `Thinking...` 状态。
- 交付物：
  - `TurnView` 标题行：左侧波形、`Thinking...` / `Generating...` / `Running...` / `Waiting for approval...` / `Starting...` / `Completed · 100s` / `Failed · 100s` / `Stopped · 100s`；右侧展开箭头；
  - 流动背景与 `prefers-reduced-motion` 静态回退；
  - reasoning 文本不渲染、不触发自动滚动；
  - 完成态默认折叠，计划卡在上、过程行在下；
  - 删除 `Timeline` 底部状态栏及旧 spinner。
- 验收：A8、A9。
- 测试：状态派生、思考文本隐藏、完成/失败/停止耗时、展开、滚动不因 reasoning 触发。
- 涉及路径：`apps/web/src/features/chat/{Timeline,TimelineItemView}.tsx`、相关 CSS 与测试。
- 备注：不新增后端事件或 API。

### AP-6 全量验证、契约与状态回填

- 状态：`todo`
- 依赖：AP-2～AP-5
- 目标：完成门禁、文档与切片收口。
- 交付物：
  - `pnpm check`、`pnpm build`、Mock / 认证 / 生产 E2E（按环境实际执行并如实记录）；
  - 契约与 051 工具说明同步；
  - ROADMAP、STATUS、tasks 收口；遗留问题如有新增则登记。
- 验收：A1～A9 的自动化覆盖；未运行项如实标注。
- 测试：整仓门禁与 E2E。
- 涉及路径：全仓与状态文档。
- 备注：失败项定点复跑，不冒充全绿。

## 验收记录（2026-11-18，macOS）

- AP-2：Profile 只剩 `coding` / `plan`；两者工具面相同，Plan 多 `update_plan`；迁移 `0034` 将 `service-ops` 归一 `coding`；PM2 观察快照不再注入，`refresh_observations` 退出模型面。定向 96 项通过。
- AP-3：`GET /api/sessions/:id/usage`、诚实聚合与 `model.usage.durationMs` 完成；定向 60 项通过。
- AP-4：输入框下方会话 Token、部分统计与最后一步速度完成；Web 定向 29 项通过。
  - 2026-11-24 调整：按用户要求去掉可见「部分统计」字样，仅保留 `≥` 前缀，缺失轮数移到 Hint（「缺失 N 轮」）；语义不变，`SessionUsageLine` 定向 7 项通过。
- AP-5：底部状态栏删除，过程标题行、波形、状态与耗时完成；reasoning 不渲染、不触发滚动；聊天定向 67 项通过。
- 全量：`pnpm check` 通过（biome、6 包 typecheck、Web 262、Agent 63 + 1 跳过、Server 734 + 14 跳过）；`pnpm build` 通过。
- E2E：Mock 24/24；认证 20/20；生产构建 20/20。认证与生产使用 3310/3320 端口（3210/3211 被现有开发服务占用），认证 Web 使用 5174。
- 未验证：真实 Provider 长时间会话的 usage 完整性、真实模型下的 Plan 行为。
- 验收：2026-11-19 人类确认 AP-1～AP-13 全部通过，同意合并推送。

### AP-7 过程标题行视觉细化（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-5
- 目标：按用户 2026-11-19 的四点反馈调整过程标题行。
- 交付物：
  - 图标改为 4 个脉冲节点，依次点亮/放大；完成后不再显示图标。
  - 流光只作用于状态文字本身，从左向右扫过；删除整行流动背景。
  - `Running...` 只显示工具类别，不显示完整命令或参数。
  - 完成/失败/停止的主标签只保留 `Completed` / `Failed` / `Stopped` / `Interrupted`，耗时与步数移到右侧次要信息。
- 验收：A8、A9 的视觉语义；完成后整行只剩文字与次要信息，无脉冲图标。
- 测试：`Timeline.test.tsx` 覆盖脉冲图标、文字流光类、命令不泄漏与完成态无图标；聊天定向 67 项通过。
- 涉及路径：`apps/web/src/features/chat/Timeline.tsx`、`apps/web/src/styles/global.css`、`apps/web/src/features/chat/Timeline.test.tsx`。
- 备注：视觉确认仍待用户；未新增后端事件或 API。

### AP-8 星光图标与灰底黑扫文字（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-7
- 目标：按用户二次反馈替换过程标题行的图标与文字扫描效果。
- 交付物：
  - 图标改为一大一小两颗四角星，轻微缩放、旋转并依次闪烁。
  - 状态文字基色改为灰色，主题前景色从左向右缓慢扫过（约 4.2 秒）；浅色主题为黑扫，深色主题为白扫。
  - 完成/失败/停止仍不显示图标与扫描。
- 验收：活动态有星光与慢速文字扫描；完成态只剩文字；`prefers-reduced-motion` 下静止。
- 测试：`Timeline.test.tsx` 断言星光类与扫描类存在、完成态不存在；定向 33 项通过。
- 涉及路径：`apps/web/src/features/chat/Timeline.tsx`、`apps/web/src/styles/global.css`、`apps/web/src/features/chat/Timeline.test.tsx`。
- 备注：视觉确认待用户；未新增后端事件或 API。

### AP-9 动画同步为 1 秒一轮（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-8
- 目标：让星光与文字扫描同步，并按用户要求统一为 1 秒一轮。
- 交付物：
  - 一大一小两颗四角星都使用 1 秒无限动画，同相位闪烁，不再错峰延迟。
  - 状态文字扫描改为 1 秒一轮，与星星同步：每周期扫过一次。
  - `prefers-reduced-motion` 下保持静止。
- 验收：活动态动画周期一致；完成态无图标与扫描。
- 测试：CSS 变更；聊天定向测试、`pnpm check`、`pnpm build`、Mock E2E 通过。
- 涉及路径：`apps/web/src/styles/global.css`。
- 备注：视觉确认待用户。
- 修正（2026-11-19）：`background-size: 300%` 配合 `120% → -120%` 的位移会在 1 秒内多次扫过；改为 `200%` 与 `100% → 0%`，位移正好等于一个容器宽度，每秒恰好扫过一次。

### AP-10 过程动画降速（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-9
- 目标：用户反馈 1 秒周期稍快，调整为更合适的慢速。
- 交付物：
  - 星星闪烁与文字扫描统一改为 1.6 秒一轮，保持同相位。
  - 仍保证每周期文字只从左到右扫过一次。
  - `prefers-reduced-motion` 下保持静止。
- 验收：活动态动画同步、节奏比 1 秒更舒缓；完成态无图标与扫描。
- 测试：CSS 变更；`pnpm check`、`pnpm build`、Mock E2E 通过。
- 涉及路径：`apps/web/src/styles/global.css`。
- 备注：视觉确认待用户。

### AP-11 会话缓存命中率（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-3、AP-4
- 目标：在会话用量行显示 Provider 实测缓存命中率。
- 交付物：
  - usage API 增加 `cache`：`hitRate`、`readTokens`、`missTokens`、`knownRequests`、`unknownRequests`。
  - 命中率只聚合 `model.usage` 请求；`usageSource=unknown` 或缺少 miss 字段的请求不进入分母，另计未知次数。
  - 若 Provider 只给 `inputTokens` 与 `cacheReadTokens`，用 `input - read` 推导未命中；结果仍只来自实测字段。
  - Token 行显示 `缓存命中 N%`；Hint 显示命中/未命中 token 与未知请求数。
- 验收：有 Provider 缓存字段时显示命中率；完全未知时不伪造 0%；部分统计标记保持独立。
- 测试：Server 命中率聚合正反例；Web 命中率显示与未知隐藏；定向测试通过。
- 涉及路径：`apps/server/src/modules/sessions/usage.ts`、`apps/web/src/features/chat/SessionUsageLine.tsx`、`apps/web/src/lib/workspaceApi.ts`。
- 备注：不同 Provider 的缓存字段可用性不同；未验证真实长会话命中率。

### AP-12 Token 行在会话页常驻（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-4、AP-11
- 目标：已创建会话中 Token 行始终显示在输入框下方；新建会话页不显示。
- 交付物：
  - 真实会话中即使用量尚未加载，也保留 Token 行并显示“Token 统计加载中…”，避免出现/消失造成跳动。
  - 加载完成后显示总量、缓存命中率与最后一步速度。
  - 草稿会话、新建会话页与 Mock 页面保持隐藏。
- 验收：切换会话时 Token 行不闪烁消失；新建会话页不显示；真实会话始终占位。
- 测试：`SessionUsageLine` 加载态与 `SessionModel` 常驻断言；定向 24 项通过。
- 涉及路径：`apps/web/src/features/chat/SessionUsageLine.tsx`、`apps/web/src/features/chat/Composer.tsx`。
- 备注：视觉确认待用户。

### AP-13 过程标题行只显示步数（用户反馈）

- 状态：`done`（2026-11-19）
- 依赖：AP-5
- 目标：外层过程标题行不显示失败项数与重试次数，只保留步数等进度信息。
- 交付物：
  - 移除标题行右侧的“失败 N 项”“重试成功 N 次”。
  - 失败工具仍保留在展开的执行过程中；未完成且无答复的 Turn 仍显示失败条目。
  - 步数、耗时、自动继续次数与预算原因继续显示。
- 验收：外层标题行不出现失败/重试计数；展开后失败详情可见。
- 测试：`Timeline.test.tsx` 断言外层无“失败/重试”，展开后失败工具仍存在；定向 33 项通过。
- 涉及路径：`apps/web/src/features/chat/Timeline.tsx`、`apps/web/src/features/chat/Timeline.test.tsx`。
- 备注：视觉确认待用户。

### 验收后修正：标题行次要信息光学对齐（2026-11-19）

- 状态：`done`
- 问题：状态文字为 12px、右侧次要信息为 11px，行盒中心一致但字形光学中心约差 0.5px，主观上像不在同一中线。
- 修正：给次要信息加 `relative top-[0.5px]`，只下移 0.5px；不改字号、行高或布局。
- 验证：浏览器计算后两者光学中心差约 0.01px；聊天定向测试、jsdom/浏览器构建通过。

### 验收后修正：Token 行卡在加载中（2026-11-19）

- 状态：`done`
- 症状：会话中偶发显示“Token 统计加载中…”，刷新页面后恢复；服务端 `/api/sessions/:id/usage` 返回 200 且响应时间约 1ms。
- 原因：`useSessionUsage` 用 `fetchQuery` + QueryCache 订阅手工桥接 React 状态；请求错误被吞掉，且仅在特定 invalidate 事件重试。缓存被移除、查询被清理或切换会话发生竞态时，本地状态会停留在 `null`，界面一直显示加载中。
- 修正：改用标准 `useQuery` 活跃订阅；启用 `retry: 2`、指数退避、窗口聚焦/重连刷新，并在无数据时每 5 秒重试。终态 `invalidateQueries` 由活跃 observer 自动触发重取，不再依赖手写缓存订阅。
- 验证：聊天定向 69 项、typecheck、biome、完整 check、build 与 Mock E2E 通过；服务端旧日志确认请求本身为 200，问题在客户端状态桥接。

### 验收后修正：上下文环并入用量行、附件按钮右移（2026-11-25，用户直接要求）

- 状态：`done`
- 要求：上下文占用圆球的信息移到输入框下方那一行；附件按钮放到原圆球位置。
- 修正：
  - `ContextUsage` 从 `Composer` 工具栏迁入 `SessionUsageLine`，在用量行右对齐显示 14px 小圆环 + `32k / 128k · 25%` 常驻文字；Hint 与 `aria-valuetext` 仍给完整 tokens 与百分比，未知时保持空环 + 「暂无统计」，比例钳制 0–100%。
  - 用量行在草稿会话、Mock 与用量查询未启用时仍渲染，只显示上下文信息，不再显示「Token 统计加载中…」。
  - 附件按钮移到原圆球位置（发送 / 停止左侧），工具栏左侧不再重复。
- 验证：`SessionUsageLine.test.tsx` 10 项、`Composer.test.tsx` 7 项、`pnpm --filter @larness/web test` 54 文件 / 311 项、`typecheck`、改动文件 `biome check` 通过；E2E 与浏览器视觉验收未跑。
- 涉及路径：`apps/web/src/features/chat/{Composer,SessionUsageLine}.tsx` 与同名测试。

### 验收后修正：用量口径（本轮 + 会话累计）（2026-11-25，用户直接要求）

- 状态：`done`
- 背景：圆环读单次请求输入（`model.usage.inputTokens`，每个 step 覆盖），跨轮会从上一轮峰值回落到本轮起点，看起来像“用量变小”；总量其实在增长，只是分母是模型窗口。
- 修正：`contextUsageInfo` 增可选 `sessionTokens`，文案改为 `本轮 32k / 128k · 25% · 会话 1.24M`；Hint 与 `aria-valuetext` 同时给出「本轮请求输入」与「会话累计输入」；`Composer` 传 `sessionUsage.inputTokens`。圆环百分比仍按单次请求 / 窗口，因为那才是压缩与溢出判断的口径。
- 验证：`SessionUsageLine.test.tsx` 11 项、`Composer.test.tsx` 7 项、`pnpm --filter @larness/web typecheck` 通过。

### 验收后修正：新会话显示上下文统计（2026-11-25，用户直接要求）

- 状态：`done`
- 现象：新会话（草稿或刚建立、尚无任何 turn）中用量行只显示空环 +「暂无统计」，看不到窗口与占比。原因是 `contextUsageInfo` 把 `used > 0` 当作已知，且 `Composer` 在没有 `model.usage` 事件时传 `null`；Mock 浏览器实测用量行存在且可见（`ROWS: 1`，高 16px），只是没有数字。
- 修正：`contextUsageInfo` 接受 `limit: number | null`，`used === 0` 视为已知的真实零；`Composer` 在草稿会话或 `sessionUsage.turns === 0` 且无 `model.usage` 时按 `本轮 0 / <窗口> · 0%` 显示，真实会话加载中或已有历史但缺当前模型输入时仍保持「暂无统计」；模型窗口未知时不再编造 `128000`，显示「模型窗口未知」。
- 验证：`SessionUsageLine.test.tsx` 12 项、`Composer.test.tsx` 8 项、web 54 文件 / 314 项、`typecheck`、改动文件 `biome check` 通过；Mock 浏览器实测新会话用量行文本为 `本轮 0 / 128k · 0%`。
- 涉及路径：`apps/web/src/features/chat/{Composer,SessionUsageLine}.tsx` 与同名测试。

### 验收后修正：新会话不显示用量行（2026-11-25，用户直接要求）

- 状态：`done`
- 要求：新会话下方不要显示用量行（上一版改成显示 `本轮 0 / 128k · 0%`，属理解偏差）。
- 修正：`Composer` 用 `showUsageLine = hasSession && !isDraftSession && (usage !== undefined || sessionUsage.turns > 0)` 决定是否挂载 `SessionUsageLine`；草稿会话、尚未完成任何 turn 的会话、以及没有当前模型 `model.usage` 且无已完成 turn 的会话均不渲染该行，也不再显示空环或 `本轮 0 / 窗口 · 0%`。草稿会话即使残留上一会话的 `modelUsage` 也不显示（避免串数）。`contextUsageInfo` 的“0 是真实零”保留，只用于请求确实回报 0 输入的情况。
- 验证：`SessionUsageLine.test.tsx` 12 项、`Composer.test.tsx` 9 项、`SessionModel.test.tsx` 14 项、`pnpm --filter @larness/web test` 54 文件 / 315 项、`typecheck`、改动文件 `biome check` 通过；E2E 与浏览器视觉验收未跑。
- 涉及路径：`apps/web/src/features/chat/{Composer,Composer.test,SessionUsageLine.test,SessionModel.test}.tsx`、`specs/041-composer-controls/spec.md`。

### 验收后修正：右下角不再重复会话累计输入（2026-11-25，用户直接要求）

- 状态：`done`
- 要求：圆环右侧不显示会话累计输入，因为同一行左侧已有会话总量。
- 修正：`contextUsageInfo` 去掉可选第三个参数 `sessionTokens`，右侧文案回到 `本轮 32k / 128k · 25%`，Hint 与 `aria-valuetext` 也只给「本轮请求输入」；`ContextUsage` 与 `SessionUsageLine` 的 props 去掉 `sessionTokens`，`Composer` 不再传 `sessionUsage.inputTokens`。左侧总量与「输入 / 输出 / 缓存命中」Hint 不变，会话累计输入仍可在那里读到。
- 验证：`SessionUsageLine.test.tsx` 12 项、`Composer.test.tsx` 9 项、`SessionModel.test.tsx` 14 项、`pnpm --filter @larness/web test` 54 文件 / 315 项、`typecheck`、改动文件 `biome check` 通过；E2E 与浏览器视觉验收未跑。
- 涉及路径：`apps/web/src/features/chat/{Composer.tsx,SessionUsageLine.tsx,SessionUsageLine.test.tsx}`。
