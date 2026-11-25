# STATUS

> 最后更新：2026-11-25
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- 无。

## 阻塞与待确认

- **实机验收证据边界（082/083）**：082 已按限定范围验收通过，但真实 Provider A/B、Windows 实机与 083 用户现有 PM2/旧命令数据未在本次环境复跑；不得据此声称这些场景已验证。
- **M5-F2 Ubuntu 实机验证**：Ubuntu 22.04 / 24.04 尚未实机验证；完成后由 M5-F3 更新支持矩阵，未验证前不标支持。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-25 | 091 跨 Turn 工具结果回放 + 084 用量口径（用户直接要求） | L0 只读工具成功结果落内部 `tool.replay`（redact + ≤16k 字符，不广播，公开事件列表过滤）；`contextAssembler` 按 `clamp(window×0.05, 2k, 32k)` tokens 回放最近结果，超预算折叠为标识符、更老省略并在当前请求说明；裁剪时连同孤立 tool 消息丢弃，保持 call/result 配对；回放内容标注可能过期。用量行改为 `本轮 32k / 1M · 3% · 会话 1.24M`，Hint 同时给「本轮请求输入」与「会话累计输入」。server 175 文件 / 936 项（31 跳过）、web 54 文件 / 312 项、`pnpm build` 通过；`pnpm check` 退出码 1 仅因已知 `terminals.test.ts` 原生 worker 崩溃；E2E、真实 Provider 长会话 A/B 未跑 | [091](specs/091-cross-turn-tool-replay/tasks.md) |
| 2026-11-25 | 084 输入框底部重排（用户直接要求） | 上下文占用圆环及其 tokens / 百分比并入输入框下方用量行右侧（`ContextUsage` 迁入 `SessionUsageLine`；未知仍为空环 +「暂无统计」，比例钳制 0–100%）；草稿会话、Mock 与用量查询未启用时只显示上下文信息；附件按钮移到原圆球位置（发送 / 停止左侧），工具栏左侧不再重复。`SessionUsageLine` 10 项、`Composer` 7 项、web 54 文件 / 311 项、`typecheck`、改动文件 `biome check` 通过；E2E 与浏览器视觉验收未跑 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md) |
| 2026-11-25 | 074 成果区修订（用户直接要求） | 成果区文件卡片最多直接显示 3 张（`RESULT_FILE_LIMIT`），其余收进无边框「展开全部 / 收起」文本按钮；预览 / 终端入口不计入上限；删除 `ProcessFilesRow`，不再显示「过程文件 N 个 · 已清理 N 个」计数行，过程文件仍可在展开的「执行过程」查看。服务端 `fileResults` 分类、200 条上限与「另有 N 个文件未列出」提示不变。`Timeline.test.tsx` 29 项、`pnpm --filter @larness/web typecheck`、`biome check` 改动文件通过；E2E 与浏览器视觉验收未跑 | [074 tasks](specs/074-result-presentation/tasks.md#修订成果区只留关键几个取消过程文件行2026-11-25用户直接要求) |
| 2026-11-24 | 090 Provider 失败重试、诊断与标题超时（PR-1～PR-4） | 步骤级重试：模型步骤在**零产出**时对 `PROVIDER_UNAVAILABLE` / `PROVIDER_RATE_LIMITED` / 5xx 或无状态码的 `PROVIDER_UNKNOWN` 重试最多 2 次（1s/2s 退避，单次 >60s 或剩余预算不足不重试），有 text/reasoning/tool-call 一律不重试；主回合 `maxRetries` 1→2；`ProviderError.statusCode` 进 `provider step retry` / `provider step failed` warn；标题超时 20s→60s、`maxRetries: 0` 并记录 timeout / provider_error / empty_text（含 `finishReason`、`sawReasoning`）；压缩显式 `maxRetries: 1`。`pnpm check`（2 workers）server 175 文件 / 935 项通过、31 跳过；`pnpm build`、E2E 与真实 Provider 抖动未运行 | [090 tasks](specs/090-provider-retry/tasks.md#验收记录2026-11-24macos) |
| 2026-11-24 | 089 会话级前缀缓存（PA-1～PA-7） | 易变上下文（日期、联网策略、记忆索引、会话摘要、附件声明）移出 system，合并进当前 user 消息，system 只留 `PROMPT_VERSION=089-1` + 策略 + 项目指令；`model.usage` 增 `promptVersion`/`systemHash`/`instructionsHash`/`toolsetHash`/`prefixBreak`/`prefixBreakAt`/`prefixKeptTokens`/`firstHistorySeq`，REST `cache.breaks` 按原因分组；会话压缩阈值 0.7（低于装配预算 0.8，修掉不可达死代码），裁剪改为 0.8 触发 / 0.6 低水位并按 4 条一块取整，`HISTORY_SCAN_LIMIT` 截断置位；附件三件套常驻、联网工具只由显式开关决定。`pnpm check`（2 workers）server 173 文件 / 923 项 + `pnpm build` 通过；A9 真实 Provider 基线与 E2E 未运行，见 acceptance | [089 acceptance](specs/089-session-prefix-cache/acceptance.md) |
| 2026-11-24 | 088 附件多视图与验收（DA-10/DA-11/DA-13） | `text`/`source` 双视图落地：`@larness/shared/attachments.ts` 统一白名单与凭据拒绝（Composer `accept` 与服务端嗅探共用）；`source` 视图按行分页、`line:N`/`offset:N`、超长单行退化字符窗口；`read_attachment` 增加 `view`/`line`/`nextAnchor`，`search_attachment` 支持跨附件与 `scope`，`list_attachments` 返回 `views`；文本类附件默认按原文注入/检索，超预算只注入大纲；HTML 保留 `<style>`、id/class 大纲与表格；预览增加“解析视图 / 原文”切换。`pnpm check` 通过（server 172 文件 / 899 项、31 跳过；web 54 文件 / 306 项）；**2026-11-24 人类实机验收通过**（原文预览与端到端附件链路），spec 转 `done`；未跑 `pnpm build`，逐项未验证内容见 acceptance §4 | [088 acceptance](specs/088-document-attachments/acceptance.md) |
| 2026-11-24 | 088 文档与图片附件 | DA-0～DA-9 完成；迁移 0038、通用上传/去重/删除、PDF/DOCX/PPTX/XLSX/HTML/CSV 抽取、图片透传与本地 OCR、上下文预算与三个附件工具、草稿托盘；DA-9 把输入区与时间线附件统一为“图标 + 文件名”标签并移到气泡下方，宽度随文件名自适应、图标复用文件目录的 Material 图标，标签两端图标内边距对称（左 `pl-2`、右 `pr-1.5` + 尾部 `p-0.5`），修复 `attachmentIds` 被当作旧截图重复渲染成破图；附件标签与产物标签共用 `chip.ts` 的 `h-7`/`rounded-full`/`text-[11px]`；`Toast` 改为 portal 到 body 级提示层（`top-14` + `z-[360]`，弹窗内由 `DialogContent` 的 `ToastHost` 承载），并让复用旧层节点时重写类名（否则 `top-4` 时期的残留层会继续被顶栏遮挡），修复附件超限报错被顶栏遮挡；`pnpm check` 与根 `pnpm build` 通过，`pnpm --filter @larness/web test` 53 文件 / 303 项通过；解析未进 worker（Q-077）、视觉连接未接线（Q-078）、真实文件与 Mock E2E 未跑 | [088 acceptance](specs/088-document-attachments/acceptance.md) |
| 2026-11-20 | GX-5 子目录项目 Git 路径基准 | 项目根为仓库子目录时暂存 / 取消暂存失败、diff 白屏；按 `--show-prefix` 折回项目相对路径并过滤项目外条目，DiffView 增加空差异说明；Git 套件 17 项通过（2 项跳过） | [078 tasks](specs/078-git-workflow/tasks.md) |
| 2026-11-23 | GX-6 未跟踪差异与 Git 失败原因 | 未跟踪文件用 `git diff --no-index` 与空基准比对，不再白屏；execute 失败保留 `GIT_CONFLICT` 等稳定码并审计，Git 面板区分写锁占用 / 快照变化 / 超时；`pnpm check` 通过（Server 836 项、31 跳过） | [078 tasks](specs/078-git-workflow/tasks.md) |
| 2026-11-23 | 088 DA-0 规格确认与 ADR-074 | 人类批准方案、气泡外附件布局与 Q-071～Q-076 全部推荐默认；格式矩阵、`auto-local` 只本地 OCR、限额、Base64 上传与纯 JS 依赖冻结；spec 转 `ready`、ADR-074 转 accepted；仅文档变更，未运行 `pnpm check` | [088 tasks](specs/088-document-attachments/tasks.md#da-0-规格确认2026-11-23) |

> 更早的收口记录（含同日其余 K-5、K-4、MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

## 交付基线

- 最新发布 `0.3.0`（2026-11-16，npm `latest`）；tag `v0.3.0` 已在 `origin/main` 上（2026-11-16 推送）。
- 迁移至 `0038`（schemaVersion 38）。

## 维护记录（已收口）

- **依赖维护**：DEPS-1～DEPS-7 于 2026-11-09 完成（工具链升级、16 个直接依赖、pnpm 固定 10.34.9、Node 22 / 24 双线验证）。明细见归档。
- **文档整理**：DOCS-1～DOCS-4 于 2026-11-08～09 完成（规格导航、Node 支持口径、文档对齐、npm 更新安全）。明细见归档。

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `done` | G-S0 通过（2026-11-01）；`D0-1`–`D0-9` 完成 |
| M0 | 工程底座与可信启动 | `done` | 2026-11-01 G0 通过（macOS 范围）；M0-1 ~ M0-9 完成 |
| M1 | 项目、会话与最小 Agent | `done` | G1 通过（2026-11-01 人类验收）；M1-1 ~ M1-15 完成 |
| M2 | 开发资源与窗口层 | `done` | G2 于 2026-11-05 通过人类统一验收（macOS 范围） |
| M3 | 开发服务与隔离预览 | `done` | G3 人类验收通过（2026-11-05）；M3-0～M3-6 完成 |
| M4 | 持久运行与版本发布 | `done` | 2026-11-07 用户验收 G4 与 M4-R0～R4，见 [M4 收尾](specs/050-deploy/closure.md) |
| M5 | 多模型、自动化与更新 | `done` | M5-1a–e / M5-2 / M5-3 / M5-4 / M5-5 `done`；G5 条件通过（2026-11-08） |
| M6 | 运行时效率与 Turn 恢复 | `done` | 070（HX）与 071（TR）于 2026-11-12 收口；HX-12b 于 2026-11-18 按用户决定废弃 |
| 切片 | 068 / 072 / 073 / 074 / 076 / 077 / 078 / 081 / 082 / 083 / 084 / 088 | `done` | UI 修复、错误预算、上下文预算、成果呈现、文件浏览、模型连接、Git 工作流、Agent 内核重构、项目服务与 service-ops、Agent Profile 收敛与用量、文档与图片附件 |
