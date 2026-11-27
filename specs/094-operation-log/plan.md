# 实施计划：跨 Turn 操作日志

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

新增内部事件 `tool.operation`，由 `turnRunner` 在 L1+ 工具完成后写入（`#record`，不广播）。payload 只保留摘要：命令的 exitCode + 800 字符尾部、文件的 path/version/changeType/增删统计、失败码与 summary。

`contextAssembler` 查询 `coveredUpToSeq` 之后、当前 Turn 之前的最近操作，渲染成纯文本块放进当前 user 消息 tail；预算 2,500 token，超出保留最新并省略更老。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 直接把 L1 tool call/result 插回历史 | 模型看到原文 | 体积大、秘密风险、破坏 call/result 配对 | 否决 |
| 只把最终 assistant 文本保留 | 零改动 | 仍然失忆 | 现状，否决 |
| 内部事件 + tail 操作日志 | 有界、可 redact、不碰 system/history | 信息有损（只保留摘要） | **采用** |
| 从现有 `tool.completed` 重建 | 无新事件 | 命令输出/参数不在事件里 | 否决 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/turn/operationLog.ts
  apps/server/test/agent/operationLog.test.ts
  specs/094-operation-log/{spec,plan,tasks}.md
修改：
  apps/server/src/modules/agent/events.ts             # 事件类型 + 公开过滤
  apps/server/src/modules/agent/contextAssembler.ts   # tail 注入
  apps/server/src/modules/agent/turnRunner.ts         # 写入 tool.operation
  apps/server/test/agent/contextAssembler.test.ts
  apps/server/test/agent/events.test.ts
  apps/server/test/agent/turnRunner.test.ts
  docs/contracts/agent-command-context.md
  docs/contracts/ws-events.md
  specs/091-cross-turn-tool-replay/spec.md            # 日期修订
  specs/README.md / specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

1. 先写失败测试：operationLog 构建/解析/redaction/预算；contextAssembler tail；events 过滤；turnRunner 写入。
2. 实现 `operationLog.ts`：类型、Zod 解析、构建、查询、渲染。
3. 在 `turnRunner` 的 L1+ 成功/失败路径写 `tool.operation`；命令尾部从 `result.data.output` 取末尾并 redact。
4. 在 `contextAssembler` 的 tailBlocks 注入操作日志；使用 `coveredUpToSeq` 与当前 Turn 过滤。
5. 更新 `events.ts` 过滤 `tool.operation`；补事件测试。
6. 跑定向与 `pnpm check`、`pnpm build`；更新文档/状态。

## 5. 数据与迁移

- schema：无。
- 兼容：旧会话没有 `tool.operation` 时 tail 为空；公开事件过滤向后兼容。
- 回滚：不写/不读该事件即可；已写入的行可保留（不影响公开事件）。

## 6. 回滚策略

移除 `contextAssembler` 的 tail 注入与 `turnRunner` 的写入；`tool.operation` 行保留但被忽略。无数据迁移。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/operationLog.test.ts test/agent/contextAssembler.test.ts test/agent/events.test.ts test/agent/turnRunner.test.ts
pnpm --filter @larness/server typecheck
pnpm exec biome check <changed files>
pnpm check
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 命令尾部含秘密 | 落盘泄露 | `secretVerdict` + `OutputRedactor`；命中则省略 |
| 日志过长 | 挤压当前请求 | 2,500 token 预算，保留最新，省略计数 |
| 与 091 L0 回放重复 | 上下文冗余 | 只记录 L1+；L0 继续走 091 |
| 公开事件泄漏 | 订阅者看到内部数据 | `#record` 不广播 + SQL 过滤 |
| tail 变化影响缓存 | 前缀失效 | 只改当前 user 消息，system/history 不变 |

## 9. 未决事项

- 是否在 UI 展示操作日志：不在本切片；只给模型。
- 是否跨多轮聚合：先按最近操作 + 预算，后续按基准调整。
