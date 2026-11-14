# 模型连接接口草案

提案对应 [077](../../specs/077-model-connections/spec.md)。现行接口以 [REST](rest-api.md)、[数据模型](data-model.md)、[WS](ws-events.md) 为准；各实现任务同步更新涉及的正式契约。

## REST

| 方法与路径 | 请求与返回 |
|---|---|
| GET `/api/models/presets` | 返回平台、接入预设、用途、字段要求和端点显示信息 |
| GET / POST `/api/credentials` | 追加预设、用途、状态；新建接收 `presetId`、`label`、`apiKey` 及该预设验证过的选项。兼容现有 provider 参数 |
| PATCH `/api/credentials/:id` | 同来源改名、停用、换 Key；写入需匹配当前配置版本。继续兼容合法的旧字段，影响现有引用的线路变更需显式操作 |
| POST `/api/models/catalog/refresh` | 按 `credentialProfileId` 单独刷新；延续现有全量刷新。返回目录状态及缓存日期 |
| GET `/api/models/catalog` | 保留现有 groups 和 defaultSelection。新增规范化能力、按字段的来源、连接可用性、验证状态 |
| PUT / DELETE `/api/models/catalog/overrides` | 对具体连接与准确模型 ID 设置或移除逐字段覆盖。PUT 可手动登记目录暂未发现的 ID |
| POST `/api/credentials/:id/test` | 接收准确模型 ID，针对该连接发送有界合成推理请求。返回已验证的协议、时间和稳定错误码 |
| PUT `/api/models/default`、PATCH `/api/models/catalog/visibility` | 保留现有参数和历史引用；同模型的展示偏好与供选择的连接分别保存 |

所有端点要求认证。写入、推理探测与上游刷新要求 CSRF。响应仅含 Key 掩码。错误区分缺少配置、版本冲突、目录临时失败、模型权限、鉴权、额度、限流、输入能力与场景限制；优先复用正式契约中的稳定码。返回用于定位问题的模型和连接引用，禁止暴露上游响应原文及请求头。

## 能力与配置

连接保存 `credentialProfileId`、`presetId`、显示名、状态、配置版本、凭据版本和已校验选项。Key 继续由 Secret Store 管理。能力使用 `contextWindow`、`maxInputTokens`、`maxOutputTokens`、`inputModalities`、`outputModalities`、`thinking`、`tools`、`streaming`。来源为用户覆盖、同线路上游、版本化目录、包内快照之一。缺失字段显式为未知。

Turn 追加所用预设、配置／凭据版本与能力快照，已有模型、凭据和窗口字段保留。上游请求头按预设生成，公共目录配置仅决定其数据来源。添加截图时另在 REST 和 WS 正式契约定义附件上传、引用和历史读取方式。
