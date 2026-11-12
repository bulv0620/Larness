# 遗留问题与开放决策

这里集中跟踪已发现的实现缺口、验证缺口、工程债务和待决事项。阶段验收记录保留当时的证据。当前发布范围见 [支持矩阵](known-limitations.md)，M5 / G5 已按 macOS 当前范围条件通过。

## 发布后任务与待验证项

| ID / 领域 | 遗留项 | 证据 |
|---|---|---|
| M5-F1 | Windows 11 x64 原生安装、TUI、ConPTY、命令、文件/Git、服务/预览与 PM2 已实机通过。 | [平台任务卡](../specs/066-cross-platform/tasks.md) |
| M5-F1-W10 | Windows 10 x64 1809+ 与 Windows 11 使用同一实现；尚未单独实机复测。 | [验收记录](../specs/066-cross-platform/acceptance.md) |
| M5-F2 | 在 Ubuntu 22.04 / 24.04 x64 验证安装、node-pty 编译回退、终端、PM2、路径与锁。 | [平台验收](../specs/066-cross-platform/acceptance.md) |
| M5-F3 | F1、F2 完成后按实机结果更新支持矩阵与验收。 | [平台任务卡](../specs/066-cross-platform/tasks.md) |
| 远程预览 | 验证独立域、通配 DNS、HTTPS 反代与浏览器行为；预览连接身份存在竞态边界。多客户端布局、外部打开和模型自主选择预览仍缺专门端到端覆盖。 | [M3 收尾](../specs/040-services-preview/closure.md) |
| 正式服务 | 核实主机重启后恢复与 PM2 运行时升级行为；正式服务秘密注入及落盘边界见 Q-029。 | [M4 收尾](../specs/050-deploy/closure.md) |
| 模型 | 实测真实第三方兼容端点与接近窗口阈值的长会话压缩质量及 UI。真实 GLM Coding 文本、推理和工具调用已有证据。 | [多模型验收](../specs/063-multi-provider/closure-d4.md) |
| 调度 | 补真实 Provider 定时任务、取消到终态的时延、实际重启和休眠唤醒、失败角标、任务数满额和视觉记录。 | [调度验收](../specs/064-scheduler/acceptance.md) |
| npm | 真实 registry 出现新版本时验证 TUI 提示；全局安装的交互 TUI 缺独立验收。npm 11 脚本策略可能影响原生模块安装。 | [分发验收](../specs/065-launcher-updater/acceptance.md)、[安装指南](guides/install.md) |
| 全量回归 | auth E2E 有批量时序抖动，终端用例可单独通过；对话用例仍有旧计划选择器失败记录。预览验收也记录过 PTY 测试时序抖动。 | [调度验收](../specs/064-scheduler/acceptance.md)、[M3 收尾](../specs/040-services-preview/closure.md) |
| Windows 浏览器与测试基线 | M1 综合认证 E2E 在项目右键菜单步骤失败。Windows 终端测试 worker 曾以 0xC0000005 退出，复跑通过。 | [068 验收记录](../specs/068-ui-fixes/tasks.md#验收记录) |
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

## 已解决

- 成果区分类已落地：Turn 终态服务端输出 `fileResults`（交付 / 过程、存在性、同路径去重、上限 200 + `fileResultsOmitted`），Web 成果区只显示交付文件，临时 / 生成 / 忽略 / 已删除文件折叠为「过程文件」行；`write_file` 与 `apply_patch` 统一文件结果卡，历史 Turn 回退原渲染（Q-037 关闭，2026-11-12）。
- 受管文件创建已落地：新增 `write_file`（项目内相对路径、1 MiB 上限、仅创建、已存在返回 `VERSION_CONFLICT`），成功后发 `file.changed`（`changeType=created`），检查点事实与「本次成果」卡片可见（Q-036 关闭，2026-11-12）。
- Turn 内资源观察改为「Turn 起点快照 + 显式 `refresh_observations`」，不再每步刷新 system；命令上下文契约的每步刷新条款由 [ADR-057](adr/ADR-057-runtime-efficiency.md) 替换（Q-031 关闭，2026-11-11）。
- 更新规范已按 [ADR-055](adr/ADR-055-npm-update-security.md) 对齐 npm 手动升级、迁移前备份与人工恢复。

- Q-008：`packages/shared/src/config.ts` 的默认会话期限为绝对 12 小时、空闲 30 分钟，服务端执行校验。
- Q-014：发布采用 npm 包，`package.json` 的 `bin` 指向 `app.js`，随包分发 Server / Web 构建产物及迁移文件。
- Q-015 / Q-017 / Q-018：按 [M0 认证验收](../specs/010-foundation/acceptance.md) 和 [ADR-021](adr/ADR-021-passkey-v1.md) 执行 IP 来源引导、同步 Passkey 与临时授权。
- Q-005：平台范围已明确；Windows 11 实现与实机验证已完成，Windows 10 实机复测见 M5-F1-W10，Ubuntu 见 M5-F2。

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
