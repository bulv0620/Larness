# M3 收尾与 G3 验收材料

> 2026-11-05；分支 `task/m3-1-registration`。M3-0～M3-4 已 done，M3-6 为整体闭环，**G3 尚未获人类验收**。远程独立注册域 HTTPS 按人类决定延后到上线实验，M3 不宣称远程预览已验证。

## 任务状态

| 任务 | 状态 | 验收 |
|---|---|---|
| M3-0 PoC | done（G-PoC-M3 2026-11-05） | [poc.md](poc.md) |
| M3-1 临时登记/退登 | done | [acceptance-m3-1.md](acceptance-m3-1.md) |
| M3-2 服务卡片/详情 | done | [acceptance-m3-2.md](acceptance-m3-2.md) |
| M3-3 预览网关 | done | [acceptance-m3-3.md](acceptance-m3-3.md) |
| M3-3b 安全矩阵 | done | [acceptance-m3-3b.md](acceptance-m3-3b.md) |
| M3-4 Browser/Agent/HMR/API | done | [acceptance-m3-4.md](acceptance-m3-4.md) |
| M3-6 整体闭环/G3 | review | 本文 |

## G3 场景映射

| 场景 | 证据 |
|---|---|
| S1 两终端登记 | 服务端测试两项独立 service；服务卡片列表 |
| S2 卡片/详情/无服务 Tab/无启停 | 组件测试 + Chromium 服务窗口 E2E |
| S3 独立来源 HTTP/WS/HMR | registry 测试 + Vite iframe E2E（HMR v1→v2） |
| S4 Ctrl+C 退登、Shell 保留 | 服务端真实 PTY 测试；preview E2E 在预览后 Ctrl+C，详情变“已结束”、预览按钮禁用 |
| S5 显式关闭终端撤销全部 endpoint | 服务端多 endpoint 测试 |
| S6 端口复用/旧票据 | 注册侧拒绝终端外/通配监听；退登后旧 grant 401 |
| S7 SSRF/管理端口/任意 URL | 路径/Host/重定向矩阵（M3-3b） |
| S8 管理 Cookie/API 隔离 | 管理 Cookie 不能当 grant、预览 host 不挂管理 API、上游不收 grant |
| S9 身份/DB 失败 | 非 RUNNING/身份失败 503/401；事件插入失败回滚；会话撤销 401 |
| S12 重启/断线/两客户端 | 重启后临时登记 UNREGISTERED；grant 内存失效；两认证客户端共享卡片但获得不同预览 host/grant，一方关闭窗口不影响另一方（E2E） |
| S13 未鉴权/CSRF/伪造 | resolve 无 CSRF 401/403；预览无 grant 401 |
| S14 前端相对 API | Vite iframe E2E：`/api` 经 dev proxy 到第二终端后端 |
| S15 日志/游标 | 关联终端有界输出；缺口/过期由终端输出契约覆盖，未做专门 UI 负例 |
| S16 自主登记/预览 | Agent 工具 L0/L2 + 策略测试；真实 Turn E2E 调用 `resolve_service_preview` 并点击卡片打开 iframe；autonomous 不造 approvalId；非法目标仍拒绝 |
| S17 iframe 受限 | 界面提供独立来源外部打开；未自动化 XFO/CSP 拒绝场景 |
| S18 同 PTY 重启/策略 | 新 executionId、只读拒绝登记、严格/标准审批 |

## 本轮验证

- `pnpm check`：通过（server 442 通过 / 2 跳过；Web 通过；Biome/类型通过）。
- `pnpm build`：通过（既有大 chunk 警告保留）。
- 真实 Chromium E2E（独立端口）：`services.spec.ts` 1/1、`preview.spec.ts` 1/1。
- 完整 auth E2E：**15/15 通过**（2.5 分钟，含两客户端预览）；M2-9 终端标题断言在批量负载下加了 15 秒等待，避免既有 5 秒抖动。修复了 conversation 最终答复在“工具完成事件晚于答复”时被隐藏的真实 UI 回归；services/files/default-workspace/git 测试已对齐 M2-24/26 现行行为。
- Demo E2E：**16/16 通过**（4 项旧 S0 布局断言已按现行互斥分区更新）。
- 根 `pnpm test` 改为串行 workspace，避免 Web/Server 测试并发争抢导致既有 5 秒 PTY 超时；`pnpm check` 通过（server 442 / 2 skipped）。


## 已知边界（不冒充完成）

1. 远程独立注册域 HTTPS 未验证，延后到上线实验；不宣称远程预览支持。
2. 两认证客户端已做服务卡片/独立预览 E2E；多客户端窗口布局的像素级差异仍未断言。
3. iframe 被 CSP/X-Frame-Options 拒绝时只有人工外部打开入口，未做浏览器负例。
4. Agent `resolve_service_preview` 卡片已在真实 Turn E2E 验证；仍未覆盖模型自主决定调用与非法目标的多轮组合。
5. DB 故障以事件提交失败/会话撤销注入，未做磁盘满、DB 句柄损坏。
6. 仅 macOS + Chromium；日志为关联终端输出，不保证逐命令切片；每客户端预算仅实现并发/请求体上限。
7. 认证 E2E 首轮抖动在本轮未能单独复现（修复后全量 14/14）；仍需注意既有批量抖动历史，不保证每次本机全量稳定。

## G3 人类验收项

- [ ] 体验服务窗口：登记 → 卡片/详情 → 预览 → 打开终端 → Ctrl+C 退登。
- [ ] 接受 iframe 预览、外部打开与“服务已结束”行为。
- [ ] 接受上述已知边界（尤其远程 HTTPS 延后、M2 E2E/Demo 旧断言未修）。
- [ ] 确认 G3 通过；M3 标 done 后进入 M4（PM2/正式运行/发布）。
