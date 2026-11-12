# 本地发布与升级清单

> 仓库不配置 CI；发布由维护者在本机执行。目标是可重复、可回滚，不把未验证平台写成支持。
> 当前已发布：`larness@0.2.1`（公共 npm，MIT）。相关：[安装指南](../guides/install.md)、[已知限制](../known-limitations.md)、[安全复核](../security/review.md)。
> 发布记录与 0.2.1 复盘见第 11、12 节；发布前先读第 4 节的 2FA / staged publish 流程。

## 1. 发布前

- [ ] 确认变更已合入、工作树干净（`git status`）。
- [ ] **先查 registry 再定版本号**：

  ```bash
  npm view larness version dist-tags
  git tag --list 'v*' --sort=-v:refname | head
  ```

  - 以 registry 为准；**git tag 存在不代表已发布**（`v0.1.1` 就只有 tag、没有发布）。
  - 目标版本必须是 registry 上不存在的新版本；默认应大于 `latest`，若维护旧版本线需在发布记录中说明。
  - 不要为了“对齐 tag”而复用一个未发布的旧版本号；直接前进一个新版本。
- [ ] 更新版本号（`package.json`，semver；已发布版本不可重复）。
- [ ] 更新 README / 安装文档 / 已知限制中受影响的版本或平台说明。
- [ ] 确认 `publishConfig.registry=https://registry.npmjs.org`、`license: MIT`、`files` 白名单。
- [ ] 确认 Node / npm 可用且在支持矩阵内：

  ```bash
  node -v   # 22.22+（22.x）/ 24+
  npm -v    # 11.5+；staged publish 依赖 npm stage
  ```

  使用官方 Node 发行包。不要用 Electron / 桌面端内置的 node：其签名和 ABI
  会让 `better-sqlite3`、`node-pty`、`rolldown` 等原生模块加载失败。
  本机 0.2.1 发布使用 Node 24.22.3 + npm 11.19.1。

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

`pnpm check` 包含真实子进程 / PTY 用例。必须在能创建进程和 PTY 的环境运行；
受限沙箱下出现 `spawn EPERM` / `posix_spawnp failed` 时，应换到正常终端重跑，
不能把“环境失败”当成通过，也不能通过跳过测试来发布。

## 3. 包内容与安装冒烟

```bash
node scripts/verify-npm-pack.mjs --install
npm pack --dry-run
```

- tarball 必须包含 `app.js`、`apps/server/dist`、`apps/server/drizzle`、`apps/server/package.json`、`apps/web/dist`、`README.md`、`LICENSE`、`docs/guides/install.md`。
- 不包含源码、测试、`test-results`、数据目录、日志、`.env`、密钥。
- 临时 prefix 安装后 `larness --version` 必须等于目标版本。

## 4. 发布（npm 2FA / staged publish）

npm 账号启用了 2FA，发布需要 proof-of-presence。推荐使用 staged publish：
先把 tarball 上传到 stage，确认状态，再用一次性验证码批准。直接
`npm publish` 也可以，但失败时更难判断版本是否已被占用。

### 4.1 登录与身份

```bash
npm login --auth-type=web   # 如未登录；在浏览器完成
npm whoami                  # 必须输出 bulv
```

Token 只保存在 `~/.npmrc`，不要写入仓库、日志、事件或对话。

### 4.2 推荐流程：stage → approve

```bash
npm pack
npm stage publish ./larness-<version>.tgz --access public
npm stage list
npm stage view <stage-id>
```

`npm stage publish` 会输出 stage id，并把版本上传到 npm 的 staged 区。
等待 npm 自动审核（本次 0.2.1 约 7 分钟）：

```bash
npm stage approve <stage-id> --otp=<6位码>
```

- 有 TOTP / 验证器时优先 `--otp=<6位码>`，最稳定。
- 没有 TOTP 时省略 `--otp`，按提示在浏览器授权；该授权链接很短命，
  页面出现后必须立即确认，否则会变成 `Invalid or Expired Token`。
- `E409 ... automated review hasn't finished`：不是发布失败。等 3–5 分钟
  （实际可能更久）后用**同一个 stage id** 重试；不要重新 stage，也不要因此换版本。
- 批准后立即验证 registry：

  ```bash
  npm view larness version dist-tags
  ```

  此时 `npm stage view <stage-id>` 可能返回 404：通常表示 stage 已被批准
  并转成正式版本，stage 记录不再存在；以 registry 查询为准，不要重复发布。

### 4.3 直接 publish（仅在确认没有 staged 占用时）

```bash
npm publish --access public --otp=<6位码>
```

- 没有 `--otp` 时，2FA 网页授权链接会过期；不要在拿不到验证码时反复重试同一版本。
- 出现 `EOTP` 后先停，检查 registry 和 staged 状态：

  ```bash
  npm view larness version dist-tags
  npm stage list
  ```

- 如果目标版本已被占用或已进入 staged 区：**不要复用该版本号**。确认是
  自己的待处理 stage 才可 `npm stage reject <stage-id>`；否则直接 bump patch。
- `E404` 出现在 `PUT https://registry.npmjs.org/larness` 时，通常是 token
  无效或没有写权限，不代表包不存在；重新 `npm whoami` / `npm login`。

### 4.4 发布成功后的 tag

```bash
git tag -a v<version> -m "larness <version>"
git push origin main
git push origin v<version>
```

## 5. 发布后验证

```bash
npm view larness version dist-tags
npm install -g --prefix /tmp/larness-check larness@<version>
/tmp/larness-check/bin/larness --version
```

- `npm view` 必须是目标版本，`latest` 必须指向它。
- 临时 prefix 安装后 `larness --version` 必须等于目标版本。
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
| `pnpm check` 出现 `spawn EPERM` / `posix_spawnp failed` | 换到能创建真实进程 / PTY 的终端重跑；不要把环境失败当通过 |
| `npm pack` 内容异常 | 修正 `files`，重建后重跑 `verify-npm-pack` |
| 临时安装失败 | 检查 Node / 原生依赖 / npm prefix；不要发布 |
| `E401` / `npm whoami` 失败 | token 无效；`npm login --auth-type=web` 后重试 |
| `E404` on `PUT` | 通常是 token 无写权限，不是包不存在；重新登录并确认账号 |
| `EOTP` | 需要 2FA；用 `--otp=<6位码>`，或立即完成网页授权 |
| `E409 Cannot publish over previously staged version` | 版本已被占用；不要复用，bump patch；先查 `npm view` / `npm stage list` |
| `E409 automated review hasn't finished` | 正常等待；数分钟后用同一 stage id 重试，不要重新 stage |
| `npm stage view` 批准后 404 | 通常已发布；用 `npm view larness version` 确认 |
| 网页授权 404 / `Invalid or Expired Token` | 链接过期；重新发起并立即确认，或改用 `--otp` |
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

## 11. 发布记录

| 版本 | 日期 | 结果 |
|---|---|---|
| 0.1.0 | 2026-11-08 | 已发布 |
| 0.1.1 | 2026-11-10 | 仅有 git tag，未发布；不要复用 |
| 0.2.0 | — | 未发布；发布尝试在 npm 侧留下版本占用，改用 0.2.1 |
| 0.2.1 | 2026-11-12 | 已发布（staged publish → approve） |

## 12. 已知坑（0.2.1 复盘）

1. **发布失败后不要复用版本号。** 0.2.0 在 2FA 未完成时被 npm 保留，
   再次 publish/stage 会报 `E409`；正确做法是查 `npm view` / `npm stage list`
   后直接 bump patch。文档旧版只写了 `npm publish`，这次已补上 staged 流程。
2. **2FA 网页链接短命。** 有验证器就用 `--otp`；没有就浏览器一弹出立即确认，
   不要先看文档或等任务输出。
3. **`E409 automated review hasn't finished` 不是失败。** 等审核完成后用
   同一 stage id 重试；不要重新 stage，也不要因此换版本。
4. **`npm stage view` 404 不等于 stage 丢了。** 批准后 stage 会转成正式版本，
   以 `npm view larness version dist-tags` 为准。
5. **批准后立刻验证。** 本次在 22:37 已发布，但继续等待后台任务输出，
   直到后来查 registry 才发现成功；以后 approve 后第一步就是 `npm view`。
