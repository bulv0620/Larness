# M5-4 跨平台验收记录（2026-11-08）

> 状态：`blocked`。macOS Apple Silicon 已完成；Windows 11 / Ubuntu 由用户实机验证；仓库 CI 已按用户要求删除。

## 已完成（macOS Apple Silicon）

| 项 | 结果 | 证据 |
|---|---|---|
| Node 20 / 22 / 24 | 通过 | 20.19.3 / 22.23.4 / 24.22.2 的 `pnpm check` 均通过（562 / 10 skip） |
| 构建 | 通过 | `pnpm build` |
| 原生模块 | 通过 | `platform-smoke`：better-sqlite3、node-pty、文件系统 |
| npm 包安装 | 通过 | `verify-npm-pack.mjs --install`；160 文件，`larness 0.1.0` |
| 终端 bootstrap | 通过 | 修复 `/bin/sh` 对 `exec --` 的不兼容；macOS / 预期 Linux dash 均使用 `(exec "$@")` |
| 公共 npm 发布 | 通过 | `larness@0.1.0` |

## 待实机验证

| 平台 | 项 | 结果 |
|---|---|---|
| Ubuntu 22.04 / 24.04 | `pnpm check` / build / platform-smoke / pack 安装 / 终端 / 命令 / PM2 | 待用户实机 |
| Windows 11 x64 | build / platform-smoke / pack 安装 | 待用户实机 |
| Windows 11 x64 | 终端 / 命令 / PM2 | **未实现**：`TerminalManager` / `CommandManager` 对 win32 返回 `RESOURCE_UNAVAILABLE`；需先实现才能跑全量 check |

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

M5-4 的 macOS 开发与本地冒烟完成；Windows/Ubuntu 等待实机，M5-4 保持 `blocked`。M5-5 的文档/安全收尾可在 Mac 上并行进行，但 G5 仍需三端结果。
