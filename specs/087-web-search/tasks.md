# 任务：联网搜索工具与独立搜索连接

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| WS-0 | 规格确认与 ADR | — | `done`（2026-11-20） |
| WS-1 | Provider 层：DeepSeek / GLM 适配器 | WS-0 | `done`（2026-11-20） |
| WS-2 | 搜索连接存储、REST 与审计 | WS-0 | `done`（2026-11-20） |
| WS-3 | Agent 工具、会话开关与上下文 | WS-1、WS-2 | `done`（2026-11-20） |
| WS-4 | 设置弹窗、侧栏入口与地球按钮 | WS-2、WS-3 | `done`（2026-11-20） |
| WS-5 | 契约、E2E、真实 Key 验证与收口 | WS-1～WS-4 | `review`（真实 Key 待验） |

## 任务卡

### WS-0 规格确认与 ADR

- 状态：`done`（2026-11-20）
- 依赖：无
- 目标：把本切片从 `draft` 转 `ready`，冻结 provider 范围、Key 隔离、会话开关、风险等级与默认关闭。
- 交付物：
  - 本 spec / plan / tasks；
  - [ADR-073](../../docs/adr/ADR-073-web-search.md)；
  - README / ROADMAP / STATUS 更新。
- 验收：
  - 人类确认的 5 项决策全部有落点；
  - spec 满足 AGENTS.md §4 最小集；
  - ADR 记录备选方案、安全影响与回滚。
- 测试：无代码测试；文档链接与交叉引用检查。
- 涉及路径：
  - `specs/087-web-search/spec.md`
  - `specs/087-web-search/plan.md`
  - `specs/087-web-search/tasks.md`
  - `docs/adr/ADR-073-web-search.md`
  - `specs/README.md`
  - `specs/ROADMAP.md`
  - `STATUS.md`
- 备注：2026-11-20 人类确认默认关闭、DeepSeek + GLM、搜索 Key 独立、常规风险控制、加号改地球按钮。

### WS-1 Provider 层：DeepSeek / GLM 适配器

- 状态：`done`（2026-11-20）
- 依赖：WS-0
- 目标：实现统一 `WebSearchProvider`，完成 DeepSeek Search/Fetch 与 GLM Web Search/Reader 的请求/响应映射。
- 交付物：
  - `types.ts`：统一查询、结果、页面、provider 接口；
  - `deepseek.ts`：`/v1/tools/search`、`/v1/tools/fetch`；
  - `glm.ts`：国内 `open.bigmodel.cn` / 国际 `api.z.ai` 的 `/paas/v4/web_search`、`/paas/v4/reader`；
  - `service.ts`：超时、重试、错误码、响应大小上限、结果归一；
  - 单元测试。
- 验收：
  - A5、A6、A8 的 provider 部分；
  - 401/402/403/404/408/429/5xx/超时映射正确；
  - 只对 408/429/5xx 重试一次；
  - 不把上游响应正文回给调用方。
- 测试：
  - `apps/server/test/web-search/deepseek.test.ts`
  - `apps/server/test/web-search/glm.test.ts`
  - `apps/server/test/web-search/service.test.ts`
- 涉及路径：
  - `apps/server/src/modules/web-search/*`
- 备注：适配器只接收已解析的 `apiKey`、`baseUrl`、`engine`，不直接读数据库。

### WS-2 搜索连接存储、REST 与审计

- 状态：`done`（2026-11-20）
- 依赖：WS-0
- 目标：新增独立搜索连接表与设置，Key 加密、REST 掩码、活动连接可选。
- 交付物：
  - 迁移 `0037_web_search`；
  - `web_search_connections` schema/repository；
  - `app_meta` 活动连接与配额设置；
  - `GET/POST/PATCH/DELETE /api/web-search/connections`；
  - `POST /api/web-search/connections/:id/test`；
  - `GET/PUT /api/web-search/settings`；
  - 审计 `web_search.connection.*`。
- 验收：
  - A3、A4；
  - Key 不出现在任何响应/事件/日志/审计；
  - 删除连接不影响模型连接；
  - 连接 CRUD 校验 provider/region/endpoint 白名单。
- 测试：
  - `apps/server/test/web-search/repository.test.ts`
  - `apps/server/test/api/web-search.test.ts`
- 涉及路径：
  - `apps/server/src/db/schema.ts`
  - `apps/server/drizzle/0037_web_search.sql`
  - `apps/server/src/modules/web-search/repository.ts`
  - `apps/server/src/modules/web-search/settings.ts`
  - `apps/server/src/api/webSearch.ts`
  - `apps/server/src/bootstrap/start.ts`
- 备注：首版只允许存在一个活动连接，但保留多连接列表。

### WS-3 Agent 工具、会话开关与上下文

- 状态：`done`（2026-11-20）
- 依赖：WS-1、WS-2
- 目标：把联网搜索接入 Agent 工具表、Profile、上下文组装与执行层，并增加会话开关快照。
- 交付物：
  - `webTool.ts`：`web_search` / `fetch_url`；
  - `web` pack，加入 `coding` / `plan`；
  - `ToolContext.webSearch` / `fetchUrl` 与 `TurnRunner` 绑定；
  - `sessions.web_search_enabled` / `turns.web_search_enabled`；
  - `contextAssembler` 条件注入与 `WEB_POLICY`；
  - `disabledTools` 执行层拦截；
  - 每 Turn 配额、去重、秘密扫描、URL 校验。
- 验收：
  - A1、A2、A7、A9；
  - 合法参数到达 handler；非法参数 `VALIDATION_ERROR`；
  - 关闭/无连接时实际上下文不含工具，直接执行 `TOOL_NOT_FOUND`；
  - 工具结果 ≤16k 且 JSON 可解析。
- 测试：
  - `apps/server/test/agent/toolContract.test.ts`
  - `apps/server/test/agent/contextAssembler.test.ts`
  - `apps/server/test/agent/profiles.test.ts`
  - `apps/server/test/agent/turnRunner.test.ts`
  - `apps/server/test/web-search/tools.test.ts`
- 涉及路径：
  - `apps/server/src/modules/agent/webTool.ts`
  - `apps/server/src/modules/agent/profiles.ts`
  - `apps/server/src/modules/agent/contextAssembler.ts`
  - `apps/server/src/modules/agent/toolExecutor.ts`
  - `apps/server/src/modules/agent/turnRunner.ts`
  - `apps/server/src/modules/sessions/*`
  - `packages/agent/src/tools/types.ts`
- 备注：Turn 开始时快照可用性；运行中切换只影响下一 Turn。

### WS-4 设置弹窗、侧栏入口与地球按钮

- 状态：`done`（2026-11-20）
- 依赖：WS-2、WS-3
- 目标：提供独立的“联网搜索”设置入口，并把输入框加号按钮替换为地球开关。
- 交付物：
  - `WebSearchSettingsDialog`：连接列表、新增/编辑/删除、region、测试、活动连接、配额；
  - 侧栏“联网搜索”入口；
  - Composer 地球按钮：点亮/熄灭，未配置时提示；
  - 会话 PATCH 与本地/服务端状态同步；
  - 相关测试。
- 验收：
  - A2、A3、A9 的 UI 部分；
  - 模型 Key 列表与搜索 Key 列表完全分离；
  - 未配置时不能点亮；
  - 点亮/熄灭有 `aria-pressed` 与可见状态。
- 测试：
  - `apps/web/src/features/webSearch/WebSearchSettingsDialog.test.tsx`
  - `apps/web/src/features/chat/Composer.test.tsx`
  - `apps/web/src/components/layout/ProjectSidebar.test.tsx`
- 涉及路径：
  - `apps/web/src/features/webSearch/*`
  - `apps/web/src/features/chat/Composer.tsx`
  - `apps/web/src/components/layout/ProjectSidebar.tsx`
  - `apps/web/src/lib/workspaceApi.ts`
  - `apps/web/src/lib/queries.ts`
  - `apps/web/src/stores/settingsStore.ts`
- 备注：移除的加号只包含硬编码上下文快捷项，不承载截图上传；截图拖拽保持不变。

### WS-5 契约、E2E、真实 Key 验证与收口

- 状态：`review`（自动化通过；真实 DeepSeek/GLM Key 与人工界面验收待完成）
- 依赖：WS-1～WS-4
- 目标：完成契约文档、Mock E2E、真实 Key 手工验证与状态回填。
- 交付物：
  - `docs/contracts/rest-api.md`、`ws-events.md`、`agent-command-context.md` 更新；
  - Mock E2E：配置连接→点亮地球→搜索→抓取→引用；
  - 真实 Key 验证记录；
  - `pnpm check` / `pnpm build`；
  - STATUS / ROADMAP / tasks 收口。
- 验收：
  - A1–A9 全部通过；
  - 真实 DeepSeek 与 GLM 国内至少各一次搜索/抓取；
  - 未验证项如实记录。
- 测试：
  - `pnpm test:e2e`（Mock）
  - 定向 server/web 测试
  - 手工真实 Key 验证
- 涉及路径：
  - `docs/contracts/*`
  - `e2e/*`
  - `STATUS.md`
  - `specs/ROADMAP.md`
- 备注：真实 Key 不写入仓库、日志或验收记录。
