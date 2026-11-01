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
| M1-8 | M1 验收与 E2E | M1-6, M1-7 | `done` |
| M1-9 | 项目目录选择器 | M1-1 | `done` |
| M1-10 | 流式对话与 Markdown | M1-6, M1-7 | `done` |
| M1-11 | 工作区布局与工具分组 | M1-6, M1-7 | `done` |
| M1-12 | 自动会话标题 | M1-2 | `done` |
| M1-13 | 侧栏右键操作 | M1-2, M1-9 | `done` |
| M1-14 | 仅展示最终答复 | M1-6, M1-10 | `done` |
| M1-15 | 草稿会话 | M1-2, M1-6 | `done` |

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
  - 偏差：`assistant.delta` 广播已由 M1-10 补上；真实 DeepSeek 冒烟在 M1-8。

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

- 状态：`done`（2026-11-01，人类验收通过）
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
- 完成记录（自动化部分）：
  - 新增 `e2e-auth/m1.spec.ts`：配对 → 项目 → 会话 → 工具 → 审批 → 补丁 → 刷新 → 切模型 → Key 掩码 → 停止；
  - E2E Server 注入 FakeProvider；真实 TurnQueue / 工具 / 审批 / 事件 / WS；
  - `pnpm check`（agent 32 / server 236 / web 23）、`pnpm build`、demo E2E 15、auth + M1 E2E 2、prod E2E 2 通过；
  - 验收记录 `acceptance.md`，含 A1–A14 / G1 映射与真实 Key 冒烟步骤；
  - 真实 DeepSeek live smoke：2026-11-01 通过（33 tests、654ms、`deepseek-chat` 工具调用，无 Key 泄漏）；
  - **人类验收**：2026-11-01 通过，G1 关闭；记录见 acceptance 第 7 节。

### M1-9 项目目录选择器

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-1
- 目标：让“添加项目”不必手写绝对路径，同时不扩大远程文件枚举面。
- 交付物：
  - `GET /api/fs/directories`：本机 loopback + 已认证，只列目录，跳过符号链接与文件，最多 500 项；
  - 项目对话框目录树：主目录 / 上一级 / 刷新 / 选择当前目录，保留手动路径输入；
  - 契约、测试与人工验收清单更新。
- 验收：本地可选到目录；远程请求 403；文件 / 相对路径 / 不存在目录被拒绝；密钥与文件内容不出现在响应。
- 测试：API 目录过滤、loopback 限制、项目对话框 E2E 路径选择。
- 涉及路径：`apps/server/src/api/fs.ts`、`apps/web/src/features/projects/ProjectDialog.tsx`、`docs/contracts/rest-api.md`。
- 完成记录：
  - `GET /api/fs/directories`：loopback + 已认证、只列目录、跳过符号链接、最多 500 项、realpath / 错误码处理；
  - 项目对话框目录树：主目录 / 上一级 / 刷新 / 选择当前目录，保留手动绝对路径；
  - 测试：server API 目录过滤与 loopback / 文件 / 相对路径 / 不存在目录；web `ProjectDialog` 组件测试；`pnpm check`（agent 32 / server 237 / web 24）与 `pnpm build` 通过；
  - M1 E2E 仍使用手动路径（临时目录在 home 之外，沙箱无法创建 home 目录）；目录树由组件测试覆盖，待人工验收第 2 步确认。

### M1-10 流式对话与 Markdown

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-6, M1-7
- 目标：让真实对话具备明确的进行中反馈，并正确渲染 Markdown 正文。
- 交付物：
  - `assistant.delta` 独立广播信封（不占用持久化 sequence），最终 `assistant.message` 以相同 `messageId` 覆盖；
  - 时间线进行中条：等待审批 / 正在执行工具 / Agent 正在思考 + 计时；
  - GFM Markdown：标题、表格、列表、引用、代码块、链接；
  - 刷新后仍以持久化消息恢复。
- 验收：流式文本增量显示；无事件序号缺口；刷新无重复；Markdown 表格与标题正确。
- 测试：runner delta 测试、eventReducer 增量测试、Markdown 组件测试、M1 E2E 进行中状态。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/web/src/features/chat/`、`docs/contracts/ws-events.md`。
- 完成记录：
  - `assistant.delta` 广播 + 客户端增量 upsert；最终消息同 id 覆盖；
  - `TurnActivity` 显示等待审批 / 工具执行 / 思考与耗时；
  - `MarkdownText` 使用 `react-markdown` + `remark-gfm`，安全转义 HTML；
  - `pnpm check`（agent 32 / server 238 / web 26）、`pnpm build`、auth + M1 E2E 2 通过。

### M1-11 工作区布局与工具分组

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-6, M1-7
- 目标：降低工具噪声、修正资源栏折叠、把工作区品牌移到 header，并移除低价值提示文本。
- 交付物：
  - 连续工具调用折叠为“执行了 N 个工具”分组，展开查看每个工具参数 / 结果；
  - 资源栏折叠状态持久化，header 与会话 header 均可折叠 / 展开；
  - `Larness / v0.1` 品牌从侧栏移到 header 最左，侧栏第一个元素为“新建会话”；
  - 移除“本机工作空间”“可信设备 · Passkey”“窗口布局会按浏览器保存”“Agent 可能执行工具与命令…”；
  - 底部改为上下文 token 占用（实际 input tokens / 模型上下文窗口）。
- 验收：工具分组可展开；资源栏折叠恢复；header / 侧栏布局正确；无残留提示；上下文用量显示。
- 测试：`pnpm check`、`pnpm build`、M1 E2E（资源栏折叠、进行中状态、完整对话）。
- 涉及路径：`apps/web/src/features/chat/`、`apps/web/src/components/layout/`、`apps/web/src/stores/`。
- 完成记录：工具分组、品牌迁移、提示清理、资源栏折叠、上下文用量；agent 32 / server 238 / web 26 测试通过，auth + M1 E2E 2/2 通过。

### M1-12 自动会话标题

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-2
- 目标：首条消息自动生成可读会话标题，减少手动重命名。
- 交付物：
  - 默认标题 `New session` 的会话在首条 Turn 创建时，取首条用户消息压缩空白并截断为 48 字符；
  - 手动命名的会话不被覆盖；
  - 前端在 Turn 创建后刷新工作区，侧栏与标题即时更新。
- 验收：首条消息后标题变化；长消息带省略号；手动标题保留；刷新后标题保持。
- 测试：turn service 单元测试；M1 E2E 标题断言。
- 涉及路径：`apps/server/src/modules/sessions/turns.ts`、`apps/web/src/stores/timelineStore.ts`。
- 完成记录：标题派生与 E2E 通过；手动标题保留。

### M1-13 侧栏右键操作

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-2, M1-9
- 目标：项目与会话支持右键重命名 / 归档或移除，不再只能进会话 header 操作。
- 交付物：
  - 项目行右键：重命名项目、移除项目（只移除登记，不删除源码；会话转为独立会话）；
  - 会话行 / 最近会话右键：重命名会话、归档会话（隐藏，不删工作目录）；
  - 操作确认对话框与错误提示；归档当前会话后回到最近会话；
  - 右键菜单点击外部 / Esc 关闭。
- 验收：项目重命名即时生效；会话重命名即时生效；归档后从列表隐藏；移除项目后源码保留。
- 测试：M1 E2E 右键重命名项目 / 会话；API 现有 PATCH / DELETE 测试。
- 涉及路径：`apps/web/src/components/layout/ProjectSidebar.tsx`、`apps/web/src/features/projects/RenameProjectDialog.tsx`。
- 完成记录：右键菜单、项目 / 会话重命名、会话归档、项目移除确认；E2E 通过。

### M1-14 仅展示最终答复

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-6, M1-10
- 目标：避免一次提问出现多段助手消息，只展示每个 Turn 的最终答复。
- 交付物：
  - `MessageItem.turnId`；时间线按 Turn 仅保留最后一条 assistant 消息；
  - 中间“先看一下 / 正在处理”等段落不再作为独立气泡展示；
  - 工具调用仍以折叠分组保留，展开可查看细节；流式最终文本保留。
- 验收：带 preamble 的 Turn 只显示最终答复；工具组可展开；刷新后仍只显示最终答复。
- 测试：M1 E2E 注入中间文本并断言不可见。
- 涉及路径：`packages/shared/src/events.ts`、`apps/web/src/lib/eventReducer.ts`、`apps/web/src/features/chat/Timeline.tsx`。
- 完成记录：Turn 级最终消息过滤与 E2E 通过。

### M1-15 草稿会话

- 状态：`done`（2026-11-01，人类验收通过）
- 依赖：M1-2, M1-6
- 目标：避免“点一次新建就落库一个空会话”，只在首条消息发送后创建后端会话。
- 交付物：
  - 本地 `draftSession`：同一项目重复点新建复用同一个草稿；切换真实会话或到其他项目新建时草稿消失；
  - 草稿在侧栏显示“新会话 / 草稿”标记，不写入数据库；
  - 首条消息发送时创建 Session + Turn，再切换到真实会话；失败保留草稿并显示错误；
  - 草稿不持久化，刷新后回到已有会话。
- 验收：连续点新建只有一条草稿；切走/换项目草稿消失；首条消息后真实会话出现；未发送不产生后端会话。
- 测试：M1 E2E 草稿复用 / 发送后消失 / 切回其他聊天消失。
- 涉及路径：`apps/web/src/stores/navigationStore.ts`、`apps/web/src/stores/timelineStore.ts`、`apps/web/src/lib/useNewSession.ts`、`apps/web/src/components/layout/ProjectSidebar.tsx`。
- 完成记录：草稿状态、延迟创建与 E2E 通过。
