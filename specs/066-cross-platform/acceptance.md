# M5-4 跨平台验收记录（2026-11-08，Windows 2026-11-10 更新）

> 状态：`done`（2026-11-08 人类确认当前范围）。macOS Apple Silicon 已完成；Windows 11 x64 于 2026-11-10 完成终端/命令/PM2 实现与实机验证；Windows 10 与 Ubuntu 待实机复测。仓库 CI 已删除。

## 已完成（macOS Apple Silicon）

| 项 | 结果 | 证据 |
|---|---|---|
| Node 20 / 22 / 24 | 通过 | 20.19.3 / 22.23.4 / 24.22.2 的 `pnpm check` 均通过（562 / 10 skip） |
| 构建 | 通过 | `pnpm build` |
| 原生模块 | 通过 | `platform-smoke`：better-sqlite3、node-pty、文件系统 |
| npm 包安装 | 通过 | `verify-npm-pack.mjs --install`；160 文件，`larness 0.1.0` |
| 终端 bootstrap | 通过 | 修复 `/bin/sh` 对 `exec --` 的不兼容；macOS / 预期 Linux dash 均使用 `(exec "$@")` |
| 公共 npm 发布 | 通过 | `larness@0.1.0` |

## Windows 11 x64（2026-11-10 实机）

环境：Windows 11 家庭中文版 build 26200，AMD64，Node.js 24.9.0，npm 11.6.0，pnpm 10.34.9。Node.js 22.23.0 另通过平台冒烟与命令/PTY 定向测试；全量 check 只在 Node 24.9.0 记录。

| 项 | 结果 | 证据 |
|---|---|---|
| `pnpm check` | 通过 | Biome、typecheck、web 141 / agent 42 / server 549 通过，31 跳过（平台条件），0 失败 |
| `pnpm build` | 通过 | Server 四入口、Web 生产构建 |
| `scripts/platform-smoke.mjs` | 通过 | better-sqlite3、node-pty（ConPTY）、文件系统 |
| `verify-npm-pack.mjs --install` | 通过 | 162 文件；临时全局安装 `larness 0.1.0` |
| TUI（源码 `node app.js` 与构建后 dist） | 通过 | ConPTY 中启动、渲染、Ctrl+C 正常退出并停止 Server/Web |
| 终端 | 通过 | ConPTY 创建/输入/resize/关闭；Ctrl+C 后保留 Shell；进程树清理；argv 原样传递 |
| 命令 | 通过 | 真实命令、`.cmd` shim（npm/pnpm）、取消/超时、输出限额、进程树终止 |
| 临时服务与预览 | 通过 | 监听探测、服务登记/注销、预览代理与限流 |
| PM2 正式服务 | 通过 | 临时 prefix 安装 pm2@7.1.2、私有 PM2_HOME、启动/替换/健康失败回滚/对账 |
| 定时脚本 | 通过 | 脚本运行、超时/取消、进程树清理 |
| 文件 / Git / 路径 | 通过 | 文件读写、Git 状态/提交/推送、盘符与反斜杠边界 |
| 锁 / IPC / 日志 / 数据库 | 通过 | Named Pipe、单实例锁、日志轮转、SQLite 迁移/备份 |
| Mock Playwright E2E | 通过 | `pnpm test:e2e`：19/19 |
| Auth Playwright E2E | 通过 | `pnpm test:e2e:auth`：18/18（Chromium，虚拟认证器） |
| 生产构建 E2E | 通过 | `pnpm test:e2e:prod`：18/18 |

## 待实机验证

| 平台 | 项 | 结果 |
|---|---|---|
| Windows 10 x64 1809+ | 同一实现的安装、TUI、终端、命令、PM2 | 待实机；只使用 Windows 10 自带 ConPTY/CIM/taskkill/Get-NetTCPConnection |
| Ubuntu 22.04 / 24.04 | `pnpm check` / build / platform-smoke / pack 安装 / 终端 / 命令 / PM2 | 待用户实机 |

## 手工验证命令

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/platform-smoke.mjs
node scripts/verify-npm-pack.mjs --install
```

- Windows 当前预期：`pnpm check` 的终端/命令测试失败；先记录 build / platform-smoke / pack 结果，不标“完整支持”。
- 记录 OS 版本、Node / npm 版本、失败日志与限制。

## CI

- 按用户要求删除 `.github/workflows/ci.yml`；不再使用 GitHub Actions。
- 三平台结果由用户实机填写；未验证平台不标通过。

## 结论

M5-4 按 macOS 当前范围完成，G5 条件通过。Windows 和 Ubuntu 的实现及实机验证见 [发布后跟踪](../../docs/open-questions.md#发布后任务与待验证项)。
