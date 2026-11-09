# 支持范围与已知限制

> 状态：2026-11-09。仅列出已验证或明确未实现的内容；未验证不等于支持。
> 安装/升级见 [install](guides/install.md)，发布见 [release](process/release.md)，安全见 [review](security/review.md)。

## 1. 支持矩阵

| 平台 | Node | 安装 | TUI / Server | 终端 | 命令 | PM2 | 状态 |
|---|---|---|---|---|---|---|---|
| macOS Apple Silicon | 22.22+（22.x）/ 24+ | npm 全局 | 已验证 | 已验证 | 已验证 | 已验证 | 支持 |
| macOS Intel | — | — | — | — | — | — | **不支持** |
| Ubuntu 22.04 / 24.04 x64 | 22.22+（22.x）/ 24+ | 预期 npm | 待实机 | 待实机 | 待实机 | 待实机 | 待验证 |
| Windows 11 x64 | 22.22+（22.x）/ 24+ | npm 全局（预期） | 待实机 | **承诺支持，当前未实现** | **承诺支持，当前未实现** | 待实机 | 承诺支持 / 待实现 |
| WSL | 跟随发行版 | 视作 Linux | 单列 | 单列 | 单列 | 单列 | 不计 Windows 原生 |
| Linux musl / ARM、Windows ARM | — | — | — | — | — | — | 不承诺 |

- macOS Apple Silicon 实测 Node.js 22.23.4 和 24.22.2。后续 Node.js 主版本的原生模块兼容性待验证。
- Windows 的 `TerminalManager` / `CommandManager` 当前对 `win32` 返回 `RESOURCE_UNAVAILABLE`；在实现前不能声称支持 Windows 终端/命令/PM2。
- Linux 的 `node-pty@1.1.0` 没有预编译，可能需要 `build-essential`、`python`、`make` 编译。
- `better-sqlite3` 固定 `13.0.3`。npm 包自带 Node-API 预编译文件，Windows / Ubuntu 仍待实机。

## 2. 更新与发布

- **不自动更新**：TUI 只提示 npm 新版本，用户执行 `npm install -g larness@latest`。
- **无签名更新包 / Launcher / UpdateLock / 自动回滚**：由 npm 负责版本安装；降级用 `npm install -g larness@<version>`。
- **升级前自动备份数据库**：迁移前 `VACUUM INTO`，失败拒绝迁移；保留最近 5 份。
- **无 CI**：仓库不配置 GitHub Actions；发布由维护者本地执行并记录三端结果。
- **无 provenance**：本地发布不能生成 npm provenance；需要时由人类另行配置。

## 3. 安全边界

- **不是沙箱**：命令、npm scripts、Agent 工具、JS 定时任务、PM2 服务均以 Larness 运行账户权限执行。
- **完全自主策略**：`autonomous` 下已登记工具免逐次审批；风险需用户确认。
- **PM2 不是安全边界**：正式服务环境、密钥注入与进程权限仍需专项验证。
- **文件白名单只约束 Larness 工具**：外部进程可绕过应用锁。
- **本地信任**：同 OS 账户可读取数据目录、备份、IPC Token。
- **预览**：只允许已登记本机服务；远程独立域 HTTPS 未实测。

## 4. 功能限制

- macOS Intel 不支持。
- Windows 终端/命令/PM2 未实现；WSL 不计 Windows 原生。
- 无外部通知（邮件 / Webhook / 系统通知）；定时任务只在应用内提示。
- 定时任务只支持 5 字段 Cron / 60 秒至 7 天的固定间隔；不支持任务 DAG、自动重试 / 退避。
- Agent 不能创建 / 修改定时任务；只能由已认证 Web 操作。
- 无自动更新、自动回滚、签名发布包。
- 无多用户 / 多租户；单工作空间。
- 图片输入未开放（即使模型支持视觉）。

## 5. 使用说明

- npm 11 可能提示 `install-scripts` 未审查；若策略阻止，使用
  `npm install -g larness --allow-scripts=node-pty@1.1.0`。
- 旧会话无 `model.usage` 时圆环显示“暂无统计”；推理正文刷新后不重放。

工程遗留项与待验证场景见 [遗留问题](open-questions.md)。

## 6. 平台验证清单

每个平台记录：

- OS 版本 / 架构 / Node / npm
- `pnpm check` / `pnpm build`
- `node scripts/platform-smoke.mjs`
- `node scripts/verify-npm-pack.mjs --install`
- TUI、终端、项目、会话、文件/Git、PM2（若支持）
- 失败日志与限制

未验证项保持“待实机”，不写成“通过”。
