# ADR-077: 服务生命周期命令与 TUI 附加模式

- 状态：accepted
- 日期：2026-11-28
- 决策者：用户（会话确认，采纳 112 spec 的推荐默认 + `logs --follow`）
- 关联：[112 spec](../../specs/112-lifecycle-commands/spec.md)、[ADR-023](ADR-023-tui-as-managed-entry.md)、[ADR-028](ADR-028-unified-dev-entry.md)、[ADR-046](ADR-046-pm2-delivery-and-lifecycle.md)

## 背景

ADR-023 把 `larness` / `pnpm dev` 定为前台单入口：TUI 作为 supervisor 启动 Server（开发时另起 Vite），关闭 TUI 即停止全部。这个模型有两个后果：

1. 长时间 Agent 任务会因为关闭终端或控制面板而被取消；
2. `larness tui` 实际是“启动全部”，没有显式停止入口，`status` 只输出 JSON，日志只能自己找路径。

[larness.md §16.1 / §35.1.4](../../larness.md) 的原始设计本来就把“服务进程”和“TUI 控制面板”分开。用户于 2026-11-28 确认恢复该模型。

## 决策

1. **命令面**：`larness start` / `stop` / `tui` / `status` / `logs` 为稳定子命令；`restart` 组合 `stop` + `start`；`doctor`、`--version`、`--help` 保持。裸 `larness` / `node app.js` 只打印帮助，不产生副作用。
2. **后台管理面**：`start` 以 detached 子进程启动打包后的 `apps/server/dist/index.js`，stdin 关闭，stdout/stderr 写入 `<dataDir>/logs/daemon.log`（0600），就绪后返回。产品不引入 supervisor 常驻进程；子进程退出即实例结束，不自动重启。
3. **停止**：`stop` 优先通过本机 IPC `server.shutdown`（`confirm: true`、`source: "cli"`）优雅关闭，并等待锁 / 端口 / IPC 释放。未运行幂等成功。不把杀 PID 作为正常路径，v1 不提供 `--force`。
4. **TUI 附加模式**：`tui` 只连接运行中的管理面；`q` / Ctrl+C / SIGTERM 只退出面板，不发送 `server.shutdown`。TUI 菜单提供显式“停止服务”，需二次确认。
5. **状态**：`status` 默认人读摘要，`--json` 保留机器可读输出；显示数据目录、运行模式（前台 / 后台、是否 dev）、PID、地址、日志路径与“PM2 正式服务独立运行”的固定说明。
6. **日志**：`logs` 只读当前数据目录下的 `larness.log` 与 `daemon.log`，默认最近 200 行、最新在后；`--lines 1–1000`、`--daemon`、`--follow`；不做过滤、上传或远程读取。
7. **dev 边界**：`pnpm dev` 保持前台受管（Vite + 源码 Server + TUI，退出即停止）。`start` 只运行打包产物，不启动 Vite、不加载 `src`。`tui` / `stop` 可作用于 dev 实例；`restart` 对 dev 实例拒绝，提示在 `pnpm dev` 终端重启。
8. **PM2 边界不变（ADR-046）**：`stop` 只停管理面与临时开发资源，不停止 PM2 守护或正式服务。

## 替代关系

- 替代 ADR-023 第 1、2、4、5 条：前台单入口、TUI 作为 supervisor、退出停止全部、不提供 daemon。
- ADR-023 第 3、6、7、8 条继续有效：启动检查、TUI 只经 IPC、日志模块、异常信号残余风险。
- 补充 ADR-028：`pnpm dev` 的 Vite 转发与前台受管体验不变；新增的是命令边界，不是第二种 dev 入口。
- 补充 ADR-046：退出边界从“TUI 退出”改为“`stop`”，PM2 正式服务继续不受影响。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 显式生命周期命令 + detached Server（本 ADR） | 任务跨终端存活；命令可脚本化；无新增常驻进程 | 需要日志文件、PID/锁状态与 Windows 验证 | 采用 |
| 保留前台单入口，仅增加 `stop` | 改动小 | 关终端仍中断任务，核心问题未解 | 不采用 |
| 引入常驻 supervisor / launchd / systemd | 可自动重启、开机自启 | 新增进程模型与平台安装面；用户明确不做 | 不采用 |
| 把 TUI 与 Server 合并成单进程 | 无 IPC | 破坏现有安全边界与 Vite 生命周期 | 不采用 |

## 影响

- **产品 / UX**：`larness start` 后终端可关闭；`tui` 变成可随时开关的控制面板；裸命令只显示帮助，属于 breaking change，需在安装与发布说明中标注。
- **契约**：`runtime-entry.md` 增加命令表、后台模型、就绪与退出码；`tui.md` 增加附加模式退出语义与菜单；`ipc.md` 增加 `server.shutdown.source` 与多 TUI 客户端；`install.md` 更新启动 / 停止 / 升级流程。
- **数据 / 迁移**：无数据库变更。实例锁只追加可选 `mode` / `dev` 字段，旧锁可读；新增 `daemon.log`。
- **安全 / 权限**：不新增监听端口或远程入口；继续使用 0600 IPC token；设备配对仍需 TUI 人工批准；`stop` 不触碰 PM2 正式服务；日志沿用脱敏规则。
- **兼容性**：`node app.js start` 从 TUI 别名改为后台启动；`node app.js` 不再启动任何东西。源码检出未构建时 `start` 明确失败并提示 `pnpm build` / `pnpm dev`。

## 验证与回滚

- 验证：`start → status → tui → 退出 → 健康检查 → stop` 全流程；重复 / 并发 `start`；IPC 不可达时 `stop` 不杀进程；`logs` 边界；`pnpm dev` 被 CLI `stop` 后 supervisor 清理 Vite；macOS 与 Windows 实机。
- 回滚：恢复 `app.js` 的 TUI 入口与 ADR-023 语义，删除生命周期命令；锁新增字段可被旧版本忽略，`daemon.log` 可直接删除，无需数据迁移。
