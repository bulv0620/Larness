# 任务：M1 项目、会话与最小 Agent

> 规则：一个任务一个提交；开始前更新 `STATUS.md`，完成后勾选本表并同步 `ROADMAP.md`。
> 涉及事件 / 工具 / 审批的变更必须同步契约与失败路径测试。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M1-1 | 项目登记与路径授权 | G0 | `done` |
| M1-2 | 会话、Turn 与事件存储 | M1-1 | `done` |
| M1-3 | Provider 适配与 FakeProvider | G0 | `done` |
| M1-4 | 工具注册与审批引擎 | M1-1, M1-2 | `done` |
| M1-5 | Turn Runner 与状态机 | M1-2, M1-3, M1-4 | `done` |
| M1-6 | 实时对话 UI | M1-5, M0-8 | `done` |
| M1-7 | 模型 Profile 与 SecretStore | M1-3 | `done` |
| M1-8 | M1 验收与 E2E | M1-6, M1-7 | `todo` |

## 任务卡

### M1-1 项目登记与路径授权

- 状态：`done`（2026-11-01）
- 依赖：G0
- 目标：安全地登记本机目录，并提供统一路径校验给后续所有工具。
- 交付物：
  - `projects` 表 / repository / service；
  - `GET/POST /api/projects`、`GET/PATCH/DELETE /api/projects/:id`；
  - `pathGuard.resolveInside()` + 单元测试；
  - Git 检测 + 5 秒超时；
  - 删除仅解除关联；重复 realpath 冲突；项目设置（默认模型 / 指令 / 忽略）。
  - 审计：created / updated / deleted。
- 验收：A1、A7 的 API 部分；不存在 / 文件 / 重复路径被拒绝；删除后目录仍存在。
- 测试：路径穿越、符号链接、大小写、Unicode、重复登记、Git 缺失。
- 涉及路径：`apps/server/src/modules/projects/`、`packages/resources/src/files/pathGuard.ts`、`apps/server/src/api/projects.ts`。
- 完成记录：
  - `0002_projects` 迁移 + `projects` 表 / repository；`GET/POST /api/projects`、`GET/PATCH/DELETE /api/projects/:id`；
  - `pathGuard`：realpath、根内包含、非存在路径祖先解析、NUL / 穿越 / 符号链接逃逸拒绝；Unicode 测试；
  - Git 检测 `git -C <root> rev-parse --show-toplevel`，5 秒超时，失败不阻塞；
  - 重复 realpath（含 symlink）409；删除仅删数据库行，目录保留；`project.created/updated/deleted` 审计；
  - 项目设置 schema：默认模型 / 指令 / ignore；PATCH 合并校验；
  - server 176 项测试。

### M1-2 会话、Turn 与事件存储

- 状态：`done`（2026-11-01）
- 依赖：M1-1
- 目标：建立可重放、可幂等、可修复的执行历史。
- 交付物：
  - `sessions` / `turns` / `agent_events` / `resource_locks` 表与 repository；
  - 独立会话工作目录创建；列表 / 最近 / 重命名 / 归档；
  - Turn 创建（含幂等）、取消骨架、活跃校验；
  - `seq` 事务分配 + `GET /events?after=`；
  - 启动修复 `repairInterruptedTurns()`；
  - `approvals` 表（供 M1-4 使用）。
- 验收：A2、A4（后端）、A5、A13、A12；并发创建同会话 Turn 只有一个成功。
- 测试：seq 连续 / 唯一、幂等、跨会话隔离、重启修复、事件分页。
- 涉及路径：`apps/server/src/modules/sessions/`、`apps/server/src/modules/agent/events.ts`、`apps/server/drizzle/0003_workspace.sql`。
- 完成记录：
  - `0003_workspace`：`sessions` / `turns` / `agent_events` / `approvals` / `resource_locks`，含 seq / 幂等 / 资源唯一索引与级联外键；
  - 会话：独立 workspace（`dataDir/sessions/<id>/workspace`，空目录）、项目会话 `realPath`、列表 / 项目筛选 / limit、详情活跃 Turn、重命名 / 下一轮模型、归档不删源码；活跃 Turn 归档 409；
  - Turn：事务内幂等键 + 活跃校验、`user.message` / `turn.created` 事件、取消骨架 `CANCELLING`；审计 `turn.started` / `turn.cancelled`；
  - 事件：事务内递增 `seq`、`GET /events?after=&limit=`（`nextSeq` / `hasMore`）、`ServerEvent` 包络；
  - 启动 `repairInterruptedTurns()`：活跃 Turn → `INTERRUPTED` + 事件，重启集成测试覆盖；重复执行不重复写事件；
  - 资源锁：acquire / renew / release / 过期回收，软释放保持 `fencing_token` 单调，旧 token 操作失败；
  - 验收：A2、A4（后端）、A5、A12、A13；server 200 项测试（新增 23 项）。

### M1-3 Provider 适配与 FakeProvider

- 状态：`done`（2026-11-01）
- 依赖：G0
- 目标：建立 Provider 抽象与可重复的测试替身，并接通 DeepSeek。
- 交付物：
  - `ProviderAdapter` / `ProviderChunk` / 能力声明 / 错误分类；
  - `FakeProvider`：脚本化文本、工具调用、错误、延迟、abort；
  - `DeepSeekProvider`：流式文本 + 工具调用，API Key 从调用参数注入；
  - 模型 Profile 读取（不含加密 UI，M1-7 完善）；
  - 契约测试：同一脚本在 Fake / 适配层映射一致。
- 验收：A3 的模型部分、A11；FakeProvider 可确定性复现；真实 DeepSeek 至少一次工具调用冒烟（手动）。
- 测试：chunk 映射、工具参数 JSON、取消、401 / 429 / 超时、上下文超限错误。
- 涉及路径：`packages/agent/src/providers/`、`apps/server/src/modules/models/`。
- 完成记录：
  - `ProviderAdapter` / `ProviderChunk` / `ProviderCapabilities` / `ModelMessage` / `ToolSchema`；`ProviderError` 覆盖认证、限流、上下文超限、内容过滤、不可用、未知、取消；
  - `FakeProvider`：脚本化文本 / 工具调用 / 错误 / 延迟，AbortSignal 取消，脚本耗尽返回 `PROVIDER_UNAVAILABLE`；
  - `DeepSeekProvider`：AI SDK 流映射（text-delta / tool-call / finish / usage）、消息与工具 JSON Schema 转换、Key 按调用注入、默认 `deepseek-chat`、超时 120s；错误消息不回传上游原文；
  - 模型 Profile：内置 DeepSeek / Fake 默认值，不含密钥，M1-7 替换为持久化 repository；
  - 共享错误码与 REST 契约新增 Provider 错误；
  - 测试：agent 15 项（另 1 项 DeepSeek live 冒烟按 `LARNESS_DEEPSEEK_SMOKE=1` + `DEEPSEEK_API_KEY` 跳过）、server 202 项、web 18 项；契约测试确认 Fake 与 AI SDK 映射一致；
  - 偏差：真实 DeepSeek 工具调用冒烟需 Key，记录推迟到 M1-8 验收。

### M1-4 工具注册与审批引擎

- 状态：`done`（2026-11-01）
- 依赖：M1-1, M1-2
- 目标：让 Agent 的文件操作受统一 schema、路径授权、审批与审计约束。
- 交付物：
  - `ToolRegistry`：schema、风险级别、handler、结果规范化；
  - `list_files` / `read_file` / `search_code` / `apply_patch`；
  - 版本 hash 与 `expectedVersion` 冲突检测；
  - `ApprovalService`：L2 请求、超时、批准 / 拒绝、参数哈希校验；
  - `ProjectWriteLock`：project 资源锁、fencing token、TTL、心跳、过期回收；
  - `POST /api/approvals/:id`、`GET /api/approvals/:id`；
  - 审计：requested / completed / denied / approval。
- 验收：A7、A8；审批参数替换被拒绝；超时默认拒绝；工具输出截断。
- 测试：schema 非法、越界、符号链接、版本冲突、审批超时、参数篡改、输出上限。
- 涉及路径：`packages/agent/src/tools/`、`packages/resources/src/files/`、`apps/server/src/modules/agent/approvalService.ts`、`apps/server/src/api/approvals.ts`。
- 完成记录：
  - `packages/resources`：文件列表 / 读取 / 搜索 / 补丁，realpath 根内校验、SHA-256 版本、行范围、1 MiB / 2000 行上限，二进制 / 超大 / 符号链接逃逸拒绝；
  - `packages/agent`：ToolRegistry（Zod schema / L0–L1 / 结果规范化）、四个文件工具、standard / strict / readonly 策略；
  - 审批：canonical 参数哈希、pending / approved / denied / expired、超时拒绝、篡改检测、`GET/POST /api/approvals/:id`、清理任务过期与审计；
  - `ProjectWriteLock`：project 锁 / TTL / fencing / 续租 / 释放；Runner 接线与审批事件留给 M1-5；
  - `ToolExecutor`：审批门禁、参数校验、`tool.requested` / `tool.completed` / `tool.denied` 审计；
  - 测试：agent 32 项、server 210 项、web 18 项；覆盖 A7、A8、版本冲突、超时、篡改、输出上限。

### M1-5 Turn Runner 与状态机

- 状态：`done`（2026-11-01）
- 依赖：M1-2, M1-3, M1-4
- 目标：把 Provider 与工具串成可持久化、可取消、有预算的执行循环。
- 交付物：
  - `TurnQueue`（全局并发 + 会话串行）；写 Turn 获取 / 续租 / 释放项目锁；
  - Runner：状态机、上下文构建、工具循环、事件写入、usage 记录；
  - 预算：30 步 / 50 工具 / 10 分钟 / 上下文 80%；
  - 取消：CANCELLING、abort、工具真实结果；
  - 审批挂起 / 恢复；拒绝结果回传模型；
  - `turn.*` 事件广播；失败码映射。
- 验收：A3、A4、A5、A6、A9、A12；同一会话永不并行；取消后无新工具调用。
- 测试：状态迁移、预算耗尽、审批恢复、取消竞态、Provider 中途失败、重启修复。
- 涉及路径：`apps/server/src/modules/agent/{turnRunner,queue,contextAssembler}.ts`、`apps/server/src/ws/publisher.ts`。
- 完成记录：
  - `TurnQueue`：全局并发（默认 2）、同会话串行、排队 / 取消 / 关闭等待在途任务；
  - `TurnRunner`：状态机、上下文构建（安全策略 / 项目指令 / 历史 / 当前输入）、Provider 单步循环、工具调用、usage 与审计；
  - 预算：30 步 / 50 工具 / 10 分钟 / 上下文 80%，可注入覆盖；
  - 审批挂起 / 恢复：工具事件、按参数哈希执行、拒绝 / 超时结果回传模型；项目写锁在写工具前获取 / 续租 / 释放；
  - `turn.*` / `tool.*` / `file.changed` 事件先落库后广播；WS 支持 `agent:<sessionId>` 订阅；创建 Turn 自动入队；
  - 测试：agent 32 项、server 227 项、web 18 项；覆盖 A3、A4（后端）、A5、A6、A9、A12、预算、审批超时、取消竞态、Provider 失败；
  - 偏差：`assistant.delta` 广播与真实 DeepSeek 冒烟分别留到 M1-6 / M1-8。

### M1-6 实时对话 UI

- 状态：`done`（2026-11-01）
- 依赖：M1-5, M0-8
- 目标：把 S0 的 Mock 对话替换为真实项目 / 会话 / 事件 / 审批。
- 交付物：
  - 项目对话框、项目切换、新建 / 重命名会话；
  - `useSessionEvents`：首屏拉取 + WS + 缺口补拉 + 去重；
  - 事件 reducer：消息、计划、工具、审批、错误、取消；
  - Composer：模型、审批策略、发送 / 停止、错误重试；
  - 审批卡片调用真实 API；空态与加载态。
- 验收：A3、A4、A6、A8、A9 的 UI 部分；刷新无重复 / 无缺口；401 统一跳 Passkey 登录（returnTo）。
- 测试：reducer 纯函数、缺口补拉、乐观消息、审批状态、E2E。
- 涉及路径：`apps/web/src/features/{projects,chat,models}/`、`apps/web/src/lib/{apiClient,eventReducer}.ts`。
- 完成记录：
  - 真实项目 / 会话数据接入，新增项目对话框、项目内新建会话、新建 / 重命名 / 归档；
  - `useSessionEvents`：REST 首屏 + `agent:<sessionId>` WS + 去重 / 缺口补拉 / 重连；`eventReducer` 输出消息、工具、文件、审批、错误、取消；
  - Composer 发送 / 停止 / 错误重试；模型与审批策略在发送前写入会话（PATCH 支持 `approvalPolicyId`）；
  - 审批卡片区分工具审批与部署审批，调用真实 API；认证撤销监控与 401 回登录；
  - 测试：web 23 项（reducer 5 项）、server 227 项、agent 32 项；`pnpm check` / `build`、demo E2E 15、认证 E2E 1 通过；
  - 偏差：真实 Agent 全链路 E2E 留到 M1-8；模型列表暂用内置 DeepSeek Profile。

### M1-7 模型 Profile 与 SecretStore

- 状态：`done`（2026-11-01）
- 依赖：M1-3
- 目标：让用户安全配置多个 Provider / Key，并按下一 Turn 切换模型。
- 交付物：
  - `secrets` 表 + AES-256-GCM SecretStore + 主密钥生成 / 权限；
  - `model_profiles` / `credential_profiles` repository；
  - `GET /api/models`、`GET/POST/DELETE /api/credentials`、`POST /api/models/:id/test`（可选）；
  - 设置界面：新增 Key（掩码展示）、模型选择、默认模型；
  - 会话切换模型；审计 model.changed / credential.created。
- 验收：A9、A10；密钥不出现在响应 / 日志 / 事件；主密钥 0600；缺失密钥时 Turn 失败可读。
- 测试：加解密、错密钥、权限、脱敏、模型切换快照、删除被引用凭据的拒绝。
- 涉及路径：`apps/server/src/modules/models/`、`apps/server/src/security/secretStore.ts`、`apps/web/src/features/models/`。
- 完成记录：
  - `0004_models`：`secrets` / `credential_profiles` / `model_profiles`；启动幂等 seed `deepseek-default`；
  - `SecretStore`：AES-256-GCM、随机 nonce、主密钥 0600、错密钥 / 篡改 fail closed；
  - 模型 / 凭据 API：密钥只写不读、响应掩码、引用中的凭据删除 409；审计 credential / model 操作；
  - 解析：Turn 使用模型 Profile + provider 最新凭据；缺失 / 解密失败 → `PROVIDER_AUTH_FAILED`；Turn 记录 provider / model 快照；
  - 会话模型切换审计 `model.changed`；项目默认模型用于新会话；设置界面添加 / 删除 Key、选择模型；
  - 测试：agent 32、server 236、web 23；A9 / A10 覆盖；`pnpm check` / `build`、demo E2E 15、认证 E2E 1 通过；
  - 偏差：`POST /api/models/:id/test` 可选项未实现；真实 DeepSeek 冒烟留在 M1-8。

### M1-8 M1 验收与 E2E

- 状态：`todo`
- 依赖：M1-6, M1-7
- 目标：完成端到端验证与 G1 门禁，形成可演示的最小产品。
- 交付物：
  - Playwright：项目 → 发送 → 工具 → 刷新恢复 → 切模型 → 取消；
  - FakeProvider 演示脚本与真实 DeepSeek 冒烟记录；
  - 安全用例：路径、审批、密钥、并发；
  - G1 验收记录；文档更新。
- 验收：
  - G1 全部通过；`pnpm check` / `build` / `test:e2e` 全绿；
  - 刷新 / 重连无事件缺口；
  - 无明文密钥；无未授权路径访问。
- 测试：E2E 全流程；重启修复；并发 Turn；审批篡改。
- 涉及路径：`e2e/`、`specs/020-workspace-agent/acceptance.md`、`STATUS.md`。
