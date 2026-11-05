# M3-2 验收记录：当前项目服务卡片与详情

> 2026-11-05；分支 `task/m3-1-registration` 上继续。M3-1 已 done；本任务只做服务窗口 UI，不做预览（M3-3/M3-4）。

## 交付

- 真实服务窗口：当前项目卡片列表、详情、关联终端输出、打开所属终端、空态、结束/不可用提示；无服务 Tab。
- L2 登记对话框：选择运行中终端 + 名称 + loopback 端口 → `POST /api/services` → 待审批 → 批准并执行 → 详情；拒绝/错误可见。
- Query 2 秒轮询卡片、详情与日志；关窗/最小化不调用任何启停接口。
- 选中服务在同一次会话的窗口隐藏/恢复后保留（按 Tab 的内存映射）；刷新浏览器后回到列表（未写入布局 v5）。
- 修复登记引入的外键回归：项目删除前清理 `services` 与 `resource_actions`，否则有服务/登记动作的项目无法删除。

## 证据

| 场景 | 证据 |
|---|---|
| S2 卡片 / 详情、无服务 Tab、无启停副作用 | 组件测试 + 真实 Chromium E2E |
| S1 / S4 / S5 / S18 的 UI 呈现 | 卡片/详情/结束提示读取 M3-1 的真实状态；对应生命周期证据见 M3-1 验收 |
| 登记审批 | E2E：填写终端/名称/端口 → 批准并登记 → 详情出现 |
| 打开终端 | E2E：详情点击打开终端 → `frontend` 终端窗口可见 |
| 关联终端输出 | E2E：详情日志显示 `SERVICE_READY` |
| 结束提示 | 详情在非 RUNNING 状态显示“服务已结束或暂不可用” |

命令：

```bash
LARNESS_E2E_WEB_PORT=5180 LARNESS_E2E_PORT=3325 \
  pnpm exec playwright test -c playwright.auth.config.ts e2e-auth/services.spec.ts
pnpm check
```

结果：E2E 1/1 通过（真实 server + Vite + Chromium + 虚拟认证器）；`pnpm check` 通过（server 435 / 2 skipped，web 106，Biome/类型通过）。

## 边界与未覆盖

- 日志固定读取前 200 块并 2 秒刷新，未做“游标过期”专门的 UI 测试；S15 的游标/缺口由后端与既有终端输出契约覆盖。
- 隐藏/恢复使用内存映射保留选中项，未把 `selectedServiceId` 写入布局持久化；整页刷新后回到列表。计划在 M3-6 前补布局字段或明确接受。
- 未测试多客户端同时打开服务窗口的布局差异（共享状态查询、独立布局）。
- 仅 macOS + Chromium；远程 HTTPS 未验证。
- 登记对话框只服务人工 L2；Agent 登记走 M3-1 工具，不在此 UI。
