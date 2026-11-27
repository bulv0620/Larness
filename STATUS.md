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
| 2026-11-27 | 100 探索效率（EX-1） | `search_code` 默认每条命中带前后各 1 行上下文（`contextLines` 0–5，0 关闭），模型文本按真实行号显示相邻行、不重复命中行并追加窄读提示；system prompt 增加“点名文件直接读 / 路径未知才 list_files / package.json 只在相关时读”，`PROMPT_VERSION=100-1`；`fileTools`/`fileService` 32 项、contextAssembler 15 项、`pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 997+14 跳过）、`pnpm build` 通过；live long-file 两次复测均 5 步/5 调用，tokens 22,620–23,048（旧 7/8/35,269），耗时 10.0–10.1s（旧 13.3s），verify=0；全任务 n=1 的 cross/multi 回退经定向复测为方差（cross 5/11、multi 10/14/2），不是稳定回归 | [100](specs/100-exploration-efficiency/tasks.md) |
| 2026-11-27 | 099 edit 参数容错（EA-1） | live benchmark 发现 `edit` 收到 `expectedVersion`/`version` 时 strict schema 返回 VALIDATION_ERROR；`repairEditArgs` 丢弃这两个跨工具混淆字段，其他未知字段仍拒绝；edit 的版本冲突/路径/CRLF/replaceAll 不变。`fileTools.test.ts` 6 项、`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 997+14 跳过）、`pnpm build` 通过；live 重跑待做 | [099](specs/099-edit-arg-repair/tasks.md) |
| 2026-11-27 | 098 Agent 基准任务与请求级 A/B（BM-1～BM-3） | 新增 5 个离线 fixture（单文件修复/跨文件重构/长文件编辑/多轮修复/符号定位），fixture 基线 verify 均失败；`pnpm bench:agent` 支持真实 Provider（`LARNESS_BENCH_API_KEY`/model/endpoint/effort）、临时 DB/项目、steps/toolCalls/toolFailures/tokens/耗时/verify/diff 指标、可选 request dump、`--print` 与 fake smoke；新增 opencode 手动 A/B 协议。fixture 5 项、fake smoke verify=0、无 Key 失败关闭；用户 live 首跑 5 任务 verify=0，但命令失败来自 runner 缺少 active client，已修并补 fake 命令链路；`cross-file-refactor` 的 `edit` expectedVersion 混淆由 099 修复；`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 997+14 跳过）、`pnpm build` 通过；干净 A/B 5/5 verify 全 0，Larness 32 步/47 调用/75.8s/160,947 prompt tokens，opencode 31 步/41 调用/98.3s/237,961 prompt tokens（n=1，opencode 含每次 3–5s 启动）；long-file 探索效率仍有差距 | [098](specs/098-benchmark/tasks.md) |
| 2026-11-27 | 097 流式启动 L0 只读工具（SR-1～SR-2） | 每个 step 的 `tool-call` 事件到达时，对 `L0 + prefetchable:true + requiresProjectLock:false + allow + 未禁用 + 预算 ok` 的调用立即启动，最多 8 个；结果仍按 call 顺序消费，写/锁/审批与混合批次中的非 L0 调用串行。`update_plan`/`remember` 等 L0 元数据写入不预取。三个 L0 文件工具显式 `requiresProjectLock:false`、`prefetchable:true`。定向 turnRunner/fileTools/plan 通过，`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 992+14 跳过）、`pnpm build` 通过；E2E 与真实 Provider 未跑 | [097](specs/097-streaming-reads/tasks.md) |
| 2026-11-27 | 096 命令 allowlist 与本轮审批复用（CA-1～CA-3） | 标准策略下把 `git status/diff/log/show/rev-parse/ls-files`、受限 `git branch`、`pnpm/npm/yarn` 的 `test/check/typecheck/lint/build/verify` 脚本、`rg/ls/pwd`、`node --version` 等降为 L1；`run_shell` 仅限无元字符/引号/绝对或 `..` 路径的简单命令；`--prefix`/`exec`/`dlx`/写 flags 仍 L2，L3 仍 deny。`executeTool` 支持同 Turn 内相同 `toolName + paramsHash` 批准复用，不跨 Turn、不持久化。定向 20 项、`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 991+14 跳过）、`pnpm build` 通过；E2E 与真实 Provider 未跑 | [096](specs/096-command-approvals/tasks.md) |
| 2026-11-27 | 095 单一 Agent 模式（SM-1～SM-5） | 移除 Composer 的 coding/plan 切换，保留一个通用模式；`update_plan` 常驻、始终注入计划策略（3+ 步提示），`PROMPT_VERSION=095-1`；旧 `plan` 作为行为一致的兼容别名，不删 `agent_profile` 列；最近计划注入 tail，当前 Turn 计划仍有 pending/running 却纯文本停止时 nudge 一次，旧计划不触发；项目指令改为“可遵循的约定，但不能授权/批准/覆盖安全”，允许项目指令提高验证门禁。ADR-075 accepted；定向 91 项 + web 22 项、`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 987+14 跳过）、`pnpm build` 通过；E2E 与真实 Provider 未跑 | [095](specs/095-single-agent-mode/tasks.md) |
| 2026-11-27 | 094 跨 Turn 操作日志（OL-1～OL-4） | 新增内部 `tool.operation`：L1+ 命令保留 exitCode+800 字符尾部，edit/patch/write 保留 path/version/changeType/增删或替换统计，失败保留 errorCode/summary；落盘前 redaction。`contextAssembler` 读取 `coveredUpToSeq` 之后、当前 Turn 之前的最多 40 条，按 2,500 token 预算注入当前 user 消息 tail；`tool.operation` 不广播、公开事件过滤。定向 operationLog/contextAssembler/events/turnRunner 等 117 项、`pnpm check` 退出码 0（web 323、agent 72+1 跳过、server 982+14 跳过）、`pnpm build` 通过；E2E 与真实 Provider 未跑 | [094](specs/094-operation-log/tasks.md) |
| 2026-11-27 | 093 工具面与结果预算（TI-1～TI-4） | `read_file` 带 1-based 行号、完整 sha256 version、50KB/2000 行页；新增 `edit`（old/new/replaceAll、CRLF、唯一匹配、L1+项目锁）；`write_file` 支持覆盖与可选 `expectedVersion`；`read_file`/`search_code`/`run_command` 使用 `modelText` 纯文本结果，JSON `data` 保留；命令输出 32KB 且不重复 stdout/stderr；结果上限 80k 字符、批预算 24k token；`edit` 加入 `core.write`。定向资源/工具/契约/命令测试通过，`pnpm check` 退出码 0（web 323、agent 72+1 跳过、server 975+14 跳过）；E2E、真实 Provider 未跑；`pnpm build` 通过 | [093](specs/093-tool-interface/tasks.md) |
| 2026-11-27 | 092 搜索与目录列表默认忽略（SI-1） | `.pnpm-store`/`dist`/`build`/`coverage`/`test-results`/`tmp`/`.turbo`/`.vite` 加入默认忽略；`list_files`/`search_code` 共用 `isIgnoredFile`，显式 `path` 仍可进入；工具描述与契约文档同步。定向 25 项、`pnpm check` 退出码 0（web 323、agent 68+1 跳过、server 969+14 跳过）；真实仓库根搜索从 0 命中恢复到 357 文件扫描并命中 `contextAssembler.ts`；E2E 与真实 Provider 未跑 | [092](specs/092-search-ignore/tasks.md) |
| 2026-11-25 | 内核正常使用缺陷修复（用户直接要求） | 修复会影响正常使用的路径：自动续轮复用父 Turn 的 `clientSessionId`（否则命令/进程工具全被 `FORBIDDEN`）；上下文预算在未发生模型调用时不再无进展续轮；关闭 TUI 把运行中 Turn 标为 `INTERRUPTED` 并关闭 `ProcessManager`（不再遗留后台进程、可恢复）；finalize 不再覆盖并发 `CANCELLING`；Job 取消/超时会直接 abort runner；进程 spawn 超时会终止并有界失败；`executeTool` 在严格 schema 前执行 `repairArgs`，且重复失败提示改为整批 tool 结果之后追加；WS 背压改用 `1013`/`1011`，客户端只在认证原因时停止重连；Web 加载历史时核对终态、`resumeTurn`/`stop`/补拉失败按原会话归属，`useSessionDetail` 增加有限重试。新增 shutdown/进程/参数别名/多工具 nudge/加载竞态等回归测试；server 181 文件 / 969 项（14 跳过）、web 55 文件 / 320 项、agent 63 项（1 跳过）、全 workspace `typecheck`、`biome ci`、`pnpm build` 通过；E2E 未跑 | [071](specs/071-turn-recovery/tasks.md)、[083](specs/083-service-model/spec.md)、[072](specs/072-agent-error-budget/tasks.md) |

> 更早的收口记录（含同日其余 K-5、K-4、MC-* 与 FR-* 任务）见 [历史状态日志](docs/log/2026-11.md)，按原文顺序保留。

## 环境与验证基线

原记录（2026-11-11）为「本机没有独立 `node`，`node` 由 Electron 内置的 v24.21.0（ABI 149）充当」，完整 server 套件稳定为 **73 个失败 / 19 个文件**（部署、命令、脚本、终端、预览、服务等需要真实 `node` 子进程或 PTY 的用例）。

**该基线已作废（2026-11-16 修订）**：在装有独立 `node`（v24.19.0 / pnpm 10.34.9）的环境串行复跑，server 151 个文件全部执行，仅 1 处 `git/manager` 用例超时（单独复跑 15 秒通过，属既有脆用例），无环境性失败；`apps/web` 246 项、6 个包 `tsc --noEmit`、`biome ci` 全通过。**今后同类失败按真实回归排查，不再视为常态。**

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
