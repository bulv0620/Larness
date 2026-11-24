# STATUS

> 最后更新：2026-11-24
> 规格入口见 [规格与工程入口](specs/README.md)。待决事项和未验证范围见 [遗留问题](docs/open-questions.md)。
> **本文件只记录当前状态**（进行中、阻塞、当前有效基线）。已收口任务的明细不进这里，见 [历史状态日志](docs/log/2026-11.md) 与各切片的 `tasks.md` / `acceptance.md`。

## 当前进行中

- **089 PA-3 用量契约与按原因汇总**（`main`，2026-11-24 开始）：`GET /api/sessions/:id/usage` 增 `cache.breaks`，同步 `ws-events.md` / `rest-api.md`。
- 后续同切片任务 PA-4～PA-7 按 `specs/089-session-prefix-cache/tasks.md` 顺序推进。

## 阻塞与待确认

- **实机验收证据边界（082/083）**：082 已按限定范围验收通过，但真实 Provider A/B、Windows 实机与 083 用户现有 PM2/旧命令数据未在本次环境复跑；不得据此声称这些场景已验证。
- **M5-F2 Ubuntu 实机验证**：Ubuntu 22.04 / 24.04 尚未实机验证；完成后由 M5-F3 更新支持矩阵，未验证前不标支持。
- **TR-3 恢复入口视觉**：已实现，待用户确认。
- **TR-4 删除粒度**：默认保留 `sessions` 行，`deleteSessions=true` 才连会话行一起删；`maxBytes` 仅入配置、未强制淘汰。待用户复核。

## 最近收口（滚动保留最近 10 项）

| 日期 | 任务 | 结果 | 记录 |
|---|---|---|---|
| 2026-11-24 | 088 附件多视图与验收（DA-10/DA-11/DA-13） | `text`/`source` 双视图落地：`@larness/shared/attachments.ts` 统一白名单与凭据拒绝（Composer `accept` 与服务端嗅探共用）；`source` 视图按行分页、`line:N`/`offset:N`、超长单行退化字符窗口；`read_attachment` 增加 `view`/`line`/`nextAnchor`，`search_attachment` 支持跨附件与 `scope`，`list_attachments` 返回 `views`；文本类附件默认按原文注入/检索，超预算只注入大纲；HTML 保留 `<style>`、id/class 大纲与表格；预览增加“解析视图 / 原文”切换。`pnpm check` 通过（server 172 文件 / 899 项、31 跳过；web 54 文件 / 306 项）；**2026-11-24 人类实机验收通过**（原文预览与端到端附件链路），spec 转 `done`；未跑 `pnpm build`，逐项未验证内容见 acceptance §4 | [088 acceptance](specs/088-document-attachments/acceptance.md) |
| 2026-11-24 | 088 文档与图片附件 | DA-0～DA-9 完成；迁移 0038、通用上传/去重/删除、PDF/DOCX/PPTX/XLSX/HTML/CSV 抽取、图片透传与本地 OCR、上下文预算与三个附件工具、草稿托盘；DA-9 把输入区与时间线附件统一为“图标 + 文件名”标签并移到气泡下方，宽度随文件名自适应、图标复用文件目录的 Material 图标，标签两端图标内边距对称（左 `pl-2`、右 `pr-1.5` + 尾部 `p-0.5`），修复 `attachmentIds` 被当作旧截图重复渲染成破图；附件标签与产物标签共用 `chip.ts` 的 `h-7`/`rounded-full`/`text-[11px]`；`Toast` 改为 portal 到 body 级提示层（`top-14` + `z-[360]`，弹窗内由 `DialogContent` 的 `ToastHost` 承载），并让复用旧层节点时重写类名（否则 `top-4` 时期的残留层会继续被顶栏遮挡），修复附件超限报错被顶栏遮挡；`pnpm check` 与根 `pnpm build` 通过，`pnpm --filter @larness/web test` 53 文件 / 303 项通过；解析未进 worker（Q-077）、视觉连接未接线（Q-078）、真实文件与 Mock E2E 未跑 | [088 acceptance](specs/088-document-attachments/acceptance.md) |
| 2026-11-20 | GX-5 子目录项目 Git 路径基准 | 项目根为仓库子目录时暂存 / 取消暂存失败、diff 白屏；按 `--show-prefix` 折回项目相对路径并过滤项目外条目，DiffView 增加空差异说明；Git 套件 17 项通过（2 项跳过） | [078 tasks](specs/078-git-workflow/tasks.md) |
| 2026-11-23 | GX-6 未跟踪差异与 Git 失败原因 | 未跟踪文件用 `git diff --no-index` 与空基准比对，不再白屏；execute 失败保留 `GIT_CONFLICT` 等稳定码并审计，Git 面板区分写锁占用 / 快照变化 / 超时；`pnpm check` 通过（Server 836 项、31 跳过） | [078 tasks](specs/078-git-workflow/tasks.md) |
| 2026-11-23 | 088 DA-0 规格确认与 ADR-074 | 人类批准方案、气泡外附件布局与 Q-071～Q-076 全部推荐默认；格式矩阵、`auto-local` 只本地 OCR、限额、Base64 上传与纯 JS 依赖冻结；spec 转 `ready`、ADR-074 转 accepted；仅文档变更，未运行 `pnpm check` | [088 tasks](specs/088-document-attachments/tasks.md#da-0-规格确认2026-11-23) |
| 2026-11-20 | 087 联网搜索与独立搜索 Key | 人类验收通过；WS-0～WS-8 完成；DeepSeek/GLM 国内/国际 Provider、独立加密搜索 Key、会话级地球开关、窄版卡片式设置弹窗；成功/失败提示统一为 `@larness/ui` 顶部 Toast 并写入 UI 规范，会话内模型/联网开关保留输入框上方小字；web 284 项 + web build；原 087 check/E2E 25/25 | [087 acceptance](specs/087-web-search/acceptance.md) |
| 2026-11-20 | 086 项目记忆与统一管理弹窗 | 人类审核通过；PM-0～PM-8 完成；指令文件、自动学习、全局偏好、硬预算淘汰、REST/WS、记忆面板；check/build + Mock E2E 24/24；未验证边界见 acceptance | [086 acceptance](specs/086-project-memory/acceptance.md) |
| 2026-11-19 | 085 长任务连续执行 | 人类验收通过；任务级 token/时长/接续深度默认关闭；85% 换页、`continued` 终态、无事实 fallback、600s 请求上限、10 分钟无进展暂停；build + Mock E2E 24/24 | [085 acceptance](specs/085-long-task-continuity/acceptance.md) |
| 2026-11-19 | 084 Agent Profile 收敛与用量 | 人类验收通过；AP-1～AP-13 完成；Profile 收敛 coding/plan、usage API 与缓存命中率、Token 行常驻、过程标题行视觉；check/build + Mock 24/24 + 认证 20/20 + 生产 20/20 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#验收记录2026-11-18macos) |
| 2026-11-19 | AP-13 过程标题行只显示步数 | 外层移除失败/重试计数，只保留步数、耗时与自动继续；失败详情仍在展开过程内；定向 33 项通过 | [084 tasks](specs/084-agent-profiles-and-usage/tasks.md#ap-13-过程标题行只显示步数用户反馈) |

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
