# 测试策略

> 原则：**关键路径与失败路径优先于覆盖率数字**。安全、权限、并发、恢复必须有显式用例。

## 1. 分层

| 层 | 工具 | 范围 | 运行频率 |
|---|---|---|---|
| 单元 | Vitest | 纯函数、策略、解析、状态机、路径校验 | 每次提交 |
| 集成 | Vitest + Fastify `inject` + 临时 SQLite | API、迁移、中间件、仓库、IPC 处理器 | 每次提交 |
| 契约 | Vitest + Zod schema | 请求 / 响应 / 事件包络与文档一致 | 每次提交 |
| 组件 | Vitest + Testing Library + happy-dom | 交互、键盘、可访问性、状态 | 每次提交 |
| E2E | Playwright（Chromium） | 配对、会话、终端、窗口、预览 | CI / 里程碑 |
| 视觉 | Playwright 截图 | 布局、主题、窗口、资源栏 | D0-9 / 里程碑 |
| 手动 | 清单 | 真实 PTY、PM2、代理、跨平台、安装包 | 里程碑门禁 |

## 2. 必测矩阵

### M0 认证

| 用例 | 期望 |
|---|---|
| 未初始化访问任意业务 API | `NOT_INITIALIZED`，无数据泄漏 |
| Web 尝试初始化 / 注册管理员 | 无此接口，404 / 405 |
| 配对申请 → TUI 拒绝 | 浏览器得到 `PAIRING_DENIED`，不可兑换 |
| 配对码错误 5 次 | 第 6 次 `RATE_LIMITED`，申请作废 |
| 两设备并发兑换同一 request | 仅一个成功，另一个失败且不泄漏 |
| `允许本次` 过期 | 会话失效，需重新配对 |
| `始终允许` 后撤销设备 | credential、会话与 WS 立即失效；Passkey 登录失败 |
| `始终允许` 未完成 Passkey 注册 | 不创建设备 / 会话，enrollment 过期后重新配对 |
| Passkey 注册 / 登录 | 虚拟认证器成功；challenge / Origin / RP ID / UV 校验生效 |
| challenge 过期 / 重放 | `CHALLENGE_EXPIRED`，不产生会话 |
| 无 Cookie / 伪造 Cookie 访问 | `UNAUTHENTICATED` |
| 错误 Origin / 缺失 CSRF | `ORIGIN_INVALID` / `CSRF_INVALID` |
| 会话 Token 重放 / 撤销 | 旧会话立即失效；新会话不可复用旧 Token |
| 通过 IP / 非安全上下文访问 | Passkey 不可用，提示 allow_once / 换 localhost |
| TUI 不可用时新设备申请 | 挂起或拒绝，不自动放行；已有 Passkey 仍可登录 |
| 重启后会话 | 未过期会话仍有效；设备 / credential 保留 |

### M1 Agent

| 用例 | 期望 |
|---|---|
| FakeProvider 脚本化工具调用 | 事件顺序、seq 连续、状态机正确 |
| 同会话并发 Turn | 第二个 `TURN_IN_PROGRESS` |
| 取消 Turn | 不再产生新工具调用；命令终止或记录真实结果 |
| 断线重连 | REST 补拉缺失事件，无重复 / 无缺口 |
| 项目外路径读取 | `PATH_OUTSIDE_PROJECT`，审计 |
| 文件写入版本冲突 | `VERSION_CONFLICT`，返回当前版本 |
| 密钥不进入事件 / 日志 | 扫描通过 |
| 切模型 | 当前 Turn 模型不变，下一 Turn 生效 |

### M2–M5

在对应 spec 的“测试计划”中补充：PTY 多客户端 / 租约、Git 写锁、服务状态机、代理 SSRF、部署审批篡改、更新回滚、跨平台冒烟。要求与 `larness.md` 第 24、42 章一致。

## 3. 测试数据与环境

- 每个测试使用独立临时目录与独立 SQLite（`file:test-<uuid>?mode=memory` 或 tmp 文件）。
- 时间通过注入时钟控制（令牌过期、锁过期、cron）。
- 模型使用 `FakeProvider`；禁止单测请求真实 API。
- 秘密使用固定假值（如 `sk-test-…`），并断言不会出现在输出中。
- 文件系统测试覆盖符号链接、大小写、Unicode 归一化、Windows 分隔符（CI 条件跳过）。

## 4. 命令

```bash
pnpm check                 # biome ci + tsc --noEmit + vitest run
pnpm test                  # vitest watch（本地）
pnpm test:e2e              # Playwright
pnpm --filter @larness/server test
```

M0-1 / D0-1 负责落地脚本；在此之前命令不存在。

## 5. 覆盖要求

- 认证、授权、路径校验、锁、代理目标校验：每个失败分支至少一个用例。
- 状态机：合法迁移与非法迁移都要测。
- 迁移：空库、上一版本库、重复执行幂等。
- 不设全局覆盖率硬门槛；新增核心模块行覆盖 < 70% 时需在任务中说明原因。

## 6. E2E 规则

- 每个 E2E 用例自建数据目录与端口，结束后清理。
- 不依赖外网；模型、服务、更新均使用本地 fake / fixture。
- 失败时保留 trace、截图、日志；禁止用 `waitForTimeout` 代替条件等待。
- 视觉基线变更必须人工确认，不能自动接受。

## 7. 平台验证

| 平台 | 时机 | 范围 |
|---|---|---|
| macOS arm64 | 每个里程碑 | 全量 |
| Linux x64 | CI | 单元 / 集成 / 构建 |
| Windows x64 | M5 前 PoC | PTY、路径、PM2、更新、安装 |

结果记录在 `STATUS.md` 或里程碑验收记录中；未实测的平台不得宣称支持。

## M3/M4边界与四策略验证（ADR-042，2026-11-05）
M3用真实PTY/已核验endpoint/HTTP+WS/隔离来源验证开发闭环，不要求PM2；M4用隔离PM2/构建产物/计划/健康/实际对账验证持久发布。四策略须区分：标准/严格需要时审批，只读拒写，自主包含部署/启停/支持的恢复在内无人工停等但仍拒绝未鉴权/篡改/过期/失效锁。只人工分支有审批请求/approvalId，自主有策略授权/审计而无伪造人类批准。文档产品批准不代替技术门禁或真实运行证据。
