# STATUS

> 最后更新：2026-11-27
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
| 2026-11-27 | 111 手动停止按失败效果呈现（MS-1～MS-4） | `turn.cancelled` 现在按失败读：摘要 `Failed`、提示用失败边框并保留「重试」、被截断的 `running` 计划步骤显示「已中断」；服务端 `CANCELLED`、事件、审计、Job 与恢复条件零改动，取消仍不提供继续入口。`Timeline.test.tsx` 先红 2 项后 30/30，web 324 项、`pnpm check` 退出码 0（server 188 文件 / 1018 项通过 / 15 跳过）、`pnpm build` 通过 | [111](specs/111-manual-stop-failure/tasks.md) |
| 2026-11-27 | 110 新会话继承最近选择的审批策略（AD-1～AD-3） | 项目 `settings.defaultApprovalPolicyId` 与默认工作区 `app_meta` 分别记住最后一次用户修改的策略；`POST /api/sessions` 创建时继承，`PATCH /api/sessions/:id` 改策略时在同一事务更新默认，旧会话不回写；Web 草稿显示项目默认，未主动改选时不回传策略；`sessions/service` 9 项、`sessions/api` 1 项、`projects/api` 3 项、web `SessionModel` 14 项 / `Composer` 9 项 / `timelineSendScroll` 3 项通过；`pnpm check` 退出码 0（server 188 文件、1018 项通过 / 15 跳过）、`pnpm build` 通过；无 DB 列/迁移 | [110](specs/110-session-approval-default/tasks.md) |
| 2026-11-27 | 109 文件工具作用域：放开项目外读取（ER-1～ER-3） | `read_file` / `list_files` / `search_code` 接受项目外 canonical 绝对路径（`ToolContext.readScope`），结果带 `rootScope=primary|external`，外部 `path` 为绝对路径；写入类工具与 `run_command.cwd` 仍限项目根；硬闸只保留 `<dataDir>` 与 `/proc`、`/sys`、`/dev`，文件系统根 / 主目录本身 / 盘符根返回 `INVALID_PATH`，不按文件类型或凭据目录名拒绝；`TurnRunner` 按 dataDir realpath 注入，dataDir 缺失则失败关闭；`PROMPT_VERSION=109-1`。`pathGuard` 7+1 跳过、`fileService`/`fileTools` 37 项、`toolExecutor` 5 项、`contextAssembler` 15 项、新增 `externalRead` 1 项通过；`pnpm check` 退出码 0（web 322、agent 37、server 1016+15 跳过）、`pnpm build` 通过；P4 `run_command.cwd` 未开始 | [109](specs/109-external-read-scope/tasks.md) |
| 2026-11-27 | 107 多轮基准采集脚本（BR-1） | 新增 `pnpm bench:rounds`：N 轮 Larness、可选 `--opencode` 自动跑同一 fixture、每轮独立目录与 request dump、opencode JSONL 解析/多轮 session、`rounds.json` + `summary.json/md/csv` 中位数/verifyPass；`roundsLib.test.ts` 5 项、Larness 2 轮 smoke、opencode 单轮与 multi-turn session smoke、错误边界通过；`pnpm check` 0（server 1011+14）、`pnpm build` 通过；真实 3 轮完成：双方 18/18 verify=0，Larness 202,232 prompt/106.9s vs opencode 416,106/114.2s（快 6.5%，上下文 48.6%） | [107](specs/107-benchmark-rounds/tasks.md) |
| 2026-11-27 | 106 宽搜索 Top files 摘要（STF-1） | Top files 探针能显示 `packages/agent/src/tools/fileTools.ts (7)`，但真实 099 任务回退为 13 步/19 调用/2 失败/269,324 input/61.6s（104 为 12/17/1/248,490/53.5s）；模型仍分段读整文件，并多读 registry/types/package.json。已回退 `files`/Top files 文本，任务 `dropped`，保留 104 | [106](specs/106-search-top-files/tasks.md) |
| 2026-11-27 | 105 简单单文件任务不创建计划（STP-1） | 计划调用成功降为 0（steps 12→10、calls 17→15），但模型改用 5 次搜索/分段读文件/整测试，tokens 248,490→272,813（+10%）、耗时 53.5→60.8s，不满足 A4；已回退 PLAN_POLICY、planTool 描述与 `PROMPT_VERSION=100-1`，任务 `dropped`，保留 104 为最佳基线 | [105](specs/105-simple-task-plan/tasks.md) |
| 2026-11-27 | 104 宽搜索目录摘要（SDS-1） | `search_code` 达到 limit 后继续统计 `apps/<name>`/`packages/<name>` 命中数，截断时给 Top dirs + `path=`；裸 `*.ts` 改为递归。真实 099 任务：12 步/17 调用/1 失败/248,490 input/53.5s，verify 0（102 基线 13/23/296,177/59.5s，103 回退 22/29/546,390/94.4s）；首次搜索即到 `packages/agent`，不再探索 `apps/server`。剩余为 2 次 list、3 次 plan、整文件/测试/types 读取 | [104](specs/104-search-directory-summary/tasks.md) |
| 2026-11-27 | 103 真实仓库探索：精确标识符优先（EIS-1） | 实现后实机复测明显回退：Larness 22 步/29 调用/546,390 input/94.4s（102 基线 13/23/296,177/59.5s）；模型先搜 `expectedVersion` 命中大量测试，错误探索 `apps/server`，宽扫提示未纠正。已回退 prompt/宽扫提示，恢复 `PROMPT_VERSION=100-1`；任务 `dropped`，后续改做仓库/包索引或搜索排序 | [103](specs/103-exact-identifier-search/tasks.md) |
| 2026-11-27 | 102 外部真实仓库 A/B（RRA-1/RRA-2） | benchmark runner 新增 `--repo`/`--prompt`/`--verify`/`--setup`：复制本地仓库（排除 `.git/.larness/tmp`）、可选 setup、baseline、复用指标；fake smoke verify=0、源仓库不变、参数/setup 失败关闭；真实 Larness 099 任务：Larness 13 步/23 调用/2 失败/299,718 tokens/59.5s，opencode 8 步/10 调用/157,152 prompt tokens/43.1s，双方 verify 0、同 diff；差距定位为宽搜索、整文件读取和错误 pnpm 命令；`pnpm check` 退出码 0（server 1006+14 跳过）、`pnpm build` 通过 | [102](specs/102-real-repo-ab/tasks.md) |
| 2026-11-27 | 101 更大仓库基准任务（DRB-1） | 新增 `checkout-discount` fixture：31 文件，测试只能定位到 `quote`，根因在 `discount.js`（返回折扣额）与 `quote.js`（运费进入折扣基数），两文件同修才通过；补基线/可解性/单点失败测试；`tasks.test.ts` 10 项、`pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 1002+14 跳过）、`pnpm build` 通过；live A/B（n=1）Larness 6 步/12 调用/38,698 tokens/18.8s，opencode 8 步/12 调用/75,253 prompt tokens/18.7s，双方 verify 0、同 diff | [101](specs/101-deep-repo-benchmark/tasks.md) |

> 更早的收口记录（含同日其余 K-5、K-4、MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

## 基准与验证策略

- **2026-11-27 基准阶段收口**：6 个 fixture ×3 轮、Larness/opencode 各 18 次运行，双方 18/18 verify=0；Larness steps/toolCalls 38/55 vs 37/57，prompt tokens 202,232 vs 416,106，总耗时 106.9s vs 114.2s。结论是“这套合成任务的完成度/工具执行/速度已接近 opencode”，不宣称所有真实项目体验等同。
- **不再新增合成 benchmark 切片**，也不再做 108（外部仓库多轮）；保留 `pnpm bench:agent` / `pnpm bench:rounds` 作为回归工具，仅在有具体问题或改动需要验证时使用。
- 真实仓库仍有单轮差距（104 最佳 12 步/17 调用/248,490 input/53.5s vs opencode 8/10/157,152/43.1s），但继续扩基准的收益已低于真实使用反馈；后续由真实项目中的具体痛点驱动（如 formatter/LSP、读取范围、恢复），不再为体感造任务。

## 交付基线

- 当前 npm `latest` 为 `0.4.0`（2026-11-25）；该版本全局安装缺少文档解析运行时依赖（`mammoth` 等），仓库已补齐根 `package.json`，`0.4.1` 修复版准备中（`pnpm check` / `pnpm build` / pack 安装后实际启动均通过，待发布）。
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
