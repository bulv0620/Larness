---
id: 065-launcher-updater
title: npm 分发与版本更新提示
milestone: M5
status: done
depends_on: [050-deploy, 064-scheduler]
owners: [human]
created: 2026-11-08
updated: 2026-11-08
---

# npm 分发与版本更新提示（M5-3）

> 状态：`done`（2026-11-08 首次公共 npm 发布成功）。发布走公共 npm 的 `larness` 包；TUI 只提示新版本，不自动更新；升级前自动备份数据库。签名包 / Launcher / UpdateLock / 自动回滚方案已废弃。
> 相关：[ROADMAP](../ROADMAP.md)、[STATUS](../../STATUS.md)、ADR-007（自动检查、手动安装）、ADR-023（受管入口）。

## 1. 背景与问题

Larness 目前以仓库内 `node app.js` 启动，没有可发布的 npm 包，也没有版本更新提示。用户希望类似 Claude Code 的体验：

- `npm install -g larness` 全局安装；
- 终端输入 `larness` 启动；
- 程序不自动更新；TUI 只提示有新版本，用户自行执行 `npm install -g larness@latest`；
- 升级后的首次启动在迁移数据库前自动备份。

本切片把“发布、安装、提示、升级备份”固定下来，不实现自动下载或启动器。

## 2. 目标

- **G-1 npm 安装**：公共 npm `larness` 可全局安装，`larness` 命令启动 TUI；包内不依赖 pnpm、源码目录或仓库脚本。
- **G-2 版本提示**：TUI 启动时与每日一次读取 npm registry 的版本；发现新版本只提示命令，不下载、不安装、不重启。
- **G-3 可预测升级**：用户执行 npm 更新后，新版本首次启动在迁移前自动备份数据库；备份失败不迁移。
- **G-4 安全边界**：更新检查只读公共 registry；Web / Agent 无更新或安装入口；不引入自动更新。
- **G-5 可发布**：包元数据、文件白名单、运行时依赖、engines 和 `npm pack` 冒烟可重复验证。

## 3. 非目标

- **NG-1 自动更新**：不下载、不安装、不自动重启；只提示。
- **NG-2 签名发布包 / Launcher / current 指针 / UpdateLock / 自动回滚**：M5-3 不做；npm 自身负责版本安装，用户可用 `npm install -g larness@<version>` 降级。
- **NG-3 Web / Agent 安装入口**：Agent 工具不能检查、安装或停止更新；Web 不提供安装按钮。
- **NG-4 私有 registry**：本切片只面向公共 npm；私有 registry / 企业分发留后续。
- **NG-5 跨平台预编译**：M5-3 只验证 macOS arm64（上游预编译）；Linux/Windows 预编译、CI 矩阵与安装说明归 M5-4。
- **NG-6 发布自动化账号**：不代替人类登录 npm 或执行真实发布；只准备可发布包与 `npm publish --dry-run` 验证。

## 4. 用户故事

- 作为新用户，我执行 `npm install -g larness` 后输入 `larness` 就能启动，不需要 pnpm 或源码。
- 作为操作者，我希望 TUI 告诉我新版本号和更新命令，但不要替我改动安装。
- 作为操作者，我希望升级后首次启动自动备份数据库，迁移失败时还能恢复。
- 作为维护者，我希望发布包干净、可重复构建，不包含测试、日志、数据或秘密。

## 5. 验收场景

### A1 全局安装与启动

```gherkin
Given macOS arm64、Node 20/22 且可访问公共 npm
When 用户执行 npm install -g <larness tarball 或 larness>
Then larness 命令在 PATH 中可用
And larness --version 输出版本
And larness 启动 TUI 与受管 Server，Web 可访问
And 不要求用户安装 pnpm 或进入源码目录
```

### A2 新版本提示

```gherkin
Given 当前安装版本 0.1.0，公共 npm latest 为 0.2.0
When TUI 启动
Then 显示“有新版本 0.2.0”，并给出 npm install -g larness@latest
And 不下载、不安装、不重启
And 同一版本只提示一次；下次检查在 24 小时后
```

### A3 已是最新 / 网络失败

```gherkin
Given 当前版本等于 latest，或 registry 不可达
When TUI 检查版本
Then 不显示更新提示，也不阻塞启动
And 网络失败只写调试日志，不显示错误弹窗
```

### A4 开发构建跳过

```gherkin
Given 通过源码 / pnpm 启动，版本为 0.0.0 或 LARNESS_DEV=1
When 启动
Then 不检查公共 registry，避免开发时误报
And npm 安装的正式版本仍按 A2 检查
```

### A5 升级前数据库备份

```gherkin
Given 已初始化数据库 schemaVersion 22，程序升级到需要 schemaVersion 23 的版本
When 新版本首次启动
Then 在 runMigrations 前生成 pre-upgrade 备份，模式 0600
And 备份成功后才执行迁移
And 备份失败时拒绝迁移并停止启动，提示备份路径 / 磁盘 / 权限
```

### A6 备份保留

```gherkin
Given 已有 5 份 pre-upgrade 备份
When 再次升级并备份成功
Then 删除最旧备份，保留最近 5 份
And 失败更新的备份不自动删除
```

### A7 降级保护

```gherkin
Given 数据库 schemaVersion 23，启动的程序只支持到 22
When 启动
Then 拒绝以旧代码打开新 schema，提示安装更新版本或恢复备份
And 不自动回退数据库
```

### A8 包内容

```gherkin
Given 执行 npm pack
When 检查 tarball 内容
Then 包含 app.js、apps/server/dist、apps/web/dist、package.json、README
And 不包含源码、测试、test-results、数据目录、日志、.env、密钥或 node_modules
And 运行时依赖在根 package.json 中声明
```

### A9 更新边界

```gherkin
Given Web 已认证或 Agent 处于 autonomous
When 尝试触发更新 / 安装
Then 没有可用接口或工具；只读版本状态也不得触发停止或 npm 命令
```

### A10 发布 dry-run

```gherkin
Given 维护者已登录 npm
When 执行 npm publish --dry-run
Then 包名、版本、文件、bin、engines 与许可证字段通过校验
And 不实际发布；真实发布由人类执行
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 根包 `larness` 可发布到公共 npm：`private:false`、正式 semver、`bin.larness=app.js`、`engines.node>=20.19`；macOS arm64 支持 Node 20.19 / 22 / 24。 |
| R-2 | MUST | `files` 只包含 `app.js`、`apps/server/dist`、`apps/web/dist`、`package.json`、`README.md` 及必要静态资源；排除源码、测试、数据、日志、秘密、`node_modules`。 |
| R-3 | MUST | 根 `package.json` 声明 server 运行时外部依赖（workspace 包由构建打包）；`npm install` 后不依赖 pnpm 或仓库脚本。 |
| R-4 | MUST | `app.js` 在发布包中只加载 dist 入口；dist 缺失时失败并提示重新安装，不回退源码 / pnpm。 |
| R-5 | MUST | TUI 启动时检查公共 npm `https://registry.npmjs.org/larness` 的 dist-tag；`stable`→`latest`，`beta`→`beta`。 |
| R-6 | MUST | 检查为非阻塞：失败静默 / 调试日志；不禁止用户关闭（无关闭开关）。 |
| R-7 | MUST | 每 24 小时最多检查一次；同一新版本只提示一次；状态写入数据目录 `updates/state.json`（0600，无秘密）。 |
| R-8 | MUST | 只提示当前版本、最新版本与 `npm install -g larness@latest`；不执行 npm、不下载、不重启。 |
| R-9 | MUST | 源码 / `0.0.0` / `LARNESS_DEV=1` 跳过检查；正式 npm 版本按 semver 比较。 |
| R-10 | MUST | 升级前（`appliedMigrationCount < expectedMigrationCount` 且已有 schema）用 `VACUUM INTO` 备份到 `<dataDir>/backups/pre-upgrade-<from>-<to>-<timestamp>.db`，0600。 |
| R-11 | MUST | 备份失败则拒绝迁移并停止启动；错误使用稳定码/可操作信息，不记录数据库内容。 |
| R-12 | MUST | 保留最近 5 份 pre-upgrade 备份；成功更新后清理，失败备份保留。 |
| R-13 | MUST | 数据库 schema 高于程序支持范围时拒绝启动并提示恢复/升级，不自动降级。 |
| R-14 | MUST | 不新增 Web / Agent 更新入口；Agent 工具与 system prompt 不暴露更新能力。 |
| R-15 | MUST | `npm pack` / `npm publish --dry-run` 冒烟通过；真实 `npm publish` 由人类执行。 |
| R-16 | SHOULD | TUI 显示当前版本、通道、最近检查时间、可用版本；失败不打扰。 |
| R-17 | SHOULD | README 记录安装、升级、降级、卸载、Node 版本与原生依赖说明。 |
| R-18 | SHOULD | 包元数据包含 description、repository、homepage、keywords、license；许可证为 MIT（2026-11-08 用户确认）。 |

## 7. 接口与契约

### 7.1 包元数据

```json
{
  "name": "larness",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "bin": { "larness": "./app.js" },
  "engines": { "node": ">=20.19" },
  "files": [
    "app.js",
    "apps/server/dist",
    "apps/web/dist",
    "README.md",
    "package.json"
  ],
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "fastify": "^5.12.7",
    "node-pty": "^1.1.0",
    "...": "server dist 的全部外部运行时依赖"
  }
}
```

- 版本由根 `package.json` 唯一来源；`app.js --version` 读取同一字段。
- `packageManager` / `devDependencies` 可保留，但不要求用户安装 pnpm。
- 不发布 workspace 包；`@larness/*` 由 server 构建打包进 `dist`。
- 原生依赖：`better-sqlite3` 使用上游 `prebuild-install`，`node-pty` 使用包内 macOS/Windows 预编译；macOS 先验证 arm64（x64 由 M5-4 覆盖）。

### 7.2 更新检查

| 项 | 约定 |
|---|---|
| 端点 | `https://registry.npmjs.org/larness`（读取 `dist-tags[latest|beta]`）；不跟随任意重定向 |
| 比较 | semver；预发布版本只与 beta 通道比较 |
| 频率 | 启动一次 + 24h；同一版本只提示一次 |
| 超时 | 5 秒；失败不影响启动 |
| 状态 | `<dataDir>/updates/state.json`：`lastCheckedAt`、`lastNotifiedVersion`、`channel` |
| 开发跳过 | 版本 `0.0.0` 或 `LARNESS_DEV=1` |
| 提示 | “有新版本 x.y.z · 运行 npm install -g larness@latest” |

- 不新增 REST / IPC / WS 接口；TUI 直接 fetch。
- Web 不展示更新提示（避免误以为可远程安装）；README 说明更新命令。

### 7.3 数据库备份

- 触发：启动时 `appliedMigrationCount > 0` 且 `< expectedMigrationCount`。
- 位置：`<dataDir>/backups/pre-upgrade-<from>-<to>-<timestamp>.db`，0600。
- 实现：现有 `backupDatabase`（`VACUUM INTO`），迁移前同步执行。
- 失败：关闭数据库、释放实例锁、退出并提示备份路径；不运行迁移。
- 保留：最近 5 份 pre-upgrade 备份；不含普通 `larness-*.db` 备份。
- 降级：`appliedMigrationCount > expectedMigrationCount` 时拒绝启动，提示安装更新版本或恢复备份。

### 7.4 配置

- 复用 `updates.channel`（stable/beta）、`updates.autoCheck`（默认 true）。
- `updates.autoInstall` 保持 false 且不生效。
- 不新增关闭检查的配置项；检查失败/离线不影响启动。
- 不新增 `manifestUrl`；公共 npm 固定 registry。

## 8. 数据与迁移

- M5-3 不新增数据库表；更新检查状态是数据目录小 JSON 文件。
- 升级前备份是启动流程的一部分；备份包含加密秘密，依赖数据目录 0700 与备份 0600，不上传、不写入日志。
- 备份失败拒迁移；迁移成功后保留备份供人工恢复。
- 不修改 `app_meta` schema 版本语义；版本仍以迁移计数表示。

## 9. 安全、权限与审计

- 更新检查只读、仅 HTTPS、无凭据；不发送安装 ID、项目路径或数据。
- 不执行 npm 命令；提示文本固定，不拼接 registry 返回的任意 HTML / 链接。
- 包文件白名单防泄漏；`npm pack` 冒烟检查无 `.env`、DB、日志、测试、密钥。
- 原生依赖使用上游预编译；不新增签名更新链。
- 备份 0600；日志只记录路径、版本、迁移数量，不记录内容。
- Web / Agent 无更新接口；不新增更新工具。
- 真实 `npm publish` 由人类在已登录、2FA 环境执行；CI 发布留 M5-4。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| registry 不可达 / 超时 | 静默失败，启动继续 | 无弹窗；调试日志 |
| 当前版本更高 / 同版本 | 不提示 | 无 |
| 开发版本 0.0.0 | 跳过检查 | 无 |
| npm 更新后未重启 | 旧进程继续运行；重启后使用新版本 | README / TUI 提示 |
| 备份失败 | 拒绝迁移并退出 | 备份路径 / 磁盘 / 权限 |
| 备份后迁移失败 | 程序启动失败；保留备份 | 恢复指引 |
| schema 高于程序 | 拒绝启动 | 安装新版本或恢复备份 |
| 包缺失 dist | 启动失败 | 重新安装 / 报告损坏 |
| 原生依赖安装失败 | npm install 失败 | 提示 Xcode CLT / 编译工具 |
| 用户 `--ignore-scripts` | 原生模块不可用 | README 明确不支持 |

## 11. 可观测性

- 更新检查：debug 日志含 `currentVersion`、`latestVersion`、`channel`、`durationMs`；不含 registry 原始响应正文。
- 备份：日志含 `from`、`to`、路径、大小、耗时；不含数据库内容。
- TUI：当前版本、最近检查、可用版本、更新命令。
- `npm pack` 检查输出文件清单和总大小。

## 12. 测试计划

- **单元**：semver / dist-tag 选择；24h 节流 / 同版本只提示；开发跳过；registry 失败静默；状态文件读写；备份文件名 / 保留 5 份；降级检测。
- **集成**：临时 npm registry fixture（或 mock fetch）返回 latest/beta；`startServer` 在迁移前备份；备份失败中止；迁移成功后启动。
- **打包**：`npm pack` 内容白名单；临时 prefix `npm install -g <tarball>`；`larness --version`；`larness doctor`；macOS arm64。
- **回归**：`pnpm check`、`pnpm build`、Demo、auth E2E。
- **手动**：真实公共 npm `npm publish --dry-run`；升级 / 降级 / 备份恢复；`npm pack` 安装后启动。

## 13. 决策与开放问题

| ID | 决策（2026-11-08 用户确认） |
|---|---|
| D1 | 公共 npm 的 `larness`；不启用私有 registry |
| D2 | 不做签名更新包 / Launcher / 自动回滚；npm 负责版本安装 |
| D3 | TUI 只提示；用户自行 `npm install -g larness@latest` |
| D4 | 不提供关闭检查；检查失败静默，不阻塞 |
| D5 | 升级前自动备份数据库；备份失败拒绝迁移 |
| D6 | M5-3 先接受 macOS 上游预编译；Linux/Windows 预编译与 CI 归 M5-4 |

已确认：

- 许可证 MIT（2026-11-08 用户确认），根包 `license: MIT` 并附 `LICENSE`。
- npm 账号已具备；包名 `larness` 当前未被占用，发布前仍需确认所有权。
- `publishConfig.registry` 固定 `https://registry.npmjs.org`，避免本机镜像配置误发布。

开放：

- beta 通道是否随首发开放；默认可读取 `beta` dist-tag，不影响 stable 用户。
- npm 账号 2FA / 发布 token 与真实 publish 由人类执行。

## 14. 完成定义

- [ ] A1–A10 通过；
- [ ] `npm pack` / `npm install -g` / `larness` 启动通过（macOS arm64）；
- [ ] TUI 新版本提示、节流、离线跳过通过；
- [ ] 升级前备份、失败拒绝迁移、保留 5 份、降级拒绝通过；
- [ ] 包内容不含源码 / 测试 / 数据 / 秘密；
- [ ] `pnpm check`、`pnpm build`、Demo、auth E2E 通过；
- [ ] 文档、STATUS、ROADMAP、tasks 更新；
- [ ] 人类验收；实际 npm publish 由人类执行。
