# DeepSeek 官方接入任务

本切片排入 M5-1，spec 已于 2026-11-07 转 `ready`。M5-1a 已验收（2026-11-07，`done`）；M5-1b / M5-1c 保持 `todo`，一次一个任务。

## M5-1a 目录、模型与档位选择

覆盖 A1–A4、A8–A10。依赖：spec ready。状态 `done`（2026-11-07 人类验收，含两级菜单 UI）。

- [x] 迁移 `0015_model_catalog`：`model_catalog_cache` 表 + `sessions.model` / `sessions.thinking` + `turns.thinking` / `turns.context_window`（只加表与可空列）。
- [x] 目录模块：固定官方端点、Secret Store 取凭据、Zod 校验、按凭据缓存、`GET /api/models/catalog` + `POST /api/models/catalog/refresh`、鉴权 / CSRF / 错误码。
- [x] Session / Turn：`model` / `thinking` 校验与快照，旧 `modelProfileId` 兼容解析；运行中改选只影响下一 Turn。
- [x] Provider：`thinking` 传入 `providerOptions.deepseek`（`enabled` / `disabled`）；档位映射 `low`→`low`、`medium`→`high`、`high`→`max`；非法值在调用上游前拒绝。
- [x] Web：Composer 模型 / 档位浮层（键盘、勾选、目录状态）、设置页凭据 + 目录 + 默认标记、旧 Profile 列表移除、无凭据引导。
- [x] 测试：目录契约、鉴权、缓存隔离与 stale；Turn 校验与快照；Provider 参数；组件与认证 E2E。
- [x] 验收记录：真实凭据同步目录；浏览器截图（1440 / 窄屏）；未验证项如实标注。

## M5-1b 思考模式工具续跑

覆盖 A5、A11。依赖：M5-1a 完成；PoC 门禁。

- [ ] PoC：用授权凭据验证同轮连续工具调用、跨轮、进程重启后的官方续跑要求，记录脱敏证据。
- [ ] 按 PoC 结论确认保留方案（默认 Turn 内存），未获结论前不落库。
- [ ] Provider：`reasoning-delta` 累积、`ModelMessage.assistant.reasoning` 回传、不广播 / 不显示。
- [ ] 测试：连续工具调用、跨轮、切模型脱敏、REST / WS / 日志不含推理正文。
- [ ] 验收记录：PoC 证据、保留范围、未验证项。

## M5-1c 单次用量与圆环

覆盖 A6、A7。依赖：M5-1a 完成。

- [ ] `model.usage` 事件：每次模型请求完成写入（事务内 seq），只含展示字段。
- [ ] 圆环：按当前模型最近一条单次统计计算；无统计显示「暂无统计」；刷新 / 重放恢复。
- [ ] 保留整轮累计 `turn.completed.usage`，不改既有历史。
- [ ] 测试：事件持久化与重放、圆环计算、切模型与旧会话、刷新。
- [ ] 验收记录：浏览器实测单次占比与累计值。
