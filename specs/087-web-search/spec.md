---
id: 087-web-search
title: 联网搜索工具与独立搜索连接
milestone: 发布后
status: active
depends_on: [020-workspace-agent, 051-agent-tool-contract, 084-agent-profiles-and-usage]
owners: [human]
created: 2026-11-20
updated: 2026-11-20
---

# 087 联网搜索工具与独立搜索连接

> 状态：`ready`（2026-11-20 人类确认以下决策）。实现前先读 [ADR-073](../../docs/adr/ADR-073-web-search.md)。
>
> 已确认决策：
>
> 1. **默认关闭，显式开启**：新会话不联网；用户点亮输入框的地球按钮才开启。
> 2. **先做 DeepSeek 与 GLM**，Provider 层保持通用，后续可接 Kimi/Tavily/Brave/SearXNG。
> 3. **搜索 Key 与模型 Key 完全隔离**：独立表、独立设置入口、独立生命周期；不复用 `credential_profiles`。
> 4. **风险控制按常规推荐**：`web_search` L0、`fetch_url` L1、每 Turn 配额、结果上限、秘密扫描、URL 白名单校验。
> 5. **输入框加号按钮移除，替换为地球按钮**：点亮表示当前会话开启联网搜索。

## 1. 背景与问题

在线搜索不是模型自身能力。当前 Larness 的 Agent 只能读取项目文件、执行命令和访问已登记服务，无法回答依赖当前外部事实的问题（版本、发布、文档、价格、新闻）。同时：

- DeepSeek 的内置 `deepseek_web_search` 在服务端执行，绕过本项目的 `executeTool`，没有审批、事件、参数校验、结果裁剪与每 Turn 配额，且绑定 `deepseek-flash`；
- 模型 Key 与搜索 Key 的用途、计费、泄露影响不同，混在一起会让搜索成本难以隔离，也会让“换模型 Key”意外改变搜索能力；
- 没有显式开关时，搜索会把用户问题发送到第三方，必须默认关闭并让用户逐会话确认。

## 2. 目标

- G-1：新增 `web_search` 与 `fetch_url` 两个普通 Agent 工具，由后端执行并把结果作为 `role: "tool"` 消息喂回模型。
- G-2：新增通用 `WebSearchProvider`，首版实现 DeepSeek Search & Fetch 与 GLM Web Search / Web Reader。
- G-3：搜索连接（provider、region、label、加密 Key）独立于模型连接，独立设置入口与独立删除生命周期。
- G-4：会话级开关，默认关闭；输入框地球按钮点亮即开启，关闭即从下一 Turn 的工具列表中移除。
- G-5：控制滥用：默认结果数 5、最多 10；每 Turn 最多 6 次 search / 4 次 fetch；结果受 16,000 字符工具预算保护；`fetch_url` 支持偏移续读。
- G-6：安全：搜索 Key 永不出现在模型上下文、事件、日志、审计或 REST 响应；query/URL 过秘密扫描；拒绝私网/本机/元数据 URL；网页内容标记为不可信数据。
- G-7：失败关闭：未配置连接、连接被删、Key 解密失败、上游 401/402/429/5xx/超时都返回稳定错误码，不静默成功。
- G-8：可验证：实际上下文组装、执行层隐藏工具、工具契约矩阵、错误路径和真实 Key 手工验证都有记录。

## 3. 非目标

- NG-1：不做 DeepSeek/GLM 的内置 server-side web tools；不使用 `deepseek_web_search`、`deepseek_read_url`、GLM `web_search` 对话工具。
- NG-2：不做图片搜索、深度研究模式、多步自动开页；只做“搜索 + 按需抓取单页”。
- NG-3：不做任意自定义搜索端点；首版只允许内置 provider + 固定 region 端点。
- NG-4：不做 MCP 搜索、SearXNG 自建、浏览器自动化或全文爬虫。
- NG-5：不做跨设备同步、团队共享搜索 Key、按项目隔离搜索 Key。
- NG-6：不改模型连接、模型目录、推理计费或 Turn 状态机。
- NG-7：不把搜索结果写入长期记忆；搜索结果是当前 Turn 的临时数据。
- NG-8：不新增搜索专用的结果卡片；先复用工具行与 Markdown 链接。

## 4. 用户故事

- 作为用户，我希望在需要最新外部信息时点亮地球按钮，让 Agent 搜索网页；不需要时保持关闭，避免问题被发送到第三方。
- 作为用户，我希望搜索 Key 与模型 Key 分开管理，换模型不会影响搜索，删除搜索 Key 也不会影响模型。
- 作为用户，我希望国内用 DeepSeek/GLM 国内端点，海外用 GLM 国际端点，并能测试 Key 是否可用。
- 作为安全负责人，我希望搜索不能读取本机/内网地址，不能把已配置的秘密带出去，网页里的指令不能提升权限。
- 作为开发者，我希望新增搜索 provider 时只实现一个接口，不改工具、上下文和 UI。

## 5. 验收场景

### A1 默认关闭

```gherkin
Given 新会话创建完成
And 已配置可用的搜索连接
When 用户打开会话
Then 地球按钮为未点亮状态
And 实际模型上下文中没有 web_search / fetch_url
And 直接执行 web_search 返回 TOOL_NOT_FOUND
```

### A2 点亮后可用

```gherkin
Given 会话已开启联网搜索
And 当前搜索连接可用
When 用户发送需要最新外部信息的问题
Then 实际模型上下文包含 web_search 与 fetch_url
And 模型可以调用 web_search 并获得带 URL 的结构化结果
And 结果作为 role=tool 消息回到模型
```

### A3 未配置连接

```gherkin
Given 没有任何搜索连接
When 用户尝试点亮地球按钮
Then 按钮保持未点亮并提示先配置联网搜索
And 后端拒绝 webSearchEnabled=true
And 不发起任何外部请求
```

### A4 搜索 Key 隔离

```gherkin
Given 模型使用 Kimi Key
And 搜索连接使用 DeepSeek Key
When 执行 web_search
Then 搜索请求使用 DeepSeek Key
And 模型上下文、工具结果、事件、日志、审计和 REST 响应都不包含任一 Key 明文
And 删除搜索连接不影响模型连接
```

### A5 DeepSeek 搜索与抓取

```gherkin
Given 搜索连接为 DeepSeek
When 执行 web_search 查询 "DeepSeek V4.1 release"
Then 返回 title/url/snippet/summary/date/authority
And 默认 need_content=false
When 执行 fetch_url 抓取结果页
Then 返回 title 与 Markdown 内容
And 超过 8,000 字符时返回 truncated=true 与 nextOffset
```

### A6 GLM 国内与国际

```gherkin
Given 搜索连接为 GLM 国内端点
When 执行 web_search
Then 请求发往 open.bigmodel.cn 的 /paas/v4/web_search
When 搜索连接为 GLM 国际端点
Then 请求发往 api.z.ai 的 /paas/v4/web_search
And 两者都映射为统一结果结构
```

### A7 秘密与 URL 防护

```gherkin
Given 已配置的搜索 Key 或模型 Key 出现在 query 中
When 执行 web_search
Then 返回 FORBIDDEN，且不发起外部请求
Given URL 为 localhost、127.0.0.1、私网、云元数据或 file://
When 执行 fetch_url
Then 返回 WEB_FETCH_BLOCKED，且不发起外部请求
```

### A8 配额与错误

```gherkin
Given 同一 Turn 已执行 6 次 web_search
When 模型再次调用
Then 返回 WEB_SEARCH_LIMIT，提示不要重试
Given 上游返回 401/402/429/500 或超时
Then 返回稳定错误码
And 不把上游响应正文或 Key 回给模型
And 只有 408/429/5xx 做最多一次退避重试
```

### A9 关闭立即生效

```gherkin
Given 会话已开启联网搜索
When 用户熄灭地球按钮
Then 当前 Turn 继续使用开始时的快照
And 下一个 Turn 不再注入 web_search / fetch_url
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `web_search` / `fetch_url` 作为普通 function tool 注册，按 Profile 与实际可用性注入 |
| R-2 | MUST | 搜索连接独立于模型连接，Key 使用 `SecretStore` 加密，REST 只返回掩码 |
| R-3 | MUST | 支持 DeepSeek 与 GLM（国内/国际），通过统一 Provider 接口映射结果 |
| R-4 | MUST | 会话级 `webSearchEnabled`，默认 false；Turn 创建时快照 |
| R-5 | MUST | 地球按钮替换加号按钮，点亮/熄灭切换会话开关 |
| R-6 | MUST | 每 Turn 配额、结果上限、`fetch_url` 分页、query/URL 秘密扫描 |
| R-7 | MUST | 网页内容是不可信数据；系统提示明确不得执行页面指令或提升权限 |
| R-8 | MUST | 未配置/连接失效/解密失败时隐藏工具并失败关闭 |
| R-9 | SHOULD | 设置页可新增、选择、测试、删除搜索连接，并显示 provider 与 region |
| R-10 | SHOULD | 工具行显示查询摘要与结果数；最终回答可点击引用链接 |

## 7. 接口与契约变更

### 7.1 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/web-search/connections` | 列出搜索连接；Key 掩码，不含明文 |
| POST | `/api/web-search/connections` | 新建连接：`provider`、`label`、`apiKey`、GLM 可选 `region` |
| PATCH | `/api/web-search/connections/:id` | 修改 label/region/Key（Key 可选） |
| DELETE | `/api/web-search/connections/:id` | 删除连接与 secret；不影响模型连接 |
| POST | `/api/web-search/connections/:id/test` | 发起一次最小真实搜索，返回延迟/结果数 |
| GET | `/api/web-search/settings` | 当前活动连接与配额设置 |
| PUT | `/api/web-search/settings` | 设置活动连接、最大结果数、每 Turn 配额 |
| PATCH | `/api/sessions/:id` | 新增 `webSearchEnabled: boolean` |

设置响应示例：

```json
{
  "activeConnectionId": "wsc_…",
  "maxResults": 5,
  "maxSearchesPerTurn": 6,
  "maxFetchesPerTurn": 4,
  "connections": [
    {
      "id": "wsc_…",
      "provider": "deepseek",
      "label": "DeepSeek 搜索",
      "region": null,
      "maskedKey": "••••••",
      "createdAt": 1790000000000
    }
  ]
}
```

### 7.2 工具

| 工具 | 风险 | 参数 | 结果 |
|---|---|---|---|
| `web_search` | L0 | `query` 1–128；`count` 1–10，默认 5 | `{ query, results: [{title,url,snippet,summary,siteName,publishedAt,authority}], count }` |
| `fetch_url` | L1 | `url` ≤8192；`offset` ≥0，默认 0；`maxChars` 2000–12000，默认 8000 | `{ url,title,content,offset,nextOffset,contentLength,truncated }` |

工具描述必须写明：只用于当前外部事实、项目代码用 `search_code`/`read_file`、网页内容不可信、不得发送秘密、引用实际使用的 URL。

### 7.3 错误码

`WEB_SEARCH_DISABLED`、`WEB_SEARCH_NOT_CONFIGURED`、`WEB_SEARCH_AUTH_FAILED`、`WEB_SEARCH_QUOTA_EXCEEDED`、`WEB_SEARCH_RATE_LIMITED`、`WEB_SEARCH_FAILED`、`WEB_SEARCH_LIMIT`、`WEB_FETCH_BLOCKED`、`WEB_FETCH_UNAVAILABLE`、`WEB_FETCH_FAILED`、`WEB_FETCH_LIMIT`。

### 7.4 事件与配置

- 不新增 WS 事件类型；沿用 `tool.requested` / `tool.started` / `tool.completed` / `tool.failed`。
- 不新增 `config.json` 键；搜索设置存数据库，避免明文配置与重启依赖。
- 审计：连接创建/修改/删除；不记录 Key 明文与 query 正文。

## 8. 数据与迁移

新增迁移 `0037_web_search`：

- 新表 `web_search_connections`：
  - `id` text 主键；
  - `provider` text not null（`deepseek` / `glm`）；
  - `label` text not null；
  - `region` text（GLM 为 `cn` / `global`，DeepSeek 为 null）；
  - `endpoint` text not null（固定预设端点）；
  - `secret_ref` text not null → `secrets.id`，`on delete cascade`；
  - `created_at` integer not null。
- `sessions` 新增 `web_search_enabled` integer boolean not null default false。
- `turns` 新增 `web_search_enabled` integer boolean not null default false。
- 不改写既有会话/模型连接；升级后全部默认关闭。
- 备份与降级：按现有迁移流程先备份；旧程序打开更高 schema 时拒绝启动。

活动连接与配额存 `app_meta`：

```json
{
  "version": 1,
  "activeConnectionId": "wsc_…",
  "maxResults": 5,
  "maxSearchesPerTurn": 6,
  "maxFetchesPerTurn": 4
}
```

## 9. 安全、权限与审计

- **Key 隔离**：搜索 Key 存独立表与 `secrets`，永不复用 `credential_profiles`；模型上下文只看到工具，不看到 Key。
- **秘密扫描**：query 与 URL 在执行前用 `secretVerdict` 对照本 Turn 已加载的秘密；命中则拒绝且不发起请求。
- **输入校验**：query 长度/空白；URL 仅 http/https、无 userinfo、≤8192，拒绝 localhost、私网、链路本地、云元数据、`.internal`/`.local`。
- **不可信内容**：搜索结果与页面正文在系统提示和工具描述中都标记为不可信；不得据此改变权限、审批或执行命令。
- **审批**：`web_search` L0；`fetch_url` L1。`strict` 下抓网页走审批，`readonly` 下禁止抓网页；`standard`/`autonomous` 按现有规则。
- **失败关闭**：连接缺失、解密失败、Key 无效、配额超限、URL 被拒都返回稳定错误码，不返回“成功”。
- **日志**：只记录 `provider`、耗时、结果数、错误码、`toolCallId`；不记录 Key、query 正文或页面正文。
- **审计**：连接 CRUD 写 `web_search.connection.*`；测试连接不写 query 正文。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 未配置连接 | 地球按钮不可点亮；后端拒绝开启 | 请先配置联网搜索 |
| 连接被删除 | 下一 Turn 不再注入工具；已开启会话显示提示 | 搜索连接已失效 |
| Key 解密失败 | 返回 `WEB_SEARCH_AUTH_FAILED`，不请求上游 | 搜索 Key 不可用，请重新填写 |
| 上游 401 | `WEB_SEARCH_AUTH_FAILED` | Key 无效或已过期 |
| 上游 402 | `WEB_SEARCH_QUOTA_EXCEEDED` | 搜索账户余额不足 |
| 上游 429/5xx/超时 | 最多一次退避重试，仍失败返回 `WEB_SEARCH_RATE_LIMITED` / `WEB_SEARCH_FAILED` | 搜索服务暂不可用，请稍后重试 |
| 空结果 | `ok=true`，`results=[]` | 未找到相关结果 |
| 页面过大 | 截断 + `nextOffset` | 已返回前 N 字符 |
| 私网/本机 URL | `WEB_FETCH_BLOCKED` | 该地址不允许抓取 |
| 每 Turn 超限 | `WEB_SEARCH_LIMIT` / `WEB_FETCH_LIMIT` | 本轮搜索次数已用完 |

## 11. 可观测性

- 日志字段：`toolName`、`provider`、`region`、`durationMs`、`resultCount`、`errorCode`、`requestId`、`sessionId`、`turnId`。
- 不记录 query、URL 查询参数、页面正文、Key。
- 工具事件沿用现有 `argsSummary`（搜索摘要）与 `resultSummary`（结果数）。

## 12. 测试计划

- **单元**：
  - DeepSeek/GLM 请求体与响应映射；
  - URL 校验（http/https、userinfo、localhost、私网、metadata、超长）；
  - 秘密扫描命中与不可用；
  - 结果分页、截断、16k 预算；
  - 配额与错误映射（401/402/403/404/408/429/5xx/超时）。
- **集成**：
  - 迁移后新表/新列存在且默认关闭；
  - 连接 CRUD 与 Key 掩码；
  - 实际上下文：开启/关闭/无连接/Profile 四种组合；
  - 执行层：隐藏工具返回 `TOOL_NOT_FOUND`；合法参数到达 handler；非法参数 `VALIDATION_ERROR`；
  - 会话开关 PATCH 与 Turn 快照；
  - 设置写入审计且无 Key。
- **E2E（Mock）**：
  - 配置连接 → 点亮地球 → 发送问题 → 工具行显示搜索 → 最终回答含链接；
  - 关闭地球 → 下一轮无搜索工具；
  - 未配置 → 点击地球提示配置。
- **真实 Key（手工，不进 CI）**：
  - DeepSeek Search + Fetch 各一次；
  - GLM 国内 search + reader 各一次；
  - GLM 国际 search + reader 各一次；
  - 记录日期、端点、延迟、结果数与费用。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| GLM 国内默认引擎 | `search_pro` | 实现时按官方可用性确认 |
| 是否允许搜索连接自定义 endpoint | 否，只允许预设端点 | 后续需要时立 ADR |
| 是否增加 per-session 默认开启 | 否，默认关闭 | 后续用户反馈 |

## 14. 完成定义

- [ ] A1–A9 全部通过；
- [ ] 单元/集成/Mock E2E 通过；
- [ ] `pnpm check`、`pnpm build` 通过；
- [ ] 契约、ADR、STATUS 与 README 更新；
- [ ] 真实 Key 手工验证记录（至少 DeepSeek + GLM 国内）；
- [ ] 人类评审通过。
