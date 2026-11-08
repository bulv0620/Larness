# M5-4 实施计划：跨平台安装与运行 PoC

> 对应 [spec](spec.md)。D1–D5 确认、spec 转 `ready` 后执行；本切片以验证和平台修复为主，不扩展产品功能。

## 1. 技术方案

1. **CI 极简三平台**：GitHub Actions 只保留 `macos-latest`、`ubuntu-latest`、`windows-latest`，统一 Node 22；每个平台执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build`、`npm pack`、临时全局安装与 `larness --version`。Node 20/24 与完整 E2E 由本地/实机覆盖。
2. **安装冒烟脚本**：复用 `scripts/verify-npm-pack.mjs --install`，输出 `os/arch/node/npm/version/native/better-sqlite3/node-pty`；CI artifact 保存日志。
3. **平台审计**：按 `process.platform` 列出 PTY、命令树、PM2、路径、文件锁、TUI 分支；对 Windows / Linux 条件测试启用或补 skip/记录。
4. **修复优先级**：安装失败 > 启动失败 > 终端/命令 > PM2 > 文件/Git > 体验；每个修复附平台测试或明确未验证。
5. **文档与验收**：安装指南增加平台矩阵、原生依赖、已验证 / 未验证功能；验收表逐平台记录。

## 2. 备选方案与取舍

| 方案 | 结论 |
|---|---|
| 只做文档、不跑 CI | 不采用；无法发现 Windows/Linux 问题 |
| 用 WSL 代替 Windows | 不采用；单列，不计原生 |
| 自建 node-pty Linux 预编译 | 暂不做；Linux 先接受编译工具，后续可评估 |
| 做 MSI / zip 安装器 | 不做；用户已选 npm |
| 全平台全量 E2E | 不做；CI 以安装/启动/核心冒烟为主 |

## 3. 目录与文件变更

```text
新增：
specs/066-cross-platform/spec.md / plan.md / tasks.md / acceptance.md
.github/workflows/ci.yml（矩阵扩展）
scripts/platform-smoke.mjs（或复用 verify-npm-pack）
docs/guides/install.md（平台表 / 限制）
apps/server/test/platform/*（条件测试，按需）
packages/resources/src/...（Windows/Linux 修复，按测试结果）

修改：
apps/server/src/platform/* / terminals / commands / service-ops（平台差异）
README.md / docs/guides/install.md
specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

### M5-4-1 CI 矩阵与安装冒烟

- 扩展 `.github/workflows/ci.yml`：macOS Apple Silicon（macos-latest）、Ubuntu latest、Windows latest；统一 Node 22。
- 每单元 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build`、`npm pack`、临时全局安装、`larness --version`；E2E 仅主平台。
- 添加平台日志 / artifact；失败不阻塞其他矩阵单元（`fail-fast: false`）。
- 本地用 macOS Apple Silicon先跑；Windows/Linux 由 CI。

### M5-4-2 Linux 验证 / 修复

- Ubuntu 22/24：验证 `better-sqlite3` 预编译、`node-pty` 编译回退（build-essential/python）、终端、命令、PM2、路径。
- 修复 Linux 进程组 / `/bin/ps` / 文件锁 / 路径差异；测试条件化。
- 记录 Linux 编译工具要求。

### M5-4-3 Windows 原生

- Windows x64：PowerShell 安装、TUI、终端（ConPTY）、命令、文件、Git、PM2。
- 修复路径分隔符 / 盘符 / 大小写不敏感 / 进程终止 / 信号 / 文件锁差异；无法修复的功能明确限制。
- 不把 WSL 结果当作 Windows 原生。

### M5-4-4 文档与验收

- 安装指南平台矩阵、Node 版本、原生依赖、已验证 / 未验证功能。
- 验收记录逐平台；`pnpm check` / `build` / 主平台 E2E 回归。
- 更新 ROADMAP / STATUS / tasks。

## 5. 数据与迁移

- 不新增数据库表或迁移；各平台数据目录由 `env-paths` 解析。
- 升级前备份在 Windows 的 `chmod` / 文件锁行为需验证；失败仍拒绝迁移。
- 不修改项目源码、PM2 数据或用户目录。

## 6. 回滚策略

- CI 矩阵可回退到原 macOS/Ubuntu Node 22 job；平台修复按需 revert。
- 平台未通过时保持文档“未验证”，不删除已有 macOS 支持。
- 不因跨平台 PoC 改动认证、锁、审批或数据模型。

## 7. 验证命令

```bash
pnpm check
pnpm build
node scripts/verify-npm-pack.mjs --install
pnpm test:e2e
pnpm test:e2e:auth
```

平台由 CI 矩阵执行；本地 macOS arm64 作为基线。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 无本地 Windows/Linux | 无法快速迭代 | CI 矩阵 + 远程实机；记录未验证 |
| node-pty Linux 编译失败 | Linux 安装失败 | build-essential/python 文档；后续预编译 |
| Windows PM2/信号差异 | 服务运维不完整 | 限制公开；只承诺已验证子集 |
| CI 成本 / 时间 | 矩阵过慢 | 安装冒烟优先；E2E 主平台；fail-fast false |
| 平台修复影响 macOS | 回归 | 保留 macOS 全量测试；按平台分支 |

## 9. 未决事项

- D1–D5 见 [spec §13](spec.md#13-开放问题与待确认决策)。
- Windows 实机 / CI 可用性；Linux 发行版镜像选择。
- 是否后续自建 node-pty Linux 预编译包。
