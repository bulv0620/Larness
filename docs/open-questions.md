# 开放问题

> 这里记录尚未冻结的边界问题。**默认方案不等于已批准**；涉及实现前必须由人类确认，或由 spec 明确引用为“暂定默认”。  
> 不阻塞 D0 / M0 的问题标注了截止里程碑。

## 待决

| ID | 问题 | 默认方案 | 影响 | 截止 |
|---|---|---|---|---|
| Q-004 | 仓库许可证？ | 暂不添加 LICENSE，按私有项目处理 | 开源 / 分发 | 公开发布前 |
| Q-005 | Windows 支持的时间与范围？ | macOS 主开发；Linux CI；Windows 在 M5 前完成 PTY / 路径 / PM2 / 更新 / Passkey PoC | 任务排期、发布说明 | M5 开始前 |
| Q-006 | 是否收集遥测 / 崩溃报告？ | 默认完全关闭；仅本地日志 | 隐私、实现 | M5 |
| Q-008 | 会话有效期具体值？ | 绝对 12h、空闲 30min；过期后用 Passkey 重新认证 | 认证体验、安全 | M0 |
| Q-010 | 备份保留策略？ | 7 份日备份 + 4 份周备份；含秘密时加密；项目源码不备份 | M4/M5 | M5 |
| Q-011 | 删除 Session 时是否删除 artifacts？ | 默认保留 7 天再清理；删除前预览；不触碰项目源码 | 数据保留 | M2 |
| Q-012 | 是否提供中文以外的 UI 语言？ | V1 仅 zh-CN，字符串集中管理，预留 i18n | UI 实现 | M5 |
| Q-013 | 公网访问是否内置 TLS / 隧道？ | 不内置；文档要求用户使用 HTTPS 反代或受保护隧道 | 部署、文档 | M4 |
| Q-014 | 单文件发布是否作为硬指标？ | 不；`node app.js` 为稳定入口，允许伴随原生资源目录 | 构建、发布 | M5 |
| Q-015 | 通过 `127.0.0.1` / 局域网 IP 访问时 Passkey 不可用，如何引导？ | 只支持 canonical origin：`http://localhost:<port>`（开发）或 HTTPS 域名（生产）；IP 访问提示改用 localhost / 域名，`allow_once` 仍可用 | M0 UI、初始化向导、文档 | M0-6 |
| Q-016 | 所有 Passkey 丢失 / TUI 不可用时如何恢复？ | V1 不提供 Web 恢复；TUI 撤销后重新配对；离线恢复码仍为 P1 | 恢复流程、支持成本 | M4 |
| Q-017 | 是否允许可同步 Passkey（iCloud / Google）？ | 允许；存储 `backupEligible` / `backupState` 并在设备列表展示，不承诺物理设备绑定 | 安全文案、撤销粒度 | M0-6 |
| Q-018 | 是否保留 `允许本次` 临时访问？ | 保留；仅短期会话，不注册 Passkey，不产生长期凭据 | 兼容不支持 WebAuthn 的浏览器 | M0-5 |
| Q-029 | 正式服务如何接收 `secretRef`，避免 PM2 将明文写入元数据、dump 或日志？ | M4-3 已验证守护/应用不继承 `LARNESS_*` 合成秘密，dump/pm2.log/服务日志无标记；正式 secretRef 注入与所有落盘路径仍需在产品注入前专项验证 | PM2 正式服务注入与脱敏 | M4-3b 产品秘密注入前 |

## 已解决

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

## M2验收后保留的工程边界（2026-11-05）
M2/G2及全部纠错已获人类统一通过，见[收尾记录](../specs/030-dev-resources/closure.md)。认证E2E批量抖动、Monaco生产CSP unsafe-eval、Git 3秒轮询仍有记录，未以验收通过伪报修复；后续按独立任务处理。M3的Q-002/Q-026及隔离预览仍待相应门禁；Q-027归M4，不能从G2通过推断已解决。

## ADR-042已确认边界（2026-11-05）
M3仅开发登记/隔离预览，Q-002/Q-026仍属M3；Q-003/Q-027移到M4 PM2门禁，不再阻塞M3。完全自主在所有已授权Agent业务动作（含首次部署/替换/启停/支持的恢复）均无人工步骤，其他模式依风险决定；计划/安全校验保留，不再将“部署是否允许免人工”列为开放问题。技术schema/grant与Turn结束关系/恢复等仍待M4评审。

## M3规格评审已通过（2026-11-05）
人类“按推荐批准”，远程验证延后至上线实验；评审材料见[040/review](../specs/040-services-preview/review.md)，决策见[ADR-043](adr/ADR-043-development-preview-authorization.md)。Q-002/Q-026 已移入“已解决”，仅授权先做 M3-0；G-PoC-M3 确认后 M3-1。

2026-11-06 G-Spec-M4 已通过，M4-0 先验证全局 PM2 初始化、专用守护、退出独立性和重开后的实际状态。见 [M4 评审包](../specs/050-deploy/review.md)。
