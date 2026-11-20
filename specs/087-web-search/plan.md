# 实施计划：联网搜索工具与独立搜索连接

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

采用“普通 Agent 工具 + 独立搜索 Provider”的方案：

```text
Composer 地球按钮
  → PATCH /api/sessions/:id { webSearchEnabled }
  → Turn 创建时快照 webSearchEnabled

TurnRunner
  → 读取会话开关 + 活动搜索连接
  → contextAssembler 注入 web_search / fetch_url
  → executeTool
  → ToolContext.webSearch / fetchUrl
  → WebSearchService
  → WebSearchProvider（DeepSeek | GLM）
  → 结构化结果 → role: "tool" → 下一步模型
```

关键点：

1. **Provider 接口与传输分离**：`WebSearchProvider` 只负责把统一请求映射成上游 JSON，并映射回统一结果；超时、重试、错误码、结果裁剪在 `WebSearchService`。
2. **连接与模型连接隔离**：新表 `web_search_connections` 只存 provider/region/endpoint/secretRef；Key 仍由 `SecretStore` 加密，REST 只返回掩码。
3. **可用性在执行层判定**：不仅靠前端隐藏；`TurnRunner` 把不可用的 `web_search`/`fetch_url` 加入 `disabledTools`，直接调用返回 `TOOL_NOT_FOUND`。
4. **Turn 快照**：会话开关在 Turn 创建时写入 `turns.web_search_enabled`；运行中切换只影响下一 Turn。
5. **结果有界**：`web_search` 默认 5 条、最多 10 条；`fetch_url` 默认 8,000 字符、支持 `offset`/`nextOffset`；最终仍受 `toolMessageContent` 的 16,000 字符预算保护。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 普通 function tool + 独立 Search API | 复用现有审批/事件/预算/Profile；provider 可替换；结果可控 | 需要自己实现适配与设置页 | **采用** |
| DeepSeek/GLM 内置 server-side 搜索 | 代码少；DeepSeek 工具调用本身免搜索费 | 绕过 `executeTool`；绑定模型；无法限额/审计/裁剪；SDK 无适配 | 不采用 |
| 在 Prompt 里让模型“自己搜索” | 无工具改动 | 不可靠，模型无网络能力 | 不采用 |
| 自建 SearXNG + HTML 提取 | 无 Key、隐私可控 | 需要运维服务、HTML 提取依赖、SSRF/质量风险 | 后续可选 |
| 复用 `credential_profiles` 存搜索 Key | 改动最小 | 与模型 Key 混在一起，无法独立生命周期 | 不采用 |

## 3. 目录与文件变更

```text
新增：
  specs/087-web-search/spec.md
  specs/087-web-search/plan.md
  specs/087-web-search/tasks.md
  docs/adr/ADR-073-web-search.md
  apps/server/drizzle/0037_web_search.sql
  apps/server/src/modules/web-search/types.ts
  apps/server/src/modules/web-search/repository.ts
  apps/server/src/modules/web-search/settings.ts
  apps/server/src/modules/web-search/service.ts
  apps/server/src/modules/web-search/deepseek.ts
  apps/server/src/modules/web-search/glm.ts
  apps/server/src/api/webSearch.ts
  apps/server/src/modules/agent/webTool.ts
  apps/server/test/web-search/*.test.ts
  apps/web/src/features/webSearch/WebSearchSettingsDialog.tsx
  apps/web/src/features/webSearch/WebSearchSettingsDialog.test.tsx
  apps/web/src/stores/settingsStore.ts

修改：
  apps/server/src/db/schema.ts
  apps/server/src/db/migrations journal
  apps/server/src/bootstrap/start.ts
  apps/server/src/modules/agent/profiles.ts
  apps/server/src/modules/agent/contextAssembler.ts
  apps/server/src/modules/agent/toolExecutor.ts
  apps/server/src/modules/agent/turnRunner.ts
  apps/server/src/modules/sessions/service.ts
  apps/server/src/modules/sessions/turns.ts
  apps/server/src/modules/sessions/repository.ts
  apps/server/src/api/sessions.ts
  apps/server/test/agent/toolContract.test.ts
  apps/server/test/agent/contextAssembler.test.ts
  apps/server/test/agent/profiles.test.ts
  apps/web/src/features/chat/Composer.tsx
  apps/web/src/features/chat/Composer.test.tsx
  apps/web/src/components/layout/ProjectSidebar.tsx
  apps/web/src/components/layout/ProjectSidebar.test.tsx
  apps/web/src/lib/workspaceApi.ts
  apps/web/src/lib/queries.ts
  docs/contracts/rest-api.md
  docs/contracts/ws-events.md
  docs/contracts/agent-command-context.md
  specs/README.md
  specs/ROADMAP.md
  STATUS.md
```

## 4. 实施步骤

1. **WS-0**：写 ADR-073，冻结 provider 范围、Key 隔离、会话开关、风险等级与默认关闭。
2. **WS-1**：先写 Provider 失败测试（请求体、响应映射、错误码、URL 校验），再实现 DeepSeek/GLM 适配器与 `WebSearchService`。
3. **WS-2**：迁移 `web_search_connections` 与 `sessions/turns.web_search_enabled`；实现 repository、设置存储、REST、审计与 Key 掩码。
4. **WS-3**：实现 `webTool.ts`、`web` pack、`ToolContext` 绑定、`contextAssembler` 过滤、`disabledTools`、配额与秘密扫描；补 `toolContract` 矩阵。
5. **WS-4**：前端设置弹窗与侧栏入口；Composer 地球按钮替换加号；会话 PATCH；Mock E2E。
6. **WS-5**：契约、文档、真实 Key 手工验证、`pnpm check` / `pnpm build`、STATUS 回填。

## 5. 数据与迁移

- 迁移 `0037_web_search.sql`：
  - `web_search_connections` 新表；
  - `sessions.web_search_enabled` 默认 0；
  - `turns.web_search_enabled` 默认 0。
- 只加表与带默认值的列，不改写既有数据；升级后全部默认关闭。
- 活动连接/配额存 `app_meta`，不做单独迁移。
- 备份由现有 `preUpgradeBackup` 流程负责；旧程序遇到更高 schema 仍拒绝启动。
- 回滚：删除连接与关闭会话开关即可停用；代码回退后新表/列保留但不影响旧逻辑。

## 6. 回滚策略

- 运行时：用户熄灭地球按钮或删除连接，下一 Turn 即无搜索工具。
- 发布级：回退版本后，`web_search_enabled` 列与连接表保留；旧代码忽略它们。
- 安全事件：删除搜索连接会级联删除 secret；已开启会话在下一 Turn 因无连接而失败关闭。

## 7. 验证命令

```bash
pnpm --filter @larness/server test:file test/web-search/deepseek.test.ts
pnpm --filter @larness/server test:file test/web-search/glm.test.ts
pnpm --filter @larness/server test:file test/agent/toolContract.test.ts
pnpm --filter @larness/web test:file src/features/webSearch/WebSearchSettingsDialog.test.tsx
pnpm --filter @larness/web test:file src/features/chat/Composer.test.tsx
pnpm check
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| GLM 国内/国际字段差异 | 映射错误或空结果 | 两个 region 分开测试；只使用固定预设 |
| 搜索结果含 prompt injection | 模型执行页面指令 | 系统提示 + 工具描述标记不可信；关键路径手工红队 |
| 页面过大导致上下文膨胀 | 费用与截断 | 默认 8k + offset；工具结果 16k 预算 |
| Key 误入日志/事件 | 凭据泄露 | 只存 secretRef；REST 掩码；日志字段白名单 |
| 地球按钮误触导致外发 | 隐私 | 默认关闭；首次点亮显示一次说明；未配置不可点亮 |
| 连接删除后会话仍开启 | 工具不可用 | 执行层失败关闭并在上下文提示重新配置 |

## 9. 未决事项

- 无阻塞项。GLM 国内默认引擎在实现时以官方文档可用值为准（`search_pro`）。
