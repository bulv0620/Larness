# M5-1d 任务

规格已于 2026-11-07 转 `ready`（D1–D4 确认）。按 M5-1d-1 → d-2 → d-3 → d-4 顺序，一次一个任务。

## M5-1d-1 Provider 注册表与 GLM / 兼容适配器

依赖：spec ready；D1 / D2 确认。状态 `review`（2026-11-07 交付）。

- [x] Provider 注册表：DeepSeek / GLM / openai-compatible，统一 `ProviderAdapter` 与 catalog fetcher。
- [x] 新增 `@ai-sdk/openai-compatible`（若批准），GLM 固定端点，兼容端点 HTTPS 校验。
- [x] `ModelProviderId` / 凭据 API / 目录 schema 扩展；错误映射与超时。
- [x] 端点安全：环回 / 私网 / 元数据 / 非 HTTPS / 重定向拒绝。
- [x] 测试：mock 契约与端点拒绝；真实 GLM 冒烟待 Key。Provider 注册表按工厂实现（DeepSeek / GLM / 兼容），目录 fetcher 与 Turn 接线归 d-2。

## M5-1d-2a 目录分组与凭据绑定（服务端）

依赖：M5-1d-1。状态 `review`（2026-11-07 交付）。

- [x] 迁移 `0016_multi_provider`：`sessions/turns.credential_profile_id` 可空列。
- [x] 目录 DTO 增加 `groups`（保留扁平字段指向最新组）；刷新按组、失败隔离；DeepSeek / GLM 目录。
- [x] Turn / Session 绑定凭据；同一模型存在于多个 Key 时要求显式选择。
- [x] Provider 解析使用 Turn 快照凭据；GLM 走 `createGlmProvider`。
- [x] 测试：分组缓存、绑定、歧义拒绝、迁移计数。

## M5-1d-2b 多 Key / Provider 选择 UI

依赖：M5-1d-2a。状态 `review`（2026-11-07 交付）。

- [x] 选择器按 `groups` 渲染 Provider + Key 分组；选择带上 `credentialProfileId`。
- [x] 能力展示：窗口、思考档位、未知窗口不可选；Provider 标签。
- [x] 设置页增加 DeepSeek / GLM Provider 选择；分组模型列表保存到当前会话。
- [x] 测试：多组渲染、选择绑定到 Key、切换 Key 后用量不串。
- [x] 修正：设置弹窗限高滚动；未知窗口模型禁用；GLM 余额不足映射 `PROVIDER_QUOTA_EXHAUSTED`。
- [x] 弹窗按服务运维风格重构：Key 列表 → Key 详情（模型列表）；添加 Key 独立视图。
- [x] 迁移 `0017_model_visibility` 与 `PATCH /api/models/catalog/visibility`；模型行眼睛图标控制是否出现在会话选择器，输入框选择器过滤隐藏模型。
- [x] 设置页去会话化：迁移 `0018_model_defaults` + `PUT /api/models/default`；只管理 Key、显示、全局默认；新会话继承默认，会话内用输入框选择器覆盖。
- [x] 迁移 `0019_credential_endpoint`：GLM 凭据可选标准 / Coding Plan × 国内 / 国际端点；目录与对话使用该端点；设置页可切换。
- [x] 修复 ProviderResolver 漏传 endpoint；回归测试覆盖解析结果；移除配额错误里的端点提示文案。

## M5-1d-2d GLM 思考模式

依赖：M5-1d-2b。状态 `review`（2026-11-07 交付）。

- [x] 能力模型增加 `thinking.mode`：`toggle` / `levels` / `mandatory-levels`。
- [x] GLM 映射：4.5/4.5-Air/4.6/4.7/5/5.1 开关；5.2 档位；5.3 强制档位（低/中/高 → low/high/max）。
- [x] 服务端按 mode 校验与默认值；Turn 快照保持 `on` / `low` / `medium` / `high`。
- [x] 兼容适配器发送 `thinking.type` 与 `reasoning_effort`（openai-compatible providerOptions）。
- [x] UI 按模型动态显示档位；切换模型自动修正非法档位。
- [x] 测试：GLM toggle / mandatory 校验、Provider options、选择器档位、内置窗口表回归。
- [x] 真实目录刷新验证：4.7/5/5.1/5-Turbo 200K、5.2/5.3/5.3-Flash/FlashX 1M，模式正确。
- [x] 对齐审计：12 个 GLM 模型的窗口 / 模式逐项锁定测试；4.7 可关闭（开启时强制思考）；5.3 / Flash / FlashX 强制思考；5.2 支持 effort；GLM 适配器声明 reasoning。
- [ ] z.ai 区域 Key 的端点支持归 d-2c；图片输入不在本切片。

## M5-1d-2c 自定义兼容端点

依赖：M5-1d-2b。候选状态：`todo`。

- [x] `credential_profiles.endpoint`（0019）与兼容 `context_window`（0020）；兼容 Provider 必须提供端点。
- [x] 创建 / 修改端点经 `assertSafeEndpoint`（HTTPS、公网、拒绝重定向）；Turn 开始前再次校验。
- [x] 兼容 Provider 目录、Turn 解析与适配器使用凭据端点；窗口按凭据显式值回退（默认 128K）。
- [x] 设置页兼容 Provider 添加 / 编辑端点与窗口；目录刷新、模型选择和默认模型可用。

## M5-1d-3 上下文压缩

依赖：M5-1d-2；D3 确认。候选状态：`todo`。

- [ ] 估算 tokens 与 70% 触发；可压缩历史判定。
- [ ] 摘要请求（无工具、超时）、结构化摘要、`session_context_summaries` 与 `context.compressed` 事件。
- [ ] 后续上下文拼装；失败降级截断 + `degraded`；UI 状态。
- [ ] 测试：阈值、摘要内容、降级、重放、删除与脱敏。

## M5-1d-4 跨模型切换与整体验收

依赖：M5-1d-3；D4 确认。候选状态：`todo`。

- [ ] 跨 Provider / 模型的标准上下文拼装与能力校验。
- [ ] 不携带推理数据 / 厂商私有字段；切换提示。
- [ ] 回归 DeepSeek 选择、圆环、思考过程与多 Key。
- [ ] 整体验收记录与未验证项。
