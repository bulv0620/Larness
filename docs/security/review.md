# 安全复核与残余风险（M5-5）

> 状态：2026-11-08 复核，范围 macOS Apple Silicon + 当前已实现功能。Windows / Ubuntu 未验证项单独标注。
> 方法：以代码路径、契约、ADR、现有测试与验收记录为证据；没有证据的项标“未验证”，不把“未发现”写成“已证明安全”。
> 相关：[安全模型](../architecture/security.md)、[CONSTITUTION](../../CONSTITUTION.md)、[REST 契约](../contracts/rest-api.md)、[WS 契约](../contracts/ws-events.md)。

## 1. 结论摘要

- macOS 范围未发现新的、需要阻止发布的高危缺陷。
- 产品仍是**单机、单工作空间、可信开发机模式**：不提供 OS 级沙箱；Agent 命令、脚本任务、PM2 服务与项目依赖都以 Larness 运行账户权限执行。
- 更新链路已改为 **npm 提示 + 用户手动安装**，不再声称签名发布包或自动回滚；升级前仅自动备份数据库。
- Windows 终端/命令/PM2 尚未实现（代码对 `win32` 返回 `RESOURCE_UNAVAILABLE`）；Ubuntu 待实机。二者不得标为已支持。
- 残余风险与未验证项见 §3、§4。

## 2. 复核矩阵

| 领域 | 结论 | 证据 | 残余风险 / 边界 |
|---|---|---|---|
| 初始化 / 配对 | 通过（macOS） | `apps/server/src/pairing`、`init`、TUI；ADR-006/024/025；`test/pairing`、`test/tui` | 本机操作者误批准；TUI 不可用时无法新增设备 |
| Passkey / WebAuthn | 通过（macOS） | `apps/server/src/webauthn`；ADR-021；`test/webauthn`、auth E2E | 可同步 Passkey 不等于物理设备绑定；RP ID / Origin 限制 |
| 会话 / CSRF / Origin / HTTPS | 通过 | `auth/sessions`、`security/guard`、`csrf`；`test/auth`、`test/security` | 已授权 Cookie 失窃；反向代理配置错误 |
| 本机 IPC / TUI | 通过 | `ipc/`、`tui/`；IPC Token 文件 0600；保活/重连测试 | 同 OS 账户可读进程/数据；非跨用户隔离 |
| Agent 工具与审批 | 通过（策略） | `packages/agent`、`modules/agent`、ADR-040/050 | autonomous 免逐次审批；任意命令仍有账户权限 |
| 项目边界 / 文件锁 | 通过 | `files/scope`、`locks/`、`projectWriteLock`；路径与锁测试 | 外部进程可绕过应用锁；不声称 OS 原子性 |
| Secret Store | 通过 | `security/secretStore`、AES-256-GCM、密钥文件 0600；测试 | 同账户可读密钥；进程内明文仅在调用期 |
| 日志 / 脱敏 | 部分 | `OutputRedactor`、pino、审计；脱敏测试 | 无法识别任意未知秘密；命令/脚本输出仍可能含敏感内容 |
| 预览隔离 / SSRF | 通过（本机） | `modules/previews`、票据、loopback 拨号、代理测试；ADR-043/044 | 远程独立域 HTTPS 未实测；connect 竞态残余 |
| PM2 / 部署 | 通过（macOS） | `service-ops/`、部署契约、M4 验收；ADR-046/050 | PM2 不是安全沙箱；生产密钥注入仍需专项验证 |
| 定时任务 | 通过（当前范围） | `modules/jobs`、064 验收；Cron/DST/超时/取消测试 | 脚本与 autonomous Agent 可执行任意账户操作；非沙箱 |
| npm 更新检查 | 通过（设计） | `updates/npm.ts`；065 spec/ADR | 只读 registry；不做签名；registry 被投毒风险由 npm/TLS 承担 |
| 升级前备份 | 通过（macOS） | `db/preUpgradeBackup.ts`、迁移前集成测试 | Windows 的 chmod/文件锁行为未验证；备份含加密秘密 |
| npm 包 / 发布 | 通过（0.1.0） | `package.json`、MIT、`verify-npm-pack`；npm `larness@0.1.0` | 本地发布无 provenance；需人类 2FA；原生依赖预编译/编译 |
| Windows 原生 | 未实现 | `TerminalManager` / `CommandManager` 对 win32 拒绝 | 终端/命令/PM2 不可用；不能宣称支持 |
| Ubuntu 原生 | 未验证 | 实机待用户 | node-pty 可能需编译工具；路径/进程差异待验 |

## 3. 主要残余风险（已接受）

1. **非沙箱**：任意命令、npm scripts、Agent 工具、JS 定时任务都以本机账户权限运行；文件白名单只约束 Larness 自身工具。
2. **完全自主策略**：`autonomous` 下已登记工具免逐次审批；用户选择时已确认风险。
3. **PM2 边界**：PM2 是进程管理器，不是安全边界；正式服务环境/密钥注入仍需专项验证。
4. **本地信任**：同 OS 账户可读取数据目录、备份、IPC Token；不防本机恶意账户。
5. **第三方 Provider**：DeepSeek / GLM / 兼容端点的内容、可用性与数据策略由上游决定；不发送 Larness 秘密。
6. **无 CI / 本地发布**：没有自动回归与 provenance；依赖人工发布清单与 2FA。
7. **平台差异**：Windows 终端/命令未实现；Ubuntu 待实机；macOS Intel 不支持。
8. **已知 UI / 测试债务**：Monaco 生产 CSP `unsafe-eval`；auth E2E 批量时序抖动；真实长会话压缩质量未验证。

## 4. 未验证 / 不在本切片

- Windows 11 实机：安装、TUI、终端、命令、PM2、文件/Git。
- Ubuntu 实机：`pnpm check`、node-pty 编译回退、PM2、路径/锁。
- 真实第三方兼容端点、真实长会话压缩。图片输入属于当前功能边界。
- 远程 HTTPS 反向代理 / 独立预览域的实际部署。
- npm provenance / CI 发布（按用户要求不做 CI）。

## 5. 发布前检查

- [ ] 认证、CSRF、Origin、HTTPS 回归通过；
- [ ] Agent 审批 / autonomous / 项目锁 / Secret Store 测试通过；
- [ ] 预览与 PM2 不被新改动绕过；
- [ ] `pnpm check`、`pnpm build`、`platform-smoke`、`verify-npm-pack` 通过；
- [ ] 升级前备份与降级保护通过；
- [ ] 支持矩阵与已知限制与实际一致；
- [ ] 三端实机结果（Windows / Ubuntu）已记录，或明确标未验证。

## 6. 复核结论

G5 已按 macOS 当前范围条件通过。待验证的 Windows / Ubuntu 与其他遗留项见 [遗留问题](../open-questions.md)。任何后续安全修复应另开任务，不在 M5-5 文档任务中夹带代码修改。
