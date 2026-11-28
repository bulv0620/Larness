# 112 实现计划

> 依据 [spec.md](spec.md) 与 [ADR-077](../../docs/adr/ADR-077-service-lifecycle-commands.md)。一次只推进一个任务；每个任务先写失败测试，再实现，跑定向验证后才勾选。

## 1. 现状与改动面

| 区域 | 现状 | 112 改动 |
|---|---|---|
| `app.js` | 裸命令 / `start` / `tui` 都进入前台受管 TUI；`status` / `doctor` 动态导入 dist | 只做薄包装：解析交给 `apps/server/src/cli/main.ts`；裸命令打印帮助 |
| `apps/server/src/cli/*` | `status.ts` 固定 JSON；`doctor.ts` 独立入口 | 新增参数解析、人读格式化、`logs`、生命周期；保留 `doctor` 入口 |
| `apps/server/src/bootstrap/lock.ts` | 锁记录仅 pid / startedAt / version | 追加可选 `mode` / `dev`，旧记录可读 |
| `apps/server/src/status.ts` | 无数据目录 / 模式 / 日志路径 | 追加 `dataDir` / `mode` / `dev` / `logPath` / `daemonLogPath` / `formalServices` |
| `apps/server/src/ipc/handlers.ts` | `server.shutdown` 只接受 `confirm` | 接受可选 `source`，写审计 |
| `apps/server/src/tui/main.ts` | `--managed` 前台受管；否则直接附加但退出仍打印“已停止” | 增加 `--attach` 明确附加语义；退出文案按模式 |
| `apps/server/src/tui/screen-dashboard.ts` | 菜单固定“退出并停止服务” | 附加模式改为“退出面板（服务继续运行）” + 独立“停止服务” |
| `apps/server/src/tui/supervisor.ts` | 注入 `LARNESS_TUI_CHILD` 等 | 追加 `LARNESS_LIFECYCLE_MODE=foreground` / `LARNESS_RUNTIME_DEV` |
| `apps/server/src/index.ts` | 前台信号 / IPC shutdown | 后台模式标记；stdout/stderr 脱敏由 `start` 侧日志约束 |

## 2. 关键设计

### 2.1 后台启动

- 入口固定为 `process.execPath apps/server/dist/index.js`，不经 shell，不接受用户脚本路径；`cwd` 为 Server 根。
- `spawn(..., { detached: true, stdio: ["ignore", fd, fd], env })`，父进程 `unref()` 后退出。
- 环境：继承当前 `LARNESS_*`；追加 `LARNESS_LIFECYCLE_MODE=background`、`LARNESS_LOG_STDERR=0`、`LARNESS_PM2_AUTO_INSTALL`（用户值优先，默认 `1`）。
- `daemon.log` 由父进程以 `0o600` 打开后交给子进程；启动失败关闭 fd，不留下半写文件。
- 就绪：`/api/health` 200 + IPC token 存在 + 锁记录 pid 等于子进程 pid；超时先尝试 IPC 优雅关闭，绝不 `SIGKILL` 用户进程。
- 已有健康实例：直接报告 PID / 地址，退出 0。

### 2.2 停止

- 读取锁：不存在 → “未运行”退出 0；存在但 pid 不存活 → 陈旧锁提示，退出 0。
- 连接 IPC，`server.shutdown { confirm: true, source: "cli" }`；轮询锁消失 / 健康端点失效，最长 15 秒。
- IPC 不可达：报告 PID、数据目录与手动命令，退出 1；不发送信号、不删锁。

### 2.3 日志

- 路径固定：`<dataDir>/logs/larness.log`、`<dataDir>/logs/daemon.log`。
- 主日志逐行解析 pino JSON，输出 `HH:mm:ss.SSS INFO message`；解析失败保持原文。
- 尾部读取限制 1 MiB；`--lines` 默认 200，范围 1–1000。
- `--follow` 用 `fs.watch` + 文件大小轮询兜底，只跟随启动时选定的文件；文件删除 / 截断时提示并退出，不切换来源。

### 2.4 TUI 附加

- `larness tui` 检查 TTY 后以 `--attach` 启动 `dist/tui.js`（或在已构建入口中导入）。
- 附加模式不启动子进程、不发送 `server.shutdown`；`q` / Ctrl+C 只恢复终端并退出 0。
- 概览显示“服务继续运行”；菜单项拆为“停止服务”（确认后 IPC shutdown）与“退出面板”。
- 前台受管模式（`pnpm dev`、遗留 `--managed`）文案保持“退出并停止服务”。

## 3. 任务顺序与门禁

| 阶段 | 任务 | 定向验证 |
|---|---|---|
| A. CLI 基础 | LC-1 参数与帮助 | `pnpm --filter @larness/server test -- cli`（按 test:file）、`biome`、`typecheck` |
| A. CLI 基础 | LC-2 status | 同上 + `node app.js status --json` |
| A. CLI 基础 | LC-3 logs | 单元测试覆盖尾部 / 行数 / 跟随 / 脱敏 |
| B. 生命周期 | LC-4 start | fixture 子进程集成测试；构建后手动 `start → status → stop` |
| B. 生命周期 | LC-5 stop / restart | 真实 `startServer` 集成测试；IPC 不可达路径 |
| C. 控制面板 | LC-6 TUI 附加 | PTY 测试 + 手动附加退出后健康检查 |
| C. 控制面板 | LC-7 dev 边界 | `pnpm dev` + CLI `stop` 集成；`restart` 拒绝 |
| D. 收口 | LC-8 文档与整仓 | `pnpm check`、`pnpm build`、`test:e2e` 按范围 |

## 4. 风险与回滚

- **PID 复用**：`stop` 不按 PID 发信号，只走 IPC；陈旧锁不自动删除。
- **Windows**：detached + 文件 stdio + IPC shutdown；需要实机验证关闭终端后存活。
- **初始化重启**：附加模式只提示 `larness restart`，不静默停服。
- **回滚**：删除新增 CLI 模块与锁字段读取即可回到 ADR-023 入口；无数据库迁移。
