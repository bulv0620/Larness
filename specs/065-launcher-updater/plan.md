# M5-3 实施计划：npm 分发与版本更新提示

> 对应 [spec](spec.md)。用户已确认公共 npm、TUI 仅提示、不自动更新、升级前自动备份；本计划不再包含签名包 / Launcher / UpdateLock / 自动回滚。

## 1. 技术方案

1. **npm 包**：根 `package.json` 改为可发布；`bin.larness=./app.js`；`files` 只收 `app.js`、`apps/server/dist`、`apps/web/dist`、README、package.json。根包声明 server dist 的外部运行时依赖；`@larness/*` 已由 server 构建打包。
2. **发布模式入口**：`app.js` 在发布包中只加载 `apps/server/dist/tui.js`；dist 缺失时报错并提示重新安装，不回退 `pnpm/tsx`。
3. **更新检查**：新增 `apps/server/src/modules/updates/npm.ts`，`fetch` 公共 registry 的 dist-tags，semver 比较；每 24h / 同版本一次；状态写 `<dataDir>/updates/state.json`；TUI 启动时显示提示，不执行 npm。
4. **升级前备份**：`startServer` 在 `runMigrations` 前比较 `appliedMigrationCount` 与 `expectedMigrationCount`；已有 schema 且将升级时用现有 `backupDatabase` 生成 `backups/pre-upgrade-*`，保留 5 份；失败中止启动。
5. **降级保护**：applied > expected 时拒绝启动，提示安装更新版本或恢复备份。
6. **验证**：`npm pack` + 临时 prefix `npm install -g <tgz>` + `larness --version`；mock registry 验证提示；临时 DB 验证备份。

## 2. 备选方案与取舍

| 方案 | 结论 |
|---|---|
| 公共 npm `larness` | 采用；名称当前可用，安装最简单 |
| 私有 registry / scope | 不做；用户已选公共 |
| TUI 自动执行 npm | 不做；只提示，避免权限与网络副作用 |
| 下载签名包 / Launcher / current 指针 | 废弃；npm 负责版本 |
| 启动时自动更新 | 不做；违反用户要求 |
| 仅文档提示升级备份 | 不做；启动前自动备份是硬要求 |
| 备份失败仍启动 | 不做；拒绝迁移，避免无备份升级 |

## 3. 目录与文件变更

```text
新增：
apps/server/src/modules/updates/npm.ts
apps/server/src/modules/updates/state.ts
apps/server/src/modules/updates/version.ts       # semver 比较 / 通道
apps/server/src/db/preUpgradeBackup.ts           # 备份 / 保留 / 降级检查
apps/server/test/updates/npm.test.ts
apps/server/test/updates/preUpgradeBackup.test.ts
apps/server/test/packaging/npm-pack.test.ts       # 或脚本冒烟
scripts/verify-npm-pack.mjs                       # npm pack 内容 / 临时安装
docs/guides/install.md                            # 安装 / 升级 / 降级 / 卸载

修改：
package.json                                      # private、deps、files、bin、engines、license
app.js                                            # 发布模式只用 dist
apps/server/src/bootstrap/start.ts                # 迁移前备份
apps/server/src/tui/main.ts / dashboard.ts / screen-* # 更新提示
apps/server/src/config.ts（若在 server）          # 读取 updates.channel
packages/shared/src/config.ts                     # 不新增键，复用 channel
apps/server/package.json                           # semver 依赖
docs/contracts/runtime-entry.md / data-model.md
```

## 4. 实施步骤

### M5-3-1 npm 包与发布模式

- 先写失败测试：`npm pack` 文件白名单、`app.js` 发布模式、根依赖覆盖。
- 调整根 `package.json`、`app.js`、`files`、`bin`、`engines`；补 README / install guide 骨架。
- 临时 prefix 安装 tgz，运行 `larness --version`、`larness doctor`。
- 不实际 publish。

### M5-3-2 TUI 更新提示

- 先写失败测试：registry mock、semver、24h 节流、同版本一次、开发跳过、网络失败静默。
- 新增 update 模块与 TUI 提示；状态文件 0600。
- 不引入 npm 命令执行；提示固定文本。
- 不阻塞启动。

### M5-3-3 升级前备份与降级保护

- 先写失败测试：有 schema 且将升级 → 备份；新库 → 不备份；备份失败 → 中止；保留 5 份；applied > expected → 拒绝。
- 在 `startServer` 迁移前接 `preUpgradeBackup`；路径 / 权限 / 日志。
- 测试临时 DB / 迁移 fixture。

### M5-3-4 发布文档与整体验收

- 安装 / 升级 / 降级 / 卸载 / Node 版本 / 原生依赖说明。
- `npm pack` + 全局临时安装 + TUI 提示 + 备份演练。
- 记录未验证项（真实 npm publish、Linux/Windows、x64）。
- `pnpm check`、`pnpm build`、Demo、auth E2E；验收记录。

## 5. 数据与迁移

- 不新增数据库表。
- 备份目录 `<dataDir>/backups`，文件名 `pre-upgrade-<from>-<to>-<timestamp>.db`，0600。
- 更新检查状态 `<dataDir>/updates/state.json`，0600，无秘密。
- 旧数据目录不受包安装影响；卸载 npm 包不删除数据。

## 6. 回滚策略

- npm 升级失败 / 不满意：`npm install -g larness@<old-version>`；数据库 schema 更高时需恢复升级前备份。
- 备份失败：不迁移；用户可修复磁盘/权限后重试。
- 降级检测：拒绝旧代码打开新 schema，给出恢复指引。
- 更新提示误报：无关闭开关，但只提示不执行；修复后发布新版本。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
pnpm test:e2e:auth
node scripts/verify-npm-pack.mjs
npm pack --dry-run
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 根包缺运行时依赖 | 全局安装后启动失败 | 从 server dist 依赖生成 / 校验；临时安装冒烟 |
| 原生依赖无预编译 | macOS 安装需 Xcode CLT | 上游预编译 + 文档；M5-4 扩展 |
| 包误带源码/数据/秘密 | 泄漏 | `files` 白名单 + `npm pack` 检查 |
| 更新检查阻塞启动 | 离线不可用 | 5s 超时、静默失败 |
| 备份占空间 / 含秘密 | 磁盘 / 泄漏 | 保留 5 份、0600、数据目录 0700、不日志内容 |
| 未备份就迁移 | 升级失败不可恢复 | 迁移前强制备份，失败拒绝 |
| 降级 schema 不兼容 | 启动崩溃 | applied > expected 拒绝并提示 |
| 真实 publish 不可逆 | 供应链 | 人类 2FA；先 dry-run；M5-4 发布流程 |

## 9. 未决事项

- 许可证 Q-004：公共 npm 实际发布前确认；未确认时只做 pack / dry-run。
- npm 账号、2FA、包名所有权由人类确认。
- beta 通道是否随首发开放；默认 stable。
- Linux/Windows 预编译与 CI 矩阵归 M5-4。
