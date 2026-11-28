# 任务：跨 Turn 操作日志

> 状态：`done`（2026-11-27，OL-1～OL-4 收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| OL-1 | operationLog 模块与单测 | 093 | `done` |
| OL-2 | TurnRunner 写入 `tool.operation` | OL-1 | `done` |
| OL-3 | ContextAssembler tail 注入 | OL-2 | `done` |
| OL-4 | 事件过滤、全量验证与收口 | OL-3 | `done` |

## 任务卡

### OL-1 operationLog 模块与单测

- 状态：`done`
- 依赖：093
- 目标：定义 `ToolOperationRecord`、解析、构建、redaction、预算渲染。
- 交付物：`operationLog.ts`、`operationLog.test.ts`。
- 验收：命令/文件/失败记录；秘密省略；预算保留最新。
- 测试：`pnpm --filter @larness/server test test/agent/operationLog.test.ts`

### OL-2 TurnRunner 写入 `tool.operation`

- 状态：`done`
- 依赖：OL-1
- 目标：L1+ 工具完成后写内部事件；命令尾部 800 字符；文件路径/版本/统计。
- 交付物：`turnRunner.ts` 写入逻辑；`turnRunner.test.ts`。
- 验收：命令、edit、失败均写入；L0 不写；不广播。
- 测试：`pnpm --filter @larness/server test test/agent/turnRunner.test.ts`

### OL-3 ContextAssembler tail 注入

- 状态：`done`
- 依赖：OL-2
- 目标：读取最近操作，注入当前 user 消息 tail；当前 Turn/摘要前过滤；预算。
- 交付物：`contextAssembler.ts`；`contextAssembler.test.ts`。
- 验收：A1–A6；system/history 不变。
- 测试：`pnpm --filter @larness/server test test/agent/contextAssembler.test.ts`

### OL-4 事件过滤、全量验证与收口

- 状态：`done`
- 依赖：OL-3
- 目标：公开事件过滤 `tool.operation`；契约/状态/文档；`pnpm check` 与 `pnpm build`。
- 交付物：`events.ts`、`events.test.ts`、契约、`tasks.md`、`STATUS.md`、`ROADMAP.md`。
- 验收：A5/A7；全量测试通过。
- 测试：`events.test.ts`、`pnpm check`、`pnpm build`。

## 验收记录

（完成后填写：定向测试、`pnpm check`、`pnpm build`、未运行项、偏差。）

### 2026-11-27（macOS arm64）

- 定向：`operationLog.test.ts` 5 项、`contextAssembler.test.ts` 14 项、`events.test.ts`、`turnRunner.test.ts`、`commands.test.ts`、`toolContract.test.ts`、`compaction.test.ts`、`profiles.test.ts` 全部通过。
- 整仓：`pnpm check` 退出码 0（web 55 文件 / 323 项、agent 72 项 + 1 跳过、server 182 文件 / 982 项 + 14 跳过）；`pnpm build` 退出码 0。
- 覆盖：命令 exit+尾部、edit/patch/write 文件摘要、失败 errorCode、redaction、2,500 token 预算与省略计数、当前 Turn/摘要边界、`tool.operation` 不出现在公开事件。
- 未运行：E2E、真实 Provider 会话。操作日志的真实模型行为由后续基准切片验证。
- 偏差：`tool.operation` 占用会话 sequence，公开事件序号可能跳号；客户端已按 091 的“严格递增/补拉跨越缺口”处理。
