# ADR-061 Windows 交互终端默认 Shell

状态 accepted。2026-11-13 用户提出选择顺序并授权实施。

[ADR-033](ADR-033-terminal-experience.md) 确立服务端选择默认交互 Shell。[ADR-038](ADR-038-agent-terminal-shell.md) 确立开发终端退出前台程序后回到同一 PTY 的提示符。Windows 依次探测 PowerShell 7、Windows PowerShell 5.1 和 CMD，供人工 Shell 及开发终端交互使用。选择依据为当前 Larness 进程可见的安装与系统可执行文件。

候选探测在创建资源前运行。PowerShell 使用固定初始化参数，禁用 profile 与历史持久化。获准程序依旧通过 Windows 开发终端引导传递原始参数，复用既有 PTY、权限与进程清理。

通过 [Windows Shell 规格](../../specs/075-windows-terminal-shell/spec.md) 中的实机与自动化场景验证。代码回滚作用于后续新建终端。
