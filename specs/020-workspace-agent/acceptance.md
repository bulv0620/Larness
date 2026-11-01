# M1 验收记录（G1）

> 状态：**自动化验收通过；真实 DeepSeek 冒烟待 Key，G1 未关闭。**
> 日期：2026-11-01 · 平台：macOS（Darwin 27，arm64，Node 20.19.3）
> 对应门禁：[ROADMAP G1](../../specs/ROADMAP.md)、[spec 完成定义](spec.md#14-完成定义)

## 1. 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm check` | 通过：Biome 290 文件；agent 32 项、server 236 项、web 23 项测试 |
| `pnpm build` | 通过：server 四入口 + web 静态构建 |
| `pnpm test:e2e` | 15/15 通过（S0 Mock Demo，`VITE_USE_MOCKS=1`） |
| `pnpm test:e2e:auth` | 2/2 通过（真实 Server + Vite；虚拟认证器；含 M1 全流程） |
| `pnpm test:e2e:prod` | 2/2 通过（Server 3210 静态托管；含 M1 全流程） |
| 真实 DeepSeek 工具调用 | **未执行**：当前环境没有 `DEEPSEEK_API_KEY`；见第 5 节 |

## 2. M1 E2E 场景（`e2e-auth/m1.spec.ts`）

1. TUI 配对（allow_once）进入工作区；
2. 添加临时项目目录，在项目中新建会话；
3. 发送任务 → FakeProvider 产生 `list_files` 工具事件与助手消息；
4. 切换“严格审批”，发送补丁任务 → 审批卡片 → 批准 → `apply_patch` 真实写入文件；
5. 刷新页面 → 事件重放，审批已解析、工具与助手消息无重复；
6. 在“设置与模型”切换到第二个模型 Profile；
7. 再次发送任务，验证下一轮正常执行；
8. 添加 API Key，界面仅显示掩码；
9. 发送可延迟 Turn → 停止 → 显示“已停止当前执行。”且无新工具调用。

测试 Server 使用注入的 FakeProvider；TurnQueue、工具、审批、数据库、事件与 WS 均为真实实现。

## 3. G1 门禁逐项

| 门禁项 | 证据 | 状态 |
|---|---|---|
| DeepSeek 至少一个流式工具调用场景 | Adapter 映射测试 + `DEEPSEEK_API_KEY` 门控 live test；真实调用未执行 | **待人工冒烟** |
| FakeProvider 覆盖状态机 | `test/agent/turnRunner.test.ts`、`test/agent/queue.test.ts`、E2E | 通过 |
| 同会话并发 Turn 被拒绝 / 排队 | `test/sessions/turns.test.ts`、`test/agent/queue.test.ts` | 通过 |
| 文件版本冲突不静默覆盖 | `test/projects/pathGuard.test.ts`、`test/tools/fileService.test.ts`、`test/agent/toolExecutor.test.ts` | 通过 |
| 断线重放无缺口、无重复 | `test/agent/events.test.ts`、`eventReducer.test.ts`、M1 E2E 刷新步骤 | 通过 |
| 取消后不再产生新工具调用 | `test/agent/turnRunner.test.ts` 取消用例、M1 E2E 停止步骤 | 通过 |
| 切模型只影响下一 Turn | `test/agent/turnRunner.test.ts`（模型快照）、`test/sessions/service.test.ts`（审计）、M1 E2E | 通过 |

## 4. A1–A14 覆盖

| 验收 | 覆盖 |
|---|---|
| A1 项目登记 | `test/projects/api.test.ts` |
| A2 独立会话 | `test/sessions/service.test.ts`、`test/sessions/api.test.ts` |
| A3 最小 Agent 闭环 | `turnRunner` 工具循环测试 + M1 E2E（FakeProvider） |
| A4 刷新恢复 | `events.test.ts`、`eventReducer.test.ts`、M1 E2E |
| A5 单会话单 Turn | `turns.test.ts`、`queue.test.ts`、`sessions/api.test.ts` |
| A6 取消 | `turnRunner.test.ts`、M1 E2E |
| A7 路径越界 | `pathGuard` / `fileService` / `toolExecutor` 测试 |
| A8 审批 | `approvals.test.ts`、`toolExecutor.test.ts`、`turnRunner.test.ts`、M1 E2E |
| A9 切模型 | `turnRunner.test.ts` 快照、`sessions/service.test.ts` 审计、M1 E2E |
| A10 密钥隔离 | `secretStore.test.ts`、`models/service.test.ts`、`api/models.test.ts`；E2E 掩码 |
| A11 Provider 故障 | `deepseek.test.ts` 错误分类、`turnRunner.test.ts` 失败映射 |
| A12 崩溃恢复 | `repair.test.ts`、`restart.test.ts` |
| A13 幂等 | `turns.test.ts`、`sessions/api.test.ts` |
| A14 同项目写串行 | `locks/service.test.ts`、`projectWriteLock.test.ts`、`turnRunner.test.ts` 锁释放 |

## 5. 真实 DeepSeek 冒烟（待执行）

无 Key 时不得宣称 G1 关闭。提供 Key 后执行：

```bash
LARNESS_DEEPSEEK_SMOKE=1 DEEPSEEK_API_KEY=... \
  pnpm --filter @larness/agent test
```

或在完成设置的机器上通过“设置与模型”添加 Key，新建会话发送“读取并修改项目文件”执行一次真实工具调用，并记录：

- 日期 / 模型（默认 `deepseek-chat`）；
- 工具调用名称与结果；
- Turn 状态与事件序列；
- 日志 / 事件 / API 响应中无 Key 明文。

## 6. 已知偏差

- `assistant.delta` 未广播；当前实时性以工具 / 状态事件和最终 `assistant.message` 为准。
- `POST /api/models/:id/test` 可选项未实现。
- 自动化 E2E 使用 FakeProvider；真实 DeepSeek 冒烟是关闭 G1 的剩余人工项。
- 资源窗口（文件 / 终端 / 服务 / Git）属于 M2，当前为占位。
