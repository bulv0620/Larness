---
id: 063-multi-provider
title: 多 Provider、能力矩阵与上下文压缩
milestone: M5
status: ready
depends_on: [061-deepseek-integration, 050-deploy]
owners: [human]
created: 2026-11-07
updated: 2026-11-07
---

# 多 Provider、能力矩阵与上下文压缩（M5-1d）

> 状态：`draft`，待规格评审。M5-1a/b/c/e 已交付；本切片是 061 的其余范围（GLM、通用兼容端点、压缩、跨模型迁移）。

## 1. 目标

1. **Provider 抽象**：保留 DeepSeek，新增 GLM 与通用 OpenAI-compatible Provider；每个 Provider 有独立的凭据、目录、能力声明与错误映射。
2. **多 Key / 多 Provider 选择**：目录按「Provider + Key」分组，模型选择绑定到具体凭据；换 Key 不串用模型或用量。
3. **能力矩阵**：流式、工具调用、思考档位、视觉、上下文窗口按 Provider / 模型声明；未知能力不猜测，UI 标注未知并禁用不支持的操作。
4. **上下文压缩**：接近窗口上限时生成摘要并保留结构化任务状态（目标、已改文件、待办、失败验证、服务/终端 ID、待审批动作），后续请求使用「摘要 + 最近消息」。
5. **跨模型切换**：同一会话切换 Provider / 模型时只迁移标准化的摘要、最近消息与工具结果，不携带厂商私有推理数据。

## 2. 非目标

- 本地模型、模型市场、插件、自动路由（按任务自动选模型）。
- 同一条模型请求内混用多个 Provider。
- 跨 Provider 共享 Secret 或自动复制凭据。
- 永久保存完整推理数据（沿用 M5-1b/e：仅 Turn 内存 + 单行预览）。
- 用一个通用黑盒替代工具授权、审批、锁与审计。

## 3. 决策（已确认 2026-11-07）

| ID | 决策 | 推荐 |
|---|---|---|
| D1 | GLM / 兼容 Provider 的实现方式 | 已确认：新增 `@ai-sdk/openai-compatible@2.0.91`（纯 JS，兼容 ai 6 / Node 20），复用 `streamText`；GLM 走官方兼容端点 |
| D2 | 自定义 endpoint 的安全边界 | 已确认：任意公网 HTTPS；GLM 固定官方端点；服务端发起，拒绝环回 / 内网 / 元数据 / 非 HTTPS / 重定向 |
| D3 | 压缩触发与摘要模型 | 已确认：≥ 窗口 70% 触发；当前 Turn 模型生成摘要（无工具、20s 超时）；失败降级截断 + `degraded` |
| D4 | 跨模型迁移范围 | 已确认：允许跨 Provider；只迁移摘要 + 最近 N 条消息 + 工具结果，不迁移推理数据或厂商私有字段 |

## 4. 接口与数据

### 4.1 Provider 注册表

- `ProviderAdapter` 已有能力字段；新增 `catalog` 能力：`fetchModels(apiKey, endpoint?)` 返回模型元数据（id、显示名、窗口、思考档位、默认标记）。
- Provider id 扩展：`"glm"` 与 `"openai-compatible"`；`ModelProviderId` / 凭据 API 的 Zod 枚举同步。
- 每个 Provider 固定默认端点：DeepSeek `https://api.deepseek.com`、GLM `https://open.bigmodel.cn/api/paas/v4`；兼容 Provider 允许用户填 HTTPS 端点（D2 边界）。
- 有官方目录的 Provider 用目录；没有目录的用内置注册表 + 未知字段（不猜窗口/档位）。

### 4.2 目录与选择

`GET /api/models/catalog` 增加 `groups`（同时保留指向最新组的扁平字段，兼容现有选择器）：

```json
{
  "groups": [
    {
      "provider": "deepseek",
      "credentialProfileId": "cred_…",
      "credentialLabel": "DeepSeek Key",
      "syncedAt": 1790000000000,
      "stale": false,
      "lastRefreshError": null,
      "models": [{ "id": "deepseek-flash", "label": "DeepSeek-V4.1-Flash", "contextWindow": 1048576, "thinking": { "supported": true, "levels": [ … ] }, "default": true }]
    }
  ]
}
```

- 刷新按「Provider + Key」执行；失败只影响该组并保留旧缓存。
- `POST /api/sessions/:id/turns` 与 `PATCH /api/sessions/:id` 接受 `credentialProfileId`；Turn 快照增加 `credential_profile_id`，模型解析只使用该凭据（缺失时失败关闭）。
- 旧调用只传 `model` 时按最新凭据解析，保留兼容；多 Key 下必须显式传 `credentialProfileId`。

### 4.3 数据与迁移（`0016_multi_provider`，schemaVersion 16）

- `sessions` / `turns` 增加可空 `credential_profile_id`（不删除旧列、不回填）。
- 新表 `session_context_summaries`：`id, session_id, covered_up_to_seq, summary, tokens_before, tokens_after, degraded, created_at`；只保留每个会话最近一条或按需保留历史。
- `model_catalog_cache` 复用；主键仍是凭据，Provider 由关联凭据决定。

### 4.4 压缩

- 触发：组装上下文时估算 tokens（消息 + 工具 + system）；超过 `window × 0.7` 且存在可压缩历史时触发。
- 摘要请求：同一模型、无工具、独立超时（如 20s）、只读取将被压缩的消息；返回结构化摘要（目标 / 已完成 / 待办 / 失败验证 / 资源 ID / 待审批）。
- 结果：写入 `session_context_summaries`，事件 `context.compressed`（`{turnId, summaryId, coveredUpToSeq, tokensBefore, tokensAfter, degraded}`）先持久化再广播；后续上下文 = system + 摘要 + 最近 N 条 + 当前 Turn。
- 失败/超时：不阻塞 Turn；降级为现有截断（`HISTORY_LIMIT`），事件标记 `degraded: true`；UI 显示「上下文已压缩（降级）」。
- 安全：摘要可能含项目内容，按会话隔离、随会话删除；不得包含密钥；不进入跨模型私有字段。

### 4.5 跨模型切换

- 切换后新模型只收到：system 政策、最新摘要、最近消息、工具结果、当前 Turn。
- 不携带上一模型的推理数据、tool call 私有字段或厂商 reasoning；能力差异（如无工具调用）在启动 Turn 前拒绝并提示。

## 5. 安全与权限

- 所有端点固定或按 D2 校验；服务端发起，禁止请求体指定任意 URL、禁止跟随重定向到非白名单主机。
- 凭据仍只经 Secret Store；目录 / 摘要 / 事件不含密钥；日志只记录 Provider、模型、tokens、耗时。
- 切换 Provider 不改变工具授权、审批、锁、项目边界或审计。
- 压缩摘要不包含秘密；沿用统一脱敏；跨会话不可读。

## 6. 失败与边界

| 情况 | 行为 |
|---|---|
| 无对应 Provider 凭据 | `409 MODEL_CREDENTIAL_MISSING`，不调用上游 |
| 目录不可用 | 保留该 Key 旧缓存，`stale: true`，不影响其他组 |
| 自定义 endpoint 非 HTTPS / 内网 / 元数据地址 | `400 VALIDATION_ERROR` 或 `403 FORBIDDEN`，不发起请求 |
| Provider 不支持工具调用 | 该 Turn 在创建前拒绝，或降级为纯文本并明确提示（按模型能力） |
| 摘要超时 / 失败 | 降级截断，Turn 继续，事件 `degraded: true` |
| 跨模型能力不足 | 明确提示并保留原模型，不静默降级 |
| 多 Key 未指定凭据 | 仅有唯一 Key 时兼容；多 Key 时要求显式选择 |

## 7. 验收场景

| 场景 | Given | When | Then |
|---|---|---|---|
| A1 GLM 目录与凭据 | 已配置 GLM Key | 刷新目录 | 返回 GLM 模型与窗口；分组显示 GLM Key；默认模型可用 |
| A2 多 Key 分组 | 同 Provider 两个 Key | 打开模型选择 | 两个 Key 分组各自列出模型；选择绑定到对应凭据 |
| A3 GLM 工具调用 | GLM 模型支持工具 | 发送需要工具的任务 | 流式输出、工具调用、审批与最终答复正常 |
| A4 兼容端点安全 | 用户填写自定义端点 | 填写环回 / 内网 / 非 HTTPS | 拒绝且不发起请求；合法 HTTPS 公网端点可同步目录 |
| A5 压缩触发 | 历史接近窗口 70% | 发起下一轮 | 生成摘要，事件持久化，后续请求使用摘要 + 最近消息 |
| A6 压缩保留 | 压缩前的任务状态 | 压缩后继续 | 目标、已改文件、待办、失败验证、资源 ID、待审批仍在摘要中 |
| A7 压缩降级 | 摘要模型超时 | 继续 Turn | Turn 不阻塞，使用截断，UI 标记降级 |
| A8 跨模型切换 | 会话使用 Provider A | 切到 Provider B 并发下一轮 | 只收到摘要 / 最近消息 / 工具结果；无推理数据；能力不足时提示 |
| A9 鉴权与隔离 | 未认证 / 其他会话 | 读取目录、摘要或事件 | 拒绝；不调用上游；不泄漏其他会话 |

## 8. 测试计划

- Provider 契约：GLM / 兼容端点 mock 上游的流式、工具调用、错误映射；真实 GLM 冒烟（有 Key 时）。
- 目录：分组、按 Key 缓存、刷新失败隔离、鉴权与 CSRF。
- 端点安全：环回 / 内网 / 元数据 / 重定向 / 非 HTTPS 拒绝。
- 压缩：触发阈值、摘要内容、降级、事件持久化与重放、随会话删除。
- 跨模型：摘要 + 最近消息、无推理、能力校验。
- 回归：`pnpm check`、`pnpm build`、auth / prod E2E；现有 DeepSeek 流程不受影响。

## 9. 任务拆分

| ID | 范围 | 依赖 |
|---|---|---|
| M5-1d-1 | Provider 注册表、GLM / OpenAI-compatible 适配器、凭据与端点安全 | 本 spec ready；D1/D2 确认 |
| M5-1d-2a | 目录分组、凭据绑定、DeepSeek / GLM 目录（服务端） | M5-1d-1 |
| M5-1d-2b | 多 Key / Provider 选择 UI、能力矩阵、自定义兼容端点 | M5-1d-2a |
| M5-1d-3 | 上下文压缩（触发、摘要、降级、事件与 UI） | M5-1d-2；D3 确认 |
| M5-1d-4 | 跨模型切换与整体验收（A8） | M5-1d-3；D4 确认 |

## 10. 开放问题

- 无阻塞项；D1–D4 已于 2026-11-07 确认。
- 真实 GLM 端点与官方目录行为尚待凭据验证（M5-1d-1 仅验证 mock 契约与端点安全）。
