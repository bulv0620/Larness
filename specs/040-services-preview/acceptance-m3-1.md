# M3-1 验收记录：临时登记、查询与退出退登

> 2026-11-05；分支 `task/m3-1-registration`。M3-0 已通过 G-PoC-M3；本任务只做临时登记/退登，不做预览代理（M3-3）或服务 UI（M3-2）。远程 HTTPS 仍延后到上线实验。

## 交付

- `0010_services` 迁移：temporary 服务行、活跃端点唯一索引、host/port/status 检查约束；终端 30 天清理先删关联服务。
- 真实执行身份适配（`ps` 后代树 + `lsof` + `(pid,birth)`）：终端外、多 owner、监听缺失一律 `PREVIEW_TARGET_INVALID`；绑定地址限制已由 [ADR-044](../../docs/adr/ADR-044-preview-binding-simplification.md) 放宽。
- `ServiceManager`：登记、幂等（operationId/活跃端点）、同名冲突、列表/详情、退登、`recover`、1 秒 `reconcile`、审计与 `service.*` 事件同事务提交后广播。
- 人工入口：`POST /api/services` 生成 L2 resource-action，`/api/resource-actions/:id` 按 kind 分派；`GET /api/services`、`:id`、`:id/logs`。
- Agent 入口：`register_temporary_service`（L2）/`list_services`（L0）；Turn 审批一次后直接登记，不产生第二次审批；autonomous 仍走同一身份校验。
- WS：`service` 订阅与已提交事件推送；REST 补拉已有。

## 场景证据

| 场景 | 证据 |
|---|---|
| S1 两个 dev 终端分别登记 | `services.test.ts` “two dev terminals” 两项服务独立 id/terminalId |
| S4 Ctrl+C 仅停前台命令 | “registers a verified…”：Shell 存活、监听消失、退登并写 `service.unregistered` |
| S5 一个 PTY 多 endpoint 显式关闭 | “unregisters every endpoint…”：两个端口同终端，`terminate` 后均 `UNREGISTERED`/`TERMINAL_ENDED` |
| S6 端口复用/无关监听 | “rejects listeners…”：终端外监听、无监听为 `PREVIEW_TARGET_INVALID`；通配监听现允许登记（ADR-044） |
| S9 状态写入失败 | “does not persist…”：`resource_events` 插入被真实 SQLite trigger 拒绝 → 服务行回滚，移除 trigger 后可正常登记 |
| S12 服务端重启 | `services-restart.test.ts`：停止并重启后旧登记为 `UNREGISTERED`；原因可能为 `SERVER_RESTART` 或关停时已写入的 `TERMINAL_*`/`LISTENER_GONE`，均为失效 |
| S13 未鉴权/坏来源 | 无会话 POST 返回 401/403；CSRF/Origin 由既有全局守卫覆盖 |
| S16 autonomous 登记 | `registerAgent` 测试：`resource_actions` 为空、operation `COMPLETED`、策略映射 autonomous=allow |
| S18 同 Shell 重启换身份 | “registers a verified…”：重新登记得到新 serviceId/executionId，旧登记保持 `UNREGISTERED` |
| 人工审批 API | `services-api.test.ts`：未审批 execute=409；approve 后 execute 完成并返回 `svc_…`；列表/详情/日志可读 |
| WS 事件 | `services-ws.test.ts`：订阅后收到 `service.unregistered` |

## 验证命令

```bash
pnpm --filter @larness/server exec vitest run \
  test/resources/services.test.ts \
  test/resources/services-api.test.ts \
  test/resources/services-ws.test.ts \
  test/resources/services-restart.test.ts \
  test/resources/services-migration.test.ts
pnpm check
```

结果：本轮新增 6 项 `services.test.ts`、1 项 API、1 项 WS、1 项 restart、1 项 migration，全部通过；`pnpm check` 通过（server 435 通过 / 2 跳过，Web 全通过）。

## 过程偏差

- 首个 registry 切片（identity/repository/manager）先写实现再补测试，未严格满足“先写会失败测试”；后续 API、WS、restart、DB 失败用例按失败迭代（401/403 期望、restart 失效原因、strict schema 多余字段）后通过。此偏差如实记录，不冒充全过程测试先行。

## 边界与未覆盖

- 预览解析/票据/grant 与 HTTP/WS 转发属 M3-3；服务卡片/详情属 M3-2；本任务没有 UI 或预览路由。
- `GET /api/services/:id/logs` 返回关联终端的有界输出，明确不是每条 Shell 命令的精确切片。
- 并发双终端同端口、SO_REUSEPORT、daemonize 之外的平台行为未做额外注入；身份证据仍是 `ps` 文本 + 1 秒出生粒度，残余窗口与 M3-0 相同。
- DB 故障用真实 SQLite trigger 注入事件提交失败，未做磁盘满/进程被杀等 OS 级故障。
- 仅 macOS 实测；远程 HTTPS/其他浏览器未验证。
