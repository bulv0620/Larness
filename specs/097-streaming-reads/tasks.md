# 任务：流式启动 L0 只读工具

> 状态：`done`（2026-11-27，SR-1～SR-2 收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| SR-1 | 流内预取与 L0 元数据 | 096 | `done` |
| SR-2 | 验证、081 修订与收口 | SR-1 | `done` |

## 任务卡

### SR-1 流内预取与 L0 元数据

- 状态：`done`
- 目标：L0 无锁 allow 调用在 tool-call 事件到达时启动；写/锁/审批仍串行；文件 L0 显式无锁。
- 交付物：`turnRunner.ts`、`fileTools.ts`、`turnRunner.test.ts`、`fileTools.test.ts`。
- 验收：A1–A5。
- 测试：`turnRunner.test.ts`、`fileTools.test.ts`。

### SR-2 验证、081 修订与收口

- 状态：`done`
- 目标：081 日期修订、契约/状态/文档；`pnpm check`、`pnpm build`。
- 交付物：文档与验收记录。
- 验收：全量通过。

## 验收记录

（完成后填写：定向测试、`pnpm check`、`pnpm build`、未运行项、偏差。）

### 2026-11-27（macOS arm64）

- 定向：`turnRunner.test.ts` 63 项、`fileTools.test.ts` 6 项、`plan.test.ts` 通过；含“流未结束时 L0 handler 已启动、同批 L1 写未启动、流结束后写执行”与 `update_plan` 取消回归。
- 整仓：`pnpm check` 退出码 0（web 55 文件 / 322 项、agent 72 项 + 1 跳过、server 184 文件 / 992 项 + 14 跳过）；`pnpm build` 退出码 0。
- 覆盖：L0/无锁/allow 流内预取；`prefetchable` 排除 `update_plan`/`remember` 等 L0 元数据写入；写/锁/审批串行；结果按 call 顺序消费。
- 未运行：E2E、真实 Provider 会话。
- 偏差：预取仅限 `prefetchable:true`，不是所有 L0；这是为避免 `update_plan`/`remember` 在取消后仍写元数据。
