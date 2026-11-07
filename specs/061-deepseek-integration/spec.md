---
id: 061-deepseek-integration
title: DeepSeek 官方接入、模型与思考档位
milestone: M5
status: ready
depends_on: [020-workspace-agent, 050-deploy]
owners: [human]
created: 2026-11-06
updated: 2026-11-07
---

# DeepSeek 官方接入、模型与思考档位

> 2026-11-07 用户确认三项决策（旧档案忽略、思考默认开启、推理数据先实测）后，本 spec 由 `draft` 转 `ready`，排入 M5-1。M4 / G4 已通过，M5 其余任务不在本切片。
> 官方资料：[模型列表](https://api-docs.deepseek.com/api/list-models/) · [模型规格](https://api-docs.deepseek.com/quick_start/pricing/) · [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)

## 1. 现状

- 内置 `deepseek-default` 指向 `deepseek-chat`，窗口硬编码 128,000（`apps/server/src/modules/models/repository.ts`）；Provider 能力声明 `reasoning: false`。
- 上下文圆环用整轮累加输入 tokens 除以该窗口（`apps/web/src/stores/timelineStore.ts` 的 `contextTokensFromEvents`），调用工具较多的轮次会提前满格。
- Provider 丢弃 `reasoning-delta`（`packages/agent/src/providers/deepseek.ts` 的 `mapAiSdkStream`），不回传 `reasoning_content`。
- 模型选择依赖用户手动创建 Profile，官方目录、窗口与档位均未接入。
- 本机 `@ai-sdk/deepseek@2.0.78` 已支持 `providerOptions.deepseek.thinking.type`（`enabled` / `disabled`）与 `reasoningEffort`（规范值 `low` / `high` / `max`，`medium`→`high`、`xhigh`→`max`）；对 V4 模型默认开启思考，并在 assistant 消息回传 `reasoning_content`。本切片按这些真实参数实施，不新增 Provider 依赖。

## 2. 已确认决策（2026-11-07，用户直接指示）

- **D1 旧档案全部忽略**：`model_profiles` 既有行保留数据、不删除，但不再进入模型选择、项目默认值与新 Turn 解析；历史 Session / Turn 的引用照常可读可展示。凭据与 Secret Store 继续复用。
- **D2 完整官方接入**：以官方目录为准同步模型、窗口与可用档位，默认候选 `deepseek-flash`；模型与档位在输入框中直接可选，不再要求用户预先建 Profile。
- **D3 思考默认开启**：新会话与新 Turn 默认开启思考，初始档位「中」；档位固定为 关闭 / 低 / 中 / 高（2026-11-07 用户直接调整，取消「默认」档）。
- **D4 推理数据先实测**：M5-1a 不持久化推理数据；M5-1b 内先用授权凭据实测同轮工具续跑、跨轮与进程重启要求，再按证据决定保留范围、有效期与清理。2026-11-07 实测（deepseek-flash）：同轮回传、省略与空串均可续跑，跨轮不带推理可用，流式适配器首步拿到 reasoning 与工具调用且续跑完成；保留范围定为 Turn 内存，不落库、无 TTL。
- **D5 选择界面（参考 Codex）**：底部药丸显示「模型名 + 档位」；点开为一级菜单（模型 / 思考等级）；模型列表按 Key 名称分组，不显示推荐分组文案；思考等级为 关闭 / 低 / 中 / 高。
- **D6 思考过程可见（2026-11-07 用户确认）**：思考正文仅在当前 Turn 内经临时 WS 增量展示给已认证客户端，与计划、工具合并为「执行过程」区；默认折叠，运行中折叠行显示单行预览，Turn 结束后折叠为摘要，点击展开只显示计划与工具，不渲染完整思考正文；客户端只保留尾部单行预览（有上限），不保留完整内容。不写入 SQLite/事件重放、日志、审计，不进入其他模型上下文；刷新或重连后不保留。

## 3. 目标

1. 服务端从固定官方地址同步目录（模型、窗口、档位、默认标记），按凭据隔离缓存并校验。
2. 模型与档位选择落到会话与 Turn：创建 Turn 时校验、快照并固定；运行中改选只影响下一 Turn。
3. Provider 按档位发送真实参数；思考模式下的工具续跑按官方协议回传推理数据。
4. 上下文圆环改为「最近一次有统计的模型请求输入 tokens ÷ 同次模型窗口」，整轮累计口径保留。
5. 设置页与输入框按 D5 改造；旧 Profile 不再展示。

## 4. 非目标

- GLM、通用 OpenAI-compatible 目录发现与多 Provider 能力矩阵（M5-1 其余范围）。
- 上下文自动压缩与跨模型迁移。
- 推理数据的长期存储、跨会话复用或导出。
- 删除、迁移或改写用户既有 `model_profiles` 行（只忽略）。
- 修改审批、锁、预算与工具授权语义。

## 5. 接口与数据变更

### 5.1 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/models/catalog` | 当前凭据范围的目录缓存；含 `stale` 与 `lastRefreshError`，不含密钥 |
| POST | `/api/models/catalog/refresh` | 服务端访问官方固定端点并刷新缓存；失败保留旧缓存 |
| GET | `/api/models` | 兼容保留的旧 Profile 列表，UI 不再使用（标记 deprecated） |

目录响应：

```json
{
  "provider": "deepseek",
  "credentialProfileId": "cred_…",
  "credentialLabel": "DeepSeek Key",
  "syncedAt": 1790000000000,
  "stale": false,
  "lastRefreshError": null,
  "models": [
    {
      "id": "deepseek-flash",
      "label": "DeepSeek Flash",
      "contextWindow": 1048576,
      "thinking": {
        "supported": true,
        "levels": [
          { "id": "low", "label": "低" },
          { "id": "medium", "label": "中" },
          { "id": "high", "label": "高" }
        ]
      },
      "default": true
    }
  ]
}
```

- `syncedAt: null` 表示从未成功同步；此时 `models` 为空，UI 提示「刷新目录」。
- 窗口与档位缺失时按「未知」展示，不猜测数值，也不把未知模型当作可选。
- `POST /api/sessions/:id/turns` 接受 `{ input, model?, thinking?, modelProfileId? }`；`PATCH /api/sessions/:id` 接受 `{ model?, thinking?, modelProfileId? }`。新字段优先；`modelProfileId` 仅兼容旧客户端。
- Session / Turn DTO 增加 `model`、`thinking`；Turn 另加 `contextWindow` 快照。`thinking` 取值：`off` / `low` / `medium` / `high`；旧 `default` 读取时归一为 `medium`。
- 校验：模型必须在当前目录（或官方内置兼容清单）内、凭据存在、档位属于该模型声明；否则拒绝且不创建 Turn。

### 5.2 事件与圆环

新增持久化事件 `model.usage`（topic `agent`，写入 `agent_events` 并递增 `seq`，先持久化后广播）：

```json
{ "type": "model.usage", "turnId": "trn_…", "model": "deepseek-flash", "inputTokens": 80000, "outputTokens": 1200, "totalTokens": 81200, "contextWindow": 1048576 }
```

- 每次模型请求完成且有 usage 时写一条；只含展示字段，不含 prompt、推理正文或密钥。
- `turn.completed.usage` 保持整轮累计口径，不变。
- 圆环取当前时间线中「最近一条 model 等于所选模型的 `model.usage`」计算 `inputTokens / contextWindow`；没有匹配统计时显示「暂无统计」，不回退到累计值或 0。
- 单次占比文案写明「单次输入 80,000 / 1,048,576」。

### 5.3 数据与迁移（`0015_model_catalog`，schemaVersion 15）

- 新表 `model_catalog_cache`：`credential_profile_id` 主键、`provider`、`endpoint`、`models_json`、`synced_at`、`last_attempt_at`、`last_error_code`。`models_json` 只存校验后的展示字段。
- `sessions` 新增可空列 `model`、`thinking`；`turns` 新增可空列 `thinking`、`context_window`。
- 只加表与可空列；不删除、不改写 `model_profiles` / `credential_profiles`，升级保留全部数据与事件序号。

### 5.4 Provider 参数

- 思考开启：`providerOptions.deepseek.thinking = { type: "enabled" }`；档位按强度映射到官方规范值：`low`→`low`、`medium`→`high`、`high`→`max`。
- 关闭思考：`thinking = { type: "disabled" }`。
- 思考开启时 SDK 忽略 `temperature` / `topP`，不作为错误处理。
- `ProviderStepInput` 增加 `thinking`（`{ enabled: boolean; effort?: "low" | "high" | "max" }`）。
- `ModelMessage.assistant` 增加可选 `reasoning`，`ProviderChunk` 增加 `reasoning-delta`；两者只用于同轮工具续跑的内存回传，不落库、不进事件、不显示。PoC 实测省略也可续跑，但仍按官方建议回传。
- 模型与档位非法时在调用上游前拒绝。

### 5.5 UI

- Composer 控件：底部药丸显示 `模型名 + 档位`（档位强调色）；点开为一级菜单，含 `模型` 与 `思考等级` 两行。模型行进入按 Key 分组的模型列表（小字 Key 名称 + 该 Key 支持的模型，当前项勾选）；思考等级行进入 关闭 / 低 / 中 / 高 列表。不使用滑杆，没有额外的分组标题。
- 键盘：菜单 ↑↓ 移动、Enter 选择、Esc 关闭；焦点可见；窄屏不遮挡输入区。
- 执行过程区：默认折叠；运行中折叠行显示「正在思考 · <尾部单行预览>」，结束后为「执行了 N 项操作 · X秒」；点击展开只显示计划与工具，不渲染完整思考正文。客户端只保留尾部单行预览（≤240 字符），不保留完整内容。
- 设置页模型区：凭据列表 + 目录（模型、窗口、档位、默认标记、同步时间、刷新按钮、stale / 错误状态）；选择保存到当前会话；旧 Profile 列表移除。
- 无凭据：控件显示「未配置凭据」并引导到设置页。
- 沿用现有 Tailwind token 与 DropdownMenu，不引入第二套 UI 框架。

## 6. 安全与权限

- 目录读取与刷新要求已认证会话；刷新为写操作，校验 CSRF；未认证不调用上游。
- 上游地址固定为官方端点，禁止从请求体 / 查询参数指定 URL，不跟随重定向到非官方主机。
- 目录响应 Zod 校验；未知或缺失字段按「未知」处理，不猜测窗口与档位。
- 推理数据只允许在所属会话的实时 WS 增量与前端内存中按协议回传和展示；禁止写入 SQLite / 事件重放、日志、审计、其他会话或跨模型上下文。刷新或重连后不保留，不重放。
- 日志只记录模型 id、档位、tokens 与耗时；目录缓存与事件不含密钥；密钥仍只经 Secret Store。
- 修改模型或档位不改变工具授权、审批、锁与预算。

## 7. 失败与边界

| 情况 | 行为 |
|---|---|
| 无 DeepSeek 凭据 | `409 MODEL_CREDENTIAL_MISSING`，不调用上游 |
| 上游 401 / 403 | `PROVIDER_AUTH_FAILED`，缓存保留，`stale=true` |
| 上游 429 | `PROVIDER_RATE_LIMITED`，缓存保留 |
| 上游超时 / 5xx | `PROVIDER_UNAVAILABLE`，缓存保留 |
| 目录响应不合规 | `502 MODEL_CATALOG_INVALID`，不写入缓存 |
| 模型不在目录 | `400 MODEL_UNSUPPORTED`，不创建 Turn |
| 档位不属于该模型 | `400 MODEL_UNSUPPORTED`，不创建 Turn |
| 旧客户端传 `modelProfileId` | 兼容解析为快照；档案已忽略或凭据缺失时失败关闭 |
| 无单次统计 | 圆环显示「暂无统计」，不显示 0 或累计值 |

新增稳定错误码：`MODEL_CREDENTIAL_MISSING`、`MODEL_CATALOG_INVALID`、`MODEL_UNSUPPORTED`。

## 8. 验收场景

| 场景 | Given | When | Then |
|---|---|---|---|
| A1 目录同步 | 已配置有效 DeepSeek 凭据 | 在设置页刷新目录 | 显示官方返回的兼容模型、窗口与档位；默认候选为 `deepseek-flash`；缓存写入并带 `syncedAt` |
| A2 目录失败 | 已有一次成功同步的目录 | 凭据失效、限流、超时或字段缺失 | 保留上次记录并显示刷新失败与 `stale`；未知窗口 / 档位显示「未知」，不给假值 |
| A3 默认选择 | 新会话，已同步目录 | 不修改选择直接发送 | 使用 `deepseek-flash`，请求带 `thinking.type=enabled` 与 `reasoningEffort=high`（中档映射）；UI 显示「中」 |
| A4 档位固定 | 所选模型提供多个档位 | 以「高」发送，再在运行中改选「低」 | 本轮每次模型请求继续用「高」（`reasoningEffort=max`）；下一轮用「低」；非法档位后端返回 `MODEL_UNSUPPORTED` |
| A5 工具续跑 | 官方端点开启思考 | 任务连续调用工具，再在同会话发下一轮 | 已授权工具正常执行并返回最终答复；同轮在内存中回传推理数据（省略/空串实测也可续跑）；跨轮无需推理；不落库 |
| A6 圆环口径 | 同一轮两次模型请求各有 40,000 和 80,000 输入 tokens，窗口为 1,048,576 | 第二次用量到达，随后刷新页面 | 圆环按 80,000 显示约 8%，文案写明单次输入；累计输入仍记录为 120,000 |
| A7 历史与切换 | 旧记录只有累计用量，或统计来自另一模型 | 打开旧会话或切换模型 | 圆环显示「暂无统计」，直到所选模型有可匹配的单次统计 |
| A8 鉴权 | 请求来自未认证客户端 | 读取目录或尝试刷新 | 服务端拒绝，且不调用上游 |
| A9 旧档案忽略 | 升级前存在用户自建 Profile | 升级后打开选择器 / 发送 | 选择器只显示目录模型；旧 Profile 不可选；历史 Turn 详情仍显示原模型与用量；DB 原行保留 |
| A10 UI | 已有目录或刷新失败 | 键盘与鼠标操作两级菜单 | 一级菜单显示模型与思考等级；模型列表以 Key 名称分组；当前项勾选；失败态给出提示；1440 与窄屏不遮挡输入区 |
| A11 推理数据不泄漏 | 思考模式完成一轮 | 查看日志、审计、SQLite 与另一会话 | 无推理正文；其他会话收不到；跨模型上下文不含；重新加载页面不出现 |
| A12 思考过程可见 | 思考模式运行中 | 观察时间线与刷新 | 默认折叠，运行中折叠行显示单行预览；展开只显示计划与工具；结束后摘要不含思考；刷新后思考消失，最终答复与工具仍在 |

## 9. 测试计划

- 契约：目录响应 Zod 校验（正常 / 缺字段 / 超限 / 非 JSON）、鉴权与 CSRF、缓存按凭据隔离、`stale` 与错误码。
- Provider（mock 上游）：各档位请求参数（`enabled` / `disabled` / `low` / `high` / `max` / 默认）；`reasoning` 回传与不落库；工具循环。
- Server：Turn 创建校验与快照、会话级模型 / 档位跨 Turn、`model.usage` 持久化与重放、迁移 0014→0015。
- Web：控件与浮层（键盘、禁用、勾选）、圆环计算（单次 / 缺失 / 切换）、设置页目录状态。
- E2E：认证浏览器选择模型与档位 → 发送 → 圆环；刷新后恢复。
- 真实凭据：官方端点目录同步与一次思考工具调用；无凭据时跳过并如实记录。
- 常规：`pnpm check`、`pnpm build`、相关 auth / prod E2E。

## 10. 任务拆分

| ID | 范围 | 依赖 |
|---|---|---|
| M5-1a | 目录同步与缓存、模型 / 档位选择与快照、Provider 发送档位、设置页与 Composer UI、旧档案忽略（A1–A4、A8–A10） | 本 spec `ready` |
| M5-1b | 推理数据 PoC 门禁、思考模式工具续跑与 `reasoning` 内存回传、脱敏（A5、A11） | M5-1a；PoC 证据 |
| M5-1c | 单次请求用量事件与圆环口径（A6、A7） | M5-1a |
| M5-1e | 思考过程与统一执行过程区（A12） | M5-1b |

## 11. 开放问题

- 阻塞项：无。
- 推理数据保留：M5-1b PoC 后定为仅 Turn 内存，不落库、无 TTL，见 [PoC 证据](poc-m5-1b.md)。
- 已实测（2026-11-07，deepseek-flash）：同轮省略/空串/回传均可续跑，跨轮不带推理可用；进程重启会中断 Turn，不继续执行。仅验证该模型，其他模型/端点未测。
