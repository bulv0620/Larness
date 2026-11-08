# M5-3 验收记录：npm 分发与版本提示（2026-11-08）

> 状态：`done`（2026-11-08 首次公共 npm 发布成功，`larness@0.1.0`）。

## 验收矩阵

| 项 | 结果 | 证据 / 边界 |
|---|---|---|
| A1 全局安装与启动 | 通过（macOS arm64） | `npm pack` 后临时 prefix `npm install -g <tgz>` 成功；`larness --version` = `0.1.0`；未在真实全局 prefix 执行 `larness` 交互 TUI |
| A2 新版本提示 | 通过（单元 / TUI） | `test/updates/npm.test.ts` 新版本 / 同版本 / beta；`screen-dashboard.test.ts` 提示行；真实公共 registry 无已发布包，未做真实新版本提示 |
| A3 已最新 / 网络失败 | 通过（单元） | 同版本不提示；网络异常静默；24h 节流 |
| A4 开发构建跳过 | 通过（单元） | 版本 `0.0.0` / `LARNESS_DEV=1` 不检查 |
| A5 升级前备份 | 通过（集成） | `preUpgradeStartup.test.ts` 真实 startServer 从 schema 21 迁移到 22 前生成备份 |
| A6 备份保留 | 通过（单元） | 7 次备份只保留 5 份；0600 |
| A7 降级保护 | 通过（单元） | `assertSchemaCompatible(23,22)` 拒绝；启动接线 |
| A8 包内容 | 通过 | `npm pack` 160 文件；含 dist / drizzle / server package / web dist / LICENSE / 安装指南；无源码 / 测试 / 数据 / 秘密 |
| A9 更新边界 | 通过（设计 / 代码审查） | Web / Agent 无更新接口或工具；TUI 只读提示 |
| A10 发布 dry-run | 通过 | `npm publish --dry-run` 指向 `registry.npmjs.org`、public access、`larness@0.1.0`、160 文件；未真实发布 |

## 自动化检查

- `pnpm check`：通过（web 141、agent 40 通过 / 1 跳过、server 562 通过 / 10 跳过），Node 20.19.3 / 22.23.4 / 24.22.2 各自通过。
- `pnpm build`：通过。
- `scripts/verify-npm-pack.mjs`：通过（160 文件）。
- `scripts/verify-npm-pack.mjs --install`：通过（临时 prefix，macOS arm64，`larness 0.1.0`）。
- `npm publish --dry-run`：通过；`publishConfig.registry=https://registry.npmjs.org`。

## 未验证 / 已知边界

- **真实 npm publish**：未执行；需要人类登录 npm、确认 2FA 与包名所有权。
- **真实 npm 新版本提示**：公共 registry 尚无 larness 发布，无法端到端验证“已发布新版本 → TUI 提示”；已用 mock registry 覆盖。
- **真实全局 prefix TUI**：临时 prefix 验证了 `--version`，未运行完整交互 TUI；`doctor` 在未初始化数据目录按预期返回非零（数据库未初始化）。
- **Node 20 engine warning**：Node 20.19.3 安装时 `cookie@2` / `content-disposition@3` 声明 `node >=22`，npm 仅警告；Node 20 测试与运行已验证。后续可再评估固定 Fastify 传递版本。
- **Node 22/24**：`pnpm check` 与 `npm pack` 临时安装均通过；`better-sqlite3` 从 11.10.0 固定到 12.6.2（12.11+ 不再提供 Node 20 预编译，13 要求 Node 22+）。
- **npm 11 install-scripts**：会提示 `allowScripts` 未审查；脚本仍执行。npm 11 全局安装可能使 `node-pty/spawn-helper` 丢失执行位，已加入终端初始化时的权限修复。
- **平台**：仅 macOS arm64；macOS x64、Linux、Windows 与完整预编译矩阵归 M5-4。
- **许可证**：MIT 已确认。

## 结论

M5-3 的包发布准备、TUI 提示、升级前备份与降级保护已交付；`larness@0.1.0` 已发布到公共 npm，自动化检查通过。跨平台安装与预编译矩阵进入 M5-4。
