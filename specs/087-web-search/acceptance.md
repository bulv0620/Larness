# 087 验收记录

> 日期：2026-11-20（macOS）
> 结论：自动化检查通过；真实 DeepSeek / GLM 搜索 Key 手工验证与人类界面验收尚待完成，因此 G-087 暂不标记通过。

## 1. 自动化验证

| 检查 | 结果 | 备注 |
|---|---|---|
| `pnpm check` | 通过 | biome + 6 包 typecheck + 全量单测；server 847 passed / 14 skipped；web 275 passed；agent 63 passed / 1 skipped |
| `pnpm build` | 通过 | server 四入口 + web；仅保留既有大 chunk 提示 |
| `pnpm test:e2e` | 通过 | 25/25，含新增“加号已移除、地球按钮存在且默认关闭” |
| Provider 定向测试 | 通过 | `test/web-search/*`：DeepSeek / GLM 请求映射、HTTP 错误、URL 防护、重试、工具参数与秘密扫描 |
| 连接与 API 定向测试 | 通过 | 迁移 0037、连接 CRUD、Key 掩码、活动连接、配额、会话开关快照 |
| Agent 契约测试 | 通过 | `toolContract.test.ts` 含 `web_search` / `fetch_url` 正反例；`profiles.test.ts` 与 `contextAssembler.test.ts` 覆盖开启/关闭 |

## 2. 已验证行为

- 新会话默认 `webSearchEnabled=false`；关闭时实际上下文不含 `web_search` / `fetch_url`，执行层返回 `TOOL_NOT_FOUND`。
- 未配置活动搜索连接时，后端拒绝 `webSearchEnabled=true`（400）。
- 开启后 Turn 快照 `webSearchEnabled=true`，下一 Turn 恢复或关闭按会话状态生效。
- 搜索 Key 存独立 `web_search_connections` + `secrets`，REST 只返回 `maskedKey`；模型连接删除不影响搜索连接，反之亦然。
- DeepSeek 使用 `https://api.deepseek.com/v1/tools/search|fetch`；GLM 国内使用 `open.bigmodel.cn/api/paas/v4`，国际使用 `api.z.ai/api/paas/v4`。
- `web_search` L0、默认 5 条 / 最多 10 条；`fetch_url` L1、默认 8,000 字符、支持 `offset` / `nextOffset`；最终受 16k 工具预算保护。
- 每 Turn 默认 6 次搜索 / 4 次抓取；Turn 内相同 query/URL 去重。
- query/URL 命中已配置秘密时返回 `FORBIDDEN`，且不发起外部请求。
- `file://`、localhost、私网、链路本地、云元数据、`.internal` / `.local` URL 返回 `WEB_FETCH_BLOCKED`。
- 上游 401/402/403/404/408/429/5xx/超时映射为稳定错误码；只对 408/429/5xx 重试一次。
- 页面内容与搜索结果在系统提示和工具描述中标记为不可信数据，不得据此提升权限。

## 3. 未验证 / 待人工

- **真实 DeepSeek Search & Fetch 调用**：未运行；需要用户提供可用的 DeepSeek Key（余额可用）。
- **真实 GLM 国内 Web Search / Reader 调用**：未运行；需要 `open.bigmodel.cn` 的平台 Key。国内默认引擎为 `search_pro`。
- **真实 GLM 国际调用**：未运行；需要 `api.z.ai` 的 Key。
- **中文结果质量、延迟与费用**：未实测。
- **界面视觉与首次开启提示**：组件测试通过，但未做真实数据的人工视觉验收。
- **Prompt injection 红队**：系统提示与工具描述已标记网页不可信；未用真实恶意页面做人工红队。

## 4. 手工验证步骤

1. 启动 `pnpm dev`，进入“设置 → 联网搜索”。
2. 添加 DeepSeek 或 GLM 搜索连接，点“测试连接”，确认返回结果数与延迟。
3. 新建会话，确认地球按钮默认未点亮；点亮后发送一个依赖最新外部事实的问题。
4. 确认时间线出现 `web_search` 行，最终回答包含可点击来源链接。
5. 熄灭地球，发送下一轮，确认不再出现搜索工具。
6. 删除搜索连接，确认模型连接仍在；已开启会话下一轮应失败关闭并提示重新配置。

## 5. 证据边界

- 本次未从现有数据库导出或使用任何真实 Key；未读取 `.env`、`config.json` 或 Secret Store 明文。
- 自动化 Provider 测试使用注入的 `fetch` 夹具，不代表真实上游可达性或结果质量。
- 迁移计数从 36 升至 37；相关启动、状态、资源迁移与升级备份测试已同步更新并通过。
