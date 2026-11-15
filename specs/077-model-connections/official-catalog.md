# 官方模型目录校准

核对日期 2026-11-15。目录表示对应线路能发现的模型或官方公布的候选。账号和套餐权限仍由上游调用确认。

| 线路 | 目录和能力来源 |
|---|---|
| OpenCode Go | [官方 Go 目录](https://opencode.ai/inference/go/v1/models) 实测返回 30 个聊天条目。按本线路读取窗口、输出上限、模态、工具与推理控制。随包保留同一响应的允许字段快照，只补已经在 Go 线路发现的同名模型。未公开档位的推理模型用默认行为。确认 [Go 接入文档](https://opencode.ai/docs/console/go/) 与 [官方变体说明](https://opencode.ai/docs/models)。 |
| DeepSeek | 官方 Key 的 [模型接口](https://api-docs.deepseek.com/api/list-models/) 决定可见模型。用同页窗口与模态示例补 Flash 和 V4 Pro，历史 ID 只在连接返回时出现。 |
| 智谱国内／Z.AI | 标准及 Coding Plan 各连接仍独立发现。补齐已核对的 [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3)、[GLM-5.2](https://docs.z.ai/guides/llm/glm-5.2)、[GLM-4.6V](https://docs.z.ai/guides/vlm/glm-4.6v) 能力。未从本连接发现的条目不会仅靠快照上线。 |
| Kimi | 开放 API 原生目录加 [官方模型列表](https://platform.kimi.com/docs/models) 和 [思考文档](https://platform.kimi.com/docs/guide/use-thinking-models)。Kimi Code 使用 [官方六个 ID](https://www.kimi.com/code/docs/en/kimi-code/models.html)。同一个 ID 的窗口因档位变化时使用最低公开值。Code 关闭思考可能改用另一个模型，选择器只提供用于所选模型本身的思考档位。 |
| MiniMax | [标准 Chat API](https://platform.minimax.io/docs/api-reference/text-openai-api) 候选含 M3 和 M3.1 Flash。国内和国际 [M Plan](https://platform.minimax.io/docs/m-plan/intro) 候选为 M3.1 Flash。按 M3 的开关和 M3.1 Flash 的五档配置适配。 |
| 百炼工作空间 | 北京、新加坡、美国、香港都可用官方工作空间预设。按 [官方列表接口](https://help.aliyun.com/en/model-studio/list-models) 查询文本生成类别、分页与模型能力。现有共享域名的连接保留，账号目录由相应工作空间路由提供。 |
| 百炼套餐 | [Coding Plan 名单](https://help.aliyun.com/zh/model-studio/coding-plan)、[窗口规格](https://help.aliyun.com/en/model-studio/coding-plan-faq)、[Token Plan 个人版](https://help.aliyun.com/en/model-studio/token-plan-personal-overview) 与 [团队版](https://help.aliyun.com/en/model-studio/token-plan-team-overview) 提供候选及已知能力。短期预览条目在官方截止日期后停止进入更新后的候选缓存。Qwen 混合思考按 [Chat 请求参数](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions) 映射。 |
| 自定义兼容 | 只读取用户所连网关的列表和个人覆盖。能力随网关配置变化。 |

旧百炼共享域名没有独立的官方账户目录，原有候选和手动登记仍适用。精确缺项可使用工作空间预设同步。第三方目录仅补其对应线路的已知模型字段，优先使用经核对的官方能力。没有取得各套餐的真实 Key，授权、推理及工具调用的线上实测仍待逐线路验证。
