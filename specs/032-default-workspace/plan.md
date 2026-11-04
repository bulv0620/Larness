# M2-10 实施计划
1. 先测共享新会话 / 历史路径保留 / 默认 scope 文件权限和终端 cwd。
2. 集中默认目录 helper，复用既有 global-terminal/workspace；新会话写共享路径，旧记录不改。
3. 扩展严格 FileScope / file stream / REST / WS；共享根统一版本 / 事件 / 锁；人工默认终端与 Agent 会话授权根匹配。
4. Web 默认入口 / 标签 / 文件树 / 同组窗口；legacy 会话仍独立。
5. 真实 Agent / PTY 与浏览器验收；同步契约与状态，无迁移，提交。
