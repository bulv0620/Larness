---
id: 017-unified-entry
title: 开发与打包运行统一入口
milestone: M0-followup
status: active
depends_on: [016-tui-experience]
owners: [human]
created: 2026-11-02
updated: 2026-11-02
---

# 开发与打包运行统一入口

> 2026-11-02 人类明确“开始实现”，G-Spec-U / [ADR-028](../../docs/adr/ADR-028-unified-dev-entry.md) 已批准；按 U0-1→U0-2→U0-3 先于 M2 实施。配套：[入口契约草案](../../docs/contracts/runtime-entry.md)、[计划](plan.md)、[任务](tasks.md)、[评审包](review.md)。

## 1. 目标与非目标

- 同一实例轮流运行 pnpm dev 和构建后的 node app.js 时，浏览器地址、配置、数据库、模型凭据与设备授权记录一致。
- 新实例默认使用 http://localhost:3210；有效配置和用户环境覆盖优先，不按模式改写 publicUrl。
- dev 使用受管 Vite 支持热更新，打包使用静态文件；TUI 仍是前台入口，退出停止全部。
- 非目标：同时运行两种模式、合并两个既有数据目录、数据库降级、自动更换域名/RP ID、放宽认证、多来源登录、通用代理、项目 Preview、headless、修改在线会话统计或新增配置编辑器。

## 2. 当前行为及拟改变内容

当前 dev 的 Web 固定 5173，初始化把它作为来源持久化；打包后 Server 的 Web 在配置监听端口。supervisor 的 loopback 端口检查因此拒绝切换。

拟保持 Server 为稳定入口，开发时内部转发本项目 Web；取消首次 dev 写入 5173 的特例。现有 ADR-023/025 和已完成 spec 的原文保留；本切片批准后只在当前契约/README 校准新行为，不能把旧验收改写为新证据。

## 3. 地址、配置与既有数据

| 项目 | dev | 打包运行 |
|---|---|---|
| 数据目录 | 现有 resolveDataDir；默认 OS 目录或 LARNESS_DATA_DIR | 相同 |
| 配置 | config.json + 同一组现有环境覆盖 | 相同 |
| Server 监听 | server.host / server.port | 相同 |
| 浏览器地址 | publicUrl，否则 localhost:server.port | 相同 |
| 前端实现 | 内部受管 Vite | 已构建静态文件 |
| API / 业务 WS | 当前 Server 直接处理 | 相同 |

1. server.port 仍是实际监听端口，内部 Vite 端口不写入配置、DB 或浏览器；不增加 user-facing devPort / devOrigin 配置。
2. publicUrl=null 按现有 deriveWebAuthn 推导；配置优先级、RP ID 推导及环境覆盖不变。不自动把 127.0.0.1 改成 localhost，不迁移浏览器存储。
3. 旧配置 publicUrl=http://localhost:5173、server.port=3210 时，两种模式给出相同的启动前诊断：保持 publicUrl，用户一次性将 server.port 对齐为 5173；关闭实例后修改原 config.json，保留其他字段。生效后 dev/打包都从 5173 提供页面。不默改文件、不重跑初始化；无环境覆盖时无需每次添加启动变量。自定义 loopback 端口不一致按同一规则处理，端口占用时拒绝启动而非自动换外部端口。
4. 反代场景的 HTTPS 域名允许端口与内部 server.port 不同；继续使用 trustedProxies 和远程 HTTPS 检查，不把“端口不同”一概判为非法。TLS 仍由既有外部设施终止；反代需同时转发 HTTP、业务 WS 和 HMR 到 Server。
5. 两个已经独立的目录不自动合并，用户通过现有 LARNESS_DATA_DIR 选一个；已初始化 DB 不再 init.apply，不删除密钥、Passkey、会话或模型配置。有效登录能否保留仍受正常的绝对/空闲过期、撤销及原有重启语义约束；不承诺强制保持登录。
6. 同目录同时启动由锁拒绝；不同版本代码/DB 兼容性不在本切片保证范围内。测试使用同一源码版本构建的产物和临时目录。

## 4. 启动、转发与 HMR

- supervisor 仍持有 Server / Vite 子进程；dev 的 Vite wrapper 通过 Node 子进程 IPC 上报已监听的 127.0.0.1 端口，OS 以 port=0 分配，避免扫描空闲端口后再绑定的竞态。消息须验证来源子进程、代号、Zod schema；旧消息不能覆盖重启后的目标。
- supervisor 将已验证的内部目标经 Server 子进程控制消息传入；仅受管 dev 启用，超时/退出后目标失效。产品入口没有新增 TCP 管理接口，也不信任从环境中注入的任意目标 URL。
- Server 前端 GET/HEAD 转发固定上游；具体边界见契约。API 保留优先级，未知 /api 也不回退前端。业务 /ws 与专用 /_larness/dev/hmr 分派明确；未知 upgrade 拒绝。
- HMR 的浏览器地址从统一 canonical origin 推导 ws/wss、主机和端口；禁止 Vite 直连回退内部端口。HMR 需同源、有效会话及传输策略；登录/配对前无热更新连接，壳页面和业务认证正常；登录成功后允许 HMR 重连。
- 热更新连接过期/撤销即断开；内置 Vite HMR token 检查保留，不将握手 token 和查询串写入日志。业务 WS 的协议与授权行为不变。
- 启动就绪同时验证 Server health、通过统一入口获取有效 HTML/开发资源以及 Vite 存活；不能仅因 Vite 内部能访问便进入概览。开发服务缺失或错误不得回退旧 dist 冒充 dev。
- Vite 启动失败或运行中退出使 dev 运行环境失效，supervisor 停止整组服务并清理。短暂转发连接失败返回脱敏错误；无重放写请求。正常/信号退出和超时兜底沿用已批准生命周期。

## 5. 接口、数据、安全与权限

- 现有 AppConfig version=1、IPC protocolVersion=1、业务 WS protocolVersion=1 保持；无数据库迁移，无新的业务 REST 方法。
- 新内部控制 DTO、开发 HMR 路径、开发转发失败码见 runtime-entry.md；只在批准后的实现提交中接线并同步 REST 错误表/测试。当前冻结契约不因草案自动改变。
- 前端是可信管理应用源代码；不代理用户项目或允许 URL 选目标，M3 Preview 仍走独立来源。内部转发不改变 Cookie/CSRF/Origin/WebAuthn 校验。
- Vite bind=127.0.0.1，限制真实文件根到 Web、ui/shared 和必要前端依赖；不暴露 Server 源码、config.json、DB、日志、主密钥、.env、越界符号链接或任意目录。GET/HEAD 外不转发；禁用 open-in-editor 等不需要的开发控制操作。
- 页面/资源转发剥离请求的认证与代理头，以及响应的 Set-Cookie。浏览器的认证 Cookie 仅供 Server 检查；HMR 先鉴权再剥离并转发；Vite 不充当认证服务器。
- dev HTML 的逐响应 nonce CSP 适配覆盖现有主题内联脚本与 React refresh 引导，不能靠禁用 CSP/放宽生产策略通过验收。来源与 Host 严格校验，拒绝任意网页跨源读取管理前端开发源码或建立 HMR。
- 打包模式不注册开发转发/HMR，不加载 Vite 运行依赖；未知开发路径返回 404，无开发接口回退到静态 SPA。依赖保持当前冻结版本；需要新依赖时暂停评审。

## 6. 失败与边界

| 条件 | 结果 |
|---|---|
| 外部端口占用、同目录实例已运行 | 拒绝启动，说明冲突；不改端口、不中止既有实例 |
| 旧 loopback HTTP 配置端口不一致 | 启动前给出一次性对齐指引，数据与配置不变 |
| 初始化发布恢复未完成 | 保持 ADR-024 恢复优先级；不能以地址统一绕过失败关闭 |
| Vite 非法上报/超时/退出，Server 启动失败 | 不就绪，停止已启动子进程，恢复 TUI，非 0 退出 |
| 转发超时/内部连接中断 | 最多 5 秒等待连接/响应首部，未发响应前返回 DEV_WEB_UNAVAILABLE；已开始响应则终止流，不拼接错误 JSON |
| HMR 无会话、Origin 错误、过期/撤销 | 拒绝握手或关闭连接；不能直连 Vite 回退；登录页面仍可使用 |
| 未知 HTTP 路径/upgrade、恶意目标或越界文件 | 拒绝；不转发其他主机/端口，不以 SPA 回退掩盖业务错误 |
| HTTPS 反代 | 使用配置来源及 trustedProxies；外层端口与内部端口不同不误报；不自建 TLS |
| TUI 退出、Ctrl+C、SIGTERM/SIGHUP | 停止 Vite/Server 和在途流/WS，释放锁/IPC/监听与终端；SIGKILL 限制不变 |

## 7. 验收场景

| ID | Given | When | Then |
|---|---|---|---|
| U1 | 空的临时数据目录、默认配置 | dev 初始化并批准配对 | Web/API/业务 WS 都用 localhost:3210，publicUrl 不被特例写为 5173，确认才初始化 |
| U2 | dev 已注册 Passkey、存在项目/会话/模型假凭据 | 正常退出，使用同版构建打包运行，再切回 dev | 同一地址、同一 DB/密钥与授权记录；正常认证继续可用，无重新初始化/配对要求，无模型明文泄漏 |
| U3 | server.port=3210，publicUrl=http://localhost:5173 的旧目录 | 首次启动并按指引一次性对齐端口，再轮流启动 | 初次拒绝无数据修改；对齐后两模式用 5173，不改 Origin/RP ID，不要求每次环境覆盖 |
| U4 | 默认或自定义一致端口，含环境覆盖 | 两模式启动并完成初始化 | 同样的有效配置/URL，环境值不意外持久化；内部 Vite 自动端口不影响入口 |
| U5 | dev 已认证且业务 WS 活跃 | 修改临时测试前端模块/样式 | 经统一地址真实 HMR 更新，浏览器无内部端口连接；业务 WS 仍能收发/重放，无 CSP 错误 |
| U6 | 未配对/无会话、错误 Origin 或已撤销会话 | 打开壳页面、建立 HMR/访问业务 | 壳及配对/登录可用；非法 HMR/业务仍拒绝，登录后 HMR 可重连，撤销/过期后连接关闭 |
| U7 | 未知 API、业务 /ws、恶意 upgrade/上游参数 | 请求统一入口 | API 不走 Vite；仅专用路径可转发 HMR，不发生 SSRF、目标切换或跨路由抢占 |
| U8 | 假 Cookie/Authorization/CSRF 和恶意路径 | 请求页面/资源及 HMR | 上游不收到认证材料，Set-Cookie 不下传；数据目录/.env/Server 源码、穿越/符号链接访问被拒绝 |
| U9 | Vite 未就绪/故障或公共端口占用 | 启动、请求或继续运行 | 明确失败、无旧 dist 回退；清理当前子进程，保留其他实例；错误无秘密/内部目标 |
| U10 | TUI 正常页/阅读页，含正在传输的 HTTP/HMR | 退出确认、Ctrl+C 或信号 | Server/Vite/转发连接全部关闭，端口/锁/IPC/终端恢复，非 TTY 不启动子进程 |
| U11 | 自定义 HTTPS 域名经测试反代到 Server | dev 与打包轮流注册/登录/访问 | canonical Origin 一致、Cookie/CSRF/WebAuthn/业务 WS 校验不放宽，开发 HMR 使用 wss 和外层地址 |
| U12 | 打包模式且无 Vite 依赖可加载 | 请求静态页面和开发保留路径 | 产品页面可用，开发路径 404，不启动内部 Vite，无开发代码加载 |
| U13 | 同一目录已有运行实例或已过期会话 | 切换/并发启动/重新登录 | 锁拒绝并发；会话仍按原规则过期，不因模式切换复活 |

## 8. 测试与完成定义

- 单元/集成先失败：URL 推导、旧配置诊断、路由优先级、子进程消息验证、头处理、路径/Host/Origin、流超时、upgrade、晚到消息及幂等关闭。
- 真实受管 Vite 集成验证 HTML、React 引导/主题 CSP、依赖/Monaco/worker/CSS 资源和 HMR，不只用假上游证明完成。
- 同一临时数据目录和浏览器上下文顺序执行 dev → 打包 → dev，含虚拟认证器、假密钥解密可用性及业务 WS；auth/prod 旧脚本若共用定位文件仍串行运行。前端编辑使用可丢弃测试工作区，不改用户源码或真实配置。
- 真实 PTY 验证两个运行模式的初始化、退出/信号/失败清理；反代场景用临时证书和临时 TLS fixture，不读取真实私钥。平台结论只据实际运行记录。
- 每任务 pnpm check / pnpm build；最终 Demo/auth/prod E2E、初始化 smoke、PTY 和本切片新增真实切换/HMR 验收。新增脚本由 U0-3 落地前不声称已存在。
- 完成需逐项关联 U1–U13、更新契约/README/STATUS、逐任务提交，人类 G-Task 抽查通过。当前只有文档，不勾选实现验收。

## 9. 开放问题与门禁

2026-11-02 文档完成后人类明确“开始实现”，批准 ADR-028、G-Spec-U、旧 5173 一次性手动对齐策略和 U0-1～U0-3 先于 M2 的顺序实施。当前按任务验收，整体安全/界面抽查留在 U0-3。
