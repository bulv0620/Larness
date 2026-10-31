# 任务：M0 工程底座与可信启动

> 规则：一个任务一个提交；开始前更新 `STATUS.md`，完成后勾选本表并同步 `ROADMAP.md`。  
> 安全相关任务必须附测试证据（命令、输出、覆盖的失败路径），不接受“手工验证过了”。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M0-1 | Server 与 workspace 扩展 | D0-9 | `todo` |
| M0-2 | 配置、数据目录、日志与诊断 | M0-1 | `todo` |
| M0-3 | SQLite、迁移与审计 | M0-2 | `todo` |
| M0-4 | 本机 IPC 与 TUI 初始化 | M0-3 | `todo` |
| M0-5 | 设备配对与会话 | M0-4 | `todo` |
| M0-6 | 鉴权与传输安全 | M0-5 | `todo` |
| M0-7 | Web 认证集成 | M0-6 | `todo` |
| M0-8 | 稳定入口与 M0 验收 | M0-7 | `todo` |

## 任务卡

### M0-1 Server 与 workspace 扩展

- 状态：`todo`
- 依赖：D0-9
- 目标：在现有前端 workspace 中加入 Server、共享契约与工程化检查，跑通最小 API。
- 交付物：
  - `apps/server`（Fastify 5、`createApp()` 工厂、`/api/health`、错误处理器、请求 ID）；
  - `packages/{agent,resources}` 占位包（可编译、无业务）；
  - `packages/shared` 增加 config / errors / domain 基础类型；
  - 根脚本 `dev`（web + server）、`check`、`build` 覆盖三个包；
  - `.github/workflows/ci.yml`：install、biome、typecheck、test、build；
  - 测试工具：临时目录、`fastify.inject`、测试用配置工厂。
- 验收：
  - `pnpm dev` 同时启动 web 与 server；`GET /api/health` 返回 `{status:"ok"}`；
  - `pnpm check` / `pnpm build` 通过；
  - CI 在 Ubuntu 通过，macOS 至少通过构建与测试。
- 测试：health 集成测试；未知路由 404 契约；错误响应不含堆栈。
- 涉及路径：`apps/server/`、`packages/*/src/index.ts`、根脚本、`.github/workflows/ci.yml`。

### M0-2 配置、数据目录、日志与诊断

- 状态：`todo`
- 依赖：M0-1
- 目标：服务能在正确的位置、以正确权限读写配置与日志，并在异常时明确失败。
- 交付物：
  - `resolveDataDir()` + 目录创建 + POSIX 权限校验；
  - `config.json` Zod schema、环境变量覆盖、默认值；
  - pino 日志 + 轮转 + 脱敏器；
  - `harness.lock` 单实例锁；
  - `status` / `doctor` CLI（临时经 tsx 调用，M0-8 接入 `app.js`）；
  - 优雅关闭骨架（信号 → 停止接收 → 清理）。
- 验收：
  - A12、A14 通过；
  - 端口占用 / 目录不可写 / 配置非法时退出码非 0；
  - 日志中不出现 Cookie / Token / 密码；
  - 第二个实例 3 秒内退出。
- 测试：配置优先级；权限错误；锁竞争；脱敏；关闭幂等。
- 涉及路径：`apps/server/src/{bootstrap,cli,security}/`。

### M0-3 SQLite、迁移与审计

- 状态：`todo`
- 依赖：M0-2
- 目标：建立可信的数据层，保证初始化、配对、会话、审计可持久化。
- 交付物：
  - Drizzle schema：`app_meta`、`auth_settings`、`device_requests`、`trusted_devices`、`browser_sessions`、`audit_logs`；
  - `0001_auth` 迁移 + 启动时 migrator + WAL / 外键 / busy_timeout；
  - repository：meta、authSettings、deviceRequests、trustedDevices、browserSessions、audit；
  - `backupDatabase()` 调用点（M0 可为空实现）；
  - 过期清理任务（申请 / 会话 / 限流记录）。
- 验收：
  - 空库迁移成功；重复启动幂等；迁移失败不监听端口；
  - 审计写入失败时敏感操作失败（fail closed）；
  - 外键与唯一索引生效（重复 Token hash 被拒绝）。
- 测试：迁移、约束、repository、清理任务、事务回滚。
- 涉及路径：`apps/server/src/db/`、`drizzle/`、`apps/server/test/db/`。

### M0-4 本机 IPC 与 TUI 初始化

- 状态：`todo`
- 依赖：M0-3
- 目标：建立本机可信通道，完成首次初始化与日常状态查看。
- 交付物：
  - IPC server：UDS / Named Pipe、0600 权限、Token 握手、Zod 协议、事件推送（按 `docs/contracts/ipc.md`）；
  - `init.status` / `init.apply`：管理员密码（Argon2id）、host、port、publicUrl、更新通道；
  - TUI：初始化向导、仪表盘、状态 / 日志 / 审计查看、退出；
  - `node app.js status` 的底层实现（只读状态）。
- 验收：
  - A2、A3、A11 通过；重复初始化返回 `ALREADY_INITIALIZED`；
  - 未初始化时 Web 无任何可写接口；
  - IPC 无 Token / 错误 Token 被拒绝；socket 权限 0600。
- 测试：IPC 握手、初始化并发、密码策略、socket 权限、TUI 冒烟（非交互函数）。
- 涉及路径：`apps/server/src/{ipc,tui,api}/`、`packages/shared/src/config.ts`。

### M0-5 设备配对与会话

- 状态：`todo`
- 依赖：M0-4
- 目标：实现完整配对状态机与凭据生命周期。
- 交付物：
  - 公开接口：创建申请、轮询状态、兑换配对码；
  - TUI：待审批列表、批准（允许本次 / 始终允许）、拒绝、展示一次性码、设备 / 会话撤销；
  - 会话签发、设备凭据、刷新与轮换；
  - 短编号 / 配对码生成与规范化；原子消费；
  - 审计：申请 / 批准 / 拒绝 / 兑换 / 撤销。
- 验收：
  - A4–A8、A13 通过；
  - 并发兑换只有一个成功；
  - 码错误 5 次后作废；
  - 撤销设备后 WS 会话失效（与 M0-6 联调）。
- 测试：状态机、并发、过期、码规范化、刷新轮换、撤销。
- 涉及路径：`apps/server/src/{pairing,auth}/`、`apps/server/src/tui/`、`drizzle/`。

### M0-6 鉴权与传输安全

- 状态：`todo`
- 依赖：M0-5
- 目标：把所有 REST / WS 面收口到统一鉴权与失败关闭。
- 交付物：
  - 会话解析中间件、CSRF、Origin / Host 校验、安全响应头；
  - 限流（IP / Token / 会话）与审计；
  - WebSocket 握手鉴权、订阅授权、撤销即断；
  - 统一错误映射（错误码 → HTTP）；
  - 失败关闭矩阵测试。
- 验收：
  - A1、A9、A10 通过；
  - 未认证访问任意业务接口均返回 401 / 409，不泄露资源是否存在；
  - 撤销会话后 1 秒内 WS 关闭；
  - 限流触发 429 并审计。
- 测试：认证矩阵、CSRF / Origin、限流、WS 握手、错误码一致性。
- 涉及路径：`apps/server/src/{auth,ws,api,security}/`。

### M0-7 Web 认证集成

- 状态：`todo`
- 依赖：M0-6
- 目标：S0 壳接入真实配对与会话，完成浏览器端闭环。
- 交付物：
  - `/pair` 页：申请、短编号、轮询、配对码输入、错误 / 过期 / 拒绝、重试；
  - `useSession` / `RequireAuth` / `returnTo`；刷新时自动尝试 refresh；
  - 登出、被撤销后的全局 401 处理；
  - 当前设备信息与到期时间；空态工作台（不接项目数据）。
- 验收：
  - 未认证访问 `/` 跳 `/pair`；认证后进入工作台；
  - 刷新页面保持登录；撤销设备后下一次请求跳配对；
  - 配对页轮询在页面隐藏时暂停；
  - 无控制台错误、无 Token 写入 localStorage。
- 测试：组件状态机、路由守卫、E2E 配对全流程（测试 IPC 客户端批准）。
- 涉及路径：`apps/web/src/features/auth/`、`apps/web/src/app/routes.tsx`、`packages/shared/src/gateway.ts`。

### M0-8 稳定入口与 M0 验收

- 状态：`todo`
- 依赖：M0-7
- 目标：交付 `node app.js` 可运行的最小产品，并完成 G0 门禁。
- 交付物：
  - 根 `app.js`：server / tui / status / doctor / `--version`；开发与发布两种解析路径；
  - 生产静态托管、SPA 回退、缓存头；
  - 构建流水线：web `vite build`、server `tsdown`；
  - 优雅关闭全链路（HTTP / WS / IPC / DB / 锁）；
  - `docs/contracts/ipc.md` 校准（与实现 / 测试一致）；
  - G0 验收记录与修复。
- 验收：
  - `node app.js` 在干净数据目录可启动；`node app.js tui` 可初始化；`status` 输出 JSON；
  - 生产构建后由 Server 托管 Web，刷新任意前端路由不 404；
  - 重启后会话与审计保留；
  - G0 清单（`larness.md` 42.1）全部通过；
  - `pnpm check` / `build` / `test:e2e` 全绿。
- 测试：启动 / 关闭 E2E、静态回退、生产构建冒烟、G0 用例。
- 涉及路径：`app.js`、`apps/server/src/index.ts`、`apps/server/src/api/static.ts`、构建配置。
