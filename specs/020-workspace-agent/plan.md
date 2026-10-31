# 实施计划：M1 项目、会话与最小 Agent

> 对应 [spec.md](spec.md)。核心是把“项目 → 会话 → Turn → 事件”做成可重放的状态机，再让 Provider 与工具挂上去。

## 1. 技术方案

```text
apps/server/src/modules/
  projects/{service,repository,gitDetect}.ts
  sessions/{service,repository}.ts
  agent/{turnRunner,queue,approvalService,contextAssembler,events}.ts
  models/{profiles,credentials}.ts

packages/resources/src/
  files/{fileService,pathGuard,search}.ts
  index.ts

packages/agent/src/
  providers/{types,fake,deepseek}.ts
  tools/{registry,fileTools,schema}.ts
  budgets.ts
  messages.ts
```

- 领域写入集中到 service + repository；路由只做校验与映射。
- Turn 执行为进程内队列：全局并发 `maxConcurrentTurns`（默认 2），每会话并发 1。
- 事件与状态在同一事务写入；事件总线在提交后广播。
- Provider 采用“单步”接口，Runner 手动驱动工具循环，便于审批、取消与持久化。
- 前端用 TanStack Query 拿快照、WS 增量、`after` 补拉；事件 reducer 是纯函数。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 使用 AI SDK 的自动工具循环 | 代码少 | 审批 / 取消 / 持久化难插入 | 不用；只借用底层流与工具调用 |
| 每次 Turn 重新读全部事件 | 简单 | 历史长时慢 | M1 可接受；索引 + 限制条数 |
| 单独 messages 表 | 上下文构造简单 | 与事件双写、易漂移 | 不采用；用事件 + 摘要 |
| 在内存保存事件 | 快 | 崩溃丢失 | 禁止；先落库 |
| 工具直接在路由层执行 | 少一层 | 绕过授权 / 审计 | 禁止；统一 ToolRegistry |
| 模型热切换 | 体验好 | 上下文不一致 | 禁止；按 Turn 固定 |

## 3. 目录与文件变更

```text
新增：
packages/resources/src/files/{pathGuard,fileService,search}.ts
packages/agent/src/providers/{types,fake,deepseek}.ts
packages/agent/src/{tools,budgets,messages}.ts
apps/server/src/modules/projects/*
apps/server/src/modules/sessions/*
apps/server/src/modules/agent/*
apps/server/src/modules/models/*
apps/server/src/api/{projects,sessions,turns,events,models,approvals}.ts
apps/server/src/ws/publisher.ts
apps/server/drizzle/0002_workspace.sql
apps/server/test/{projects,sessions,agent,approvals}/*
apps/web/src/features/projects/{ProjectDialog,ProjectList}.tsx
apps/web/src/features/chat/{useSessionEvents,useSendTurn,ApprovalCard}.tsx
apps/web/src/features/models/{ModelPicker,CredentialDialog}.tsx
apps/web/src/lib/{apiClient,eventReducer}.ts

修改：
packages/shared/src/{domain,events,gateway,errors}.ts
docs/contracts/{rest-api,ws-events,data-model}.md
```

## 4. 关键实现

### 4.1 项目与路径

- `pathGuard.ts` 提供 `resolveInside(root, relative): string`：
  - 拒绝绝对路径（除非显式允许）、`..`、NUL、Windows 保留名；
  - `realpath` 后做前缀校验；
  - 打开文件后再用 `fstat` / realpath 复核，降低 TOCTOU。
- 项目登记保存 `root_path`（用户输入）与 `real_path`（canonical）；列表默认显示名称 + 路径。
- Git 检测通过 `execFile('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 5000 })`；失败不报错，标记 `git_detected=false`。

### 4.2 会话工作目录

- 独立会话：`mkdir(dataDir/sessions/<id>/workspace, { recursive: false })`，确保是新建空目录；不接受客户端指定路径。
- 项目会话：workspace 使用项目 `real_path`，但会话仍记录 `workspace_path` 便于审计。
- 删除会话不删项目目录；独立会话 workspace 按 Q-011 保留 / 清理。

### 4.3 Turn 创建与队列

```text
POST /turns
  → 校验 session / 模型 / policy / 幂等键
  → BEGIN IMMEDIATE
      INSERT turn (QUEUED)
      INSERT event user.message (seq)
      INSERT event turn.created
    COMMIT
  → 广播
  → queue.enqueue(turnId)
```

- 活跃判断：`status IN ('QUEUED','PREPARING','RUNNING','WAITING_APPROVAL','CANCELLING')`。
- 幂等：`(session_id, idempotency_key)` 唯一；冲突时查询并返回已有 Turn。
- 队列按 FIFO；同一会话只允许一个活跃，跨会话受全局并发限制。

### 4.4 Runner 状态机

```text
QUEUED → PREPARING（构建上下文）
       → RUNNING（Provider 流 / 工具循环）
       → WAITING_APPROVAL（挂起 Promise，持久化审批）
       → RUNNING（批准）/ RUNNING（拒绝后把拒绝结果回给模型）
       → COMPLETED / FAILED / CANCELLED
```

- 每步先检查 `abortSignal` 与预算；超出预算产出 `turn.completed`（带 `budgetExhausted`）或 `turn.failed`。
- 工具调用顺序：校验 schema → 路径 / 风险 → 审批 → 执行 → 结果事件 → 下一轮。
- 所有事件通过 `eventSink` 写入（事务分配 seq），提交后广播。
- 取消：置 `CANCELLING`，abort Provider；工具若无法终止，记录真实结果后结束。

### 4.5 Provider 单步接口

```ts
interface ProviderChunk {
  type: 'text-delta' | 'tool-call' | 'finish' | 'error';
  text?: string;
  toolCall?: { id: string; name: string; args: unknown };
  usage?: { promptTokens?: number; completionTokens?: number };
  finishReason?: 'stop' | 'tool-calls' | 'length' | 'error';
  error?: ProviderError;
}

interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  streamStep(input: {
    model: string;
    messages: ModelMessage[];
    tools: ToolSchema[];
    signal: AbortSignal;
    apiKey?: string;
    endpoint?: string;
  }): AsyncIterable<ProviderChunk>;
}
```

- FakeProvider：从脚本数组读取 chunks，支持断言调用顺序与注入错误。
- DeepSeek：`createDeepSeek({ apiKey, baseURL })`；`streamText`；把 `text-delta` / `tool-call` / `finish` 映射为 ProviderChunk；工具 schema 转 AI SDK tool 定义。
- 不做自动重试；网络错误交给用户重试，避免重复副作用。

### 4.6 工具与审批

- 风险映射：read/list/search = L0；apply_patch = L1；根外读取 / 写入 = L2。
- `approvalService.request()` 写 `approvals` 行 + 事件，返回 Promise；超时默认 `denied` 并写事件。
- 规范化参数：路径转相对根、统一分隔符、排序环境变量；比较 `sha256(JSON(normalized))`。
- 工具执行结果统一为 `{ ok, summary, data?, errorCode?, truncated? }`；只把摘要送入模型，完整内容按需读取。

### 4.7 事件与上下文

- 事件类型：`user.message`、`turn.created`、`turn.status`、`plan.updated`、`assistant.delta`、`assistant.message`、`tool.requested`、`tool.approval.required`、`tool.approval.resolved`、`tool.started`、`tool.completed`、`tool.failed`、`file.changed`、`artifact.created`、`turn.completed`、`turn.failed`、`turn.cancelled`、`turn.interrupted`。
- 上下文构造：最近 N 个 Turn 的用户输入 + 最终助手消息 + 工具摘要（不含全文）；当前 Turn 的完整内存消息；项目指令单独区块。
- 不把 `assistant.delta` 写入 DB（仅广播）；完成时写 `assistant.message`。

### 4.8 Secret 与模型

- `secrets` 表：`id, ciphertext, nonce, tag, created_at`；主密钥 `secrets/master.key`（32 字节，0600）。
- 创建凭据：加密后写 DB，返回 `credentialId` 与 `secretRef`；更新时覆盖并审计，不返回明文。
- 模型 Profile：`provider + model + credentialProfileId + endpoint + capabilities`；连接测试接口可选（M1-7 实现 `POST /api/models/:id/test`）。
- 会话默认模型：项目设置 > 全局默认 > 第一个可用 Profile。

### 4.9 前端

- `apiClient` 统一处理 401 → 跳 `/login?returnTo=…`（Passkey 重新认证），不做 refresh；CSRF Token 从 session 缓存。
- `useSessionEvents(sessionId)`：首次 `GET events?after=0`（限制 500），订阅 WS；收到事件按 `seq` 插入，检测缺口后补拉。
- `eventReducer` 生成时间线项：message / plan / tool / approval / error；同 ID 更新而非重复插入。
- Composer 发送后锁定；`stop` 调 cancel；审批按钮调用 approvals API；错误展示错误码与重试。
- 项目对话框校验路径（前端提示，后端最终裁决）。

## 5. 数据与迁移

`0002_workspace`：

| 表 | 说明 |
|---|---|
| `projects` | 唯一索引 `real_path` |
| `sessions` | `project_id` 可空；索引 `(project_id, updated_at)` |
| `turns` | 唯一 `(session_id, idempotency_key)`；索引 `(session_id, created_at)` |
| `agent_events` | 唯一 `(session_id, seq)` |
| `approvals` | `turn_id, tool_call_id, status, risk, params_hash, scope_json, expires_at, decided_at` |
| `model_profiles` / `credential_profiles` / `secrets` | 不含明文 |

迁移后执行一次 `repairInterruptedTurns()`；之后每次启动执行。

## 6. 回滚

- 代码回退即可；数据库迁移只前进。
- 若 M1 迁移需撤销，开发环境删除数据目录；生产环境从迁移前备份恢复。
- DeepSeek 可关闭：会话切回 FakeProvider（仅测试 / 演示），不影响项目数据。

## 7. 验证命令

```bash
pnpm check
pnpm --filter @harness/server test
pnpm test:e2e
```

真实 Provider 冒烟（手动，需环境变量）：

```bash
DEEPSEEK_API_KEY=... pnpm --filter @harness/server test:provider
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI SDK 流事件与工具调用格式变化 | 适配层失效 | 只依赖稳定字段；契约测试；锁定版本 |
| 工具循环失控 | 费用 / 时间 | 预算 + 最大步数 + 取消 |
| 上下文构造丢任务状态 | 反复劳动 | 事件中保留计划 / 文件 / 待办摘要 |
| 审批挂起时进程崩溃 | 卡住 Turn | 启动标记 INTERRUPTED；审批作废 |
| 路径 TOCTOU | 越界读写 | realpath + fd 复核 + 单测 |
| 事件 seq 并发冲突 | 丢事件 | 单写事务 + UNIQUE 约束 |
| 密钥丢失 | 凭据不可用 | 初始化时提示备份；恢复流程 M4 |

## 9. 未决事项

- 默认模型名、上下文压缩、审批记忆、项目锁：见 spec 第 13 节与 `docs/open-questions.md`。
- 是否在 M1 加入 `run_command`：不加入，按 M2-3。
