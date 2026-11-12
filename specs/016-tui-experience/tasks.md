# 任务：TUI 页面与交互统一

> G-Spec-TUI / ADR-027 于 2026-11-02 经人类“开始实现”确认，顺序执行；T0-1～T0-3 全部完成；2026-11-02 人类明确“验收通过”。

| ID | 任务 | 依赖 | 状态 | 预估 |
|---|---|---|---|---|
| T0-1 | 页面容器、输入所有权、概览与退出恢复 | I0-7 done；G-Spec-TUI / ADR-027 人类批准 | done | 2 天 |
| T0-2 | 配对与设备页面统一 | T0-1 | done | 1–2 天 |
| T0-3 | 日志/审计阅读页与整体验收 | T0-2 | done | 2 天 |
| T0-4 | 初始化页文案清理（人类直接指定） | T0-3 | done | 小修 |
| T0-5 | 概览“活跃会话”口径与命名修正（用户反馈） | T0-4 | done | 小修 |

## T0-1 页面与生命周期基础

- 目标：建立独立屏幕、单一物理输入所有者、初始化表单适配、概览/导航、退出确认、异常/信号/resize 恢复。
- 交付物：terminalSession/input/renderer/navigation、主入口接线、校验过的 IPC 状态读取、现有功能适配、已批准纯 JS 依赖声明、真实 PTY 测试入口。
- 范围：apps/server/src/tui/{main,dashboard,supervisor,lifecycle,init-flow}.ts 及新增基础模块、test/tui/、测试脚本、server/package.json / lockfile。
- 验收：A1 基础重绘、A5–A7、A9–A11、A14–A15；非 TTY 启动子进程数为 0，确认取消不停止服务，全部清理恢复输入模式与原屏幕。
- 测试先行：输入所有权/表单 Esc 与 q、确认默认取消、只读晚到响应、终端恢复、失败/重复信号、中文尺寸；随后 pnpm check/build、pnpm test:tui:pty。
- 不包含：最终配对/设备/日志/审计页面；现有功能经适配仍可用，不放空占位。
- [x] 人类门禁通过，2026-11-02 声明 in_progress；
- [x] 先失败测试、基础实现及 Node 20.19 / 依赖构建记录，见 acceptance.md；
- [x] check（server 276 / agent 32 / web 26）、build、真实 PTY 6 类场景与初始化 smoke，通过后更新状态并提交。

## T0-2 配对与设备

- 目标：配对列表/操作/确认/码页面，设备列表/详情/撤销确认；只展示当前页面，成功/失败停留可读。
- 交付物：复用实际 pairing.* / devices.* 的页面与 Zod 返回校验；资源 ID 保持选择；一次性码离页清空；在途写操作与结果待确认处理。
- 范围：apps/server/src/tui/{pairing,devices}.ts、控制器/页面状态、test/tui/。
- 验收：A2、A4、A6–A8、A12–A14 中配对/设备部分；两种批准方式均停留；不可用 trust 不可选；超时不重发、不重取旧码；已撤销设备不重复操作。
- 测试先行：假 IPC 延迟/拒绝/超时/断线，连按 Enter 只执行一次，确认 Esc 不写入；真实 PTY 验证码页 Enter/Esc 与撤销结果留页；pnpm check/build。
- 不包含：配对 TTL/消费/审批权限变更、日志与审计实现。
- [x] T0-1 完成，2026-11-02 声明 in_progress；
- [x] 先失败测试、实际 IPC 页面实现及针对性 PTY 验收；
- [x] 更新状态及单任务提交。

## T0-3 日志、审计与整体交付

- 目标：日志双来源快照、审计摘要、滚动/手动刷新/空态/错误态，完成所有页面一致性与视觉验收。
- 交付物：Server 最多 200 行/子进程最多 300 行来源视图，审计最多 200 条，当前快照时间/来源/数量，刷新失败旧数据标记，逐项验收记录。
- 范围：apps/server/src/tui/{dashboard,format}.ts、新增日志/审计页、控制器、test/tui/、脱敏人工记录。
- 验收：A1、A3–A4、A7、A9–A12、A16，最终复验 A1–A16；阅读中后台输出不抢位置，来源切换不请求，页面不堆叠。
- 测试先行：快照/偏移边界/晚到数据/部分失败、中文长行/ANSI/OSC，PTY 翻页/刷新/来源切换/resize；pnpm check/build/test:tui:pty。
- 人工：100×30、80×24 核对页头/正文/底部，60×16 验证空间不足；确认取消/信号恢复；只使用假码/假密钥。
- 不包含：自动跟随、筛选/搜索、无限历史、导出或审计数据变更。
- [x] T0-2 完成后声明 in_progress（2026-11-02，task/t0-3-reading-pages）；
- [x] 先失败测试与页面实现，自动化逐项关联 A1–A16；
- [x] 2026-11-02 人类明确“验收通过”；平台记录仍限本轮已验证的 macOS；
- [x] 更新 spec/STATUS/契约并提交；人类验收通过后切片标记 done。

## T0-4 初始化页文案

- 人类指出“不设置管理员密码。”突兀，直接授权删除；初始化页只保留操作说明和当前 Web 地址。
- 仅删除展示文案，初始化/认证/数据/契约无变化；复用既有检查，不为静态文字新增镜像测试。
- [x] 已删除文案，check（server 297 / agent 32 / web 26）与 build 通过，单独提交。

- T0-4 人类验收：2026-11-02 明确“验收通过”。

## T0-5 活跃会话口径与命名

- 人类反馈概览“在线会话”不准确：原实现只排除已撤销和已绝对过期（默认 12 小时）的会话行，关闭浏览器后仍会计入，且忽略了认证实际使用的空闲超时。
- 口径修正：只统计仍能通过 `resolveActiveSession` 的会话——未撤销、未绝对过期、且 `last_seen_at` 不早于 `now - idleTtlMinutes`（默认 30 分钟）。一个有效浏览器会话算一个。
- 范围：`apps/server/src/db/stats.ts`、`apps/server/src/ipc/handlers.ts`（传入配置的空闲 TTL）、新增 `apps/server/test/db/stats.test.ts`、`docs/contracts/ipc.md`。
- 不包含：WS 实时连接统计（“真在线”）、TUI 自动轮询、CLI `status` 的在线数（独立进程，仍不显示）、数据库 schema 或 IPC 字段变更。
- 显示文案由“在线会话”改为“活跃会话”：概览为 `待配对 N · 活跃会话 M`，旧面板为 `会话: N 活跃 / M 待审批`；测试断言同步。
- 未按设备去重：`device_id` 只有 passkey 会话才有，混合“设备/会话”会让口径不一致；同一设备的重复登录产生的旧会话会在空闲超时后自动退出计数。
- [x] 测试先行：`test/db/stats.test.ts` 两个用例先失败（旧实现把空闲/越界会话计入，收到 4 与 1，期望 2 与 0）；
- [x] 实现后定向测试通过（stats 2 + IPC 10 + TUI 20，共 32），server typecheck 与改动文件 biome 通过；文案改用“活跃会话”，`screen-dashboard` 断言已更新；
- [x] 契约 `sessions.online` 口径已写入 [ipc.md](../../docs/contracts/ipc.md)；STATUS 已更新并单任务提交。
- 验证范围：未运行完整 `pnpm check`（本机 PATH 无 node/pnpm，仅用 Electron 内置 Node 跑定向套件），未做真实 TUI 人工复核。
