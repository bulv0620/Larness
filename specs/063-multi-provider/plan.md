# M5-1d 实施计划

需求与验收见 [spec](spec.md)。本计划在规格评审（D1–D4）通过后执行。

## 1. Provider 与端点（M5-1d-1）

- 在 `packages/agent` 增加 Provider 注册表：`id → adapter + catalog fetcher + 默认端点`；DeepSeek 现有适配器迁入注册表，GLM 与兼容端点复用 OpenAI-compatible 协议。
- 新增 `@ai-sdk/openai-compatible`（纯 JS）用于 GLM / 兼容端点；不改 DeepSeek 适配器行为。
- 端点校验集中在服务端：固定官方端点或 HTTPS 公网 URL；拒绝环回、私网、链路本地、云元数据、非 HTTPS 与跨域重定向。
- 凭据仍走 Secret Store；`ModelProviderId` 与 API schema 扩展 `glm` / `openai-compatible`。

## 2. 目录、多 Key 与能力矩阵（M5-1d-2）

- `GET /api/models/catalog` 返回按 Provider + Key 分组；刷新按组执行，失败只标记该组 `stale`。
- 迁移 `0016_multi_provider`：`sessions/turns.credential_profile_id` 可空列；选择与 Turn 快照绑定凭据。
- 选择 UI 沿用现有「Key 小字 + 模型列表」，改为多组渲染；模型行显示 Provider 与能力（窗口 / 工具 / 思考档位），未知能力标注未知。
- Provider 解析只使用 Turn 快照的凭据；缺失 / 跨 Provider 引用失败关闭。

## 3. 上下文压缩（M5-1d-3）

- 组装上下文时估算 tokens；超过窗口 70% 且存在可压缩历史时触发。
- 摘要请求使用当前模型、无工具、20s 超时，输出结构化字段（目标 / 已完成 / 待办 / 失败验证 / 资源 ID / 待审批）。
- 新表 `session_context_summaries` + 事件 `context.compressed`（先持久化后广播）；后续上下文 = system + 摘要 + 最近 N 条 + 当前 Turn。
- 失败 / 超时降级为现有截断，事件标记 `degraded`；UI 显示压缩状态；摘要随会话删除，不含秘密。

## 4. 跨模型切换（M5-1d-4）

- 新模型只接收 system 政策、最新摘要、最近消息、工具结果与当前 Turn。
- 不携带推理数据、厂商私有字段或旧 system prompt；能力不足（如无工具调用）在创建 Turn 前拒绝并提示。
- 回归现有 DeepSeek 单选 / 多 Key / 圆环 / 思考过程，确保切换不串模型、不串用量。

## 5. 验证

- 每个任务先写失败测试：Provider 契约（mock 上游）、端点安全、目录分组、压缩触发 / 降级、跨模型上下文。
- `pnpm check`、`pnpm build`；auth / prod E2E；有 Key 时增加真实 GLM 冒烟。
- 记录未验证项（其他 Provider、真实端点差异、平台范围）。
