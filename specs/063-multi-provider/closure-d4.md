# M5-1d-4 跨模型切换与整体验收（2026-11-07）

> 状态：`done`。2026-11-07 人类确认 M5-1d 验收通过；未验证项保留为非阻塞边界，不冒充已验证。

## 范围

- 跨 Provider / 模型的标准上下文拼装与能力校验。
- 切换时不携带推理正文或厂商私有字段。
- 回归 DeepSeek / GLM / 多 Key / 圆环 / 思考过程 / 压缩。

## 验收矩阵

| 项 | 结果 | 证据 |
|---|---|---|
| Session 级模型 / 凭据切换，Turn 快照 | 通过 | `turns.test.ts` 凭据快照；Composer 选择器测试 |
| 跨 Provider 上下文只含 user / assistant 文本 | 通过 | `contextCompressor.test.ts` provider-neutral 用例 |
| 推理正文不落库、不跨 Turn | 通过 | 061 策略；`agent_events` 无 reasoning 正文；刷新丢失 |
| 思考模式按模型能力切换 | 通过 | `catalog.test.ts` GLM toggle / mandatory；Composer 档位测试 |
| 多 Key 绑定与默认模型 | 通过 | `catalog.test.ts` 分组、`providerResolver.test.ts` |
| 单次请求圆环按模型统计 + hover 提示 | 通过 | Composer 圆环测试；`Hint` 显示单次 / 窗口 |
| 上下文压缩 70% 触发、摘要、降级 | 通过 | `contextCompressor.test.ts` 成功 / 降级 / 无历史 |
| 设置页全局 Key / 显示 / 默认（不读写会话） | 通过 | 设置页实现；`model_defaults` 测试 |
| DeepSeek + GLM 真实调用 | 通过 | DeepSeek 真实 Turn；GLM-4.6 / 5.3 / 5.3-Flash Coding 端点文本、reasoning、工具调用 |
| 自定义兼容端点 | 部分 | 端点 / SSRF / 目录 / 窗口单测；真实第三方未验证 |
| GLM 图片输入 | 未支持 | 模型支持视觉，但应用未开放图片输入，不在本切片 |
| 真实长会话压缩 UI / 摘要质量 | 未验证 | 单测覆盖逻辑；需要跑到 70% 窗口 |

## 已知约束

- 兼容 Provider 的窗口由用户显式填写（默认 128K），不是自动探测。
- Coding Plan Key 必须选择 Coding 端点；标准端点会返回 1113。
- 推理正文只存在于当前 Turn 内存 / 临时 WS，刷新后不重放。
- 截图中的旧失败 Turn 不会自动重试；用失败消息的「重试」或发新消息。

## 结论

M5-1d 的功能范围完成，2026-11-07 人类验收通过，M5-1d-1 / 2a / 2b / 2c / 2d / 3 / 4 全部关闭。剩余未验证项（真实第三方兼容端点、GLM 图片输入、真实长会话压缩质量）不阻塞本切片，转入后续实验或 M5-5 发布清单跟踪。
