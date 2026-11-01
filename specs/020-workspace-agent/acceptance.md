# M1 验收记录（G1）

> 状态：**自动化验收通过；G1 仍需人类验收。**
> 依据：[workflow 评审门](../../docs/process/workflow.md) 规定 G1–G4 由人类通过；本文自动化结果不能替代人工确认。
> 日期：2026-11-01 · 平台：macOS（Darwin 27，arm64，Node 20.19.3）
> 对应门禁：[ROADMAP G1](../../specs/ROADMAP.md)、[spec 完成定义](spec.md#14-完成定义)

## 1. 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm check` | 通过：Biome 291 文件；agent 33 项（含真实 DeepSeek live）、server 236 项、web 23 项测试 |
| `pnpm build` | 通过：server 四入口 + web 静态构建 |
| `pnpm test:e2e` | 15/15 通过（S0 Mock Demo，`VITE_USE_MOCKS=1`） |
| `pnpm test:e2e:auth` | 2/2 通过（真实 Server + Vite；虚拟认证器；含 M1 全流程） |
| `pnpm test:e2e:prod` | 2/2 通过（Server 3210 静态托管；含 M1 全流程） |
| 真实 DeepSeek 工具调用 | 通过：live smoke 654ms，见第 5 节 |

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
| DeepSeek 至少一个流式工具调用场景 | Adapter 映射测试 + live smoke（第 5 节，Provider 层） | 自动化通过；产品层人工待验 |
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

## 5. 真实 DeepSeek 冒烟（2026-11-01，通过）

执行命令：

```bash
LARNESS_DEEPSEEK_SMOKE=1 DEEPSEEK_API_KEY=... \
  pnpm --filter @larness/agent test
```

结果：

- 6 个测试文件、33 项测试全部通过；
- `deepseek.live.test.ts` 用时 654 ms；
- 模型 `deepseek-chat` 返回流式工具调用（`tool-call`），无 provider 错误；
- 测试输出、日志与响应中未出现 Key 明文；
- AI SDK 仅提示 messages 中 system 消息的安全警告，不影响本次工具调用。

该记录证明 Provider 层的流式工具调用可用；它不代表完整 UI / TurnRunner 产品链路已经人工验收。

## 6. 已知偏差

- `assistant.delta` 已由 M1-10 广播；刷新时不重放增量，加载最终 `assistant.message`。
- `POST /api/models/:id/test` 可选项未实现。
- 自动化 E2E 使用 FakeProvider；真实 DeepSeek 调用由第 5 节的 live smoke 单独覆盖。
- AI SDK 对 messages 中的 system 内容给出注入风险警告；M1 的系统策略与项目指令仍按受控文本处理，后续可改为独立 `system` 参数。
- 资源窗口（文件 / 终端 / 服务 / Git）属于 M2，当前为占位。

## 7. 人类验收清单（G1 关闭前必须完成）

> 目的：验证真实产品入口、真实模型 Key、视觉与交互，而不仅是自动化测试。请由人类执行并记录结果。

- [ ] 使用 `pnpm dev` 或 `node app.js` 启动，Passkey 登录进入工作区，无阻塞性控制台 / 页面错误；
- [ ] 用目录树选择器添加一个临时项目目录（并验证手动路径回退），新建项目会话；首条消息后确认会话标题自动生成，手动重命名后不被覆盖；确认路径、Git 状态与空态正确；
- [ ] 右键项目 / 会话验证重命名；归档会话后从列表隐藏；移除项目后本地源码仍保留；
- [ ] 在“设置与模型”添加真实 DeepSeek Key（只显示掩码），发送真实任务读取并修改临时文件；确认工具卡片、审批卡片、文件变化与 Turn 完成；
- [ ] 刷新页面：历史与审批状态完整，无重复、无缺口，Turn 不被中断；
- [ ] 发送一个可延迟任务，确认出现“Agent 正在思考 / 正在执行工具 / 等待批准”的进行中条，再点击“停止”，确认 UI 显示已停止且不再产生工具调用；
- [ ] 检查助手回复的 Markdown 标题、列表、表格与代码块渲染，刷新后内容不重复、不丢失；中间过程不出现多条独立助手气泡，只显示最终答复；
- [ ] 连续工具调用折叠为“执行了 N 个工具”，展开后可查看每一步参数与结果；资源栏折叠 / 展开正常；
- [ ] 底部上下文占用随 Turn 更新，header 品牌与侧栏“新建会话”位置正确；
- [ ] 创建第二个模型 Profile（可用 `POST /api/models` 或后续设置界面）并切换；确认当前 Turn 不受影响、下一轮使用新模型；
- [ ] 检查页面、事件、API 响应、日志与审计中无 Key 明文；`secrets/master.key` 权限为 0600；
- [ ] 1440×900 桌面与窄屏截图检查：无遮挡、无横向溢出、审批/工具卡片可读；
- [ ] 记录：日期、平台、执行人、截图路径、结果与遗留问题。

### 验收签字

| 项 | 记录 |
|---|---|
| 执行人 | 待填写 |
| 日期 / 平台 | 待填写 |
| 结果 | 待填写（通过 / 不通过 + 问题） |
| 证据 | 截图 / 录屏 / 日志路径 |
