# 实施计划 · 模型连接与平台接入

本计划对应 [077 规格](spec.md)。评审先确认目录信任边界、按模型浏览和连接／账单绑定语义。

## 1. 实现顺序

1. 在 `apps/server/src/modules/models` 建立官方预设注册表，复用现有凭据和 Secret Store。预设描述连接表单、可用场景、目录策略、协议、端点和错误分类。推理地址与目录地址分别声明。连接 ID 对应现有凭据 ID；运行时解析连接和版本一次，任务内复用。
2. 增加规范化模型能力和匹配逻辑。各平台用独立的 Zod 解析器保留数值语义；目录缓存保存原子提交的数据与刷新状态。新增按模型和连接范围覆盖的配置，并兼容旧接口、历史选择。新增模型在设置可见，具体能力按来源显示。
3. 先用现有 Provider 验证设置页与 Composer。沿用项目现有组件、主题和两段式浮层，新增连接、模型两个 Tab。添加覆盖多连接、唯一连接、隐藏和默认值、错误提示、键盘操作、深浅色与窄屏的验收。
4. 逐个平台接入。复用 `packages/agent/src/providers/compatible.ts`，只对已知请求差异增加映射；能力不足时按模型限制 UI 和 Turn 创建。测试真实模型的流式输出、工具执行后续步、标准化用量和鉴权／额度错误。
5. 按 077 的图片验收另做内容块和附件切片。旧文本消息解析成文本内容块；附件强制走认证 API，ws 历史只引用 ID。保留附件草稿和资源归属，按模型与协议编码，验证估算与实际用量。

## 2. 实现时使用的官方接入依据

| 平台 | 推理与目录 | 第一项验收重点 |
|---|---|---|
| OpenCode Go | 推理 Base URL `https://opencode.ai/inference/go/openai/v1`，目录 `https://opencode.ai/inference/go/v1/models`。Go 对文本提供协议转换，首批复用 Chat Completions。 [Go API](https://opencode.ai/docs/console/go#endpoints) · [第三方客户端接入](https://opencode.ai/docs/console/harnesses#sessions) | Go 要求 `x-opencode-session`。为每对本地会话与连接产生稳定且对上游不透明的 ID，同会话多步与后续 Turn 复用，测试调用使用专用 ID。无 Key 目录实测返回 403，首次验收需用合法 Go Key 记录响应字段和边界。 |
| 百炼 | API 使用 [官方地域及套餐 Base URL](https://help.aliyun.com/zh/model-studio/base-url)。北京共享按量路径 `https://dashscope.aliyuncs.com/compatible-mode/v1`；Coding Plan 为 `https://coding.dashscope.aliyuncs.com/v1`；北京 Token Plan 为 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。标准业务空间另有分页的 [原生目录](https://help.aliyun.com/en/model-studio/list-models)。 | 解析原生目录的窗口、输入和输出上限、模态与 features。只有明确属于同一个已配置业务空间的目录可使用该 Key。测试套餐连接与标准连接隔离，以及 http 429 下额度与限流的区分。 |
| Kimi | 开放平台为 `api.moonshot.cn/v1` 或 `api.moonshot.ai/v1`；Kimi Code 为 `api.kimi.com/coding/v1` 或 `api.kimi.ai/coding/v1`。 [Kimi 路径对照](https://www.kimi.com/code/docs/en/) | 真实验证第三方客户端适用性、模型选择、工具续步。订阅线路独立核对目录来源及返回字段；适配器保留真实的 Larness 客户端标识。 |
| MiniMax | 国内 `https://api.minimax.cn/v1`，国际 `https://api.minimax.io/v1`。标准 Key 与套餐订阅 Key 独立；套餐可用模型按官方资料和真实 Key 验证。 [国内接入](https://platform.minimax.cn/docs/api-reference/text-openai-api) · [国际接入](https://platform.minimax.io/docs/api-reference/text-openai-api) · [套餐与标准 Key](https://platform.minimax.io/protocol/paid-agreement) | 验证同 Turn 带 `tool_calls` 和 `reasoning_content` 的 assistant 回传、流中业务错误、输出上限参数以及各模型强制或可关闭的思考模式。 |
| 现有平台 | DeepSeek 读取 [官方模型目录](https://api-docs.deepseek.com/api/list-models/)，GLM 沿用 [063 端点表](../063-multi-provider/spec.md#41-provider-注册表)。 | DeepSeek 的总窗口包含输入与输出；解析上游 effort 和输入模态。GLM 的四端点隔离，迁移后预算与档位回归。 |

套餐线路真实验证至少包含一个该预设能用的文本 Agent 模型。平台明示限制接入产品或场景的，先核实 Larness 的发起方式是否在范围内。HTTP 认证失败、模型禁用和额度不足分别记录；不能用另一个预设的成功结果代替。

## 3. 目录与预算

- 在模型设置 API 返回能力值和来源。Models.dev 是可选远程补充，使用固定 HTTPS 地址和本地预设命名空间映射。首次接入以显式刷新请求读取固定地址，刷新时保存取得的字段。包内快照支持离线启动。首批可从版本固定的公开目录构建快照，维护一份预设映射表。每个同步周期只读同一份远程目录，保留已验证缓存。
- 远程 JSON 只取允许字段并校验大小、结构、类型和上限。拒绝重定向与任意 URL 导入，目录请求不带 API Key。目录数据禁止接管预设地址、请求头、SDK 或错误映射。
- 上游字段映射成总窗口、最大输入与最大输出三类值，保留各自口径。让上下文压缩、发送前预检、输出预留与 Composer 圆环依据同一份已解析预算。
- 连接刷新用版本比较后提交，旧缓存按版本隔离。设默认、切换可见性与迁移已有会话在事务中更新引用；失败返回对应稳定错误。
- 兼容旧数据库时记录兼容网关的遗留窗口来源。迁移先备份；回退版本时使用迁移前数据库备份及匹配的密钥材料。

## 4. 验证

```bash
pnpm check
pnpm build
pnpm test:e2e:auth
pnpm test:e2e:prod
```

按 [任务](tasks.md) 先落失败测试，再运行对应专项和整仓门禁。真实服务验收记录在本切片，禁止写入 Key 或上游原始响应。复用现有配置的 Go Key 只通过 Secret Store 或由操作者在设置界面录入。
