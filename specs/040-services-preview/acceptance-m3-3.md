# M3-3 验收记录：PreviewRegistry 与固定上游 HTTP/WS

> 2026-11-05；分支 `task/m3-1-registration`。M3-1/M3-2 已 done；本任务做后端预览网关，不含 iframe 入口/UI（M3-4）。

## 交付

- 一次性 30 秒票据 → 独立预览 host 上的 `POST /__bootstrap` 换 15 分钟 host-only `larness_preview` grant；票据只回给管理端内存，不进入 URL/query。
- 固定 loopback 上游：只拨 `127.0.0.1`；重写 Host、剥离 grant/管理凭据/转发头；限制路径与请求体；不跟随重定向。
- HTTP 与 WebSocket 转发；每次连接前核对 grant host/过期/管理会话/服务 RUNNING 与实际监听身份（2 秒证据缓存），失败即撤销。
- 服务退登事件触发 grant 撤销并断开已有 HTTP/WS；`POST /api/previews/resolve`（CSRF、no-store）；`preview.enabled` 时按配置端口启动，端口冲突失败关闭并告警。
- 修复/补强：项目删除清理 `services` 与 `resource_actions`，避免外键阻塞。

## 证据

| 场景 | 证据 |
|---|---|
| S3 独立来源 HTTP | `previews.test.ts`：resolve → bootstrap 303 + cookie → GET 200，上游 Host 为 loopback 且未收到 grant |
| S3 WS | 同文件：真实 Upgrade 101 + echo；无 grant 401 |
| S6 源退出/旧 grant | 服务退登后旧 grant 立即 401；事件订阅撤销 |
| S7 Host/路径 | `127.0.0.1` Host 421；`//evil`、`http://evil` 路径 `VALIDATION_ERROR` |
| S8 管理凭据 | 上游不接收 `larness_preview`；预览 host 未挂载管理路由 |
| S9 身份/会话 | 服务非 RUNNING → 503/401；管理会话撤销后预览 401 |
| S13 鉴权/CSRF | resolve 无 CSRF 401/403；预览无 grant 401 |
| 过期/重放 | 票据过期、grant 过期、票据重放、错误 host 均拒绝 |
| 配置 | `preview.enabled` 关闭时 resolve 503；启用时按 `preview.port` 启动 |

命令：

```bash
pnpm --filter @larness/server exec vitest run \
  test/resources/previews.test.ts \
  test/resources/previews-api.test.ts
pnpm check
```

结果：预览测试 5 项通过；`pnpm check` server 440 / 2 skipped、Web 全通过。

## 边界与未覆盖

- iframe/外部打开、CSP/X-Frame-Options 组合与真实 Vite HMR 浏览器证据属 M3-4；本任务只用 Node 验证 HTTP/WS。
- 重定向不跟随、慢消费者/连接上限、管理 API 跨源负例列入 M3-3b 安全矩阵。
- grant/票据只存内存，进程重启全部失效；未做多实例/持久 grant。
- 仅 macOS；远程独立域 HTTPS 未验证，仍延后至上线实验。
