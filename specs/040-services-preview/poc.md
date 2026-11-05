# M3-0：开发执行身份与隔离预览 PoC

> 2026-11-05。实验已完成本机范围（12 项测试），**G-PoC-M3 尚未获人类确认**。远程独立注册域 HTTPS 按人类决定延后至后续上线实验，本文不宣称远程预览已验证。这是可行性证据，不是产品接口；M3-1 起才写入产品代码与迁移。

## 环境与复现

| 项目 | 实测 |
|---|---|
| OS / 架构 | macOS 27.0.1，Darwin arm64 |
| Node / pnpm | v20.19.3 / 10.12.4 |
| 浏览器 | Playwright 1.64.1 Chromium（headless） |
| Vite | 7.3.7（仓库 `apps/web` 实际版本；规格中的“Vite6”为当时代表版本，本次未安装 Vite 6） |
| 原生 PTY | node-pty 1.1.0（M2 已验收，未改补丁） |

执行：

```bash
# 12 项 PoC 测试；浏览器项由脚本显式开启
pnpm test:poc:m3

# 等价于
LARNESS_POC_BROWSER=1 pnpm --filter @larness/server exec vitest run \
  test/resources/m3-poc.test.ts \
  test/resources/m3-preview-poc.test.ts \
  test/resources/m3-vite-poc.test.ts \
  test/resources/m3-failure-poc.test.ts \
  test/resources/m3-policy-poc.test.ts

# 默认（不设环境变量）跳过 3 项浏览器测试，便于 CI 单元阶段在安装 Chromium 前通过
pnpm check
```

测试文件默认只在 macOS 运行身份类测试（`describe.skipIf(process.platform !== "darwin")`）；浏览器测试需要 `LARNESS_POC_BROWSER=1`，并单独安装/存在 Chromium。

PoC 代码只新增在 `apps/server/scripts/m3-poc/` 与 `apps/server/test/resources/m3-*.test.ts`，**没有产品 REST/WS/DB/配置/UI 变更**。

## P1/P2：执行与监听身份

真实 PTY 内启动 Node HTTP 服务，用 `lsof` 找实际监听 PID，用 `ps` 取父进程/出生时间，验证监听进程是否在终端进程树内。结果 3/3 通过：

| 实验 | 结果 |
|---|---|
| 同 PTY 启动服务 → 绑定；人工 Ctrl+C 后监听消失但 Shell 仍可输入；同一 Shell 重启得到新 `executionId`、旧绑定被拒 | 通过 |
| 端口被终端外进程复用 → 旧绑定拒绝、重新登记被拒（不在终端后代树） | 通过 |
| `0.0.0.0` 通配监听虽属于终端 → 仍拒绝（只接受真实 loopback） | 通过 |
| check-to-connect 窗口 | 实测存在：最后一次校验通过后换监听，连接会命中替换者；已故意拉宽窗口并用真实 HTTP 请求证明 |

关键发现：

1. **macOS 的 `ps -o sess` 恒为 0**，不能作为终端会话身份。已改为 `ppid` 后代链判定；被 daemonize / 重父化的监听一律拒绝。
2. **`lstart` 出生时间只有 1 秒粒度**；身份是 `(pid, birth)` 对加进程树，不是单一字段。同一秒内 PID 回收并复用的理论窗口未消除。
3. **校验与 connect 不是原子操作**：替换监听后，先校验再连接的实现会连到新目标。产品实现必须在每次新上游连接前后重验，并接受残余窗口；不得宣称 OS 级隔离或原子绑定。

## P3：隔离来源、票据与 Cookie

本机 PoC 网关监听 loopback，按 `*.preview.localhost` 的 Host 路由；一次性 30 秒票据换 15 分钟 grant，grant 为 host-only/HttpOnly/Secure/SameSite=None Cookie。2/2 通过：

| 实验 | 结果 |
|---|---|
| Chromium 解析 `abc.preview.localhost` 到 loopback 并加载 iframe | 通过 |
| 票据一次性：重放 401；30 秒过期 401；grant 15 分钟过期 401 | 通过 |
| Host 不匹配（`127.0.0.1` 直连）421；其他 `*.preview.localhost` 带旧 Cookie 401 | 通过 |
| 管理站 Cookie 不进入预览请求；`document.cookie` 读不到 HttpOnly grant | 通过 |
| 预览页 JS 跨源 `fetch` 管理 API 被 CORS 阻止 | 通过 |
| 预览项目尝试 `Domain=localhost` Cookie 投毒 → Chromium 拒绝，管理站未收到 | 通过（仅当前 Chromium/本机） |
| 上游 `Set-Cookie: Domain=localhost` 被剥离，Cookie 限预览 host；grant 不透传上游 | 通过 |

重要边界：`SameSite=None; Secure` 在 `http://*.preview.localhost` 被接受，是因为 Chromium 把 localhost 视为可信来源；**远程 HTTPS 行为未测**。本机 `*.localhost` 与管理站同属 localhost 站点范围，隔离依赖 host-only Cookie 与浏览器拒绝 `Domain=localhost`，比独立注册域弱；远程方案必须使用独立注册域并在上线实验复验。

## P4：真实 Vite HTTP/WS/HMR 与开发 API

用仓库实际 Vite 7 启动临时项目，经预览网关加载；1/1 通过：

| 实验 | 结果 |
|---|---|
| 页面经 `http://<random>.preview.localhost:<gateway>/` 加载 | 通过 |
| HMR WebSocket 经网关 Upgrade，URL 使用预览 host | 通过 |
| 修改 `main.js` 后模块热替换 v1→v2，document 级加载计数保持 1（未整页刷新） | 通过 |
| 前端相对 `/api` 经 Vite 代理到第二个 terminal 的后端服务 | 通过 |
| 浏览器全部请求无直连 Vite 端口；WS 无直连回退 | 通过 |

网关 Upgrade 会重写上游 `Host` 为 `127.0.0.1:<port>`、剥离 grant Cookie、保留项目 Cookie 与 `Upgrade`/`Sec-WebSocket-*` 头。转发的 `Origin` 保持浏览器值，PoC 中 Vite 未拒绝。

## P5：故障、限额与重启

| 实验 | 结果 |
|---|---|
| grant 持久化钩子抛错 → bootstrap 503、不下发 Cookie、无授权 | 通过 |
| 网关重启 → 旧 grant 全部失效（401），不重建上游进程 | 通过 |
| 上游端口已关闭 → 502，3 秒内返回 | 通过 |
| 上游接受连接但永不响应 → 300ms 空闲超时后 504 | 通过 |
| 超过 HTTP / WebSocket 连接上限 → 429，不进入上游 | 通过 |
| 声明式超大请求体（Content-Length > 上限）→ 413，上游收到 0 字节 | 通过 |
| 一个客户端暂停读取大响应时，另一个客户端的小请求仍在 2 秒内完成 | 通过 |
| 真实 `decideToolAccess` 对登记 L2：autonomous=allow、standard/strict=require_approval、readonly=deny、standard+L3=deny | 通过 |

未覆盖：每客户端/每服务预算与慢读者的内存上限、真实 DB 事务/seq/退登、真实登录会话撤销、登记动作与 Turn 快照接线。策略映射用的是 M2-25 的真实函数，但“autonomous 下真实登记无人工停等、非法目标仍拒绝”的完整链路属 M3-1 实现验证；本 PoC 只证明策略函数与身份拒绝的组合可用，不冒充完成。

## 回归与已知项

- `pnpm check`：本次曾暴露一个与 M3 无关的既有失败——`apps/web/src/features/files/files.test.ts` 仍按旧语义断言关闭文件窗口后同步最小化；M2-24 已改为“先确认再关闭 Tab”。已把该测试对齐到现行行为（closeRequest、草稿不落盘、窗口仍在），**未改产品代码**。
- 浏览器 PoC 默认跳过，避免 CI 在 `pnpm check` 阶段早于 Chromium 安装而失败；完整证据按上面的命令显式运行。
- 未运行 E2E 套件、构建或 TUI 回归；M3-0 交付的是隔离实验，不宣称产品预览已接线。
- 所有临时目录、PTY、监听端口、Vite/后端进程在测试 `finally` 中清理；没有使用真实用户配置、配对、项目源码或数据库。测试使用临时 HTTP 服务，未写入 Larness 数据目录。

## 人类门禁

- [ ] G-PoC-M3：确认本机执行/监听身份、隔离来源/票据/Cookie、真实 Vite HMR/API、失败与限额证据，以及本文列出的残余窗口和平台边界。
- [ ] 确认远程独立注册域 HTTPS 证据延后至上线实验；在补齐前不宣称远程预览已支持。
- [x] 2026-11-05 人类批准 G-Spec-M3，仅先授权 M3-0。
