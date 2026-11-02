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

## U0-2 中间诊断记录（后续已解决）

- URL/受管命令测试按新契约先失败后通过；定向 TUI 51 项通过。真实受管 dev 的 2 项启动/初始化/环境覆盖测试单独运行通过，构建通过。
- 两轮全量 pnpm check 中 runtime 2 项均在子进程 ready 前退出（294 通过 / 2 失败），尚未定位全量与定向环境差异，不将单独通过视为完整验收。
- 真实 PTY 的非 TTY、TERM=dumb、正常生产和 dev 正常退出均通过；终止 Vite 的场景退出等待超时，剩余 PTY 场景本轮未完成。建议调整关闭通知先后以解除互相等待，并增加脱敏阶段/退出码诊断定位前一问题。
- 按 AGENTS §9 已暂停编码并请求继续确认；本任务未提交，不能标 done，不开始 U0-3。

## U0-2 最终验收（2026-11-02，macOS）

- 人类按 AGENTS §9 明确批准“继续定位并修复，按原计划验收”，后续又指令继续，未放宽断言。定位 Vite 7 listen(0) 会回退 5173，导致全量并行启动冲突；用其公开 HTTP listener 直接绑定 0，保留真实 OS 分配。新增同时启动两个实际 Vite、端口必须不同的回归。
- Vite 关闭时先通知父进程，再等待 HTTP 清理，消除等待 Server 先断开而父进程等待 Vite 先退出的循环。真实 PTY dev-web-failure 现能非 0 退出并释放全部子进程/锁/IPC/端口/TTY。仅保留稳定退出阶段/退出码诊断，临时原始调试插桩已移除，未提交。
- 默认产品已接统一入口：实际鉴权/审计、私有 ready/attach、同代临时缓存、真正页面/客户端探测、初始化不再写 5173、发布恢复/重启和退出清理；旧 loopback HTTP 不一致配置给出一次性对齐指引，TUI 不再吞掉该诊断。
- check（server 297 / agent 32 / web 26）、build、test:smoke:init、test:tui:pty 全部通过；PTY 增加 dev 正常退出、dev Vite 故障及 dev 信号，既有生产/初始化/配对/阅读/重连/小尺寸/信号场景继续通过。
- 当前未宣称同目录真实 Passkey 模式切换和 HTTPS 反代整体通过，留给 U0-3。无用户数据/配置修改，无 schema/业务 IPC/WS 协议版本变化。


## U0-3 整体验收（2026-11-02，macOS / Node 20.19.3）

- 新增 `pnpm test:smoke:unified`，需要先 build、安装 Playwright Chromium，并有 `openssl`。复制可丢弃源码工作区，所有前端修改、数据库、密钥和证书只在临时目录；不改用户项目、配置或运行数据。CI 在既有 E2E 后运行该命令，Linux CI 结果不冒充本机实测。
- 真实 HTTP dev → built → dev 使用同一数据目录、浏览器上下文和虚拟认证器：首次配对/注册后正常 Passkey 登录，项目/会话/设备/凭据 ID 保持，主密钥字节不变，假凭据可离线解密；切换期间不再次初始化或配对。测试中将临时会话空闲时间置为过期，确认切换不复活旧 Cookie，随后 Passkey 重新登录可用。
- 真实业务 WS 完成订阅，实际 Monaco TypeScript worker 返回诊断；修改临时 React 模块后 DOM 热更新，文档哨兵保留（没有页面重载），业务 WS 仍为 OPEN。全部浏览器 WS 只连接公开入口；设备撤销后 HMR 和业务 WS 关闭、REST 返回 401；日志不含测试假密钥或配对码。
- 临时自签证书 HTTPS 反代使用不同内外端口、配置 trustedProxies；同目录 dev → built 的真实 Passkey、API、业务 WS、Monaco worker 和 wss HMR 通过，无 CSP 违规。仅测试浏览器上下文忽略该临时证书错误，产品未放宽 TLS/Origin 检查。
- 旧 HTTP 来源/监听端口不一致时两模式拒绝，原 config 字节不变且没有创建运行数据；按指引一次性手动对齐后两模式可用。同目录并发启动拒绝，原实例仍健康。
- built 子进程通过 Node ESM loader 主动禁止解析 Vite，仍能完整登录/使用工作空间；`/@vite/client` 返回 404。生产开发保留路径负例另由 static 测试覆盖。
- 真实链路先复现并修复：Monaco 的 9 MiB 第三方源码被 Vite 兜底内联 map 膨胀为约 45 MiB，超过 32 MiB 上限；省略大型 vendor 的兜底 map 后约 9 MiB，不提高上限。主题初始化移为同源模块，消除生产内联脚本 CSP 拒绝，不放宽 CSP。依赖首轮预构建在 ready 前完成。
- 退出登录后 Vite 默认匿名 `vite-ping` 被鉴权边界拒绝，导致 HMR 无法恢复；新增真实重鉴权回归先失败，随后改为使用相同鉴权连接重试，登出/重新登录后真实热更新通过。worker 夹具显式等待语言服务异步注册，不把该注册时序误判为网络失败。
- 启动探测读完响应体，避免未消费的开发资源影响关闭；已被信号终止的子进程不重复等待。supervisor 清理已验证同代缓存，新增 Vite SIGKILL 的真实 PTY 验收。PTY 缓存使用短的独立临时根，避免夹具的长 TMPDIR 超过 Unix socket 路径上限；未修改 IPC 产品行为。

- 最终命令结果：`pnpm check`（server 297 / agent 32 / web 26）、`pnpm build`、`pnpm test:smoke:unified`、`pnpm test:smoke:init`、`pnpm test:tui:pty`、Demo 15 / auth 2 / prod 2 E2E 全部通过。agent 原有条件式真实模型测试仍按既有环境条件跳过；无新增 skip。保留既有 lint/chunk 提示，未放宽检查。auth/prod 共用 IPC 定位文件，按序运行。

### 场景与证据

| 场景 | 自动化证据 |
|---|---|
| U1/U4 | runtime.test.ts、init smoke、真实 PTY 的初始化/重启/环境覆盖 |
| U2 | unified smoke 的 HTTP 同目录三次切换、真实 Passkey/数据/密钥检查 |
| U3 | unified smoke 的 legacy 无写入拒绝与手动对齐 |
| U5 | unified smoke 真实 HMR + Monaco worker + 业务 WS；vite.test.ts 重鉴权热更新 |
| U6 | HTTP/HMR 鉴权集成、真实配对与重登录、设备撤销、空闲过期 |
| U7/U8 | control/http/static 测试：固定目标、路由、头、来源、realpath 与恶意路径 |
| U9/U10 | runtime 测试、真实 PTY 正常/故障/SIGKILL/信号/启动中断清理 |
| U11 | unified smoke 临时 TLS 反代、真实 wss、Passkey 和模式切换 |
| U12 | built 禁止解析 Vite 的实际运行、开发路径 404 测试 |
| U13 | unified smoke 的同目录锁冲突和过期会话切换 |

脱敏界面记录（均为临时 fixture，无配对码、Cookie、密钥）：[首次 dev](evidence/http-1-dev.png)、[built](evidence/http-2-built.png)、[切回 dev](evidence/http-3-dev.png)、[HTTPS dev](evidence/https-1-dev.png)。已检查自动截图，不能代替负责人的 G-Task 验收。

### 人类抽查（2026-11-02 已通过）

人类在初始化文案修正后明确“验收通过”，本轮统一入口与文案修正验收完成。以下保留复验步骤：

1. 选定同一 `LARNESS_DATA_DIR`，确认有效 publicUrl/监听端口一致；若为旧 3210/5173 配置先按 README 一次性对齐。
2. `pnpm dev` 进入工作台后退出 TUI，再用 `node app.js` 访问同一地址，确认原项目/会话/模型凭据仍在并能用 Passkey 登录；关闭后再切回 dev。
3. dev 登录后修改管理前端组件，确认无需刷新即可更新；日志页返回、正常退出与信号退出均恢复终端并停止服务。

仅记录 macOS 实机；Windows/Linux 未作本机验收。U0-3 人类 G-Task 已通过，切片关闭，M2 仍为 draft。
