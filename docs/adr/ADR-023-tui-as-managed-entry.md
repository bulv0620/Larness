# ADR-023: TUI 作为受管前台入口

- 状态：accepted
- 日期：2026-11-01
- 决策者：用户（会话确认）
- 关联：R-1、R-23、[010-foundation plan 5.10](../../specs/010-foundation/plan.md)、`docs/contracts/ipc.md`

## 背景

M0 原实现把 TUI 定位为 IPC 客户端：`node app.js` 只启动 Server，TUI 另起进程连接；R-23 要求“TUI 断开不影响 Server”。

用户确认目标体验是：运行 `pnpm dev` 或构建后的 `node app.js` 后，Server 与前端服务自动启动并直接进入 TUI；TUI 启动页显示 Server / Web 已就绪及地址；关闭 TUI 即停止全部服务，不留后台进程；不需要产品级 headless 模式。

## 决策

1. `pnpm dev` 与构建后的 `node app.js` 是**前台单入口**：启动 Server（开发时再加 Vite）并进入 TUI。
2. TUI 进程作为 supervisor：以子进程启动 Server；开发模式额外启动 Vite；启动完成后 TUI 通过现有 IPC 连接 Server。
3. 启动页执行并展示检查：数据目录、Server `/api/health`、Web URL（开发 5173 / 生产 Server 静态托管）、IPC 可用。
4. TUI 正常退出（`q` / Ctrl-C / SIGTERM / SIGHUP）会优雅停止 Server 与 Web 子进程，释放锁 / IPC / DB，不留后台；不再保证 TUI 退出后 Server 常驻。
5. 不提供产品级 headless / daemon 命令；`status` / `doctor` 保持只读，可对运行中的 TUI 实例执行。测试与 E2E 通过内部 `startServer` 启动，不暴露为用户入口。
6. TUI 仍是 IPC 客户端，不直接访问 DB；IPC / Token / 单实例锁保留，便于测试、`status` / `doctor` 与未来多客户端能力。
7. TUI 增加日志模块：读取 Server 文件日志 tail，并展示 supervisor 捕获的 Server / Vite 子进程输出；子进程日志不得直接写终端，避免破坏 TUI。
8. 异常信号（SIGKILL、终端崩溃）无法保证清理子进程；通过 SIGINT / SIGTERM / SIGHUP 处理与 child kill 兜底，残余风险在验收记录中注明。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| TUI 作为 supervisor（本 ADR） | 体验单入口；保留 IPC 安全边界；开发/生产一致 | 仍是两个进程；终端异常退出可能留子进程 | 采用 |
| TUI 与 Server 同进程嵌入 | 真正单进程；无 IPC | Vite dev、静态托管、关闭顺序、日志复杂；后续 Agent 与 TUI 生命周期耦合 | 不采用 |
| 保持 TUI 客户端 + 手动启动 Server | 改动最小；Server 可常驻 | 不符合用户入口体验 | 不采用 |
| headless / daemon 产品模式 | 适合服务器 | 用户明确不需要 | 不采用 |

## 影响

- 产品 / UI：`pnpm dev`、`node app.js` 进入 TUI；启动页显示 Server/Web 状态；关闭 TUI 停止全部；`q` 提示“退出（停止服务）”。
- API / 契约：无 REST/WS 变更；IPC 保留；TUI 不再承诺“退出不影响 Server”。
- 数据 / 迁移：无。
- 安全 / 权限：不变；TUI 仍通过 0600 IPC + Token；不把 DB 暴露给 TUI。
- 兼容性：`status` / `doctor` 保留；`dev:web` / `dev:server` 仅作为开发调试脚本，不是产品入口。

## 验证与回滚

- 开发与生产启动页各验证一次 Server/Web 检查；
- 关闭 TUI 后端口、锁、IPC socket、子进程全部清理；
- 启动失败时展示子进程日志并清理；
- `pnpm check`、构建、现有 E2E 通过；
- 回滚：恢复 `app.js` server 入口与 R-23 原文，删除 supervisor。

## 后续

- 若未来需要后台常驻，另立 ADR 增加显式 daemon，不改变默认前台停止语义。
