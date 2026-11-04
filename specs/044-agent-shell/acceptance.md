# M2-22 验证记录（2026-11-04 +08:00）

- 前置真实 PTY 回归先红：4/4 因服务退出后原 PTY 已结束、无法继续输入而失败。固定引导接入后通过；新增 missing/builtin 外部执行边界及显式子进程清理共 6 项。
- `pnpm --filter @larness/server exec vitest run test/resources/terminal-dev-shell.test.ts test/resources/terminal-shell.test.ts test/resources/terminals.test.ts test/resources/terminal-process.test.ts test/agent/terminalTools.test.ts test/agent/terminalControl.test.ts`：6 文件 33/33 通过。
- 真实证据：人工租约 Ctrl+C、监听端口释放/服务 PID 退出、同 terminalId RUNNING 和后续文件输入；0/9 返回、missing 程序和名为 eval 的外部程序失败后 Shell 可用；字面空格/引号/美元/换行/ETX/空参数无解释；显式 Shell exit 仍有正确终态退出码；显式 terminate 清理前台父子进程。
- 原终端输出测试按新契约等待子命令输出后确认 Shell 仍 RUNNING，再通过真实认证 WS 输入 exit 9 验证终端非零退出；秘密跨块/未知 token/管理环境过滤断言全部保留。原人工前台任务 TERM/HUP 抵抗子进程清理、Agent 参数冲突/审批篡改/人工优先/旧代输入等回归通过。
- Web 相关 TerminalClose / TerminalEntry / terminals / timelineTerminalClose：4 文件 32/32。Server typecheck、改动 TS Biome、git diff --check 通过。
- 仅验证本机 macOS arm64 / Node 20.19.3；无全量 check/build/E2E，遵从用户必要校验、自行界面验收要求。无新依赖/迁移/配置/事件字段，无用户运行数据或服务被主动修改。
- 前置验证曾发现单纯交互 Shell -c 会在 Ctrl+C 后退出，改为父 Shell trap INT + 子 exec 后真实验证通过；未采用无保护 -c、按键注入或重建 PTY。
- 兼容：只有后续新建终端生效，原直接程序 PTY 不迁移/重建。G2 仍待用户 UI/安全验收，未进入 M3。

人工验收：新建 Agent 开发终端→手动获取输入/接管→Ctrl+C，确认服务停止、原 Tab 回到提示符→运行其他命令→关闭 Tab，确认整个终端和受管任务结束。窗口关闭/最小化后恢复不终止资源；历史关闭资源的打开入口继续提示已关闭。
