---
id: 086-project-memory
title: 项目指令、项目记忆与用户偏好
milestone: 发布后
status: active
depends_on: [020-workspace-agent, 082-agent-kernel]
owners: []
created: 2026-11-20
updated: 2026-11-20
---

# 086 项目指令、项目记忆与用户偏好

> 状态：`active`（2026-11-20 实现与自动验证完成，待人类视觉/真实使用验收）。决策见 [ADR-072](../../docs/adr/ADR-072-project-memory.md)（accepted）；验证记录见 [acceptance](acceptance.md)。
>
> 设计立场：**默认自动学习，不要求用户逐条确认。** 记忆只在有证据时写入，写入后下一个 Turn 生效；用户通过“查看 / 纠正 / 忘记 / 固定”控制，而不是通过审批队列。所有层都有硬字节预算、淘汰与保留期，保证长期使用不会无限扩张。

## 1. 背景与问题

Larness 目前没有任何跨会话记忆：

1. **项目指令只有数据库字段。** `contextAssembler` 只读取 `project.settings.instructions`（最多 20,000 字符），不读取项目仓库里的 `AGENTS.md` 或同类文件。用户每次登记项目都要手动粘贴约定，且无法随仓库版本化。
2. **会话摘要与检查点不是记忆。** `session_context_summaries` 和 Turn checkpoint 只服务当前会话或当前长任务；换会话、换项目后全部失效。[ADR-058](../../docs/adr/ADR-058-turn-recovery-retention.md) 也明确把“跨会话的长期记忆”排除在范围外。
3. **重复发现成本高。** 构建/测试命令、目录约定、已知坑、服务端口、部署方式在每个新会话都要重新读文件、跑命令、重新总结；长任务换页后也会丢失早期事实。
4. **用户偏好没有落点。** “回答简短”“以后用 pnpm”“不要自动提交”这类跨项目偏好只能在每个会话重复说，Agent 不会随着使用变懂。
5. **但自动记忆很容易变成负担。** 逐条确认会打断工作；全量对话记忆会带来噪声、过期事实、秘密泄漏、持久化 prompt injection，以及数据库和上下文无限膨胀。

因此本切片的目标不是“记住一切”，而是建立一个**低摩擦、可纠正、硬上限**的三层知识系统：

- **指令层**：人写、只读、随仓库版本化的项目约定。
- **项目记忆层**：Agent 在工作中自动沉淀的事实、命令、坑与决策，按项目隔离。
- **用户偏好层**：跨项目生效的少量偏好与工作习惯，只从用户明确表达中学习。

## 2. 目标

- G-1：项目根目录的 `AGENTS.md` 与 `.larness/instructions.md` 自动进入上下文，和现有数据库指令合并。
- G-2：Agent 在发现可复用事实时自动写入项目记忆，**不要求用户逐条确认**；写入后下一个 Turn 生效。
- G-3：从用户明确表达中自动学习少量跨项目偏好，让 Agent 逐步适应用户的工作方式。
- G-4：每条记忆都有来源与证据；证据不足、冲突或高风险的内容进入低频审核列表，而不是直接生效或弹窗打断。
- G-5：硬上限控制长期增长：项目 active ≤64 KiB / 300 条、总占用 ≤192 KiB；全局 active ≤8 KiB / 50 条、总占用 ≤24 KiB；revision、审核项、已忘记项都有保留期。
- G-6：超预算时按“置信度 + 使用频率 + 新鲜度 - 陈旧/纠正惩罚”淘汰，固定项豁免；淘汰可恢复、可审计。
- G-7：记忆永远是不可信数据，不参与授权、不绕过审批/锁、不能覆盖安全策略；秘密在写入与注入两侧扫描。
- G-8：同一 Turn 写入的记忆不在本 Turn 注入，避免自我强化；只在下一个 Turn 生效。
- G-9：用户可以随时查看“Larness 记住了什么”、来源与上次使用时间，并编辑、固定、忘记；忘记后不会立刻被重新学回来。
- G-10：上下文注入有固定预算（≤2,000 token），不随记忆总量线性增长；不破坏 prompt 缓存稳定性。
- G-11：用命中率、纠正率、淘汰量、注入 token 与重复纠正次数评估是否真的“更懂”，而不是只凭感觉。

## 3. 非目标

- NG-1：不做逐条确认队列；审核只用于证据不足、冲突、决策类或高风险内容。
- NG-2：不做全量对话记忆、向量库、embedding 或原生依赖；v1 只用 key、kind、证据与关键词。
- NG-3：不自动推断敏感属性（健康、政治、宗教、性取向等），不建立“人格画像”。
- NG-4：不把项目路径、代码、客户数据、秘密写入全局偏好。
- NG-5：不改变工具授权、审批策略、项目锁、资源授权或 Turn 状态机；记忆不能授予权限。
- NG-6：不默认往用户仓库写记忆文件；主存储在 Larness 数据库。
- NG-7：不重做项目设置页视觉；只增加指令来源、记忆与偏好管理区域。
- NG-8：v1 不支持指令文件递归层级、`@import`、远程 URL 或多文件通配；只读固定两个路径。
- NG-9：不保留无限 revision 或无限审核历史；旧版本、已拒绝、已过期项按保留期清理。
- NG-10：不做跨设备同步、云备份或多人共享记忆。
- NG-11：不把会话摘要/检查点改造成长期记忆；两者继续独立。

## 4. 用户故事

- 作为项目维护者，我希望仓库里的 `AGENTS.md` 自动生效，而不是每个新会话重新粘贴构建与测试约定。
- 作为长期使用同一项目的用户，我希望 Agent 自动记住“测试先启动数据库”“这个目录是生成物不能改”，而不是每次重新踩坑。
- 作为用户，我希望 Agent 记住我的跨项目偏好，比如常用包管理器、回答风格、提交习惯，而不需要我反复提醒。
- 作为用户，我不希望每条记忆都弹窗让我确认；我希望它默认生效，只在我说“不对”或主动查看时纠正。
- 作为用户，我希望看到 Larness 记住了什么、为什么记住、最近有没有用到，并能一键忘记。
- 作为安全负责人，我希望记忆不能变成持久化的权限提升或注入通道，秘密不会进入记忆。
- 作为长期用户，我希望记忆数量和上下文成本保持稳定，不随着使用时间无限上涨。

## 5. 验收场景

### A1 指令文件自动加载与合并

```gherkin
Given 项目根目录存在 AGENTS.md
And 存在 .larness/instructions.md
And 项目设置里有人工填写的 instructions
When 新 Turn 装配上下文
Then system prompt 依次包含三个来源的内容并标注来源
And 数据库 instructions 位于最后
And 三者都不能覆盖安全策略
```

### A2 指令文件缺失、不可读或过大

```gherkin
Given 指令文件不存在、不是普通文件、包含二进制内容或超过读取上限
When 装配上下文
Then 该来源被跳过或按上限截断
And 明确记录截断字符数与警告
And Turn 不因指令文件失败而终止
```

### A3 指令文件不能越出项目根目录

```gherkin
Given AGENTS.md 或 .larness/instructions.md 是指向项目根目录之外的符号链接
When 解析指令来源
Then 该文件不被读取
And 返回可见警告
And 不把项目外内容注入上下文
```

### A4 自动学习已验证的项目事实

```gherkin
Given 一个已登记项目
And Agent 在当前 Turn 成功执行了测试命令并看到结果
When Agent 调用 remember 记录测试命令
Then 该记忆直接变为 active，不需要用户确认
And 当前 Turn 不注入该记忆
And 下一个 Turn 的项目记忆索引包含它
And 来源 Turn 与证据类型可追溯
```

### A5 用户查看、纠正与忘记

```gherkin
Given 一条自动学习的 active 记忆
When 用户打开“Larness 记住了什么”
Then 可以看到内容、来源 Turn、证据类型、最后使用时间与置信度
And 可以编辑、固定或忘记
And 忘记后该记忆不再注入
And 90 天内 Agent 不会用相同 key 或相同正文重新学回来
```

### A6 同一 key 的更新不产生重复

```gherkin
Given 已有 key=build.test.command 的 active 记忆
When Agent 用同一 key 记录更新后的命令且证据更新
Then 新内容替换为 active
And 旧内容保留为有界 revision
And 不产生两条同时 active 的记忆
And 索引只出现一次
```

### A7 证据不足或冲突只进入低频审核

```gherkin
Given 一条提议缺少有效证据、置信度低、与现有 active 冲突，或属于决策类
When Agent 调用 remember
Then 该条状态为 review，不进入上下文
And 不弹窗打断当前 Turn
And 在设置页的“待确认”区域可见
And 用户接受后下个 Turn 生效，拒绝后进入抑制列表
```

### A8 跨项目用户偏好

```gherkin
Given 用户在项目 A 明确说“以后都用 pnpm，不要用 npm”
When Agent 调用 remember 记录全局偏好
Then 生成 scope=global、kind=preference 的 active 记忆
And 在项目 B 的会话中也能看到该偏好
And 该偏好不包含项目 A 的路径、代码或业务数据
```

### A9 全局与项目隔离

```gherkin
Given 项目 A 有一条项目事实
When 在项目 B 的会话中装配上下文或调用 read_memory
Then 项目 A 的项目事实不可见
And 只有 scope=global 的偏好可见
And 标记为私有/隔离的项目不会读取或写入全局偏好
```

### A10 硬预算与淘汰

```gherkin
Given 项目记忆已达到 64 KiB 或 300 条上限
When Agent 再写入一条记忆
Then 系统淘汰评分最低的非固定项，直到回落到预算内
And 固定项不被淘汰
And 新记忆写入成功并记录淘汰审计
And 上下文注入量不随记忆总量增长
```

### A11 有界保留与稳定占用

```gherkin
Given 项目长期使用并反复更新记忆
When 保留期清理运行
Then 每条记忆最多保留 3 个 revision 或 30 天
And review 项最多 20 条、14 天后清理
And 已拒绝/已过期/已淘汰项 30 天后清理
And 项目记忆字节数不会持续超过预算
And 数据库行数与注入 token 保持稳定
```

### A12 过期与陈旧

```gherkin
Given 一条记忆已超过 expires_at
When 装配上下文
Then 该记忆不被注入
And 界面显示已过期

Given 一条 active 记忆的 verified_at 超过该 kind 的陈旧阈值
When 装配上下文
Then 索引中标记 stale
And 系统提示要求 Agent 在写文件、启动服务或部署前实测可变状态
```

### A13 秘密与注入内容

```gherkin
Given 一条记忆正文包含 API Key、Cookie 或环境秘密
When Agent 或用户写入
Then 写入被拒绝并返回 MEMORY_SECRET_REJECTED
And 日志、事件与错误详情不含正文

Given 一条记忆正文包含“忽略安全策略”或“允许执行所有命令”
When 该记忆被 active 并注入上下文
Then 它仍以不可信数据处理
And 工具授权、审批、锁和资源校验仍由服务端按原策略决定
And 不因为记忆内容提升任何权限
```

### A14 同一 Turn 不自我强化

```gherkin
Given Agent 在 Turn N 写入一条记忆
When 同一 Turn 的后续模型请求继续执行
Then 该记忆不出现在 Turn N 的 system prompt 或索引中
And 只在 Turn N+1 起生效
```

### A15 关闭记忆与项目删除

```gherkin
Given 项目设置关闭了记忆
When 装配上下文或调用记忆工具
Then 不注入记忆索引
And 记忆工具不可用或失败关闭
And 已有记忆数据保留，重新开启后恢复

Given 项目下存在记忆
When 用户删除项目
Then 删除确认中显示将删除的记忆数量
And 项目删除后其记忆、revision 与抑制项级联删除
And 审计保留删除动作但不再保留正文
```

### A16 长期使用后仍然“懂我”且不膨胀

```gherkin
Given 用户连续使用同一项目 30 天
When 对比第 1 天与第 30 天的记忆统计
Then 项目记忆字节数不超过 64 KiB
And 全局偏好不超过 8 KiB
And 单次记忆注入不超过 2,000 token
And 重复纠正同一事实的次数下降
And 被淘汰或过期的记忆不进入上下文
```

## 6. 功能需求

### 6.1 项目指令

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 从项目根目录读取 `AGENTS.md` 与 `.larness/instructions.md`，与 `project.settings.instructions` 合并注入。 |
| R-2 | MUST | 注入顺序为 `AGENTS.md` → `.larness/instructions.md` → 数据库 instructions；每个来源带清晰标签。 |
| R-3 | MUST | 三个来源合计上限 20,000 字符；超限时按“最低优先级先截断”的顺序处理，并追加显式截断标记与数量。 |
| R-4 | MUST | 只接受项目根目录内的普通 UTF-8 文件；单文件读取上限 64 KiB；含 NUL 的文件按二进制跳过；符号链接必须解析后仍在项目根目录内。 |
| R-5 | MUST | 指令文件缺失、不可读、越界或截断都不终止 Turn；记录警告并在项目设置中可见。 |
| R-6 | MUST | 指令内容按不可信数据处理，明确“不能覆盖安全策略”，不改变工具授权。 |
| R-7 | MUST | 每个 Turn 装配时读取一次；文件变更从下一个 Turn 生效，不引入 watcher。 |
| R-8 | MUST | 项目设置显示检测到的来源、字符数、是否截断、本次解析时间与警告，并提供在文件编辑器中打开。 |

### 6.2 记忆捕获

| ID | 级别 | 需求 |
|---|---|---|
| R-9 | MUST | 新增统一记忆存储，至少包含：scope、projectId、kind、key、title、body、status、confidence、证据类型、来源 Turn/事件、创建者、验证/过期时间、使用次数、最后使用/确认时间、纠正次数、固定标记。 |
| R-10 | MUST | scope 为 `project` 或 `global`；kind 为 `fact|command|gotcha|decision|preference`。`global` 只允许 `preference`。 |
| R-11 | MUST | 提供 `remember` 工具；参数包含 scope、kind、key、title、body、evidence、confidence；证据必须属于当前会话/项目且事件存在；`user_statement` 证据必须带用户在源事件中的原文引用（quote），服务端校验引用是源消息的子串。 |
| R-12 | MUST | 默认自动生效：`project` 的 `fact` / `command` / `gotcha` 在证据有效、无冲突且置信度 ≥0.6 时直接 active；`decision` 默认 review；`global preference` 仅在证据为 `user_statement` 且置信度 ≥0.9 时直接 active。 |
| R-13 | MUST | review 只用于：证据不足、置信度低于阈值、与现有 active 冲突、决策类、全局非用户明确表达、内容命中高风险规则。review 不注入、不弹窗。 |
| R-14 | MUST | 同一 Turn 写入的记忆不在本 Turn 注入；只在下一个 Turn 生效。 |
| R-15 | MUST | 同一 scope + project + key 只允许一条 active；同 key 新证据更新时旧内容转为 superseded，保留有界 revision，并更新 `verified_at` / `last_confirmed_at`；同 key 同正文幂等返回。用户编辑或明确纠正视为 correction：旧版本 `correction_count +1`、confidence 下调，新内容 confidence 设为 0.8；`correction_count` 由同 key 后续版本继承，用于淘汰不稳定记忆。 |
| R-16 | MUST | `global` 记忆不得包含项目路径、代码、客户数据、秘密或项目名；只保存跨项目可复用的偏好/工作习惯。 |
| R-17 | MUST | 用户忘记或拒绝一条记忆时写入抑制项（key 与正文哈希，默认 90 天）；抑制期内相同 key 或相同正文的 `remember` 返回 `MEMORY_SUPPRESSED`，不重新学习。 |
| R-18 | MUST | 每个 Turn 最多自动写入 3 条项目记忆和 1 条全局偏好；超出返回 `MEMORY_RATE_LIMITED`，不写部分数据。 |

### 6.3 预算、淘汰与保留

| ID | 级别 | 需求 |
|---|---|---|
| R-19 | MUST | 硬预算：项目 active ≤64 KiB / 300 条，项目总占用（active + revisions + review + evicted + suppressions）≤192 KiB；全局 active ≤8 KiB / 50 条，全局总占用 ≤24 KiB；单条正文 ≤4,000 字符；key 匹配 `^[a-z0-9][a-z0-9._-]{2,79}$`。 |
| R-20 | MUST | 写入前检查预算；超过 90% 时按顺序处理：先清理超过保留期的 revision/review/evicted，再把 revision 裁到 3 个，最后按评分淘汰非固定 active 到 80%；固定项永不自动淘汰。 |
| R-21 | MUST | 淘汰评分至少包含：置信度、使用次数、最近使用时间、陈旧程度、纠正次数；默认 `score = 2×confidence + 0.15×min(useCount,10) + recency − stale − 0.5×min(correctionCount,4)`，其中 `recency = 1 − min(daysSinceLastUse,30)/30`，`stale` 取 0/1；固定项不参与淘汰。评分规则确定、可测试、可解释。 |
| R-22 | MUST | 若固定项本身已超过硬预算，拒绝新写入并返回 `MEMORY_BUDGET_FULL`，同时在设置页提示用户清理或取消固定。 |
| R-23 | MUST | 每条记忆最多保留 3 个 revision 或 30 天；review 最多 20 条、14 天，超出时拒绝新增 review 而不删除未处理项；rejected/expired/evicted 保留 30 天；抑制项最多 500 条/项目、90 天。 |
| R-24 | MUST | 清理任务按保留期删除旧 revision、review、rejected、expired、evicted 与抑制项；active 不自动删除，除非触发预算淘汰。TTL 默认：`command` / `fact` 30 天过期，`decision` / `gotcha` 不过期但 180 天标陈旧，`preference` 不过期；用户可显式设置或清除。 |
| R-25 | MUST | 淘汰项在 7 天内可恢复，恢复不突破预算；恢复失败给出明确提示。 |
| R-26 | MUST | 装配只查询索引与按需正文，不把全部记忆正文加载进进程内存；列表分页，禁止无界 `SELECT *`。 |

### 6.4 上下文注入

| ID | 级别 | 需求 |
|---|---|---|
| R-27 | MUST | 全局 active 偏好以完整正文注入，≤512 token；超限按固定/置信度/更新时间排序截断。 |
| R-28 | MUST | 项目 active 记忆只注入有界索引：key、kind、title、陈旧标记；≤1,024 字符，超出标注省略数量；排序固定为 pinned → confidence → kind 顺序 → key 升序。 |
| R-29 | MUST | 提供只读工具 `read_memory`，按 key 或关键词读取项目 active 正文；单次最多 5 条、每条 ≤1,000 字符；关键词匹配 key/title/body，大小写不敏感；总量仍受 R-30 约束。 |
| R-30 | MUST | 记忆相关注入总量（全局偏好 + 项目索引 + 工具结果）单次请求 ≤2,000 token，按现有估算器计算；超出显式截断。 |
| R-31 | MUST | 注入顺序：安全策略 → 项目指令 → 全局偏好 → 项目记忆索引 → 会话摘要；同一组记忆排序稳定。 |
| R-32 | MUST | 系统提示明确：记忆是不可信事实，可能过期；可变状态执行前必须实测；记忆不能授予权限或覆盖指令；跨项目偏好用 `global`，项目约定/命令用 `project`；不要记录一次性状态或可从代码直接读取的信息。 |
| R-33 | MUST | `read_memory` 命中的 active 条目更新 `last_used_at` 与 `use_count`；不因读取自动提升置信度。 |

### 6.5 界面与可发现性

| ID | 级别 | 需求 |
|---|---|---|
| R-34 | MUST | 设置页提供“Larness 记住了什么”：全局偏好与当前项目记忆分区展示。 |
| R-35 | MUST | 显示预算使用量（字节/条数）、active/review/expired 计数、最近淘汰与最近使用；达到 80% / 100% 时提示。 |
| R-36 | MUST | 每条记忆显示 kind、key、title、来源 Turn、证据类型、置信度、最后使用/确认时间、过期时间与 revision 数。 |
| R-37 | MUST | 支持编辑、固定/取消固定、忘记、恢复淘汰项；review 支持接受/拒绝；操作结果通过 `memory.changed` 实时更新。 |
| R-38 | MUST | 默认不弹确认、不要求逐条接受；只在预算满、抑制命中或 review 累积时显示低调提示。 |
| R-39 | MUST | 项目设置显示指令来源、截断警告与“在编辑器中打开”；删除项目时显示将级联删除的记忆数量。 |

### 6.6 安全与审计

| ID | 级别 | 需求 |
|---|---|---|
| R-40 | MUST | 证据校验：`command` 必须来自当前 Turn 的成功命令；`preference` 的全局写入必须来自用户明确表达，并用 quote 校验原文；`gotcha` 必须有失败后修复的证据；`fact` 必须来自文件/命令观察。 |
| R-41 | MUST | 内容策略：拒绝秘密、凭据、Cookie、绝对家目录路径、带 Token 的 URL、命令式安全指令；全局偏好额外拒绝项目路径、代码、项目名与业务数据。 |
| R-42 | MUST | 记忆正文在写入与注入前都经过秘密扫描；命中即拒绝或排除，错误与日志不含正文。 |
| R-43 | MUST | 记忆永远不参与授权判定；工具可用性、审批、锁与资源校验仍按服务端原策略。 |
| R-44 | MUST | 项目记忆严格按 projectId 隔离；全局偏好只允许 `preference`；不存在跨项目项目事实查询。 |
| R-45 | MUST | 审计覆盖 `memory.learned/updated/reviewed/forgotten/evicted/restored/purged`；日志只记录 id、scope、项目、动作、字节数，不记录正文。 |
| R-46 | MUST | `remember` 的工具事件只保存 memoryId、scope、kind、key 与字节数，不复制 body；`read_memory` 结果可进入对话事件用于重放，但不进入日志/审计，且注入前已扫描秘密。 |
| R-47 | MUST | 记忆关闭时工具不可用或失败关闭，装配不注入；关闭不删除数据。 |

## 7. 接口与契约变更

### 7.1 REST

新增（均要求现有认证、CSRF 与项目作用域）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/projects/:id/instructions` | 返回指令来源、字符数、截断/警告、本次解析时间。 |
| `GET` | `/api/projects/:id/memories?status=&kind=&q=&limit=&offset=` | 分页列表；默认 `status=active`；只返回该项目记忆。 |
| `GET` | `/api/memories/global?status=&kind=&limit=&offset=` | 全局偏好列表；只返回 `preference`。 |
| `PATCH` | `/api/projects/:id/memories/:memoryId` | 编辑 title/body/expiresAt、固定/取消固定；`status` 只允许 `review → active` 或 `review → rejected`；需 `expectedUpdatedAt`。 |
| `DELETE` | `/api/projects/:id/memories/:memoryId` | 忘记单条记忆（硬删除）并写抑制项；对 review 项等价于拒绝。 |
| `POST` | `/api/projects/:id/memories/:memoryId/restore` | 恢复 7 天内的淘汰项。 |
| `PATCH` | `/api/memories/global/:memoryId` | 全局偏好的编辑、固定、review 接受；需 `expectedUpdatedAt`。 |
| `DELETE` | `/api/memories/global/:memoryId` | 忘记全局偏好并写抑制项。 |
| `POST` | `/api/memories/global/:memoryId/restore` | 恢复淘汰的全局偏好。 |
| `GET` | `/api/projects/:id/memories/budget` | 预算使用量、淘汰/清理统计。 |

- 列表响应包含 `stale` 派生字段、`expiresAt`、`sourceTurnId`、`evidenceKind`、`confidence`、`useCount`、`lastUsedAt`。
- 所有 PATCH/DELETE 需 `expectedUpdatedAt` 防并发覆盖；冲突复用 `VERSION_CONFLICT`。
- 错误码新增：`MEMORY_NOT_FOUND`、`MEMORY_BUDGET_FULL`、`MEMORY_SECRET_REJECTED`、`MEMORY_SUPPRESSED`、`MEMORY_RATE_LIMITED`、`MEMORY_INVALID_EVIDENCE`、`MEMORY_SCOPE_FORBIDDEN`、`MEMORY_DISABLED`。同步 `docs/contracts/rest-api.md`。

### 7.2 WebSocket

新增 `memory.changed`：

```json
{
  "type": "memory.changed",
  "scope": "project|global",
  "projectId": "prj_...",
  "memoryId": "mem_...",
  "action": "learned|updated|reviewed|forgotten|evicted|restored|purged",
  "status": "active|review|rejected|superseded|expired|evicted"
}
```

只广播给已认证且有权访问该项目的客户端；不包含正文。同步 `docs/contracts/ws-events.md`。

### 7.3 Agent 工具

新增 `memory` tool pack：

- `remember({ scope, kind, key, title, body, evidence, confidence? })`：按证据与策略决定 active 或 review；返回 `{ memoryId, status }`。
- `read_memory({ keys?, query?, limit? })`：只读项目 active；返回条目、来源、证据、使用/过期时间与陈旧标记。

两个工具都 `requiresProject: true`。`memory` pack 加入 `coding` 与 `plan` Profile；关闭记忆时移除。按 [051 工具执行契约](../051-agent-tool-contract/spec.md) 同步工具描述、模型 schema、system prompt、界面提示与正反例。

### 7.4 配置

- `agent.memory.enabled`（默认 `true`）。
- 项目设置新增 `memory.enabled`（默认 `true`）与 `memory.globalEnabled`（默认 `true`；关闭后不读写全局偏好）。
- 预算默认放在模块常量：项目 64 KiB / 300 条、全局 8 KiB / 50 条、索引 1,024 字符、注入 2,000 token、每 Turn 3 条项目 + 1 条全局、revision 3 个 / 30 天。
- 配置变更同步 `packages/shared/src/config.ts` 与配置文档。

### 7.5 Prompt

- `PROMPT_VERSION` 从当前值 bump 一次，记录原因“项目指令来源 + 全局偏好 + 项目记忆索引”。
- 系统提示新增：何时调用 `remember`、何时不调用、记忆不可信、可变状态先实测、忘记后不要重学。

## 8. 数据与迁移

新增三张表（实际迁移 `0036`）：

```sql
memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('project','global')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact','command','gotcha','decision','preference')),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','review','superseded','expired','evicted','rejected')),
  confidence REAL NOT NULL,
  evidence_kind TEXT NOT NULL,
  source_turn_id TEXT,
  source_event_seq INTEGER,
  created_by TEXT NOT NULL CHECK (created_by IN ('agent','user')),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  last_confirmed_at INTEGER,
  correction_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  verified_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((scope = 'global' AND project_id IS NULL AND kind = 'preference') OR (scope = 'project' AND project_id IS NOT NULL))
)

memory_revisions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  changed_by TEXT NOT NULL CHECK (changed_by IN ('agent','user','system')),
  changed_at INTEGER NOT NULL,
  reason TEXT
)

memory_suppressions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
)
```

- 索引 / 约束：`UNIQUE INDEX ... ON memories(scope, project_key, key) WHERE status = 'active'`；`(scope, project_id, status)`；`(expires_at)`；`UNIQUE(memory_id, revision)`；`(project_id, expires_at)`。
- `bytes` 按 key + title + body 的 UTF-8 字节计算；预算统计包含 active、revision、review、evicted 与 suppression。
- 迁移只新增表与索引，不改动现有列；旧数据无记忆时行为与现状一致。
- 时间统一 Unix 毫秒（UTC）；ID 使用 `mem_` / `mrev_` / `msup_` 前缀加 `crypto.randomUUID()`；所有 REST、工具与配置输入用 Zod 校验。
- 回滚：关闭 `agent.memory.enabled` 与项目开关即可停止注入与工具；需要彻底回滚时删除三张新表。
- 保留与备份：记忆属于用户数据，沿用升级前数据库备份；清理只删除 revision、review、rejected、expired、evicted 与抑制项，active 仅按预算淘汰。

## 9. 安全、权限与审计

- **身份与授权**：所有 REST 走现有会话、CSRF 与项目作用域；Agent 工具沿用 Turn 身份与审批策略。
- **自动写入不是审批绕过**：`remember` 只写本地记忆，不执行外部副作用；它不改变任何工具权限。[ADR-050](../../docs/adr/ADR-050-pm2-cli-deployment.md) 的自主执行不受影响。
- **证据优先**：没有有效证据不自动生效；证据由服务端校验，不信任模型自述。
- **秘密处理**：写入与注入双向扫描；命中即拒绝或排除；日志、事件、错误不含正文。
- **Prompt injection**：记忆正文按不可信数据处理；即使包含指令性文本，也不能改变工具 schema、授权、审批、锁或资源范围；同一 Turn 写入不在本 Turn 注入。
- **项目隔离**：项目记忆强制 `project_id`；全局只允许 `preference` 且拒绝项目数据；私有项目可关闭全局偏好读写。
- **审计**：`memory.learned`、`memory.updated`、`memory.reviewed`、`memory.forgotten`、`memory.evicted`、`memory.restored`、`memory.purged`；记录 actor、scope、projectId、memoryId、动作、字节数，不记录正文。
- **失败关闭**：证据校验失败、秘密扫描失败、作用域非法或预算无法满足时，不写入、不注入；记忆读取失败时本次 Turn 不带记忆继续，并记录警告。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 指令文件不存在 | 跳过该来源，继续装配 | 项目设置显示“未检测到” |
| 指令文件过大 | 按优先级截断并标注数量 | 截断警告与字符数 |
| 指令文件是越界符号链接 | 不读取，继续装配 | 来源警告 |
| 记忆证据无效 | 不自动生效；写入 review 或拒绝 | 审核项说明“证据不足” |
| 记忆命中秘密 | 拒绝写入 | “包含疑似秘密，未保存” |
| 同 key 冲突 | 新内容更新 active，旧内容保留为 revision；证据不足则 review | 版本对比与来源 |
| 预算达到 90% | 淘汰最低分非固定项 | “已清理 N 条低频记忆” |
| 固定项超预算 | 拒绝新写入 | “固定项已占满预算，请取消固定或清理” |
| review 累积 | 不弹窗；设置页低调提示 | 待确认角标 |
| 用户忘记 | 写抑制项，立即停止注入 | “已忘记，不会再学习这条” |
| 抑制命中 | 拒绝重新学习 | “你之前忘记过这条” |
| revision/保留期到期 | 清理旧数据，active 不受影响 | 可在活动记录中查看 |
| 并发编辑 | `expectedUpdatedAt` 不匹配返回 409 | “已被其他窗口修改，请刷新” |
| 项目删除 | 级联删除记忆、revision、抑制项 | 删除前显示数量 |
| 记忆关闭 | 不注入、工具不可用，数据保留 | 设置页说明 |

## 11. 可观测性

- 日志：指令来源/字符数/截断；记忆 learned/review/forgotten/evicted/restored/purged 的 scope、kind、字节数；注入条数与 token。**不记录正文。**
- 指标 / 状态：项目/全局 active 字节与条数、项目/全局总占用、预算使用率、review 数、淘汰/恢复数、`read_memory` 调用次数、命中率、陈旧命中、纠正次数、重复纠正同一 key 的次数。
- 诊断入口：设置页预算条与活动记录；Turn 过程详情显示本次注入条数与 token；`doctor` 可选输出预算摘要（不含正文）。
- 成功标准（用于验收评估，不单列为硬门禁）：30 天使用后记忆不超预算；重复纠正同一事实的次数下降；注入 token 稳定；用户主动“忘记”的比例不持续上升。

## 12. 测试计划

- 单元：
  - 指令解析：顺序、合并、20k 截断优先级、64 KiB、二进制、缺失/不可读、symlink 越界。
  - 记忆状态机：active/review/rejected/superseded/expired/evicted 的合法与非法转移。
  - 证据校验、scope/kind 矩阵、置信度阈值、同 key 更新、抑制项、幂等与限流。
  - 预算与淘汰：项目 active 64 KiB/300、总占用 192 KiB；全局 active 8 KiB/50、总占用 24 KiB；评分顺序、固定项、恢复、保留期清理。
  - 注入：全局偏好上限、项目索引上限、`read_memory` 上限、总 token、稳定排序、同 Turn 隔离。
  - 秘密与内容策略。
- 集成：
  - 成功命令后自动学习；下个 Turn 索引出现；当前 Turn 不出现。
  - 更新同 key 不产生重复；冲突进入 review；用户接受/拒绝/忘记/恢复。
  - 全局偏好跨项目可见；项目事实不可见；私有项目关闭全局。
  - 预算淘汰、固定项超预算、清理后行数与字节稳定。
  - 项目删除级联；关闭记忆。
  - 指令文件顺序与越界链接。
- E2E：
  - 带 `AGENTS.md` 的项目新建会话，Agent 使用其中的测试命令。
  - 执行一次测试 → 自动学习 → 新会话直接复用，不再询问。
  - 用户说“以后用 pnpm” → 另一项目生效。
  - 设置页查看、编辑、固定、忘记；忘记后不重新学习。
- 安全：
  - 秘密写入被拒且日志/事件无正文。
  - 无效证据、跨项目、私有项目、注入文本均失败关闭。
  - 记忆不能启用禁用工具或绕过审批。
- 手动 / 视觉：
  - 设置页预算条、活动记录、review 提示；长任务中陈旧记忆的实测提示。

## 13. 已确认决策

> 2026-11-20 人类确认按推荐默认实施；决策见 [ADR-072](../../docs/adr/ADR-072-project-memory.md)（accepted）。D1–D11 依次对应 Q-060～Q-070。

| ID | 决策 |
|---|---|
| Q-060 | 仅自动加载 `AGENTS.md` 与 `.larness/instructions.md`；不读 `CLAUDE.md`/`.cursor/rules`。 |
| Q-061 | 注入顺序 AGENTS → .larness → DB；超 20k 时先截断 AGENTS，最后截断 DB；显式标记。 |
| Q-062 | 项目 `fact`/`command`/`gotcha` 有证据且置信度 ≥0.6 即 active；`decision` 默认 review；全局 `preference` 仅用户明确表达且置信度 ≥0.9 时 active。 |
| Q-063 | v1 全局偏好只从用户明确表达学习；跨项目重复推断留到有评测数据后。 |
| Q-064 | 项目 active 64 KiB / 300 条、总占用 192 KiB；全局 active 8 KiB / 50 条、总占用 24 KiB；索引 1,024 字符；注入 2,000 token；每 Turn 3+1 条；revision 3 个 / 30 天；读正文 5 条 × 1,000 字符；评分按 R-21。 |
| Q-065 | command/fact 30 天；decision/gotcha 180 天标陈旧；review 14 天；rejected/expired/evicted 30 天；抑制 90 天。 |
| Q-066 | 全局偏好完整注入（≤512 token）+ 项目索引（≤1,024 字符）+ 正文按需读取。 |
| Q-067 | 删除项目时级联删除记忆、revision、抑制项，确认框显示数量。 |
| Q-068 | v1 不做额外 LLM 整理，依赖 Agent 主动 `remember` + 指标评估；覆盖率不足再加批处理 curator。 |
| Q-069 | 全局偏好放在 086，独立任务 PM-4；schema 从一开始带 `scope`。 |
| Q-070 | 淘汰项 7 天内可恢复；私有项目关闭全局偏好读写，但仍可读写项目记忆。 |

无未决事项。

## 14. 完成定义

- [ ] A1–A16 全部通过；
- [ ] 单元、集成、安全、E2E 与手动视觉验证有记录；
- [ ] 30 天模拟/加速测试证明预算、保留期与注入量稳定；
- [ ] `pnpm check` / `pnpm build` 通过，定向测试与工具契约矩阵通过；
- [ ] REST、WS、数据模型、配置与错误码契约已同步；
- [ ] ADR 已 accepted，记录自动学习、证据、预算与隐私边界；
- [ ] ROADMAP、STATUS、任务卡与验收记录已更新；
- [ ] 人类评审通过。
