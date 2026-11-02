# 运行入口与开发前端转发契约

> 状态：accepted（2026-11-02 人类指令开始实现）；配套 [ADR-028](../adr/ADR-028-unified-dev-entry.md) / [017 spec](../../specs/017-unified-entry/spec.md)。U0-1/U0-2 已实现模块和默认产品接线；同目录真实模式切换整体验收属于 U0-3。

## 1. 地址和配置

两种模式从同一个 dataDir 加载 config.json，沿用现有环境覆盖。server.host/server.port 控制 Server 监听；publicUrl 或现有 deriveWebAuthn 控制浏览器 canonical origin。publicUrl=null 时默认 http://localhost:<server.port>。同一目录只能运行一个实例。

内部 Vite 使用 OS 自动分配的 127.0.0.1 端口，不是 publicUrl、server.port 或配置持久化内容。无新的用户配置键/用户环境变量，无配置版本、IPC/业务 WS 版本或数据库变更。

旧 loopback HTTP 来源端口不一致时保持启动拒绝，提供一次性修改指引；推荐保留原 publicUrl/RP ID，将 server.port 对齐其端口。不会自动删除/重建数据或改写文件。HTTPS 反代来源（含本机 TLS fixture）不要求端口与本机监听端口相同；该旧 HTTP 直连配置检查不适用于它。

## 2. 内部控制消息（拟议）

下表仅为 supervisor 与其 Node 子进程之间的私有 process IPC，不加入本机业务 IPC methods 或浏览器 API。所有消息使用 strict Zod schema。

| 方向 | 消息 | 字段/限制 |
|---|---|---|
| Vite wrapper → supervisor | dev-web.ready | generation：本次启动 UUID；host：字面量 127.0.0.1；port：整数 1–65535；只能接受当前 wrapper 的 IPC 消息 |
| supervisor → Server | dev-web.attach | generation 与已验证的同代目标；仅受管 dev 生效，在页面转发就绪前处理 |
| Server → supervisor | dev-web.attached | 对应 generation；仅表示目标已配置，最终就绪仍需 HTML/资源探测 |

目标生命周期与进程实例绑定；重复同代消息幂等，不接受过期消息/运行中任意换目标。控制通道断开使开发转发失效并触发整组停止，不退回环境 URL。显式附加/解绑不落盘；目标和握手材料不返回 system.status。

启动顺序：TTY 检查 → 解析地址和待恢复的有效配置（待发布配置由 Server 在监听前恢复） → 启动 Vite/获取 ready → 启动 Server/attach → health 与统一入口 HTML/资源检查 → 连接现有 IPC/初始化/TUI。任一步失败共用幂等清理。初始化导致有效地址变化时，按原流程停掉整个旧运行环境再重启，不借用旧代 Vite。

## 3. HTTP 路由分派

| 请求 | dev | 打包运行 |
|---|---|---|
| /api 及 /api/* | Server 路由/错误；未知路径也不进 Vite | 同左 |
| /ws 及其保留子路径 | 业务 WS 或拒绝，不进入前端回退 | 同左 |
| /_larness/dev/hmr | 仅有效 WS upgrade；普通 HTTP 404 | 404，无升级处理器 |
| 其他 /_larness/* | 404 | 404 |
| GET/HEAD 页面、前端模块、资源 | 通过安全检查后转发固定 Vite | 原有静态/SPA 规则；开发专属路径例外见下 |
| 前端路径的其他 HTTP 方法 | 拒绝，不转发；使用既有 NOT_FOUND/404 | 原有路由规则 |

打包运行的 /@vite/*、/@react-refresh、/@fs/*、/@id/*、/src/*、/node_modules/*、/__vite*、/__open-in-editor 以及 /_larness/* 明确 404，不能被通配 SPA 返回 index.html。现有业务 REST/WS 路径不改变。

前端资源允许根是受管程序已知 realpath 集合：apps/web、packages/ui、packages/shared 与其必要前端依赖（含 pnpm 实际 store 中解析到的依赖根）；不允许整个仓库、任意 node_modules 上级、用户项目或数据目录。逻辑模块路径/编码解析必须与 Vite 解析一致，多重编码/畸形路径失败关闭；/@fs 只允许明确根内的实际资源。拒绝 .env、密钥/config/DB/日志、Server 源码和越界 symlink；由 Vite fs.strict / fs.allow / fs.deny 与入口边界联合验证。禁止 open-in-editor 等开发控制请求。缺失资源保持错误，不能由转发器任意重写成 HTML。

前端请求要求合法 Host；有 Origin 时必须符合当前管理来源规则，无 Origin 的浏览器导航可用。远程传输仍要求 HTTPS/trustedProxies；不能用 Vite 的宽松 CORS 绕过入口，不能反射任意 Origin。

## 4. 头、流和错误

- HTTP 请求剥离 Cookie、Authorization、Proxy-Authorization、x-csrf-token、Forwarded、X-Forwarded-*、hop-by-hop 头；HMR 先由 Server 校验会话，再以受控 Upgrade/Connection 建立上游握手。上游 Host 固定为已登记内部目标，不采用浏览器输入；Vite allowedHosts 保持明确列表，Origin 保留已校验值。
- 响应丢弃 Set-Cookie、hop-by-hop 头和上游 CSP/CORS；CSP/跨源策略由管理入口统一设置。禁止将内部目标的 Location 发给浏览器，不跟随上游重定向。外部重定向也不得成为可选代理目标。
- dev HTML/模块 no-store；HTTP 采用流式背压，单响应上限 32 MiB，不完整缓冲任意响应；转发端连接/响应首部超时 5 秒、响应传输空闲超时 30 秒。浏览器断开即销毁上游流，停机销毁全部代理流。启动探测须覆盖冷启动资源转换，依赖扫描与首轮预构建在就绪前完成。大于 1 MiB 的第三方模块省略 Vite 的兜底内联 source map，避免 Monaco TypeScript 服务被重复嵌入后超限；不改变源码内容或 32 MiB 上限。
- 新拟议错误 `DEV_WEB_UNAVAILABLE`，HTTP 503，使用既有错误结构，消息为“开发页面暂不可用，请查看本机 TUI”；仅在响应未开始时返回，已发部分内容则中断连接。不返回内部地址/路径、原始异常/堆栈或认证材料，不把 Vite 不可用伪装成静态 dist 成功。
- 现有业务错误仍由原处理器返回。U0-1 已同步 shared 错误 schema 和 REST 错误表；默认产品接线属于 U0-2。

## 5. HMR 与安全头

- 专用路径 /_larness/dev/hmr，与 /ws 分开；仅 dev 且当前目标已附加时处理。浏览器连接地址使用当前 canonical origin 对应的 ws/wss，设置 clientPort/path，不暴露或回退内部端口。
- 握手先按现有 resolveActiveSession 校验有效会话（含绝对/空闲期限）、canonical Origin 和 transportAllowed，错误复用 UNAUTHENTICATED / ORIGIN_INVALID / HTTPS_REQUIRED；无会话不能以 localhost 豁免。登录/配对页可加载公开壳资源，HMR 在登录成功后重试；登出断开后也经相同鉴权通道重连，不使用匿名 vite-ping 探活，不回退内部端口。旧设备撤销/会话撤销事件需关闭对应 HMR，期限至少按现有业务 WS 的心跳频率复核，不将 HMR 心跳视为用户活动延长空闲期限。
- 仅允许 Vite HMR 的受控握手/子协议；保留 Vite 自身 token 验证，不实现通用 WS 隧道。握手查询串/子协议中的临时材料不得进入日志/审计/错误/截图。审计拒绝时仅记录脱敏路径、稳定原因和关联 ID。
- 帧上限 1 MiB，待发送缓冲上限 8 MiB，超限关闭连接，不能无界积压；停止/上游断开/授权失效都关闭双向连接。未知 upgrade 直接拒绝，不抢占业务 WS。
- dev HTML 逐响应生成不可预测 nonce，并给 Vite/React refresh 注入的合法内联脚本附加对应 nonce；主题初始化使用同源模块；script-src 使用 self + nonce，保持其余当前 CSP 限制。样式策略沿用当前允许内联样式；不新增 unsafe-eval 或 script unsafe-inline，不去掉 frame-ancestors。不能直接透传任意 Vite 错误 HTML 绕过 nonce 流程。
- 生产静态 CSP 与业务 API CSP 不变。真实 Chromium 验证登录、主题、React refresh、Monaco/worker、业务 WS 和 HMR，无 CSP 控制台错误且恶意脚本不执行。

## 6. 故障和退出

Vite 退出/控制通道中断使 dev 运行环境失败；supervisor 停止本次 Server 与剩余子进程，不影响其他数据目录实例。HTTP 连接短暂失败先按上节返回，若进程已退出则走整体清理。公开端口冲突不自动跳号，内部端口由 OS 分配不持久化。正常退出、重复信号、初始化重启、启动失败均释放转发连接、监听、锁、IPC 和 TUI 原始模式；Vite wrapper 被 SIGKILL 后，仍存活的 supervisor 清理已验证同代临时缓存；supervisor 自身被 SIGKILL 的限制沿用 ADR-023。
