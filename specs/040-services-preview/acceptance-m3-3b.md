# M3-3b 验收记录：预览隔离与生命周期安全矩阵

> 2026-11-05；分支 `task/m3-1-registration`。M3-3 已 done；本任务补负例矩阵，不做 iframe 入口（M3-4）。

## 矩阵证据

| 类别 | 负例 | 结果 |
|---|---|---|
| Host/来源 | 非 `*.preview.localhost` Host | 421，不进入路由 |
| 路径/SSRF | `//evil`、`http://evil`、绝对 URL | `VALIDATION_ERROR`，不解析新目标 |
| 重定向 | 上游 302 到外部域 | 原样 302，不跟随、不代理新目标 |
| 管理 API | 预览 host `/api/health` | 仅转发到项目上游，未挂载管理 API |
| 管理 Cookie | 只带 `larness_session` | 401，管理 Cookie 不作为预览凭据 |
| Cookie 域 | 上游 `Set-Cookie: Domain=localhost` | 剥离 Domain，仅当前预览 host |
| grant 透传 | 上游收到的 Cookie | 不含 `larness_preview` |
| 票据 | 重放/过期/错误 host | 401 |
| grant | 过期/错误 host/无 cookie | 401 |
| 会话 | 管理会话撤销后 | 401 |
| 源退出 | 服务退登 | 旧 grant 立即 401，事件触发撤销 |
| 限额 | 并发超过 `maxConnections` | 429 |
| 请求体 | 超过 `maxBodyBytes` | 413 |
| WS | 无 grant 升级 | 401 |

## 命令与结果

```bash
pnpm --filter @larness/server exec vitest run test/resources/previews.test.ts
pnpm check
```

`previews.test.ts` 5 项通过；`pnpm check` 见本轮提交记录（server 440+ / Web 全通过）。

## 未覆盖与边界

- DB 故障仅以“会话撤销/服务非 RUNNING”验证 fail-closed；未注入磁盘满、DB 句柄损坏等 OS 级故障。
- 慢消费者只验证并发上限与请求体上限；未测暂停读取时的内存上限。
- 端口复用注册侧证据见 M3-1；预览旧 grant 在退登后 401 已测，但未在同一端口启动无关进程再复用（原终端进程仍持有端口）。
- iframe 限制、CSP/X-Frame-Options、外部打开属 M3-4；远程 HTTPS 未验证。
