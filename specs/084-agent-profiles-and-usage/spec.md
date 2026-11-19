---
id: 084-agent-profiles-and-usage
title: Agent Profile 收敛与会话 Token 统计
milestone: 发布后
status: active
depends_on: [051-agent-tool-contract, 082-agent-kernel, 083-service-model]
owners: []
created: 2026-11-18
updated: 2026-11-18
---

# Agent Profile 收敛与会话 Token 统计

> 状态：`active`（2026-11-18 人类审核通过并指示实施；AP-1～AP-6 完成，自动化门禁通过，待 UI 视觉验收）。本切片修改 082/083 的 Profile 模型，并增加输入框下方的会话 Token 统计与最后一步实测速度。决策见 [ADR-070](../../docs/adr/ADR-070-agent-profiles-and-usage.md)，验收记录见 [tasks](tasks.md#验收记录2026-11-18macos)。

## 1. 背景与问题

当前 Profile 为 `coding`、`plan`、`service-ops`：

- `coding` 有完整文件/命令/后台进程工具，但没有 `update_plan`，也没有结构化的 PM2 服务工具；
- `plan` 只有只读文件工具 + `update_plan`，不能写文件、执行命令或部署；
- `service-ops` 只有 PM2 列表/日志/控制工具，不能构建、创建部署目标或编辑项目文件。

这造成三个问题：

1. 用户想“部署一个正式服务”时，Service Ops 只能控制已有服务，Coding 又缺少结构化 PM2 工具，容易落在错误模式；
2. `plan` 的 `update_plan` 在只读模式下只能展示调研步骤，真正开始实现后计划能力消失；
3. 用户目标是“快、省 token”，需要默认模式不支付计划提示、计划步骤和每轮 PM2 观察的固定成本。

同时，用户希望在输入框下方看到：

- 任务进行中的最后一步实测输出速度；
- 当前会话累计 Token 数量。

Provider 只在每个模型步骤结束时上报 usage，无法逐 token 实时计数；本切片不做伪实时 speed。

## 2. 目标

- G-1：Profile 收敛为 `coding` 与 `plan` 两个；`service-ops` 从 Profile 枚举、API、UI 和会话数据中移除。
- G-2：两个 Profile 拥有相同的完整工具面：文件读写/搜索、`run_command` / `run_shell`、后台进程、Service Ops 工具。
- G-3：`coding` 不提供 `update_plan`；`plan` 在完整工具面之上提供 `update_plan` 与计划提示。
- G-4：`plan` 不再承担只读安全边界；它只是“带计划工具的完整执行模式”。只读需求由审批策略或未来独立模式承担。
- G-5：旧 `service-ops` 会话迁移为 `coding`；左侧“服务运维”人类弹窗保持不变。
- G-6：默认 Coding 模式不注入每轮 PM2 观察；需要时通过 `list_service_ops` 按需读取。
- G-7：输入框下方增加会话累计 Token 统计；任务进行中显示最后一步实测输出速度。
- G-8：不引入字符估算或伪实时 token/s；无法精确统计时明确显示“部分统计”或隐藏，不伪造完整总数。
- G-9：Coding 的验证规则按改动范围收敛，默认先跑最小验证，不因小任务自动跑全仓测试。

## 3. 非目标

- NG-1：不做逐 token / 逐秒实时速度；Provider 没有流式 usage。
- NG-2：不改 ADR-059 的预算模型、停止语义或花费上限。
- NG-3：不新增 Provider 依赖、tokenizer 依赖或第三方计量服务。
- NG-4：不改变 Service Ops 的人类 REST/UI 控制模型、项目锁、targetId + pm2Name 校验与审计。
- NG-5：不改变终端只面向人类、Git 面板只面向人类的结论。
- NG-6：不恢复 Git / 终端模型工具。
- NG-7：不把 `plan` 用作权限边界；真正的只读仍由审批策略或未来显式模式提供。

## 4. 用户故事

- 作为用户，我希望默认 Coding 模式不创建计划、不注入 PM2 列表，以便小任务快速完成且少花 token。
- 作为用户，我希望复杂任务切到 Plan 后仍能正常改文件、执行命令和部署，同时看到计划进度。
- 作为用户，我希望在服务运维之外，Coding Agent 也能部署并控制正式 PM2 服务，不必切换第三个 Profile。
- 作为用户，我希望输入框下方显示本会话累计 Token，以及任务进行中最后一步的真实输出速度。
- 作为用户，我希望统计缺失时明确标出，而不是显示一个看似精确的假数字。

## 5. 验收场景

### A1 Coding 默认快速模式

```gherkin
Given 新会话使用默认 Coding Profile
When 用户要求完成一个小范围修改
Then 模型工具面没有 update_plan
And 不注入每轮 PM2 观察
And 模型可直接读写文件、执行针对性检查、管理后台进程
And 可调用 list_service_ops / read_service_ops_logs / control_service_ops
```

### A2 Plan 是完整执行 + 计划

```gherkin
Given 用户将会话切换为 Plan Profile
When 用户要求实现一个多步骤任务
Then 模型工具面与 Coding 相同，并额外包含 update_plan
And 系统提示包含计划策略
And 模型可以修改文件、执行命令、启动后台进程和控制 PM2
And 计划卡片随执行进度更新
```

### A3 旧 Service Ops 会话迁移

```gherkin
Given 升级前存在 agent_profile=service-ops 的会话
When 新版本启动并完成迁移
Then 该会话的 Profile 归一为 coding
And 左侧“服务运维”弹窗与人类控制能力保持不变
And 旧事件、日志与消息可继续回放
```

### A4 会话 Token 统计

```gherkin
Given 一个包含多个已完成 Turn 的会话
When 打开会话
Then 输入框下方显示该会话累计 Token（输入/输出或总数）
And 数值来自各 Turn 已持久化的 provider usage
```

### A5 最后一步速度

```gherkin
Given 一个 Turn 正在运行且已完成至少一个模型步骤
When 该步骤结束并上报 usage
Then 输入框下方显示该步骤的实测输出速度（outputTokens / durationMs）
And 不把它描述为逐字实时速度
```

### A6 统计缺失

```gherkin
Given 某些 Turn 或模型步骤没有 provider usage
When 显示会话 Token 或最后一步速度
Then 显示“部分统计”/“已知”或隐藏对应数值
And 不将缺失数据补零后冒充完整总量
```

### A7 验证范围

```gherkin
Given Coding 模式下的单文件小改动
When 模型准备验证
Then 默认运行该文件/包的定向测试与检查
And 仅在跨包、契约、迁移、认证/安全或用户明确要求时运行全量检查
```


### A8 过程呈现收敛

```gherkin
Given 一个 Turn 正在思考或生成
When 时间线渲染当前 Turn
Then 不再显示底部独立状态栏
And 计划卡在上、过程折叠标题行在下
And 标题行左侧是音频波形图标，不是转圈或折叠箭头
And 标题行显示 Thinking... / Generating... / Running... 等状态和流动背景
And 思考时不展示 reasoning 内容，只显示 Thinking... 状态
And 展开后显示工具调用、失败与耗时详情
```

### A9 完成后收起并可展开

```gherkin
Given 一个 Turn 已完成
When 时间线显示该 Turn
Then 过程标题行显示 Completed · 100s（失败/停止显示对应状态与耗时）
And 默认折叠，只保留该行和最终回答
And 用户点击标题行可展开查看执行过程
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `AgentProfileId` 收敛为 `coding \| plan`；删除 `service-ops`。 |
| R-2 | MUST | `coding` packs：`core.read`、`core.write`、`core.command`、`process`、`serviceOps`；不包含 `plan`。 |
| R-3 | MUST | `plan` packs 与 `coding` 相同，并增加 `plan`；计划模式不再是只读。 |
| R-4 | MUST | 两个 Profile 的 system prompt 都包含项目后台任务与持久 PM2 契约；`plan` 额外包含计划策略。 |
| R-5 | MUST | 默认不向 Coding 注入 PM2 观察快照；PM2 信息通过 `list_service_ops` 按需读取。 |
| R-6 | MUST | `service-ops` 会话迁移为 `coding`，并提供迁移测试。 |
| R-7 | MUST | 新增会话用量查询，返回累计 input/output/total/cache 已知值及缺失 usage 的 Turn 数。 |
| R-8 | MUST | `model.usage` 事件增加步骤耗时，供前端计算最后一步实测输出速度；不新增流式 token 计数。 |
| R-9 | MUST | 输入框下方在任务进行中显示最后一步实测速度；会话累计 Token 显示规则按 §12 确认。 |
| R-10 | MUST | 缺失 usage 时不得补零伪装精确总量；显示部分统计或隐藏。 |
| R-11 | SHOULD | Coding 提示增加验证比例原则：默认最小验证，全量检查仅在跨包/契约/迁移/安全或用户要求时执行。 |
| R-12 | MUST | Service Ops 人类弹窗仍独立，不从 Profile 合并中删除。 |
| R-13 | MUST | 删除底部独立状态栏；Turn 状态收敛到过程折叠的标题行。 |
| R-14 | MUST | 过程标题行左侧使用音频波形 loading 图标，不使用转圈或左侧折叠箭头；展开箭头放在右侧。 |
| R-15 | MUST | 标题行显示 `Thinking...` / `Generating...` / `Running...` / `Waiting for approval...` 等状态，并有低对比度流动背景；`prefers-reduced-motion` 下停止动画。 |
| R-16 | MUST | 思考时只显示 `Thinking...` 状态，不渲染 reasoning 摘要、完整句子或逐字内容；避免抖动与无意义噪声。 |
| R-17 | MUST | 完成后标题行显示 `Completed · {duration}`，失败/停止显示对应状态与耗时；默认折叠，点击展开执行过程。 |
| R-18 | MUST | reasoning 增量不触发时间线自动滚动；只有正文、工具、计划或审批变化才跟随底部。 |

## 7. 接口与契约变更

- REST：新增 `GET /api/sessions/:id/usage`，返回会话级累计 usage 与缺失统计；084 增加 `cache` 对象：`hitRate`（仅 Provider 回报的请求，0–1）、`readTokens`、`missTokens`、`knownRequests`、`unknownRequests`；未知请求不进入命中率分母。沿用认证守卫。
- REST：Profile 枚举从 `coding \| plan \| service-ops` 改为 `coding \| plan`。
- WS / 事件：`model.usage` payload 增加 `durationMs`（模型步骤墙钟耗时）；不新增逐 token 事件。
- DB：无新表；会话累计统计从 `turns.usage_json` 聚合。
- 配置：无新增配置键。
- 错误码：沿用现有 `VALIDATION_ERROR` / `NOT_FOUND` / `UNAUTHENTICATED`；不新增敏感信息。
- 同步更新：`docs/contracts/rest-api.md`、`docs/contracts/ws-events.md`、`docs/contracts/agent-command-context.md`、`docs/contracts/data-model.md`、`specs/051-agent-tool-contract/spec.md`。

## 8. 数据与迁移

- 新表 / 新列：无。
- 迁移：`0034_agent_profile_coding_plan.sql` 将 `sessions.agent_profile='service-ops'` 更新为 `coding`。
- 索引 / 约束：沿用现有 `sessions.agent_profile`。
- 回滚：回滚应用不回滚用户会话；如需保留旧 Profile 语义，向前迁移新增值而不是删除数据。
- 保留与备份：升级前沿用既有数据库备份流程；不删除旧 Turn、事件或 usage。

## 9. 安全、权限与审计

- 身份与授权：会话用量接口要求现有认证会话；只返回聚合数字，不返回 prompt、密钥或原始 usage 明细中的敏感字段。
- 审批级别：Service Ops 控制仍为 L2，沿用 targetId + pm2Name + 项目/服务锁与审计；合并 Profile 不降低控制风险。
- 秘密处理：统计只保存 token 数，不记录消息内容或 API Key。
- 审计：不新增高频用量审计；控制操作沿用现有审计。
- 失败关闭：usage 缺失显示部分统计；PM2 身份不明仍拒绝控制。

## 10. 失败、边界与恢复

| 条件 | 行为 |
|---|---|
| Provider 未上报 usage | 会话总量标记“部分统计”；该步骤速度不显示 |
| Turn 被取消 / 失败 | 只统计已上报 usage；不推断缺失值 |
| 会话无已完成 Turn | 显示 0 或隐藏总量，按 §12 确认 |
| 旧 service-ops 会话 | 迁移为 coding；权限与历史保持 |
| PM2 不可用 | Coding 仍可开发；`list_service_ops` 返回不可用原因 |
| `update_plan` 在 Coding 被调用 | 工具面不存在，执行层返回 `TOOL_NOT_FOUND` |
| 小任务被执行全量测试 | 由提示与工具说明约束；不新增命令黑名单 |

## 11. 测试计划

- 单元：Profile catalog（coding 不含 plan、plan 含 plan 且其余相同）、禁用工具矩阵、迁移。
- 集成：会话 usage 聚合（多 Turn、缺失 usage）、`model.usage` durationMs、TurnRunner 不再注入 PM2 快照。
- Web：Composer 下方总量与最后一步速度显示；缺失 usage 隐藏/部分统计；Plan 模式计划卡片；思考状态只显示 `Thinking...`，不渲染 reasoning 文本。
- E2E：Coding 小任务不出现计划卡；Plan 任务出现计划卡并完成实际修改；会话 Token 显示。
- 门禁：`pnpm check`、`pnpm build`、`pnpm test:e2e`、`pnpm test:e2e:prod`。

## 12. 已确认决议（2026-11-18 审核通过）

1. **Coding / Plan 文案**：保留 `Coding` 与 `Plan`；Plan 详情为「完整能力 + 计划」。
2. **Token 行显示时机**：总数常驻（有已知 usage 时）；最后一步速度仅在 Turn 进行中显示。
3. **Token 单位**：总量显示 `1.24M tokens` / `12.3k tokens`；输入/输出明细放在 Hint 中。
4. **缺失 usage**：总量前缀 `≥`，Hint 标注「部分统计 · N 轮缺失」；不隐藏已知值、不补零。
5. **最后一步速度**：显示 `38 tok/s`；Hint 显示该步骤输出量与耗时。
6. **PM2 观察**：两个 Profile 都不注入；模型需要时调用 `list_service_ops`。
7. **验证比例原则**：写入 system prompt，并同步到 051 工具契约说明。
8. **`refresh_observations`**：保留实现，但不再属于任何 Profile 的工具包，退出模型面。
9. **旧 Plan 会话**：升级后直接获得完整写/命令权限，不二次确认；`plan` 不是权限边界。
10. **ADR**：[ADR-070](../../docs/adr/ADR-070-agent-profiles-and-usage.md) 已 accepted，取代 ADR-069 的独立 Service Ops Profile 决策。

## 13. 完成定义

- A1–A9 根据最终确认范围通过；
- Profile 只剩 `coding` / `plan`，两者工具面仅差 `update_plan` 与计划提示；
- 旧 `service-ops` 会话完成迁移；
- 会话 Token 统计与最后一步速度按确认的显示规则工作，缺失数据不伪装；
- ADR、契约、STATUS、ROADMAP、测试同步更新。

## 14. 过程呈现收敛方案（2026-11-18 增加，待实现）

> 本节是用户在 084 讨论中确认追加的 UI 方案；不替换前面的 Profile 与 Token 统计方案。

### 14.1 布局

```text
[计划卡，如有]

[▂▅▃▆] Thinking...     3 步 · 19s  ›
        （展开后：工具调用、失败、耗时、详情）
```

- 删除时间线底部的独立状态栏；
- 计划卡保持在上方，过程折叠紧随其后；
- 过程标题行本身就是状态展示；
- 标题行左侧只有音频波形图标；
- 右侧保留展开箭头，并显示步骤数/失败数/耗时等次要信息；
- 点击标题行展开或收起执行过程。

### 14.2 状态与完成态

| 情况 | 标题行 |
|---|---|
| 思考中 | `Thinking...` |
| 输出正文 | `Generating...` |
| 执行工具 | `Running...`（可附工具名） |
| 等待审批 | `Waiting for approval...` |
| 启动/准备 | `Starting...` |
| 完成 | `Completed · 100s` |
| 失败 | `Failed · 100s` |
| 停止 | `Stopped · 100s` |

完成态默认折叠，只保留 `Completed · 100s`、最终回答和成果卡；点击标题行展开执行过程。失败/停止同样保留耗时与可展开的执行记录。

### 14.3 思考内容

- 只在 `Thinking...` 状态显示；
- 不在标题行展示 reasoning 摘要、完整句子或逐字内容；
- reasoning 仍可用于内部状态判断，但不进入用户可见文本；
- 这样避免文字抖动、减少渲染开销，也不扩大思考内容的暴露面；
- 如果未来需要查看思考，另行设计显式展开，不在默认过程行里显示。

### 14.4 波形与背景

- 波形为 4–5 根高低变化的竖条，类似音频均衡器；
- 流动背景只在标题行局部，低透明度渐变缓慢移动；
- 深色/浅色主题各自使用低对比度颜色，不遮挡文字；
- `prefers-reduced-motion: reduce` 时停止波形和背景动画。

### 14.5 滚动与性能

- reasoning delta 不渲染可见文本，也不触发时间线自动滚动；
- 只有 assistant 正文、工具状态、计划或审批变化才跟随底部；
- 思考句子固定单行高度，避免标题行反复改变高度；
- 用户向上滚动后仍暂停自动跟随，并保留“回到最新消息”按钮。

### 14.6 非目标

- 不新增后端事件或 API；本方案只改 Web 呈现与滚动策略；
- 不改变 reasoning token 的生成或计费；
- 不把思考句子当作精确的模型内部状态，只是 UI 摘要。

### 14.7 2026-11-19 视觉细化（用户反馈）

1. 图标改为 4 个脉冲节点，依次点亮 / 放大，像神经突触传递信号；不再使用柱状波形。
2. 流光只作用于 `Thinking...` / `Generating...` / `Running...` / `Waiting for approval...` / `Starting...` 这行文字本身，从左向右扫过；不再给整行加流动背景。
3. `Running...` 的次要信息只显示工具类别（命令 / 读取 / 修改文件 / 后台进程 / 服务运维），不显示完整命令、参数或输出。
4. 完成、失败、停止后不再显示脉冲图标，也不保留文字流光；主标签只保留 `Completed` / `Failed` / `Stopped` / `Interrupted`，耗时、步数与失败数移到右侧次要信息。

### 14.8 2026-11-19 二次视觉调整（取代 14.7 第 1、2 条）

1. 图标改为一大一小两颗四角星，带轻微缩放、旋转与闪烁，参考现代 AI 产品的 Sparkles 语言；不再使用脉冲圆点。
2. 状态文字基色为灰色，主题前景色（浅色主题为黑、深色主题为白）从左向右扫过，不再使用强调色流光。
3. 星星闪烁与文字扫描使用同一周期且同步（当前 1.6 秒一轮）：每个周期星星闪一次、文字从左到右恰好扫过一次；不再使用错峰延迟，也不使用会在一秒内多次扫过的位移区间。

