# ADR-028：开发与打包运行共用入口和实例配置

- 状态：proposed
- 日期：2026-11-02
- 决策者：待人类评审；当前授权为“先补充文档”，不等于批准实现
- 关联：[017 spec](../../specs/017-unified-entry/spec.md)、[入口契约草案](../contracts/runtime-entry.md)
- 影响：批准后替代 ADR-023 第 3 项的“开发 5173”入口约定，以及 ADR-025 / I0-4 的首次 dev 默认写入 5173 行为；保留其余生命周期和初始化安全决策。原 ADR 本次不修改。

## 背景

当前 dev 由 Vite 在 5173 提供页面，Server 在配置端口（默认 3210）提供 API；打包后由 Server 同端口提供页面和 API。首次 dev 初始化会持久化 publicUrl=localhost:5173，切换打包运行触发端口一致性拒绝。推荐两套数据目录只绕开冲突，无法满足同一实例轮流使用源码与构建产物的需求。

配置来源和数据库无需按运行模式拆分；必须一致的是浏览器 canonical origin、认证规则和实际提供页面的入口。

## 拟议决策

1. pnpm dev 和构建后的 node app.js 使用同一数据目录解析、config.json 与环境覆盖规则；默认浏览器入口均为 http://localhost:3210。server.port 是 Server 对外监听端口；publicUrl 继续表示浏览器的 canonical origin，合法外部 HTTPS 反代可以与内部监听端口不同。
2. dev 保留两个受管子进程：Server 和本项目 Web 的 Vite。Vite 绑定 127.0.0.1:0，由 OS 分配内部端口，以 Node 子进程 IPC 上报。Server 仅向本次 supervisor 启动的 Vite 转发前端 GET/HEAD 和独立 HMR 路径；API 与业务 /ws 不经过 Vite。浏览器和配置不包含内部端口。
3. 打包模式只加载静态产物，不启动 Vite，不启用开发转发。两种模式显示同一 Web URL，TUI 关闭停止全部；无新增 headless 产品入口。
4. 不新增持久化配置键，不提升配置、IPC 或业务 WS 协议版本。进程内 DevWebUpstream 与子进程控制消息以 Zod 校验，目标只能来自当前子进程 IPC；不能从浏览器、任意 URL、Host 或查询参数选择目标。现有 LARNESS_* 用户变量语义不按模式改变。
5. 初始化取消 5173 特例，沿用有效配置，仅在用户确认后写入，环境覆盖不无意落盘。默认值推导为 localhost:server.port。保留初始化发布恢复及已有密文的密钥校验。
6. 对已一致配置直接沿用；对旧 loopback HTTP publicUrl 端口与 server.port 不一致的配置，提供一次性对齐指引：保持原 publicUrl / RP ID / 主机名，用户将 server.port 改为其端口，例如 3210 → 5173。两种模式随后均使用 5173。程序不静默改网络配置，不删数据、不合并原本独立的两个数据库、不重设授权。环境覆盖造成的不一致需调整对应环境变量，不能持久化覆盖值。
7. 同一数据目录轮流运行，继续由单实例锁拒绝并发。共用数据不代表支持用任意旧构建打开新 schema；本切片不处理数据库降级。保留会话/设备记录不等于绕过原有过期、登出、撤销和 WebAuthn 校验。

## 安全与权限

- 本项目 Web 是受信任的管理应用；其开发资源转发不提供用户项目预览，不替代 M3 ServiceRegistry / Preview 隔离，不开放通用代理。
- 前端代码/配对与登录页面沿用公开静态壳的边界；业务数据仍由 Server 鉴权。HMR 额外要求 canonical Origin、有效浏览器会话及既有 HTTPS 策略；未配对时页面可打开，热更新连接被拒绝，不影响配对/登录。登录后重连；过期/撤销关闭 HMR。
- Vite 只允许当前 Web、packages/ui、packages/shared 及必要前端依赖的 realpath 根；拒绝穿越、越界符号链接、.env、Server 源码和数据目录。不得设置 fs.strict=false、allowedHosts=true，不能因根路径请求失败而扩大为任意磁盘访问。
- 转发前消费并剥离 Cookie、Authorization、CSRF 和不可信 Forwarded 头；响应剥离 Set-Cookie。保留受校验的 Origin，Host 使用明确允许的主机。Vite 自带 HMR 校验不关闭，开发握手材料不写日志。
- 仅独立保留路径 /_larness/dev/hmr 可升级为 HMR；业务 /ws 仍走原鉴权。未知 upgrade 拒绝。浏览器不得直连内部 Vite 或回退到内部地址。
- dev HTML 使用每响应 nonce 的 CSP 适配覆盖主题脚本及 React refresh 引导；禁止为接入 Vite 全局取消 CSP、放开 unsafe-eval 或修改生产 CSP。实现必须以真实浏览器验证，若当前工具需要新增解析/代理依赖，先单独评审，不直接导入传递依赖。

## 备选方案

| 方案 | 取舍 |
|---|---|
| 两套数据目录 | 保持隔离，但初始化、模型配置和授权分裂，不满足本需求 |
| 每次切换覆盖端口/publicUrl | 可暂时运行，但操作重复且来源容易漂移，不作为产品方案 |
| dev 中 Vite 监听配置端口，Server 改为内部端口 | 可统一地址，但改变 server.port 的监听含义，并让业务 API 绕经 Vite，不采用 |
| 将 Vite 嵌入 Server 同进程 | 少一个监听目标，但耦合生命周期和依赖加载；本批保留现有受管进程模型 |
| Server 固定入口，dev 转发内部受管 Vite | 保留 Server 授权边界和静态部署模型，承担限定 HTTP/HMR 转发测试；建议采用 |

## 影响、迁移与回滚

- 涉及 supervisor/main/init、Server 页面路由和 upgrade 分派、Vite 受管启动及配置、相关 E2E；不改数据库列、已有 REST 路径和业务 WS 事件。
- 新开发 HMR 路径及故障码为契约草案；不是业务 API，也不能在生产访问。内部端口不进 config.json、DB、IPC system.status 的 Web URL 或浏览器响应。
- 旧 5173 配置需要一次性监听端口对齐；已正确配置的 3210 或 HTTPS 反代不迁移。迁移指引不得建议删除数据或更改 RP ID。
- 回滚按任务恢复源码/构建和文档，不恢复或删除 DB/密钥。回到旧入口实现时可能再次要求显式端口覆盖；不能通过自动搬迁数据“修复”。
- Linux/Windows 支持以实机记录为准；首先在 macOS 真实 PTY/Chromium 验证。

## 验证与门禁

G-Spec-U / 本 ADR 批准后，U0-1 → U0-2 → U0-3 顺序实现并分任务提交。验收同一地址、同一临时数据目录下 dev → 打包 → dev 的真实配对/Passkey 登录、数据/密钥保留、HMR 与业务 WS 共存、恶意转发输入、非授权 HMR、退出清理。详见 spec / tasks。当前只提交文档，不将设计或既有测试记为已实现。
