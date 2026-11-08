# M5-3 任务：npm 分发与版本更新提示

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 开始任务前更新 `STATUS.md`；完成后勾选本表并更新 `ROADMAP.md`。
> 门禁：spec `ready`（2026-11-08 用户确认公共 npm / TUI 提示 / 自动备份）。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-3-1 | npm 包、发布模式与安装冒烟 | 065 spec ready | `done` |
| M5-3-2 | TUI 新版本提示 | M5-3-1 | `done` |
| M5-3-3 | 升级前数据库备份与降级保护 | M5-3-1 | `done` |
| M5-3-4 | 发布文档与整体验收 | M5-3-2、M5-3-3 | `done` |

## 任务卡

### M5-3-1 npm 包、发布模式与安装冒烟

- 状态：`done`
- 依赖：065 spec ready
- 目标：公共 npm 包可全局安装并运行 `larness`，不依赖 pnpm / 源码。
- 交付物：
  - 根 `package.json`：`private:false`、`bin`、`files`、`engines`、运行时依赖、元数据；许可证占位待确认。
  - `app.js` 发布模式只加载 dist；缺失时明确失败。
  - `scripts/verify-npm-pack.mjs`：`npm pack` 白名单 + 临时 prefix 安装 + `larness --version`。
  - `docs/guides/install.md` 骨架。
- 验收：A1、A8；macOS arm64 临时全局安装可启动；tarball 无源码 / 测试 / 数据 / 秘密。
- 测试：pack 内容、依赖覆盖、发布模式、临时安装。
- 交付（2026-11-08）：
  - [x] 根包 `larness@0.1.0`：`private:false`、MIT、`bin`、`files`、`engines`、根运行时依赖。
  - [x] 发布模式 `app.js` 只用 dist；缺失时提示重新安装；新增 `scripts/verify-npm-pack.mjs`。
  - [x] `npm pack`：160 文件 / 4.2MB；含 `apps/server/dist`、`drizzle`、`apps/server/package.json`、`apps/web/dist`、MIT、安装指南；不含源码 / 测试 / 数据。
  - [x] 临时 prefix `npm install -g <tgz>` 成功，`larness --version` 输出 `0.1.0`；macOS arm64 上游预编译安装成功。
  - [x] `pnpm check` 在 Node 20.19.3 / 22.23.4 / 24.22.2 通过（web 141、agent 40/1、server 562/10）；`pnpm build` 通过。
- 涉及路径：`package.json`、`app.js`、`apps/server/src/version.ts`、`scripts/verify-npm-pack.mjs`、`docs/guides/install.md`。
- 备注：安装时出现 `cookie@2` / `content-disposition@3` 的 Node 20 engine warning（传递依赖声明 Node >=22，但安装与当前测试可用）；Node 版本支持需在 M5-4 再确认。

### M5-3-2 TUI 新版本提示

- 状态：`done`
- 依赖：M5-3-1
- 目标：TUI 只提示 npm 新版本，不自动更新。
- 交付物：
  - `updates/npm.ts` / `version.ts` / `state.ts`：registry dist-tags、semver、24h、同版本一次、开发跳过。
  - TUI 启动提示与最近检查显示；不执行 npm。
  - 状态文件 0600，无秘密。
- 验收：A2、A3、A4；离线不阻塞；只提示命令。
- 测试：mock registry、节流、版本比较、失败静默、状态文件。
- 交付（2026-11-08）：
  - [x] `updates/npm.ts`：公共 registry dist-tags、semver、24h 节流、同版本只提示一次、开发跳过、失败静默。
  - [x] `<dataDir>/updates/state.json` 0600；TUI 控制面板异步显示“有新版本 … · 运行 npm install -g …”，不阻塞、不执行 npm。
  - [x] 稳定 / beta 通道映射 `latest` / `beta`；无关闭开关。
  - [x] 测试：新版本 / 同版本 / beta / 节流 / 网络失败 / 开发跳过 / TUI 提示；`pnpm check` 与 `pnpm build`。
- 涉及路径：`apps/server/src/modules/updates/npm.ts`、`apps/server/src/tui/screen-dashboard.ts` / `main.ts`、`apps/server/test/updates/npm.test.ts`。

### M5-3-3 升级前数据库备份与降级保护

- 状态：`done`
- 依赖：M5-3-1
- 目标：升级首次启动在迁移前自动备份；失败不迁移。
- 交付物：
  - `db/preUpgradeBackup.ts`：检测 applied / expected、备份、保留 5 份、降级拒绝。
  - `startServer` 迁移前接线；错误 / 日志 / 退出。
  - 备份 0600；不记录内容。
- 验收：A5、A6、A7；备份失败中止；降级拒绝。
- 测试：有 schema 升级、新库、备份失败、保留、降级、迁移前后。
- 交付（2026-11-08）：
  - [x] `db/preUpgradeBackup.ts`：迁移前 `VACUUM INTO`，`pre-upgrade-<from>-<to>-<timestamp>.db`，0600，保留 5 份。
  - [x] 启动时 `applied > 0 && expected > applied` 才备份；备份失败中止启动；`applied > expected` 拒绝降级。
  - [x] 日志记录 from/to/路径，不记录数据库内容；备份目录 0700。
  - [x] 测试：备份 / 保留 / 权限、schema 降级拒绝、真实 startServer 从 21 迁移到 22 前生成备份。
  - [x] `pnpm check`（server 556/10、web 141、agent 40/1）与 `pnpm build` 通过。
- 涉及路径：`apps/server/src/db/preUpgradeBackup.ts`、`apps/server/src/bootstrap/start.ts`、`apps/server/test/updates/*`。

### M5-3-4 发布文档与整体验收

- 状态：`done`
- 依赖：M5-3-2、M5-3-3
- 目标：安装 / 升级 / 降级 / 备份文档与整体验收。
- 交付物：
  - `docs/guides/install.md`：`npm install -g larness`、`larness`、升级命令、降级、卸载、Node / 原生依赖、备份恢复。
  - `npm pack` / `npm publish --dry-run` 记录；未验证项。
  - 验收记录、STATUS / ROADMAP / tasks / 契约更新。
- 验收：A1–A10；`pnpm check`、`pnpm build`、Demo、auth E2E。
- 测试：pack / install / TUI / 备份演练；真实 publish 由人类执行。
- 交付（2026-11-08）：[验收记录](acceptance.md)；安装 / 升级 / 降级 / 卸载指南 `docs/guides/install.md`；`npm pack` 160 文件、临时全局安装、`npm publish --dry-run` 通过。
- 涉及路径：`docs/guides/install.md`、`specs/065-launcher-updater/acceptance.md`。
