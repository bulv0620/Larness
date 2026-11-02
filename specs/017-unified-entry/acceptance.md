# 统一入口验收记录

## U0-1 转发基础（2026-11-02，macOS / Node 20.19.3）

- 人类在设计文档提交后明确“开始实现”，G-Spec-U / ADR-028 通过，按顺序先实施转发基础，后接默认产品入口。
- 测试先行：控制消息和 HTTP 模块不存在时测试失败；生产开发专属路径原先返回 SPA，新增测试复现 200，修复后明确 404。没有删除/放宽断言。
- strict Zod 只接受当前子进程和 generation 的 loopback 目标，拒绝额外 URL 字段/旧消息/换端口/关闭后消息。固定 HTTP 上游、头剥离、来源/传输检查、realpath 根、流限额/背压/超时、CSP nonce 及 HMR 单独路由完成；DEV_WEB_UNAVAILABLE 已同步共享错误类型/REST 表。
- 真实 Vite + Chromium 使用临时前端 fixture 和假测试会话：未登录拒绝 HMR，设置测试 Cookie 后自动重连；修改临时 React 组件后真实热更新成功，无 CSP 违规，主题脚本可执行，连接始终指向统一浏览器入口。撤销事件关闭 HMR；无 nonce 注入脚本被 CSP 阻止。此处假会话用于转发模块鉴权边界，不代替 U0-3 的真实浏览器配对/Passkey 验收。
- 首轮真实 Vite 因 macOS /var → /private/var 路径别名导致根检查返回 403，统一 realpath 后通过；没有扩大允许根。开发依赖缓存使用独立临时目录，关闭时删除，不写用户数据目录；未新增/升级依赖。
- HTTP 验证认证头不进入上游、Set-Cookie 不下传、每响应 nonce 不同、分块 nonce 替换、API/未知升级路径不转发、Origin/Host 拒绝、越界 symlink/多重编码/.env/绝对文件目标拒绝；上游重定向/超大响应/断流返回脱敏 503。
- pnpm check：server 295 / agent 32 / web 26 通过；agent 的真实模型测试沿用仓库既有条件跳过，本次未新增 skip。pnpm build 通过（现有 Web chunk 体积提示保留）；本任务未切换默认 supervisor/初始化，完整模式切换、HTTPS 与真实 PTY 接线验收属于 U0-2/U0-3。
- 平台只记录本机 macOS；Linux/Windows 未实测。最终 UI/安全 G-Task 抽查留在 U0-3，当前模块验收不冒充整体交付。
