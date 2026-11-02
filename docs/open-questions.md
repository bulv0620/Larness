# 开放问题

> 这里记录尚未冻结的边界问题。**默认方案不等于已批准**；涉及实现前必须由人类确认，或由 spec 明确引用为“暂定默认”。  
> 不阻塞 D0 / M0 的问题标注了截止里程碑。

## 待决

| ID | 问题 | 默认方案 | 影响 | 截止 |
|---|---|---|---|---|
| Q-002 | 预览独立来源如何落地？ | 开发：`<token>.preview.localhost`（需验证解析）；生产：配置独立注册域；无独立来源时禁用公网内嵌预览 | M3 代理、Cookie 作用域、CSP、PoC | M3 开始前 |
| Q-003 | PM2 是随包依赖还是可选外部安装？ | 先作为依赖随包，`PM2Adapter` 可替换；打包体积与 Daemon 隔离在 M3 PoC | 发布物、跨平台、升级 | M3 开始前 |
| Q-004 | 仓库许可证？ | 暂不添加 LICENSE，按私有项目处理 | 开源 / 分发 | 公开发布前 |
| Q-005 | Windows 支持的时间与范围？ | macOS 主开发；Linux CI；Windows 在 M5 前完成 PTY / 路径 / PM2 / 更新 / Passkey PoC | 任务排期、发布说明 | M5 开始前 |
| Q-006 | 是否收集遥测 / 崩溃报告？ | 默认完全关闭；仅本地日志 | 隐私、实现 | M5 |
| Q-008 | 会话有效期具体值？ | 绝对 12h、空闲 30min；过期后用 Passkey 重新认证 | 认证体验、安全 | M0 |
| Q-009 | 调度任务时区？ | 使用系统时区；每个任务显式记录时区，DST 需测试 | M5 调度 | M5 |
| Q-010 | 备份保留策略？ | 7 份日备份 + 4 份周备份；含秘密时加密；项目源码不备份 | M4/M5 | M5 |
| Q-011 | 删除 Session 时是否删除 artifacts？ | 默认保留 7 天再清理；删除前预览；不触碰项目源码 | 数据保留 | M2 |
| Q-012 | 是否提供中文以外的 UI 语言？ | V1 仅 zh-CN，字符串集中管理，预留 i18n | UI 实现 | M5 |
| Q-013 | 公网访问是否内置 TLS / 隧道？ | 不内置；文档要求用户使用 HTTPS 反代或受保护隧道 | 部署、文档 | M4 |
| Q-014 | 单文件发布是否作为硬指标？ | 不；`node app.js` 为稳定入口，允许伴随原生资源目录 | 构建、发布 | M5 |
| Q-015 | 通过 `127.0.0.1` / 局域网 IP 访问时 Passkey 不可用，如何引导？ | 只支持 canonical origin：`http://localhost:<port>`（开发）或 HTTPS 域名（生产）；IP 访问提示改用 localhost / 域名，`allow_once` 仍可用 | M0 UI、初始化向导、文档 | M0-6 |
| Q-016 | 所有 Passkey 丢失 / TUI 不可用时如何恢复？ | V1 不提供 Web 恢复；TUI 撤销后重新配对；离线恢复码仍为 P1 | 恢复流程、支持成本 | M4 |
| Q-017 | 是否允许可同步 Passkey（iCloud / Google）？ | 允许；存储 `backupEligible` / `backupState` 并在设备列表展示，不承诺物理设备绑定 | 安全文案、撤销粒度 | M0-6 |
| Q-018 | 是否保留 `允许本次` 临时访问？ | 保留；仅短期会话，不注册 Passkey，不产生长期凭据 | 兼容不支持 WebAuthn 的浏览器 | M0-5 |
| Q-021 | PTY 与项目写锁如何协调？ | 修订建议 dev / 交互终端不长期持源码写锁，支持前后端与编辑并行；明确可能并行写及串行保证边界，待 ADR-029 批准 | [ADR-029](adr/ADR-029-development-resource-execution.md) / M2 使用体验与单写保证 | G-Spec-M2 |
| Q-022 | node-pty、进程清理与文件监听是否可行？ | 设计批准后 M2-0 实机 PoC；node-pty + 原生目录监听 / 对账；失败回评审 | ABI / built 寻址、孤儿进程、文件身份与监听溢出 | G-PoC-M2 |
| Q-023 | 终端回放大小与保留策略？ | 内存 1 MiB；落盘 7 天 / 每终端 10 MiB / 总 100 MiB，先触发者轮转，过旧明确缺口 | 存储、脱敏、重连体验 | G-Spec-M2 |
| Q-024 | 人工 Git 如何审批及限定操作？ | 新资源动作绑定客户端、参数 / 仓库快照；pull 仅 ff-only / 普通 push 逐次批准 | [M2 契约草案](contracts/m2-resources.md)，不虚构 Agent Turn | G-Spec-M2 / ADR-029 |
| Q-025 | 不同项目根重叠如何加锁？ | canonical root 相等 / 祖先包含视为冲突，独立 workspace 同样纳入 | 跨项目并发不能绕过共同目录保护；M2-0 验证 | G-Spec-M2 / G-PoC-M2 |

## 已解决

| ID | 结论 | 记录 |
|---|---|---|
| Q-001 | V1 使用 Passkey / WebAuthn，不再签发长期设备 Token | [ADR-021](adr/ADR-021-passkey-v1.md) |
| Q-020 | 2026-11-02 人类明确开始实现，G-Spec-TUI / ADR-027 通过，T0-1 → T0-2 → T0-3 先于 M2 | [ADR-027](adr/ADR-027-tui-screen-and-input.md) |
| Q-019 | 一个工作空间只支持一个 canonical RP ID / Origin，不做多域名 | [ADR-021](adr/ADR-021-passkey-v1.md) |
| Q-007 | 产品名与命名空间统一为 Larness；默认数据目录使用 Larness | [ADR-022](adr/ADR-022-product-name-larness.md) |

## 已确认（勿重复讨论）

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
