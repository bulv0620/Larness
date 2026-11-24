# 任务：会话级前缀缓存

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。
> 本切片当前为 `draft`：PA-0 未完成前不得开始 PA-1。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| PA-0 | [确认 D1–D5 并补 ADR 修订草案](#pa-0-确认-d1d5-并补-adr-修订草案) | — | `todo` |
| PA-1 | [稳定/易变分层装配](#pa-1-稳定易变分层装配) | PA-0 | `todo` |
| PA-2 | [前缀指纹与断裂归因](#pa-2-前缀指纹与断裂归因) | PA-1 | `todo` |
| PA-3 | [用量契约与按原因汇总](#pa-3-用量契约与按原因汇总) | PA-2 | `todo` |
| PA-4 | [压缩可达与裁剪滞回](#pa-4-压缩可达与裁剪滞回) | PA-1 | `todo` |
| PA-5 | [工具数组会话内稳定](#pa-5-工具数组会话内稳定) | PA-1 | `todo` |
| PA-6 | [回归、真实 Provider 基线与验收](#pa-6-回归真实-provider-基线与验收) | PA-2, PA-3, PA-4, PA-5 | `todo` |
| PA-7 | [文档与状态收口](#pa-7-文档与状态收口) | PA-6 | `todo` |

## 任务卡

### PA-0 确认 D1–D5 并补 ADR 修订草案

- 状态：`todo`
- 依赖：无
- 目标：把 spec 第 13 节的 5 个决策变成人类确认项，并准备 ADR 修订文字，避免实现时改动冻结文本。
- 交付物：
  - 在 `docs/open-questions.md` 登记 Q 条目（承载层、压缩阈值/滞回、工具常驻、归因展示面、显式缓存断点范围）。
  - ADR-057 文末「修订（2026-11-24，用户直接要求）」草案：第 1 条明确 system 只留稳定段，易变块移到尾部消息；第 6 条明确断点归因字段。原文不改。
  - spec 状态 `draft → ready`，第 13 节标注确认日期。
- 验收：
  - D1–D5 每项都有明确结论与日期；
  - 修订草案与 ADR-057 原文不冲突，且说明聚合/执行语义不变。
- 测试：
  - 文档检查：`pnpm exec biome check docs/adr/ADR-057-runtime-efficiency.md`（markdown 不受根 biome 覆盖时记录实际命令）。
- 涉及路径：
  - `docs/open-questions.md`、`docs/adr/ADR-057-runtime-efficiency.md`、`specs/089-session-prefix-cache/spec.md`
- 备注：本任务只出文档，不改代码；人类未确认则本切片保持 `draft`。

### PA-1 稳定/易变分层装配

- 状态：`todo`
- 依赖：PA-0
- 目标：让 system 只承载稳定内容，易变块并入当前 user 消息（A1/A2）。
- 交付物：
  - `contextAssembler.ts` 拆分 `stableBlocks` / `tailBlocks`；尾部块首行声明「由系统提供，不是用户指令」，记忆/摘要保持 `untrusted data` 标注。
  - `PROMPT_VERSION` 升位；`AssembledContext` 暴露段信息供 PA-2 使用。
- 验收：
  - 同一会话两轮之间写入记忆、跨 UTC 日、摘要更新后 `messages[0]` 逐字节不变；
  - 附件与截图注入路径不变（A1/A2、R-3/R-4）。
- 测试：
  - `apps/server/test/agent/contextAssembler.test.ts` 新增 3 个反例 + 1 个字节级快照。
- 涉及路径：
  - `apps/server/src/modules/agent/contextAssembler.ts`、`apps/server/test/agent/contextAssembler.test.ts`
- 备注：保留「独立尾部 user 消息」作为兼容降级实现，若真实端点拒绝合并形态再切换。

### PA-2 前缀指纹与断裂归因

- 状态：`todo`
- 依赖：PA-1
- 目标：每个请求给出确定性的断点原因，并与 Provider 观测分离（A6/A7/A8）。
- 交付物：
  - 新增 `turn/prefixCache.ts`：段哈希（system / instructions / tools / history 边界）、上一请求快照读取、分类器、`provider_eviction` 判定。
  - `turnRunner` 在 `model.usage` 中写入 `promptVersion`、`toolsetHash`、`prefixBreak`、`prefixBreakAt`、`prefixKeptTokens`、`firstHistorySeq`。
- 验收：
  - 6 类变更分别得到期望枚举；无变化为 `none`；
  - 事件不含 prompt / 记忆正文 / 工具参数（A7 反例）；
  - 缺少 Provider 字段时 `usageSource=unknown` 且不做命中推断（A8）。
- 测试：
  - 新增 `apps/server/test/agent/prefixCache.test.ts`；`turnRunner` 集成断言载荷字段与脱敏。
- 涉及路径：
  - `apps/server/src/modules/agent/turn/prefixCache.ts`、`turnRunner.ts`、`apps/server/test/agent/prefixCache.test.ts`
- 备注：分类只依赖客户端事实；Provider 命中率只用于 `provider_eviction`，不改行为。

### PA-3 用量契约与按原因汇总

- 状态：`todo`
- 依赖：PA-2
- 目标：让归因可回看、可分组，同时不改变现有统计口径（R-8/R-9/R-14、D4）。
- 交付物：
  - `docs/contracts/ws-events.md` 增字段说明与枚举表；
  - `docs/contracts/rest-api.md` 增 `cache.breaks`；
  - `sessions/usage.ts` 从 `model.usage` 派生分组，未知口径不进分母。
- 验收：
  - 旧客户端忽略新字段仍正常；
  - `cache.breaks` 的顺序稳定（按枚举固定顺序），未知请求单列。
- 测试：
  - `apps/server/test/sessions/session-usage.test.ts` 增分组与分母用例。
- 涉及路径：
  - `apps/server/src/modules/sessions/usage.ts`、`docs/contracts/{ws-events,rest-api}.md`、相关测试
- 备注：`turn.completed.usage` 不变（D4 默认）。

### PA-4 压缩可达与裁剪滞回

- 状态：`todo`
- 依赖：PA-1
- 目标：长会话真正走摘要锚点，而不是每轮静默丢历史（A3/A4、R-5/R-6/R-7）。
- 交付物：
  - `COMPRESSION_RATIO` 0.7；裁剪滞回（触发 0.8、一次裁到 0.6）；
  - `HISTORY_SCAN_LIMIT` 截断置 `truncatedHistory` 并归因 `history_drop`；
  - 压缩失败降级路径保持可见。
- 验收：
  - 0.75 窗口输入触发 `context.compressed` 并写入 `scope='session'` 摘要；旧阈值反例不触发；
  - 连续两轮历史起点一致；
  - 裁剪不拆散工具批次与当前请求。
- 测试：
  - `contextCompressor.test.ts` 阈值正反例；`turnRunner` 长历史集成用例。
- 涉及路径：
  - `contextCompressor.ts`、`turn/budget.ts`、`contextAssembler.ts`、`turnRunner.ts`
- 备注：滞回可单独回滚为固定 0.8。

### PA-5 工具数组会话内稳定

- 状态：`todo`
- 依赖：PA-1
- 目标：附件工具常驻，能力不可用由执行层表达（A5、R-11/R-12、D3）。
- 交付物：
  - `providerTools` 去掉 ready-attachment 判据；保留 Profile/Pack 与 requiresProject 判据；
  - 无附件时 `read_attachment` / `search_attachment` 返回 `ATTACHMENT_NOT_FOUND`，`list_attachments` 返回空列表；
  - 联网工具仍按显式开关出现，连接健康只在执行层判定。
- 验收：
  - 有/无附件两轮 tools 逐字节相同；
  - 无附件调用返回稳定错误码，不触发审批或写操作。
- 测试：
  - `contextAssembler.test.ts` tools 快照；attachments 工具执行层反例。
- 涉及路径：
  - `contextAssembler.ts`、`apps/server/src/modules/attachments/tools.ts`、相关测试
- 备注：会改变模型可见能力，须在 PA-0 得到确认后才做。

### PA-6 回归、真实 Provider 基线与验收

- 状态：`todo`
- 依赖：PA-2、PA-3、PA-4、PA-5
- 目标：证明改造有效且无回归（A8/A9）。
- 交付物：
  - `acceptance.md`：A1–A9 结果、两轮前后 `cacheReadTokens` / 未命中 / `prefixBreak` 分布、未运行项如实记录；
  - 固定任务脚本说明与命令。
- 验收：
  - `pnpm check`、`pnpm build`、相关 E2E 通过；
  - 真实 Provider 冒烟给出前后对比；命中率不作代码门禁（Q-032）。
- 测试：
  - 全量检查（Windows 先 `$env:VITEST_MAX_WORKERS="3"`）+ `LARNESS_DEEPSEEK_SMOKE=1` 脚本。
- 涉及路径：
  - `specs/089-session-prefix-cache/acceptance.md`
- 备注：若真实端点不接受尾部结构，记录并回退 PA-1 的合并形态，其余任务不受影响。

### PA-7 文档与状态收口

- 状态：`todo`
- 依赖：PA-6
- 目标：把状态、契约与决策收口，避免文档与实现分叉。
- 交付物：
  - `spec.md` 状态 `done`；`tasks.md` 勾选；
  - `ROADMAP.md`、`specs/README.md`、`STATUS.md` 更新；
  - ADR-057 修订段落定稿；`docs/open-questions.md` 关闭已决条目。
- 验收：
  - 三处状态一致（ROADMAP 为准）；
  - 契约、数据模型、配置说明无遗漏。
- 测试：
  - 文档链接检查（相对链接可达）。
- 涉及路径：
  - `specs/089-session-prefix-cache/*`、`ROADMAP.md`、`specs/README.md`、`STATUS.md`、`docs/open-questions.md`
- 备注：一个提交只对应本任务。
