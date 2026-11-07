# DeepSeek 官方接入实施计划

需求与验收见 [spec](spec.md)，任务拆分见 [tasks](tasks.md)。2026-11-07 用户确认 D1–D5 后进入实施。

## 1. 目录与模型能力（M5-1a）

- 固定官方端点，服务端用现有 Secret Store 取凭据发起 `GET /models`，Zod 校验后写入 `model_catalog_cache`（按凭据主键隔离），只保存展示字段。
- 目录只补充「官方没有的信息」：显示名、默认档位标记；窗口与档位以官方响应为准，缺失按未知。
- 选择器不再读 `model_profiles`；Session / Turn 记录 `model`、`thinking`、`context_window` 快照。旧 Profile 行保留不动。
- 迁移 `0014_model_catalog`：新表 + 可空列，不做数据回填、不删除旧行。

## 2. 档位选择与发送（M5-1a）

- `thinking` 取值 `off` / `default` / `low` / `high` / `max`；服务端按目标模型声明校验。
- Provider 传 `providerOptions.deepseek.thinking` 与 `reasoningEffort`；「默认」省略 `reasoningEffort`。
- Turn 创建时固定快照；运行中 PATCH 只影响下一 Turn，已有 Turn 从 `turns.thinking` 读取。
- UI：Composer 控件 + 浮层（模型段 / 档位段 / 目录状态），设置页改为凭据 + 目录 + 默认模型。

## 3. 工具续跑与推理数据（M5-1b）

- 先做 PoC：用授权测试凭据验证同轮连续工具调用、跨轮、进程重启后的官方要求，记录请求/响应事实（不含推理正文）。
- 再定保留方案：默认仅在 Turn 内存中累积 `reasoning` 并随 assistant 消息回传；不落库、不进事件。
- 若 PoC 证明跨轮或重启必须持久化，回到本 spec 与 `docs/open-questions.md` 更新决策，不静默扩大存储。

## 4. 单次用量与圆环（M5-1c）

- 每次模型请求完成写一条 `model.usage` 事件（事务内 seq），前端按「当前模型最近一条」计算占比。
- 保留 `turn.completed.usage` 累计口径；旧会话无单次统计时展示「暂无统计」。
- 页面刷新与重连依赖既有事件重放，不新增前端存储。

## 5. 验证与提交

- 每个任务先写失败测试：契约（目录校验 / 鉴权 / 缓存）、Provider 参数、Server 快照与事件、Web 组件。
- 运行 `pnpm check`、`pnpm build`；涉及浏览器行为的任务另跑 auth / prod E2E。
- 真实凭据验证官方目录与一次思考工具调用；无凭据时跳过并在验收记录中写明。
- 一次提交只对应一个任务；契约、迁移、测试与 STATUS 同提交。
