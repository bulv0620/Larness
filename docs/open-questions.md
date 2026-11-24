# 遗留问题与开放决策

这里集中跟踪已发现的实现缺口、验证缺口、工程债务和待决事项。阶段验收记录保留当时的证据。当前发布范围见 [支持矩阵](known-limitations.md)，M5 / G5 已按 macOS 当前范围条件通过。

## 发布后任务与待验证项

| ID / 领域 | 遗留项 | 证据 |
|---|---|---|
| M5-F1 | Windows 11 x64 原生安装、TUI、ConPTY、命令、文件/Git、服务/预览与 PM2 已实机通过；Windows 10 x64 于 2026-11-18 由用户确认实机复测通过。 | [平台任务卡](../specs/066-cross-platform/tasks.md) |
| M5-F2 | 在 Ubuntu 22.04 / 24.04 x64 验证安装、node-pty 编译回退、终端、PM2、路径与锁。 | [平台验收](../specs/066-cross-platform/acceptance.md) |
| M5-F3 | F2 完成后按实机结果更新支持矩阵与验收；Windows 10 已验证。 | [平台任务卡](../specs/066-cross-platform/tasks.md) |
| 远程预览 | 验证独立域、通配 DNS、HTTPS 反代与浏览器行为；预览连接身份存在竞态边界。多客户端布局、外部打开和模型自主选择预览仍缺专门端到端覆盖。 | [M3 收尾](../specs/040-services-preview/closure.md) |
| 正式服务 | 核实主机重启后恢复与 PM2 运行时升级行为；正式服务秘密注入及落盘边界见 Q-029。 | [M4 收尾](../specs/050-deploy/closure.md) |
| 模型 | 实测真实第三方兼容端点与接近窗口阈值的长会话压缩质量及 UI。真实 GLM Coding 文本、推理和工具调用已有证据。 | [多模型验收](../specs/063-multi-provider/closure-d4.md) |
| 模型连接与截图 | 使用合法持有的 Key 逐预设验收真实模型发现、流式工具调用、续步和用量。使用支持图片与工具的真实线路验证截图输入。 | [077 验收记录](../specs/077-model-connections/acceptance.md) |
| 调度 | 补真实 Provider 定时任务、取消到终态的时延、实际重启和休眠唤醒、失败角标、任务数满额和视觉记录。 | [调度验收](../specs/064-scheduler/acceptance.md) |
| npm | 真实 registry 出现新版本时验证 TUI 提示；全局安装的交互 TUI 缺独立验收。npm 11 脚本策略可能影响原生模块安装。 | [分发验收](../specs/065-launcher-updater/acceptance.md)、[安装指南](guides/install.md) |
| 全量回归 | auth E2E 有批量时序抖动，终端用例可单独通过；对话用例仍有旧计划选择器失败记录。预览验收也记录过 PTY 测试时序抖动。2026-11-16 先后两次复现：`pnpm test` 全量 9 文件 / 16 项失败（前一次）、153 文件 / 744 用例中 37 失败 / 675 通过 / 31 跳过 + 3 个 worker 崩溃（081 改动后），失败项全部落在真实子进程、PTY、预览、Vite 与终端组。081 那次对同一 15 个文件定点串行复跑：13 个通过，只有 2 项是契约变更导致的真实断言失败并已修复，其余为并行负载与 `Worker forks emitted error` / `Unable to deserialize cloned data` 类崩溃。 | [调度验收](../specs/064-scheduler/acceptance.md)、[M3 收尾](../specs/040-services-preview/closure.md)、[079 验收记录](../specs/079-plan-progress/tasks.md#验收记录)、[081 验收记录](../specs/081-agent-lean/tasks.md#验收记录) |
| Windows 浏览器与测试基线 | M1 综合认证 E2E 在项目右键菜单步骤失败。Windows 终端测试 worker 曾以 0xC0000005 退出，复跑通过。 | [068 验收记录](../specs/068-ui-fixes/tasks.md#验收记录) |
| Server 单测基线 | 命令与终端重启恢复的根屏障已在 M2-R1 修复。Windows 曾记录服务运维预览解析请求得到 400、测试期望 503。 | [UI-F17 验收记录](../specs/068-ui-fixes/tasks.md#ui-f172026-11-13windows) |
| 前端与资源 | Monaco 生产 CSP 使用 `unsafe-eval`；Git 状态每 3 秒轮询，暂无 WS 失效接线。外部写入、进程脱组及磁盘满/数据库损坏仍是边界。 | [M2 收尾](../specs/030-dev-resources/closure.md)、[M3 收尾](../specs/040-services-preview/closure.md) |
| 发布与安全 | 本地发布无 CI / npm provenance；风险与检查证据保存在安全复核中。 | [安全复核](security/review.md) |
| 源码包管理器 | pnpm 12.18.0 的默认发布年龄策略暂时拒绝 5 个新锁项；先固定 10.34.9。等锁项满足 24 小时门槛后可重新验证 12。 | [ADR-056](adr/ADR-056-dependency-major-upgrades.md)、[DEPS-7](../specs/067-release-hardening/tasks.md#deps-7-pnpm-包管理器升级) |

## 待决

默认方案须由人类确认或由 spec 明确引用为暂定默认。

| ID | 问题 | 默认方案或当前证据 | 影响 | 跟踪 |
|---|---|---|---|---|
| Q-006 | 是否收集遥测 / 崩溃报告？ | 默认完全关闭；仅本地日志 | 隐私、实现 | 未排期 |
| Q-010 | 备份保留策略？ | 当前升级前数据库备份保留 5 份；周期性备份与含秘密备份的额外加密策略仍待决定 | M4/M5 | 未排期 |
| Q-011 | 删除 Session 时是否删除 artifacts？ | 默认保留 7 天再清理；删除前预览；不触碰项目源码 | 数据保留 | 未排期 |
| Q-012 | 是否提供中文以外的 UI 语言？ | V1 仅 zh-CN，字符串集中管理，预留 i18n | UI 实现 | 未排期 |
| Q-013 | 公网访问是否内置 TLS / 隧道？ | 不内置；文档要求用户使用 HTTPS 反代或受保护隧道 | 部署、文档 | 未排期 |
| Q-016 | 所有 Passkey 丢失 / TUI 不可用时如何恢复？ | V1 不提供 Web 恢复；TUI 撤销后重新配对；离线恢复码仍为 P1 | 恢复流程、支持成本 | 未排期 |
| Q-029 | 正式服务如何接收 `secretRef`，避免 PM2 将明文写入元数据、dump 或日志？ | M4-3 已验证守护/应用不继承 `LARNESS_*` 合成秘密，dump/pm2.log/服务日志无标记；正式 secretRef 注入与所有落盘路径仍需在产品注入前专项验证 | PM2 正式服务注入与脱敏 | M4-3b 产品秘密注入前 |
| Q-032 | 缓存命中率的发布门槛怎么定？ | 已确认先只观测、不设门槛；真实数值与门槛在 HX-1 基线后按 Provider 设定（官方也说明缓存是尽力而为，不保证 100% 命中） | 发布门槛、性能验收口径 | [070 spec](../specs/070-runtime-efficiency/spec.md) D6 |
| Q-033 | `agent_events` / `turns` / `session_context_summaries` 的保留期与体积上限默认值？ | 建议 events 90 天、turns 180 天、摘要 90 天，另有 `maxBytes`；先由 TR-1 体积报告支撑再定；清理默认关闭、只 dry-run | 数据保留、备份体积、历史可追溯性 | [071 spec](../specs/071-turn-recovery/spec.md) D2、[ADR-058](adr/ADR-058-turn-recovery-retention.md) |
| Q-035 | TypeScript 7.0.2 对 JSDoc 中的某些文本会产生假诊断（例如注释里写 `**/test/*.ts` 会报 `TS7008 Member 'test' implicitly has an 'any' type`）。 | 已观测：改写注释即可消除；暂不改注释规范，遇到时按误报处理并记录 | 开发体验、误导性报错 | [HX-8 记录](../specs/070-runtime-efficiency/tasks.md) |
| Q-034 | 开启清理前是否强制备份，备份保留几份？ | 建议强制备份一次并复用 ADR-055 的备份路径；份数与周期沿用 Q-010 | 删除不可逆风险 | [071 spec](../specs/071-turn-recovery/spec.md) TR-4、Q-010 |
| Q-039 | 计划陈旧提醒的阈值（6 个工具调用）与「每计划版本只提醒一次」是否合适？ | 已按 6 实现（`PLAN_STALE_TOOL_CALLS`）；真实长任务中若模型仍只在结尾更新，再按 `plan.updated` 次数调低或允许每 N 次重复 | 长任务体验、token 成本 | [079 spec](../specs/079-plan-progress/spec.md#13-开放问题) |
| Q-040 | 回合已完成但计划仍留 `pending` 时，是否要在回合摘要额外提示「计划未同步」？ | 默认只在计划行显示「另有 N 步未完成」，不加回合级提示；若用户仍误读计划与成果不符，再评估 | 计划可读性、界面噪声 | [080 spec](../specs/080-plan-terminal-state/spec.md#13-开放问题) |
| Q-041 | 是否继续压缩 `@larness/shared` 的 schema 字段描述（`update_plan`、`start_project_terminal`、`run_command`）？081 把重复的生命周期文案合到一处后，字段描述成为剩余固定开销的最大单项（工具 schema 仍约 4.4k token）。 | 暂不动：改 `.describe()` 属执行契约变更，需要重跑工具契约矩阵并更新 `051` 契约，单开一轮评估 | 固定开销、模型调用正确率 | [081 spec](../specs/081-agent-lean/spec.md#13-开放问题) |
| Q-077 | 088 的解析器仍在主进程执行，只有硬超时，没有 worker/内存隔离；大 PDF 或恶意 Office 文件可能阻塞事件循环。 | 当前按「进程内 + 硬超时 + 解压前置限额」交付，未宣称沙箱；下一步评估独立 worker 入口与打包（tsdown 第五入口），或改用子进程并保留超时/终止。 | 解析安全、事件循环阻塞、DA-3 验收缺口 | [088 acceptance](../specs/088-document-attachments/acceptance.md) |
| Q-078 | `attachments.ocr.mode=vision` 已进入配置 schema，但 bootstrap 未把 `visionConnectionId` 解析成可调用的转写器，视觉模式仍失败关闭。 | 默认 `auto-local` 只走本地 OCR；视觉连接接线前不得声称云端视觉可用。需要时按模型连接服务解析密钥并复用 provider，失败不回退。 | A3 视觉分支、外发隐私 | [088 acceptance](../specs/088-document-attachments/acceptance.md) |
| Q-080 | 是否提供“把附件导入项目目录”的写盘通道（`import_attachment`，L2）？ | 首版不做：上传即落盘会引入路径审批、覆盖冲突与项目锁扩张。需要时按“默认写 `tmp/attachments/<attachmentId>/`、显式 `targetPath` 才写项目、项目锁 + 审计”设计并单独评审。 | 修改真实页面/运行附件仓库的工作流 | [088 spec §7.7](../specs/088-document-attachments/spec.md#77-视图契约与格式矩阵) |

## 已解决
- Q-081～Q-083、D4、D5（2026-11-24）：089 按推荐默认确认——易变上下文移出 system、合并进当前 user 消息并声明「由系统提供、不是用户指令」；会话压缩阈值降到 0.7、裁剪加滞回（0.8 触发裁到 0.6），接受长会话多一次摘要调用，压缩失败才降级为可见裁剪；附件工具常驻、用 `ATTACHMENT_NOT_FOUND` / 空列表表达不可用，联网工具仍由显式开关控制；断点归因只进 `model.usage` 与 `cache.breaks`，`turn.completed.usage` 口径不变；不实现 `prompt_cache_key` / 显式缓存断点。命中率仍只观测、不设门槛（Q-032）。见 [089 spec §13](../specs/089-session-prefix-cache/spec.md#13-开放问题) 与 [ADR-057](adr/ADR-057-runtime-efficiency.md)。

- Q-079（2026-11-24）：采用“多视图”而非单一 markdown——`read_attachment` 增加 `view="source"`（原文按行分页，仍包在 `<attachment>` 内、只当数据处理），文本类附件默认按原文注入与跨附件检索；HTML 解析补回 `<style>`、id/class 大纲与表格；不提供写盘导入，另立 Q-080。见 [088 spec §7.7](../specs/088-document-attachments/spec.md#77-视图契约与格式矩阵)。

- Q-071～Q-076（2026-11-23）：088 按推荐默认确认——首版矩阵冻结 PDF/DOCX/PPTX/XLSX/HTML/CSV/TXT/MD/PNG/JPEG/WebP，旧 Office/压缩包/音视频/SVG 拒绝；`auto-local` 只用本机 OCR，云端视觉默认关闭且必须显式选连接；20 MiB/文件、8 个/轮、200 个/会话、400 页、单文件 8k token、附件总预算 15%；v1 用 JSON Base64 上传；批准 `pdfjs-dist`、`mammoth`、`exceljs`、`jszip`、`fast-xml-parser`、`turndown`、`sanitize-html` 与可选 `tesseract.js`，不引入原生 canvas；扫描 PDF 首版不渲染。见 [088 spec](../specs/088-document-attachments/spec.md#13-已确认决策) 与 [ADR-074](adr/ADR-074-document-attachments.md)。

- Q-060～Q-070（2026-11-20）：086 按推荐默认确认——仅加载 `AGENTS.md` + `.larness/instructions.md`；项目 fact/command/gotcha 证据有效且置信度 ≥0.6 自动 active，decision 默认 review，全局 preference 仅用户明确表达且置信度 ≥0.9 自动 active；项目 active 64 KiB/300 条、总占用 192 KiB，全局 8 KiB/50 条、总占用 24 KiB；revision 3 个/30 天，review 20 条/14 天，抑制 90 天；全局偏好完整注入 ≤512 token + 项目索引 ≤1,024 字符 + 正文按需，总注入 ≤2,000 token；v1 不加额外 LLM 整理，先按指标评估。见 [086 spec](../specs/086-project-memory/spec.md#13-已确认决策) 与 [ADR-072](adr/ADR-072-project-memory.md)。

- Q-052～Q-059（2026-11-19）：085 按默认值实施——任务级 token 上限关闭、紧急兜底 24h/1000 步、换页阈值 85%、无事实用最近消息+摘要、初版不暴露配置、定时 Job 保持自身超时、输出截断单独处理、ADR-071 accepted、新增 `terminalReason=continued`、无进展 10 分钟暂停。见 [085 spec](../specs/085-long-task-continuity/spec.md#13-开放问题) 与 [ADR-071](adr/ADR-071-long-task-continuity.md)。

- M5-F1-W10（2026-11-18）：用户确认 Windows 10 x64 实机复测通过；具体版本与日志未回填。见 [验收记录](../specs/066-cross-platform/acceptance.md)。
- HX-12b（2026-11-18）：用户决定废弃 `turnRunner` 循环体拆分；082/083 后维持单循环。若后续出现具体维护痛点，按新任务重新评估。见 [070 tasks](../specs/070-runtime-efficiency/tasks.md#hx-12b-turnrunner-循环体拆分)。

- Q-051（2026-11-18）：083 决定项目开发服务统一为 `ProcessManager` 的后台任务，内存 + `agent_events`，不跨重启恢复；不新增服务表，旧 `services` 仅历史读取。PM2 运维独立在 service-ops。见 [083](../specs/083-service-model/spec.md)。

- Q-042～Q-050（2026-11-18）：人类批准 [082 spec](../specs/082-agent-kernel/spec.md#13-已确认决策) 与 [ADR-068](adr/ADR-068-agent-kernel.md) 的全部推荐默认。新会话与存量会话统一 `coding`，内测允许破坏性重构、不保留旧能力；`workspace` 仅显式选择。`plan` 仅 plan Profile；终端退出模型面；Git 模型工具移除；后台进程/服务工具按 3+4 粒度；`run_command` + `run_shell` 双路径；锁为 ProjectLease + ServiceLease；审计为 required/resource/debug；ADR-059/060 与 AGENTS.md 加载方式不变。K-1 基线见 [baseline.md](../specs/082-agent-kernel/baseline.md)。

- Q-038：MC-2 使用包内能力与显式刷新 Models.dev，公共目录只补已经发现的模型的允许字段；调用地址、授权头和协议由 Larness 管理。后续复查公共目录返回 HTTP 200，离线合并和失败路径以测试覆盖。见 [077 验收记录](../specs/077-model-connections/acceptance.md)。

- 成果区分类已落地：Turn 终态服务端输出 `fileResults`（交付 / 过程、存在性、同路径去重、上限 200 + `fileResultsOmitted`），Web 成果区只显示交付文件，临时 / 生成 / 忽略 / 已删除文件折叠为「过程文件」行；`write_file` 与 `apply_patch` 统一文件结果卡，历史 Turn 回退原渲染（Q-037 关闭，2026-11-12）。
- 受管文件创建已落地：新增 `write_file`（项目内相对路径、1 MiB 上限、仅创建、已存在返回 `VERSION_CONFLICT`），成功后发 `file.changed`（`changeType=created`），检查点事实与「本次成果」卡片可见（Q-036 关闭，2026-11-12）。
- Turn 内资源观察改为「Turn 起点快照 + 显式 `refresh_observations`」，不再每步刷新 system；命令上下文契约的每步刷新条款由 [ADR-057](adr/ADR-057-runtime-efficiency.md) 替换（Q-031 关闭，2026-11-11）。
- 更新规范已按 [ADR-055](adr/ADR-055-npm-update-security.md) 对齐 npm 手动升级、迁移前备份与人工恢复。

- Q-008：`packages/shared/src/config.ts` 的默认会话期限为绝对 12 小时、空闲 30 分钟，服务端执行校验。
- Q-014：发布采用 npm 包，`package.json` 的 `bin` 指向 `app.js`，随包分发 Server / Web 构建产物及迁移文件。
- Q-015 / Q-017 / Q-018：按 [M0 认证验收](../specs/010-foundation/acceptance.md) 和 [ADR-021](adr/ADR-021-passkey-v1.md) 执行 IP 来源引导、同步 Passkey 与临时授权。
- Q-005：平台范围已明确；Windows 11 与 Windows 10 实机验证已完成（Windows 10 为用户确认），Ubuntu 见 M5-F2。

Q-004（2026-11-08）：用户确认 MIT 许可证；根包 `license: MIT` 并附 `LICENSE`，用于公共 npm 发布。

Q-009（2026-11-07）：M5-2 采用系统时区默认 + 每个任务显式 IANA 时区；`cron-parser` 计算下一次触发，春季不存在的 02:30 顺延到 03:30、秋季重复的 01:30 只执行一次，均有单元测试。见 [064 spec](../specs/064-scheduler/spec.md)。

Q-030（2026-11-07）按 [ADR-050](adr/ADR-050-pm2-cli-deployment.md) 取消专用运维模型工具与独立 Turn 入口。普通项目会话使用命令工具和系统提供的 PM2 环境/项目关系，服务运维弹窗可进入所属项目会话。

Q-027（2026-11-06）：Larness 管理进程异常退出或 TUI 正常退出时，正式 PM2 服务继续运行，重开后对账并展示实际状态。涉及 PM2 运行时替换的更新影响在对应交付前核实。见 [ADR-046](adr/ADR-046-pm2-delivery-and-lifecycle.md)。

Q-003（2026-11-06）：M4-0 验证全局检查/补装、私有 `PM2_HOME`、实例隔离与失败处理；M4-3 在 TUI 受管入口接入固定 `pm2@7.1.2` 安装/复用。支持范围见 [M4-3 验收](../specs/050-deploy/acceptance-m4-3.md)；其他平台与 PM2 升级仍待验证。

Q-002 / Q-026（2026-11-05）：人类按[评审包](../specs/040-services-preview/review.md)推荐批准 G-Spec-M3，[ADR-043](adr/ADR-043-development-preview-authorization.md) 转 accepted。Q-002 采用本机 `*.preview.localhost` + 远程独立注册域/通配 DNS/HTTPS 反代；Q-026 采用后端核验 launch/执行/监听 owner+birth/generation、≤1 秒对账、证据陈旧 >2 秒拒绝，并接受 connect 竞态残余风险。远程 HTTPS 实测延后至后续上线实验，M3-0 先做本机证据；实现细节由 G-PoC 冻结，未验证项不得宣称支持。

Q-022（2026-11-03）：人类在阅读 M2-0 PoC 后明确开始 M2-1，G-PoC-M2 通过；实测 macOS arm64，支持范围及文件最终竞态 / 进程身份边界见 [poc.md](../specs/030-dev-resources/poc.md)。

2026-11-02 人类要求开始 M2，并确认“按最新spec来”：Q-021 的开发终端并发写边界、Q-023 回放限额、Q-024 人工 Git 方案、Q-025 重叠根冲突域设计已随 ADR-029 / G-Spec-M2 批准；Q-028 采用完整 AI 输入 / 中断 / 人工接管，ADR-029 第 6 条已同步。Q-022 技术可行性证据见 M2 poc.md，G-PoC-M2 已于 2026-11-03 获人类确认。

| ID | 结论 | 记录 |
|---|---|---|
| Q-001 | V1 使用 Passkey / WebAuthn，不再签发长期设备 Token | [ADR-021](adr/ADR-021-passkey-v1.md) |
| Q-020 | 2026-11-02 人类明确开始实现，G-Spec-TUI / ADR-027 通过，T0-1 → T0-2 → T0-3 先于 M2 | [ADR-027](adr/ADR-027-tui-screen-and-input.md) |
| Q-019 | 一个工作空间只支持一个 canonical RP ID / Origin，不做多域名 | [ADR-021](adr/ADR-021-passkey-v1.md) |
| Q-007 | 产品名与命名空间统一为 Larness；默认数据目录使用 Larness | [ADR-022](adr/ADR-022-product-name-larness.md) |

## 已确认（勿重复讨论）

- ADR-030：临时服务在 Terminal 启动，服务模块只登记 / 展示 / 转发，源进程退出退登；持久服务由 PM2 管理，人和 AI 同后端能力操作。
- ADR-030：关闭 / 最小化窗口只隐藏；关闭终端 Tab 显式终止；文件 / Browser Tab 关闭不删文件 / 不停服务。
- ADR-030：服务窗口当前项目卡片 / 详情，无项目切换器或服务Tab（ADR-031/042修订早期规则）；文件与预览结果卡片点击打开用户视图。

- 产品名与内部命名空间统一为 Larness（ADR-022）。
- 单机、单工作空间、多客户端；不做多租户。
- 三栏 Chat-first、顶部入口、无 Dock、右栏四分区可调高。
- TUI 初始化与设备审批；Web 不能自我注册。
- Passkey 作为 V1 可信凭据；`允许本次` 仅短期会话。
- 全局资源 Tab 的身份、来源、分组、项目筛选与去重按 [resource-views 契约](contracts/resource-views.md) 执行。
- DeepSeek / GLM 优先，每 Turn 固定模型。
- 预览只代理已登记本机服务；同源 iframe 不可接受。
- V1 不承诺 OS 级沙箱。

## 如何新增

1. 在表中追加 `Q-0xx`，写清问题、默认、影响、截止。
2. 需要立即决策的，在 `STATUS.md` 的“待人类确认”中同步。
3. 决策完成后：写 ADR（若改变冻结行为）或更新 spec / 契约，并从本表移除或标记 `resolved`。
