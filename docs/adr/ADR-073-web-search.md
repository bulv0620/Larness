# ADR-073 联网搜索：普通 Agent 工具、独立搜索连接与默认关闭

- 状态：accepted（2026-11-20，人类确认 087 决策）。
- 关联：[087 spec](../../specs/087-web-search/spec.md)、[051 工具执行契约](../../specs/051-agent-tool-contract/spec.md)、[ADR-062](ADR-062-model-connections-and-capabilities.md)、[安全架构](../architecture/security.md)。
- 范围：Agent 的 `web_search` / `fetch_url` 工具、搜索 Provider、独立搜索 Key、会话级开关与相关 UI。内置 server-side 搜索、图片搜索、深度研究、自建搜索、MCP 不在本 ADR。

## 背景

在线搜索不是模型自身能力。Larness 的 Agent 目前只能读取项目文件、执行命令与访问已登记服务，无法回答依赖当前外部事实的问题（版本、发布、文档、价格、新闻）。可选方案有三类：

1. 使用模型厂商的内置 server-side 搜索（DeepSeek `deepseek_web_search`、GLM `web_search` 对话工具）；
2. 使用搜索厂商的独立 REST API，再由应用注册成普通 function tool；
3. 自建 SearXNG + 自己抓取 HTML。

方案 1 代码少，DeepSeek 的内置工具调用本身也已免搜索费；但它在厂商服务端执行，绕过 Larness 的 `executeTool`，因此没有审批、事件、参数校验、秘密扫描、结果裁剪和每 Turn 配额，且绑定具体模型。方案 2 复用现有工具执行契约，结果可控、provider 可替换，代价是需要适配与设置页。方案 3 无 Key，但需要运维服务、HTML 提取依赖和质量保障。

同时，搜索会把用户问题发送到第三方，必须默认关闭并显式开启；搜索 Key 与模型 Key 的用途、计费与泄露影响不同，混用会让成本与生命周期难以隔离。

## 决策

1. **采用普通 function tool，不采用厂商内置 server-side 搜索。** 新增 `web_search`（L0）与 `fetch_url`（L1），由 `TurnRunner` / `executeTool` 执行，结果作为 `role: "tool"` 消息回到模型。这样审批、事件、结果预算、Profile 与审计沿用现有契约。
2. **默认关闭，会话级显式开启。** 新会话 `web_search_enabled=false`；用户在输入框点亮地球按钮后才注入工具。Turn 创建时快照，运行中切换只影响下一 Turn。
3. **搜索 Key 与模型 Key 完全隔离。** 新表 `web_search_connections` 保存 provider/region/endpoint/secretRef；Key 仍由 `SecretStore` 加密。不复用 `credential_profiles`，删除搜索连接不影响模型连接。
4. **首版支持 DeepSeek 与 GLM，Provider 层通用。** DeepSeek 使用 `/v1/tools/search` 与 `/v1/tools/fetch`；GLM 使用国内 `open.bigmodel.cn` / 国际 `api.z.ai` 的 `/paas/v4/web_search` 与 `/paas/v4/reader`。统一结果结构，后续可加 Kimi/Tavily/Brave/SearXNG。
5. **固定端点，不允许任意自定义 URL。** Provider + region 映射到预设端点；避免把搜索 Key 发送到任意主机，也让 SSRF 面收敛。
6. **风险与配额。** `web_search` L0；`fetch_url` L1（`strict` 下审批，`readonly` 下禁止）。默认 5 条、最多 10 条；每 Turn 最多 6 次 search / 4 次 fetch；`fetch_url` 默认 8,000 字符并支持 `offset`/`nextOffset`；最终受 16,000 字符工具预算保护。
7. **安全默认。** query/URL 过秘密扫描；URL 仅 http/https、无 userinfo、≤8192，拒绝 localhost/私网/链路本地/云元数据/`.internal`/`.local`；网页内容在系统提示与工具描述中标记为不可信数据，不得据此提升权限或执行指令；日志不记录 Key、query 正文或页面正文。
8. **失败关闭。** 未配置、连接被删、Key 解密失败、401/402/403/404/408/429/5xx/超时都返回稳定错误码，不静默成功；只对 408/429/5xx 做最多一次退避重试。
9. **独立设置入口。** 侧栏新增“联网搜索”设置，管理搜索连接、region、活动连接与配额；模型设置弹窗不混入搜索 Key。
10. **加号按钮改为地球按钮。** 原“添加上下文”快捷项移除；截图拖拽入口保持不变。地球点亮即当前会话开启搜索，熄灭即关闭。

## 备选方案

- **DeepSeek 内置 `deepseek_web_search`**：省代码、搜索工具本身免搜索费；但绕过执行层、绑定 `deepseek-flash`、无法控制结果数量/格式/配额，SDK 也无现成适配。不采用。
- **复用 `credential_profiles` 存搜索 Key**：改动最小；但搜索 Key 会出现在模型 Key 列表，删除/轮换互相影响，计费无法隔离。不采用。
- **全局开关而非会话开关**：实现更简单；但无法做到“默认关闭、按会话显式开启”，一次开启会影响所有会话。不采用。
- **自建 SearXNG**：无 Key、隐私可控；但要运维服务、引入 HTML 提取依赖，质量与 SSRF 自负。后续可选。
- **搜索连接允许任意 endpoint**：灵活；但违反“Key 只发预设主机”的安全边界。首版不采用。

## 影响

- **产品 / UI**：输入框加号改为地球开关；侧栏新增“联网搜索”设置；会话默认关闭；未配置时不可点亮；最终回答链接沿用现有 Markdown 渲染。
- **Agent 能力**：新增 `web` pack（`web_search`、`fetch_url`），加入 `coding` / `plan`；`PROMPT_VERSION` bump；按 051 同步描述、schema、提示与正反例。
- **API / 契约**：新增 `/api/web-search/connections`、`/api/web-search/settings`；`PATCH /api/sessions/:id` 增加 `webSearchEnabled`；新增 `WEB_*` 工具错误码；同步 `docs/contracts/*`。
- **数据 / 迁移**：新增 `web_search_connections`；`sessions` / `turns` 增加 `web_search_enabled` 默认 0（迁移 `0037`）；活动连接与配额存 `app_meta`。
- **安全 / 权限**：搜索 Key 独立加密；REST 掩码；query/URL 秘密扫描；URL 白名单；网页不可信；日志脱敏；连接 CRUD 审计。
- **成本**：DeepSeek 约 $0.75/1k 次成功请求；GLM 按官方搜索定价；模型读取结果另计 token。每 Turn 配额与结果上限控制费用。
- **风险**：prompt injection、页面过大、provider 字段差异、Key 误入日志、误触外发；由提示、裁剪、双 region 测试、字段白名单与默认关闭缓解。

## 验证与回滚

- 验证：A1–A9；DeepSeek/GLM 请求与响应映射；URL 与秘密反例；配额与错误映射；实际上下文与执行层隐藏工具；会话开关快照；Mock E2E；真实 Key 手工验证（至少 DeepSeek + GLM 国内）。
- 回滚：用户熄灭地球或删除连接即可停用；代码回退后新表/列保留但被旧代码忽略；删除连接级联删除 secret，已开启会话下一 Turn 失败关闭。回滚不修改模型连接与会话历史。

## 后续

- 若需要图片搜索/深度研究，另开切片，优先评估厂商内置模式而非塞进现有工具。
- 若接入第二家第三方搜索（Tavily/Brave），复用 `WebSearchProvider` 与连接表，不改工具与 UI 结构。
- 若用户需要 SearXNG，先补自建服务的 SSRF、HTML 提取与质量验收，再新增 provider。
