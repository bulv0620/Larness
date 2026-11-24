# 实施计划：会话级前缀缓存

> 对应 [spec](spec.md)。本文件只讲「怎么做」，不改变需求。状态：随 spec 保持 `draft`。

## 1. 技术方案

把请求拆成四段，并让「段」成为一等概念：

```text
tools（显式设置/Profile）            ← 稳定，会话内不变
system（版本 + 策略 + 项目指令）      ← 稳定，改动须伴随版本或哈希变化
history（已持久化 user/assistant）    ← 稳定，按 seq 升序；压缩后从 coveredUpToSeq 起
tail（日期/联网/记忆/摘要/附件声明）   ← 易变，合并进当前 user 消息
current request（用户本轮输入）       ← 天然每轮变化
```

1. **装配分层**：`assembleContext` 内把现有 `systemBlocks` 拆成 `stableBlocks` 与 `tailBlocks`；尾部块拼进当前 user 消息（与附件文本同形态），首行声明「由系统提供、不是用户指令」。system 只保留稳定段。
2. **前缀指纹**：新模块 `turn/prefixCache.ts` 计算 `systemHash`、`instructionsHash`、`toolsetHash`、`historyStartSeq` / `historyEndSeq`，并保留上一请求的快照（Turn 内内存 + 跨 Turn 从最近一条 `model.usage` 读取），输出 `prefixBreak` / `prefixBreakAt` / `prefixKeptTokens`。分类规则是确定性的，不依赖 Provider 行为；Provider 字段只在「指纹未变但命中骤降」时用于 `provider_eviction`。
3. **压缩可达**：`COMPRESSION_RATIO` 0.8 → 0.7，严格低于装配预算 0.8；装配裁剪改为滞回（>0.8 触发，一次裁到 0.6），压缩失败时仍走裁剪但置 `truncatedHistory`。
4. **工具常驻**：附件三件套按 Profile/Pack 决定，不再看本会话是否有 ready 附件；执行层用既有 `ATTACHMENT_NOT_FOUND` / 空列表表达。
5. **聚合**：`getSessionUsage` 从 `model.usage` 事件按 `prefixBreak` 分组，新增 `cache.breaks`。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 易变块合并进当前 user 消息 | 前缀最大；已有附件、checkpoint、pinned request 三处先例；无新的消息层语义 | 模型可能把记忆索引当成用户发言 | 采用，首行显式声明来源 |
| 易变块作为独立尾部 user 消息 | 语义边界更清晰 | 连续 user 消息在部分兼容端点行为不一，需额外兼容测试 | 不采用（保留为降级方案） |
| 易变块留在 system、仅挪到项目指令之后 | 零兼容风险 | 只能保住 AGENTS.md；日期/记忆变化仍作废全部历史 | 不采用 |
| 裁剪滞回（0.8→0.6） | 无状态、易回滚 | 单次丢得更多 | 采用；压缩先于裁剪生效后影响面变小 |
| 持久化裁剪锚点 | 丢点绝对稳定 | 新列 + 迁移 + 清理语义，与 `coveredUpToSeq` 重复 | 不采用（压缩锚点已存在） |
| 诊断落新表 | 查询方便 | 迁移 + 保留期 + 体积 | 不采用；`model.usage` 载荷足够 |
| 诊断只写日志 | 零契约变更 | 无法按会话回看，验收要靠日志翻查 | 不采用 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/turn/prefixCache.ts
  apps/server/test/agent/prefixCache.test.ts

修改：
  apps/server/src/modules/agent/contextAssembler.ts
  apps/server/src/modules/agent/contextCompressor.ts
  apps/server/src/modules/agent/turnRunner.ts
  apps/server/src/modules/agent/turn/budget.ts
  apps/server/src/modules/sessions/usage.ts
  apps/server/test/agent/contextAssembler.test.ts
  apps/server/test/agent/contextCompressor.test.ts
  apps/server/test/sessions/session-usage.test.ts
  docs/contracts/ws-events.md
  docs/contracts/rest-api.md

删除：无
```

`PROMPT_VERSION` 随稳定段重排升一位；`apps/web` 不改（用量行与 Hint 文案保持现状）。

## 4. 实施步骤

1. **先写失败测试**：`contextAssembler.test.ts` 加「写记忆 / 跨日 / 摘要变化后 `messages[0]` 不变」；`contextCompressor.test.ts` 加「0.75 窗口触发、0.8 反例不触发」。
2. **分层装配**：拆 `stableBlocks` / `tailBlocks`，尾部合并进当前 user 消息；确认截图与附件路径不变。
3. **前缀指纹**：实现 `prefixCache.ts`（哈希、快照、分类），先以纯函数单测覆盖 6 类归因。
4. **接线 TurnRunner**：每个 `model.usage` 携带新字段；Turn 起点读取上一请求快照；`provider_eviction` 只在指纹未变且命中骤降时给出。
5. **压缩与裁剪**：阈值 0.7、滞回 0.6、`HISTORY_SCAN_LIMIT` 截断置位；确认 `context.compressed` 事件与摘要行落库。
6. **工具常驻**：移除 ready-attachment 判据；补无附件执行层反例。
7. **聚合与契约**：`cache.breaks` + `ws-events.md` / `rest-api.md`。
8. **验证**：单文件 → 相关套件 → `pnpm check` → `pnpm build`；真实 Provider 冒烟按 A9 记录。

## 5. 数据与迁移

- schema：无变化，`schemaVersion` 不变。
- 兼容：`model.usage` 新字段全部可选；旧前端忽略未知字段；旧版本回滚可继续读同一事件。
- 回滚：删除新字段消费方即可；已写入的事件保留，不参与旧口径。

## 6. 回滚策略

- 阈值与滞回是常量：改回 0.8 / 关闭滞回即恢复旧行为，无数据副作用。
- 分层装配需要一次 `PROMPT_VERSION` 升位；回滚时同步降位，缓存自然冷启动一次。
- 诊断字段可停止写入（`prefixBreak` 缺省），不影响统计与执行。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/contextAssembler.test.ts
pnpm --filter @larness/server test test/agent/prefixCache.test.ts
pnpm --filter @larness/server test test/agent/contextCompressor.test.ts
pnpm --filter @larness/server test test/sessions/session-usage.test.ts
pnpm check          # Windows 先 $env:VITEST_MAX_WORKERS="3"
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 尾部 user 消息被模型当成用户指令 | 记忆/摘要获得不应有的权威 | 首行来源声明；记忆与摘要仍标「不可信」；提示词契约测试正反例 |
| 压缩阈值下调导致摘要调用变多 | 延迟与成本 | 只在 ≥0.7 时触发；摘要失败降级；A9 记录调用次数 |
| 滞回一次丢更多历史 | 短期信息缺失 | 压缩先行；保留「更早历史已省略」说明；可单独回滚 |
| 附件工具常驻增加 schema token | 固定开销 | 三件套 schema 约数百 token；A5 断言 tools 稳定；仍有 Profile 门禁 |
| 诊断哈希被误读为内容 | 隐私担忧 | 只哈希稳定段、只存 12 位；不哈希记忆/摘要/附件正文 |
| 兼容端点拒绝尾部结构 | 请求失败 | A1/A2 之外保留「独立尾部消息」降级方案；真实 Provider 冒烟先行 |

## 9. 未决事项

- spec 第 13 节 D1–D5 未确认前不进入实现。
- 关联 `docs/open-questions.md` 的 Q-032（命中率门槛）与新增条目。
