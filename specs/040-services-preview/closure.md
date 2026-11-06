# M3 收尾与 G3 验收材料

> 2026-11-05；分支 `task/m3-1-registration`，已合并到 `main`（45f343e）并推送 `origin/main`。M3-0～M3-4 已 done，M3-6 于 2026-11-05 通过人类 **G3**，M3 关闭。远程独立注册域 HTTPS 按人类决定延后到上线实验，M3 不宣称远程预览已验证。

## 任务状态

| 任务 | 状态 | 验收 |
|---|---|---|
| M3-0 PoC | done（G-PoC-M3 2026-11-05） | [poc.md](poc.md) |
| M3-1 临时登记/退登 | done | [acceptance-m3-1.md](acceptance-m3-1.md) |
| M3-2 服务卡片/详情 | done | [acceptance-m3-2.md](acceptance-m3-2.md) |
| M3-3 预览网关 | done | [acceptance-m3-3.md](acceptance-m3-3.md) |
| M3-3b 安全矩阵 | done | [acceptance-m3-3b.md](acceptance-m3-3b.md) |
| M3-4 Browser/Agent/HMR/API | done | [acceptance-m3-4.md](acceptance-m3-4.md) |
| M3-6 整体闭环/G3 | done（G3 2026-11-05） | 本文 |

## G3 场景映射

| 场景 | 证据 |
|---|---|
| S1 两终端登记 | 服务端测试两项独立 service；服务卡片列表 |
| S2 卡片/详情/无服务 Tab/无启停 | 组件测试 + Chromium 服务窗口 E2E |
| S3 独立来源 HTTP/WS/HMR | registry 测试 + Vite iframe E2E（HMR v1→v2） |
| S4 Ctrl+C 退登、Shell 保留 | 服务端真实 PTY 测试；preview E2E 在预览后 Ctrl+C，详情变“已结束”、预览按钮禁用 |
| S5 显式关闭终端撤销全部 endpoint | 服务端多 endpoint 测试 |
| S6 端口复用/旧票据 | 注册侧拒绝终端外/未知归属监听；退登后旧 grant 401；通配监听按 ADR-044 允许登记 |
| S7 SSRF/管理端口/任意 URL | 路径/Host/重定向矩阵（M3-3b） |
| S8 管理 Cookie/API 隔离 | 管理 Cookie 不能当 grant、预览 host 不挂管理 API、上游不收 grant |
| S9 身份/DB 失败 | 非 RUNNING/身份失败 503/401；事件插入失败回滚；会话撤销 401 |
| S12 重启/断线/两客户端 | 重启后临时登记 UNREGISTERED；grant 内存失效；两认证客户端共享卡片但获得不同预览 host/grant，一方关闭窗口不影响另一方（E2E） |
| S13 未鉴权/CSRF/伪造 | resolve 无 CSRF 401/403；预览无 grant 401 |
| S14 前端相对 API | Vite iframe E2E：`/api` 经 dev proxy 到第二终端后端 |
| S15 日志/游标 | 关联终端有界输出；缺口/过期由终端输出契约覆盖，未做专门 UI 负例 |
| S16 自主登记/预览 | 服务登记成功且本轮结束后，成果区提供“打开预览 · <服务名>”。真实 Turn E2E 调用 `resolve_service_preview` 并点击卡片打开 iframe。Agent 工具 L0/L2 与策略测试覆盖自主执行的授权记录和非法目标拒绝 |
| S17 iframe 受限 | iframe 被拦时显示“无法访问 + 刷新”，可用右上角图标在独立来源打开；不删安全头、不降同源 |
| S18 同 PTY 重启/策略 | 新 executionId、只读拒绝登记、严格/标准审批 |

## 本轮验证

- `pnpm check`：通过（server 442 通过 / 2 跳过；Web 通过；Biome/类型通过）。
- `pnpm build`：通过（既有大 chunk 警告保留）。
- 真实 Chromium E2E（独立端口）：`services.spec.ts` 1/1、`preview.spec.ts` 1/1。
- 完整 auth E2E：**15/15 通过**（含两客户端预览）；M2-9 终端标题断言在批量负载下加了 15 秒等待，避免既有 5 秒抖动。修复了 conversation 最终答复在“工具完成事件晚于答复”时被隐藏的真实 UI 回归；services/files/default-workspace/git 测试已对齐 M2-24/26 现行行为。
- Demo E2E：**16/16 通过**（4 项旧 S0 布局断言已按现行互斥分区更新）。
- 根 `pnpm test` 改为串行 workspace，避免 Web/Server 测试并发争抢导致既有 5 秒 PTY 超时；`pnpm check` 通过（server 442 / 2 skipped）。


## ADR-045：独立停止/删除（2026-11-05）
服务详情新增“删除登记”（只退登、不杀进程）与“停止服务”（核验后只终止监听进程树及其后代，不关 Shell；共享同一进程的其他 endpoint 一并退登）。API：`DELETE /api/services/:id`、`POST /api/services/:id/stop`。安全限制与失败路径见 [ADR-045](../../docs/adr/ADR-045-independent-service-stop-delete.md)。

## ADR-044：绑定地址简化（2026-11-05）
人类明确“终端监听端口就创建入口，访问不了显示访问不了”。登记不再以绑定地址拒绝：`0.0.0.0`/`::`/具体本机地址均可登记；网关按已核验的 dialHost 访问（回环/通配用 `127.0.0.1`，具体地址用该地址），失败时预览显示不可用而不撤销登记。身份、票据、grant、管理隔离保持不变；文档不再承诺“端口无需公网暴露”。详见 [ADR-044](../../docs/adr/ADR-044-preview-binding-simplification.md)。

## 已知边界（不冒充完成）

1. 远程独立注册域 HTTPS 未验证，延后到上线实验；不宣称远程预览支持。
2. 两认证客户端已做服务卡片/独立预览 E2E；多客户端窗口布局的像素级差异仍未断言。
3. iframe 被 `X-Frame-Options`/CSP 拒绝时统一显示不可用；工具栏图标提供隔离外部打开（本轮未保留专门 E2E，仅有组件/API 覆盖）。
4. Agent `resolve_service_preview` 卡片已在真实 Turn E2E 验证；仍未覆盖模型自主决定调用与非法目标的多轮组合。
5. DB 故障以事件提交失败/会话撤销注入，未做磁盘满、DB 句柄损坏。
6. 仅 macOS + Chromium；日志为关联终端输出，不保证逐命令切片；每客户端预算仅实现并发/请求体上限。
7. 认证 E2E 修复后全量 15/15；仍保留既有批量抖动历史，不保证每次本机全量稳定；`pnpm check` 的 PTY 5 秒用例偶发受机器负载影响。

## G3 人类验收项

- [x] 体验服务窗口：登记 → 卡片/详情 → 预览 → 打开终端 → Ctrl+C 退登。
- [x] 接受 iframe 预览、右上角外部打开、不可用状态与“服务已结束”行为。
- [x] 接受上述已知边界（尤其远程 HTTPS 延后）。
- [x] 确认 G3 通过；M3 标 done，下一步 M4 规格评审。

## G3 后工作区优化验收

2026-11-06 用户确认本轮修改全部验收通过。

| 任务 | 验收行为 | 实现提交 |
|---|---|---|
| M3-7 | 后台任务状态与会话选择独立。每个项目默认最多显示五条会话，历史可展开及搜索。资源窗口覆盖浮栏 | `00f329d` |
| M3-8 | Turn 结束后计划停止旋转，原进行中步骤显示红叉和「未完成」，历史重放保留真实进度 | `0bdd8ee`、`4c4b140` |
| M3-9 | 本轮成果在 Turn 结束后显示，取消、失败和中断后仍可访问已产出结果 | `1c4a523` |

本次合并前在本机 macOS 通过 `pnpm check`、`pnpm build`、Demo E2E 17/17 和构建版定向认证 E2E 3/3，定向用例为 sidebar、conversation 和 M1 文件成果。分任务的自动化范围见 [侧栏与窗口任务](../049-workspace-sidebar/tasks.md)和 [对话区任务](../036-conversation-experience/tasks.md)。

## G3 后 Agent 工具纠错验收

2026-11-06 用户确认 M3-10 通过并授权合并与推送。实现提交 `1d9447b` 对齐了启动和登记提示、模型上下文与实际 Turn 策略，并约束 Git 操作的字面路径、分支和推送范围。相关回归及未验证范围见 [M3-10 验收记录](../051-agent-tool-contract/tasks.md)。

## G3 后 M3-11 前端交互验收

2026-11-06 用户确认本轮前端修改全部通过。最小化保留已挂载的窗口 DOM。点击工作区空白处会收起未置顶的窗口，从右侧资源区打开文件时保留已有窗口。终端保留画面并补读新输出，终止后清空画面。预览底栏精简，Turn 结束后成果放在答复的复制与时间栏上方。见 [M3-11 验收记录](../052-workspace-polish/tasks.md)。

M4 下一步是技术规格评审。DeepSeek 官方接入与上下文用量排在 M5-1，依赖 G4。 [M4 评审入口](../050-deploy/review.md) · [M5 DeepSeek 草案](../061-deepseek-integration/spec.md)
