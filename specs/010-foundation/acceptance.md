# M0 验收记录（G0）

> 状态：**自动化检查通过；人工安全评审与真机验收待完成。**
> 日期：2026-11-01 · 平台：macOS（Darwin 27，arm64，Node 20.19.3）
> 对应门禁：[ROADMAP G0](../../specs/ROADMAP.md)、[spec 完成定义](spec.md#14-完成定义)

## 1. 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm check` | 通过：Biome 216 文件、6 个 workspace typecheck、server 170 项测试、web 18 项测试 |
| `pnpm build` | 通过：server `tsdown` 输出 `dist/{index,status,doctor,tui}.js`，web `vite build` |
| `pnpm test:e2e` | 15/15 通过（S0 Mock Demo，`VITE_USE_MOCKS=1`） |
| `pnpm test:e2e:auth` | 1/1 通过（Vite 5173 + server 3210，虚拟认证器） |
| `pnpm test:e2e:prod` | 1/1 通过（Server 3210 静态托管，虚拟认证器） |
| CI Playwright | 已配置 Ubuntu / macOS 的 `test:e2e`、`test:e2e:auth`、`test:e2e:prod`；远端首次运行待 push |
| `node app.js --version` / `--help` | 通过 |
| `pnpm dev` | 通过：启动页显示 Server `http://localhost:3210` / Web `http://localhost:5173` / IPC；3210 不提供前端（仅 API/WS）；SIGTERM 后端口与子进程全部清理 |
| `node app.js`（构建后） | 通过：启动 Server + 静态 Web 并进入 TUI；关闭后端口清理；`/assets/*` 长缓存，`/api/health` 200 |
| `node app.js status` / `doctor` | 通过：status 输出运行态，doctor 退出码 0 |

## 2. G0 门禁逐项

| 门禁项 | 证据 | 状态 |
|---|---|---|
| 未初始化时业务 API 不开放；初始化只经本机通道 | `test/security/guard.test.ts`、`test/ipc/init-integration.test.ts`；Web 无 `/api/init` | 通过 |
| 未授权只能访问配对页；REST / WS / 静态资源不泄露数据 | guard + WS 测试；静态壳不含业务数据 | 通过 |
| 配对码绑定申请、限时、限次、一次消费；并发兑换唯一 | `test/pairing/service.test.ts`、`test/api/pairing.test.ts` | 通过 |
| `允许本次` 过期不可重用；无 refresh | `test/auth/session.test.ts`、`test/api/pairing.test.ts`（`/api/auth/refresh` 401） | 通过 |
| `始终允许` 必须 Passkey 注册；未完成不建设备 / 会话 | `test/webauthn/service.test.ts`、`test/api/webauthn.test.ts` | 通过 |
| Passkey 登录、撤销、challenge 重放 / 过期、错误 Origin、IP 来源 | 上述 WebAuthn 测试 + `e2e-auth` 虚拟认证器；WS 过期 / 撤销关闭 | 通过 |
| 不签发长期设备 Token / refresh | `test/db/migrations.test.ts`（无 token 列）、会话 schema | 通过 |
| TUI 是前台入口，关闭停止全部；清理端口 / 锁 / IPC | ADR-023；`pnpm dev` / `node app.js` 启动页与 SIGTERM 清理冒烟 | 通过（自动化 + 手工） |
| TLS / Cookie / CSRF / Origin / WS 鉴权用例 | `test/security/guard.test.ts`（远程 HTTP → `HTTPS_REQUIRED`、trusted proxy）、`test/ws/server.test.ts`（过期关闭）、Cookie 属性断言 | 通过 |

## 3. A1–A18 覆盖

| 验收 | 覆盖 |
|---|---|
| A1 未初始化 | guard / init integration 测试 |
| A2 TUI 初始化 | `test/init/service.test.ts`、`test/ipc/init-integration.test.ts` |
| A3 远程初始化 | `/api/init` 404、无 Web 写接口测试 |
| A4 允许本次 | pairing service + REST 测试（手动 E2E 已验证） |
| A5 始终允许 + Passkey | REST WebAuthn 测试、`test:e2e:auth` / `test:e2e:prod` |
| A6 错误码限次 | pairing service 测试（5 次后第 6 次 429） |
| A7 并发兑换 | pairing service 测试 |
| A8 allow_once 过期 | session / REST 测试（401，无 refresh） |
| A9 Passkey 登录 | WebAuthn service / REST / 两个 E2E |
| A10 撤销 | WebAuthn service、WS 测试、E2E（撤销后跳登录） |
| A11 CSRF / Origin | guard 测试 |
| A12 WS 鉴权 | WS 测试 + 订阅越权 |
| A13 TUI 未操作 | pairing API 保持 pending 测试；TUI 关闭即停服（ADR-023） |
| A14 单实例 | `test/startup.test.ts`、`test/lock.test.ts` |
| A15 status / doctor | `test/status.test.ts`、`node app.js status/doctor` 冒烟 |
| A16 IP 来源 | WebAuthn / guard 测试（`ORIGIN_INVALID`） |
| A17 challenge 重放 / 过期 | WebAuthn service / REST 测试 |
| A18 enrollment | WebAuthn service 测试（跨申请、重复、过期） |

## 4. 人工待办（G0 关闭前）

- [ ] 真实 macOS Touch ID / Safari 的 Passkey 注册、登录、撤销手工冒烟；
- [ ] 安全评审：初始化、配对、Passkey、撤销、失败关闭矩阵与日志脱敏；
- [ ] TUI 交互式初始化 / 配对审批 / 设备撤销的人工走查（启动页与关闭清理已冒烟）；
- [ ] CI 在 Ubuntu 与 macOS 的真实运行结果（已配置 Playwright，仓库暂无 remote，首次 push 后待确认）；
- [ ] Windows / Linux PoC 支持范围记录。

## 5. 已知偏差

- ADR-023：TUI 是受管前台入口；关闭 TUI 会停止 Server 与 Web，不提供 headless 产品模式。异常 SIGKILL / 终端崩溃可能残留子进程。
- M0 的 WebSocket 只开放 `system` 主题；配对 / 设备状态由 TUI 轮询。
- 限流为单进程内存态，重启清零。
- 远程 HTTPS 依赖正确的 `trustedProxies` 配置；未配置可信代理时无法识别本地代理后的真实客户端协议。
- `VITE_USE_MOCKS=1` 仅用于 S0 Demo / 视觉 E2E；生产构建不得设置。
- 未实现 attestation 验证（spec 固定 `none`）。
