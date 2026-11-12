# 本地发布与升级清单

> 仓库不配置 CI；发布由维护者在本机执行。目标是可重复、可回滚，不把未验证平台写成支持。
> 当前已发布：`larness@0.1.0`（公共 npm，MIT）。`0.2.1` 已 stage，待 2FA 批准。相关：[安装指南](../guides/install.md)、[已知限制](../known-limitations.md)、[安全复核](../security/review.md)。

## 1. 发布前

- [ ] 确认变更已合入、工作树干净（`git status`）。
- [ ] 更新版本号（`package.json`，semver；已发布版本不可重复）。
- [ ] 更新 README / 安装文档 / 已知限制中受影响的版本或平台说明。
- [ ] 确认 `publishConfig.registry=https://registry.npmjs.org`、`license: MIT`、`files` 白名单。
- [ ] 确认 Node 版本在支持矩阵内（22.22+（22.x）/ 24+）。

## 2. 构建与检查

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/platform-smoke.mjs
node scripts/verify-npm-pack.mjs
```

要求：

- `pnpm check` 通过（macOS Apple Silicon 基线；Windows / Ubuntu 由实机记录）。
- `pnpm build` 通过；macOS 如遇 Vite 内存不足，可用
  `NODE_OPTIONS=--max-old-space-size=6144 pnpm build`。
- `platform-smoke` 检查 better-sqlite3、node-pty、文件系统。
- `verify-npm-pack` 检查 tarball 文件白名单与大小。

## 3. 包内容与安装冒烟

```bash
node scripts/verify-npm-pack.mjs --install
npm pack --dry-run
```

- tarball 必须包含 `app.js`、`apps/server/dist`、`apps/server/drizzle`、`apps/server/package.json`、`apps/web/dist`、`README.md`、`LICENSE`、`docs/guides/install.md`。
- 不包含源码、测试、`test-results`、数据目录、日志、`.env`、密钥。
- 临时 prefix 安装后 `larness --version` 必须等于目标版本。

## 4. 发布

```bash
npm login                 # 如未登录
npm whoami
npm publish --access public
npm view larness version
npm view larness dist-tags
```

- 需要 npm 2FA；不要把 token 写入仓库。
- 发布失败时不要用同一版本重试；先确认 registry 状态。
- 发布成功后创建并推送 git tag：

```bash
git tag v<version>
git push origin v<version>
```

## 5. 发布后验证

```bash
npm install -g larness@<version>
larness --version
larness doctor            # 未初始化数据目录会按预期返回非零
```

- 在 macOS Apple Silicon 上启动 TUI，验证项目/会话/终端/PM2。
- Windows / Ubuntu 按 [已知限制](../known-limitations.md) 的矩阵实机验证；未验证项保持“未验证”。

## 6. 升级与备份

按 [ADR-055](../adr/ADR-055-npm-update-security.md)，等待 Agent Turn、部署与数据库写入完成，通过 TUI 正常停止管理面，再手动安装。正式 PM2 服务继续运行。

```bash
npm install -g larness@latest
# 重启 larness；首次启动会在数据库迁移前自动备份到 <dataDir>/backups/
```

- 备份文件 `pre-upgrade-<from>-<to>-<timestamp>.db`，0600，保留最近 5 份。
- 备份失败时拒绝迁移；不要手动跳过。
- 更新检查只提示，不自动安装；TUI 退出不影响正式 PM2 服务。

## 7. 降级 / 回滚

安装旧版本前同样等待在途作业完成并正常退出 TUI。程序版本切换与数据库恢复分开执行。

```bash
npm install -g larness@<old-version>
```

- 如果数据库 schema 已升级到更高版本，旧程序会拒绝启动；先停止 Larness，保留当前数据库副本，再从升级前备份恢复。
- 恢复前确认备份完整；恢复后启动旧版本。
- 坏版本可先 `npm deprecate larness@<bad-version> "reason"`，再发布补丁；不要删除已发布版本作为唯一回滚手段。

## 8. 失败处理

| 场景 | 处理 |
|---|---|
| `pnpm check` 失败 | 停止发布；修复或记录已知平台限制，不能用跳过测试发布 |
| `npm pack` 内容异常 | 修正 `files`，重建后重跑 `verify-npm-pack` |
| 临时安装失败 | 检查 Node / 原生依赖 / npm prefix；不要发布 |
| `npm publish` 认证失败 | 重新 `npm login` / 2FA；不要复用失败版本号 |
| 发布后启动失败 | `npm deprecate` 坏版本，发布补丁；必要时指导降级 + 备份恢复 |
| 数据库迁移失败 | 使用升级前备份恢复；保留日志与备份路径 |

## 9. 平台验证矩阵

| 平台 | 必做 |
|---|---|
| macOS Apple Silicon | check / build / platform-smoke / pack 安装 / TUI / 终端 / PM2 |
| Ubuntu 22.04 / 24.04 | 同上；node-pty 可能需 build-essential / python |
| Windows 11 x64 | build / platform-smoke / pack 待实机；终端与命令当前不可用，PM2 待验证 |

## 10. 禁止

- 不把未验证平台写成“支持”。
- 不跳过 `pnpm check` 直接发布。
- 不在仓库写入 npm token、私钥或发布凭据。
- 不用 `npm unpublish` 作为常规回滚；优先 `deprecate` + 补丁 / 降级。
