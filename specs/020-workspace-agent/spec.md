---
id: 020-workspace-agent
title: M1 项目、会话与最小 Agent
milestone: M1
status: done
depends_on: [010-foundation]
owners: [human]
created: 2026-10-31
updated: 2026-10-31
---

# M1 项目、会话与最小 Agent

> 源设计：`larness.md` 第 4.1–4.3、13、14、15、36–37 章。  
> 目标：让 Larness 第一次真正“能干活”——登记项目、创建会话、发送任务，Agent 用受控文件工具读写项目，事件可重放，模型可切换。

> 2026-11-04：新未关联项目会话的目录行为已按人类确认的 [ADR-032](../../docs/adr/ADR-032-shared-default-workspace.md) / [032 spec](../032-default-workspace/spec.md) 改为共享默认工作区；本文的每会话空目录规则仅描述历史实现，旧目录保留。

## 1. 背景与问题

M0 只有认证与空壳。M1 要建立 Larness 的核心领域模型与第一条 Agent 闭环：

- 项目目录如何登记、如何防止路径越界；
- Session / Turn / Event 如何持久化、如何保证同一会话单 Turn；
- Provider 如何抽象、如何流式输出与调用工具；
- 工具如何审批、如何审计、如何避免把密钥送进模型；
- 前端如何在刷新 / 断线后恢复对话。

M1 只做“文件工具 + 对话”，不实现终端、命令执行、Git、服务、预览。

## 2. 目标

- G-1：项目登记 / 编辑 / 移除；realpath + 路径越界防护；Git 检测。
- G-2：项目内与独立会话；独立会话拥有 `dataDir/sessions/<id>/workspace`。
- G-3：Session → Turn → Event 持久化；每会话 `seq` 连续；断线可重放。
- G-4：ProviderAdapter + FakeProvider + DeepSeek；流式文本与工具调用。
- G-5：ToolRegistry 与最小工具集（list / read / search / patch）；L0–L2 审批；审计。
- G-6：Turn Runner 状态机、预算、取消、崩溃标记、幂等。
- G-7：模型 Profile 与 SecretStore；切模型只影响下一 Turn。
- G-8：Web 接入真实项目 / 会话 / 对话 / 审批 / 重连。

## 3. 非目标

- 终端 / PTY、`run_command`、Git 写操作、服务、部署、预览（M2–M4）。
- 多 Provider 全量适配、GLM 深度适配、上下文压缩（M5，M1 只做 DeepSeek + Fake）。
- 完整 file / git / service 锁与 fencing 扩展（M2-7）；M1 在写工具启用前实现最小项目级写锁，保证同项目写作业串行。
- 文件编辑 UI、Monaco、Diff 窗口（M2）。
- 自动化 Agent、定时任务（M5）。
- 多租户 / 多用户。

## 4. 用户故事

- 作为开发者，我登记一个本地项目，创建会话，让 Agent 阅读并修改代码。
- 作为开发者，我在 Agent 运行时刷新页面，回来后还能看到完整过程。
- 作为开发者，我在发送前切换模型，当前任务不受影响，下一个任务使用新模型。
- 作为操作者，我能看到每次工具调用的参数摘要、结果与审批记录。

## 5. 功能需求

### 5.1 项目（MUST）

| ID | 需求 |
|---|---|
| R-1 | `POST /api/projects` 接受 `{name, rootPath}`；路径必须存在、是目录、可读；保存 `realpath`。 |
| R-1a | Web 添加项目时必须提供目录树选择器：`GET /api/fs/directories` 仅允许本机 loopback、只返回目录（不读文件内容、不跟随符号链接），供管理员选择项目根目录；手动绝对路径仍保留。 |
| R-2 | 名称默认取目录名；同一 `real_path` 不允许重复登记（可提示已有项目）。 |
| R-3 | Git 检测使用 `git -C <root> rev-parse --show-toplevel`，5 秒超时；无 Git 不阻塞项目使用。 |
| R-4 | 删除项目只删数据库记录与关联视图，**不删除磁盘目录**；会话保留但 `project_id` 置空或归档。 |
| R-5 | 项目设置至少包含：默认 Model Profile、项目指令（可选）、忽略规则（搜索 / 文件树）。 |
| R-6 | 路径校验：`realpath` 后必须等于根或以根 + 分隔符开头；拒绝 `..`、NUL、UNC 越界、符号链接逃逸。 |

### 5.2 会话（MUST）

| ID | 需求 |
|---|---|
| R-7 | `POST /api/sessions` 支持 `projectId?`；无项目时创建独立会话，工作目录 `dataDir/sessions/<sessionId>/workspace` 并确保为空目录。 |
| R-8 | 会话列表按 `updated_at` 倒序；支持按项目筛选；最近会话包含独立会话。 |
| R-9 | 会话标题可由首条消息截断生成，可手动重命名；标题不参与授权。 |
| R-10 | 会话记录 `model_profile_id`、`approval_policy_id`；`PATCH` 修改只影响下一 Turn。 |
| R-11 | 删除 / 归档会话需预览影响；不删除项目源码；artifacts 保留策略见 Q-011。 |

### 5.3 Turn 与事件（MUST）

| ID | 需求 |
|---|---|
| R-12 | `POST /api/sessions/:id/turns` 创建 Turn；同一会话已有活跃 Turn 时返回 `TURN_IN_PROGRESS`（409）。 |
| R-13 | Turn 创建必须支持 `Idempotency-Key`；重复键返回首次 Turn，不重复执行。 |
| R-14 | 状态机：`QUEUED → PREPARING → RUNNING → COMPLETED / FAILED / CANCELLED / INTERRUPTED`；审批时进入 `WAITING_APPROVAL`；取消时先进入 `CANCELLING`。 |
| R-15 | 每个事件在事务内分配 Session 内递增 `seq`；`UNIQUE(session_id, seq)`；先落库再广播。 |
| R-16 | `GET /api/sessions/:id/events?after=` 返回增量事件，顺序稳定；客户端可据此恢复。 |
| R-17 | Turn 记录 provider、model、credential、usage、错误码、开始 / 结束时间；输入与输出可追溯。 |
| R-18 | 服务启动时把无法证明存活的活跃 Turn 标记 `INTERRUPTED` 并写事件，不自动续跑。 |
| R-19 | 取消：停止新工具调用、abort Provider 请求、尽力终止进行中的工具；记录真实结果。 |

### 5.4 Provider（MUST）

| ID | 需求 |
|---|---|
| R-20 | `ProviderAdapter` 声明能力：流式、工具调用、视觉、reasoning、上下文上限；不支持的能力不得假装。 |
| R-21 | M1 实现 FakeProvider（确定性、脚本化）与 DeepSeek（`deepseek-chat` 默认）；模型名可配置。 |
| R-22 | Provider 只接收标准化消息与工具 schema；不接收 Larness 内部 ID、Cookie、密钥。 |
| R-23 | 流式文本聚合为消息；工具调用参数必须通过 Zod 校验；非法参数返回工具错误而非崩溃。 |
| R-24 | 错误分类：认证失败、限流、网络、上下文超限、内容过滤、未知；映射为稳定错误码并保留可重试标记。 |

### 5.5 工具与审批（MUST）

| ID | 需求 |
|---|---|
| R-25 | ToolRegistry 定义 `name / description / schema / riskLevel / handler`；执行前统一校验与授权。 |
| R-26 | 工具最小集：`list_files`、`read_file`、`search_code`、`apply_patch`；均限制在授权根内。 |
| R-27 | `read_file` 返回内容与 `version`（SHA-256）；`apply_patch` 必须带 `expectedVersion`，不匹配返回冲突。 |
| R-28 | 审批策略：`standard`（L0/L1 自动、L2 询问）、`strict`（所有写入询问）、`readonly`（禁止写入）。默认 `standard`。 |
| R-29 | L2 操作进入 `WAITING_APPROVAL`，生成 `approvalId`，事件 `tool.approval.required`；超时默认拒绝。 |
| R-30 | 审批参数与执行参数规范化后必须一致；不一致拒绝并审计。 |
| R-31 | 工具输出上限 1 MiB / 2000 行，超出截断并标记；写入审计摘要，不写完整敏感内容。 |
| R-32 | 项目指令视为不可信数据，可影响风格但不能覆盖系统安全策略；不得把密钥放入上下文。 |

### 5.6 上下文（MUST）

| ID | 需求 |
|---|---|
| R-33 | ContextBuilder 顺序：系统安全策略 → 项目指令 → 当前需求 → 任务状态 / 计划 → 最近消息 → 工具结果 / 相关文件 → 历史摘要。 |
| R-34 | 预算：最多 30 步、50 次工具调用、10 分钟、单 Turn 上下文不超过模型上限的 80%；超限产出部分结果并说明。 |
| R-35 | 只加载相关文件，不整仓库注入；长文件按范围读取；工具结果可附件化。 |
| R-36 | 压缩 / 摘要必须保留目标、已改文件、待办、失败验证、待审批动作（M1 允许简化，但不得丢任务状态）。 |

### 5.7 Secret 与模型 Profile（MUST）

| ID | 需求 |
|---|---|
| R-37 | `credential_profiles` 只存 `secret_ref`；SecretStore 使用 AES-256-GCM，主密钥 0600。 |
| R-38 | `GET /api/models` / `GET /api/credentials` 不返回明文；创建时允许提交密钥，响应只回 `secretRef` 与掩码。 |
| R-39 | 切换会话模型只写 `sessions.model_profile_id`；新 Turn 创建时快照，当前 Turn 不变。 |
| R-40 | 模型不可用 / Key 无效时 Turn `FAILED`，错误对用户可读，不泄露 Key 或完整请求体。 |

### 5.8 Web（MUST）

| ID | 需求 |
|---|---|
| R-41 | 登录后加载项目 / 会话 / 模型列表；支持新增项目、切换会话、新建会话。 |
| R-42 | 对话时间线由事件驱动；流式文本、计划、工具卡片、审批卡片、错误、取消与最终状态正确。 |
| R-43 | 刷新 / 断线后按 `lastSeq` 补拉事件；补拉失败全量重同步；不重复渲染。 |
| R-44 | Composer 支持模型选择、审批策略、发送、停止；发送后禁用直到 Turn 结束。 |
| R-45 | 审批卡片展示工具、参数摘要、作用域、过期时间；批准 / 拒绝调用后端并更新状态。 |
| R-46 | 项目路径、会话工作目录、错误信息对用户可见；不显示任何密钥。 |
| R-47 | 项目写锁：同一项目同一时刻最多一个写作业（写 Turn / `apply_patch`）；锁含 owner、fencingToken、过期时间与心跳；过期可回收。 |
| R-48 | 写工具执行前必须持有有效项目锁；锁丢失 / fencing 不匹配返回 `RESOURCE_LOCKED`；只读 Turn 可并发。 |

## 6. 验收场景

### A1 项目登记与路径

```gherkin
Given 一个存在的目录 /tmp/demo
When POST /api/projects { name: "demo", rootPath: "/tmp/demo" }
Then 返回项目，real_path 为解析后的绝对路径，git_detected 正确
When 用不存在的路径 / 文件路径 / 重复 realpath 登记
Then 分别返回 VALIDATION_ERROR / CONFLICT，不创建记录
```

### A2 独立会话

```gherkin
Given 已登录
When 创建不带 projectId 的会话
Then workspace_path 位于 dataDir/sessions/<id>/workspace
And 该目录自动创建且为空
```

### A3 最小 Agent 闭环

```gherkin
Given 项目 demo，模型指向 FakeProvider 脚本
When 发送“读取 README 并在末尾追加一行”
Then Turn 进入 RUNNING，产生 tool.requested / tool.completed / file.changed
And 最终消息说明修改结果，Turn COMPLETED
And 文件内容确实变化，审计包含工具调用
```

### A4 刷新恢复

```gherkin
Given Turn 正在运行
When 刷新浏览器或断开 WS 后重连
Then 会话历史与工具事件完整显示，顺序与 seq 一致
And Turn 继续执行，不因断线取消
```

### A5 单会话单 Turn

```gherkin
Given 会话已有 RUNNING Turn
When 再次 POST /turns
Then 返回 TURN_IN_PROGRESS，不创建新 Turn
```

### A6 取消

```gherkin
Given Turn 正在运行
When POST /api/turns/:id/cancel
Then 状态进入 CANCELLING 后 CANCELLED
And 不再产生新的工具调用；进行中的工具记录停止或真实结果
```

### A7 路径越界

```gherkin
Given 项目根 /tmp/demo
When Agent 读取 /tmp/demo/../secret 或符号链接指向根外
Then 工具返回 PATH_OUTSIDE_PROJECT，Turn 继续但记录失败
And 审计记录拒绝
```

### A8 审批

```gherkin
Given 审批策略 strict，Agent 请求 apply_patch
When 工具需要审批
Then Turn 进入 WAITING_APPROVAL，前端显示审批卡片
When 批准后执行参数与展示一致
Then 工具执行一次；若参数被替换则拒绝并审计
When 审批超时
Then 默认拒绝，Turn 继续或失败并给出明确状态
```

### A9 切模型

```gherkin
Given 会话使用模型 A，Turn 正在运行
When PATCH 会话为模型 B
Then 当前 Turn 仍使用 A
When 发送下一个 Turn
Then 使用 B，历史事件仍可读
```

### A10 密钥隔离

```gherkin
Given 已配置 DeepSeek Key
When 查看日志、事件、API 响应、错误
Then 不出现明文 Key
And 模型上下文只包含 secretRef 或不需要密钥
```

### A11 Provider 故障

```gherkin
Given Provider 返回 401 或网络错误
When 执行 Turn
Then Turn FAILED，错误码 PROVIDER_UNAVAILABLE 或 PROVIDER_AUTH_FAILED
And 已产生的事件保留，可重试
```

### A12 崩溃恢复

```gherkin
Given Turn 处于 RUNNING 时进程崩溃
When 重启 server
Then 该 Turn 标记 INTERRUPTED，写入事件
And UI 显示“执行已中断”，不显示完成
```

### A13 幂等

```gherkin
Given 同一 Idempotency-Key 的 Turn 请求
When 网络重试再次提交
Then 返回同一个 turnId，不产生第二个 Turn
```

### A14 同项目写串行

```gherkin
Given 同一项目有两个会话同时请求 apply_patch
When 两个 Turn 并发执行
Then 只有一个 Turn 持有项目写锁并修改文件
And 另一个 Turn 等待或返回 RESOURCE_LOCKED，不产生交错写入
And 锁过期后可被新 Turn 回收，旧 fencing token 不能继续写
```

## 7. 接口与契约

新增 / 使用：

- `GET/POST /api/projects`、`GET/PATCH/DELETE /api/projects/:id`
- `GET/POST /api/sessions`、`GET/PATCH/DELETE /api/sessions/:id`
- `POST /api/sessions/:id/turns`、`POST /api/turns/:id/cancel`
- `GET /api/sessions/:id/events?after=`
- `GET /api/models`、`POST /api/models`、`POST /api/models/:id/test`
- `GET/POST /api/credentials`、`DELETE /api/credentials/:id`
- `GET/POST /api/approvals/:id`（详情 / 批准 / 拒绝）
- WS `agent` 主题事件，见 [ws-events.md](../../docs/contracts/ws-events.md)。

Turn 状态使用大写枚举；API 字段小驼峰；错误码沿用既有表。审批、凭据、模型测试接口已在 `docs/contracts/rest-api.md` 登记，实现时以该文件为准。

## 8. 数据与迁移

迁移 `0002_projects` + `0003_workspace`：

- `0002_projects`：`projects`；
- `0003_workspace`：`sessions`、`turns`、`agent_events`、`model_profiles`、`credential_profiles`、`secrets`、`approvals`、`resource_locks`；
- `turns` 唯一索引 `(session_id, idempotency_key)`；`agent_events` 唯一 `(session_id, seq)`；
- 外键：`sessions.project_id → projects.id`（`ON DELETE SET NULL`）；`turns.session_id → sessions.id`（`ON DELETE CASCADE`，但删除会话需先预览）；
- 启动时修复：活跃 Turn → INTERRUPTED。

## 9. 安全与审计

- 所有项目 / 会话 / Turn / 事件接口都校验会话与资源归属；跨项目访问默认拒绝。
- 路径校验在工具层与 API 层各做一次；不信任前端传入的绝对路径。
- 项目指令视为不可信文本；系统策略优先级最高。
- 工具参数记录摘要；文件内容只记录路径与 hash，不记录全文。
- 审计：`project.created/updated/deleted`、`session.created/deleted`、`turn.started/cancelled`、`tool.requested/completed/denied`、`approval.granted/denied`、`model.changed`、`credential.created`。
- SecretStore 主密钥权限 0600；密钥不进入事件、日志、错误、前端。

## 10. 失败、边界与恢复

| 场景 | 行为 |
|---|---|
| Provider 超时 / 断流 | Turn FAILED 或带部分结果 COMPLETED_WITH_WARNINGS（M1 用 FAILED + 事件） |
| 上下文超限 | 截断工具结果 / 历史，保留任务状态；仍超限则失败并提示 |
| 工具参数非法 | 返回工具错误，让模型修正；连续 3 次同错则终止 |
| 文件版本冲突 | 工具返回 VERSION_CONFLICT + 当前 hash；模型需重新读取 |
| 审批超时 | 默认拒绝，作废审批；Turn 继续或失败 |
| 磁盘写满 | Turn FAILED，事件写入失败时拒绝继续 |
| 会话删除时 Turn 运行 | 先取消或拒绝删除，返回 409 |
| 项目目录被移走 | 工具返回 NOT_FOUND；项目标记异常，不崩溃 |

## 11. 可观测性

- `turn.started` / `turn.completed` 日志带耗时、工具数、token 用量（不含内容）。
- 审计可查每次工具调用的参数摘要、决策、结果摘要。
- UI 显示 Turn 状态、预算消耗、错误码、可重试提示。

## 12. 测试计划

- 单元：路径校验、事件 seq、状态机、预算、幂等、审批参数规范化。
- 集成：A1–A13；FakeProvider 脚本化工具循环；重启修复；并发 Turn。
- Provider 契约：DeepSeek 的真实 API 冒烟（手动 / 环境变量门控），不进入默认 CI。
- E2E：新增项目 → 发送任务 → 工具卡片 → 刷新恢复 → 切模型 → 取消。
- 安全：密钥扫描、路径穿越、跨项目访问、审批篡改、超长输出。

## 13. 开放问题

| 问题 | 默认 | 截止 |
|---|---|---|
| 默认 DeepSeek 模型 | `deepseek-chat`；模型列表可配置 | M1-3 |
| 上下文压缩策略 | M1 只做截断 + 摘要占位；M5 完整实现 | M5 |
| 审批策略是否允许“记住本项目” | M1 不做记忆，仅逐次 / 本 Turn | M2 |
| `run_command` 何时加入 | M2-3；M1 不提供 | M2 |
| 多会话同项目并发写 | M1 加最小项目写锁 + fencing；M2-7 扩展 file / git / service 锁 | M1 |

## 14. 完成定义

- [x] A1–A14 全部通过；
- [x] FakeProvider 覆盖状态机；DeepSeek 至少一次真实工具调用验收；
- [x] 刷新 / 重连无事件缺口；
- [x] 密钥扫描通过；
- [x] G1 门禁通过（2026-11-01，人类验收）；
- [ ] 契约、STATUS、ROADMAP 更新。
