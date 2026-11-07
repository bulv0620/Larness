# M5-1d 任务

规格 `draft`，待 D1–D4 确认后转 `ready`。按 M5-1d-1 → d-2 → d-3 → d-4 顺序，一次一个任务。

## M5-1d-1 Provider 注册表与 GLM / 兼容适配器

依赖：spec ready；D1 / D2 确认。候选状态：`todo`。

- [ ] Provider 注册表：DeepSeek / GLM / openai-compatible，统一 `ProviderAdapter` 与 catalog fetcher。
- [ ] 新增 `@ai-sdk/openai-compatible`（若批准），GLM 固定端点，兼容端点 HTTPS 校验。
- [ ] `ModelProviderId` / 凭据 API / 目录 schema 扩展；错误映射与超时。
- [ ] 端点安全：环回 / 私网 / 元数据 / 非 HTTPS / 重定向拒绝。
- [ ] 测试：mock 上游流式与工具调用、真实 GLM 冒烟（有 Key 时）、端点拒绝。

## M5-1d-2 目录分组、多 Key 与能力矩阵

依赖：M5-1d-1。候选状态：`todo`。

- [ ] 迁移 `0016_multi_provider`：`sessions/turns.credential_profile_id` 可空列。
- [ ] 目录 DTO 改为分组；刷新按组；失败隔离。
- [ ] Turn / Session 绑定凭据；多 Key 未指定时失败关闭（唯一 Key 兼容）。
- [ ] 选择 UI 多组渲染 + 能力标注；未知能力不猜测。
- [ ] 测试：分组缓存、绑定、跨 Provider 拒绝、UI 组件。

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
