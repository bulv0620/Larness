# 实施计划：统一运行入口

> 未实施；spec=draft / ADR-028=proposed。当前只完成 U0-0 文档，不安装依赖、修改配置或启动环境。需 G-Spec-U 批准后按任务顺序执行。

## 1. 结构

```text
浏览器：同一个 publicUrl（默认 localhost:3210）
  └─ Server（server.host/server.port）
       ├─ /api/*       现有后端
       ├─ /ws          现有业务连接
       ├─ 页面/资源    dev → 受管 loopback Vite；打包 → 静态目录
       └─ /_larness/dev/hmr   dev → 已鉴权 HMR；打包 → 404

TUI supervisor
  ├─ Server 子进程（现有本机 IPC 仍用于业务管理）
  └─ Vite wrapper 子进程（仅 dev；私有 process IPC 上报监听结果）
```

只为本项目可信管理前端增加限定转发，不复用未来 Preview 的来源或凭据。复用 Node HTTP/stream/child_process 与现有 Fastify/websocket、ws、Zod；不新增/升级运行依赖。Vite 仅由开发 wrapper 从 Web 包已声明的依赖解析，生产 server/tui bundle 不静态引入 Vite；不直接导入未声明的传递包。

## 2. 模块和边界

| 拟议模块 | 职责 |
|---|---|
| dev-web/control | strict Zod 子进程消息、generation、upstream 生命周期；只接当前子进程 IPC |
| dev-web/vite-runner | loopback 自动端口、资源根/Host/HMR/CSP 配置、预热和 ready、停止；使用 Web 包现有 Vite |
| dev-web/http / hmr | 固定目标 HTTP 流、头过滤/路径安全、专用升级、授权复用、背压/超时/销毁 |
| app/static/ws | 明确路由优先级；生产拒绝开发保留路径，不改变 /api 和 /ws |
| supervisor/main/init-flow | 启动 ready/attach、统一地址、初始化去特例、旧配置指引、失败/退出清理 |
| test/e2e 脚本 | 真实 Vite、同目录模式切换、真实浏览器 HMR、反代与 PTY，记录支持平台 |

拟涉及 apps/server/src/{tui,dev-web,app,index,api/static,ws,security}、apps/web 的受管开发配置/引导及对应测试、packages/shared 错误 schema、E2E 启动脚本和文档。无 DB schema、密钥文件或用户数据改动。

## 3. 关键实施顺序

1. U0-1 先完成可独立测试的转发/control/wrapper 模块，直接以集成夹具装配真实 Vite；此阶段不切换默认产品入口，不以模块测试声称配置共享已完成。专用路由和 DEV_WEB_UNAVAILABLE 的契约/错误 schema 一起提交。
2. U0-2 在 U0-1 验收完成后接 supervisor，统一有效 URL、初始化和重启；同一入口探测、Vite 退出监控、旧配置诊断必须一起落地。不引入临时用户开关或双套来源回退，原有 dev:web 调试命令不作为完整产品入口。
3. U0-3 增加真实同目录 dev → 打包 → dev 端到端验收、HTTPS fixture、HMR/业务 WS 共存、全量 PTY与文档；取得人类 G-Task 抽查后关闭切片。

每项一次只做一个，测试先失败后实现、全量检查通过再提交；不同时改多个未就绪任务。预计每项 1–2 天，实际明显超出则先拆分。

## 4. 专项验证

- 代理测试用假上游记录头/连接，覆盖攻击和边界；真实 Vite另测 HTTP/模块/HMR/CSP，以免假上游通过但前端无法工作。
- CSP 的每响应 nonce 必须覆盖当前 index.html 主题脚本和 React refresh 引导，HTML 适配不能靠全局放宽；接入需要新增解析库时先提出依赖评审。基于当前锁定版本验证，而非凭 API 名推断行为。
- 真实 HMR 编辑只发生于临时 Web fixture/可丢弃工作区，不触碰用户源码；对模块更新结果和浏览器连接目的地址作断言。无自动重试通过；保留明确失败证据。
- 切换测试统一目录和浏览器上下文、使用虚拟认证器和固定假密钥；检查项目/会话/设备 ID 与 SecretStore 可用性，不输出明文。会话过期场景另测，不以延长有效期通过。
- 测试各自临时目录和空闲外部端口，内部端口真实由 OS 分配。认证/生产现有测试共用 IPC 定位文件时串行运行，不能只换端口就并行。
- HTTPS 反代只用临时证书，验证 wss、Origin、Secure Cookie 与 trustedProxies；不读取用户证书。三平台按实测记录，macOS 首验不等于 Windows/Linux 已支持。

## 5. 验收命令和文档

每项 pnpm check / pnpm build 及任务定向测试；U0-2/U0-3 复验 test:tui:pty、test:smoke:init；最终依次运行 Demo / auth / prod E2E。U0-3 新增统一入口真实验收脚本与命令，未落地前不是现有命令。

实现提交同步 runtime-entry.md、rest-api.md 的开发错误码/基址说明、ipc.md 的初始化默认行为注释、tui.md 的地址说明、README、STATUS 和任务状态。原 ADR 原文保留，由 ADR-028 标记被补充条款；不重写旧验收。当前文档提交只增加草案链接，不提前改现行使用指引。

## 6. 回滚

按任务回退源码与同版构建，不删除/迁移 DB 或密钥。保留用户已一次性对齐的 server.port/publicUrl；旧版启动需要端口兼容时明确提示，不能自动恢复成不同来源。程序回退不承诺数据库降级；本切片没有 schema 变化。
