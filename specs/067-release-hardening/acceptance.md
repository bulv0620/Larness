# M5-5 验收记录与 G5 状态（2026-11-08）

> 状态：文档/安全复核完成；**G5 未通过**，等待 Windows / Ubuntu 实机结果。M5-5 不新增代码行为。

## 1. 交付文档

| 文档 | 内容 | 状态 |
|---|---|---|
| [安全复核](../../docs/security/review.md) | 身份/认证、Agent、锁、秘密、日志、预览、PM2、调度、npm 更新、备份矩阵与残余风险 | 完成 |
| [发布清单](../../docs/process/release.md) | 版本、检查、构建、包内容、临时安装、publish、tag、升级/降级/回滚 | 完成 |
| [已知限制](../../docs/known-limitations.md) | 支持矩阵、无沙箱、Windows 限制、原生依赖、更新与已知问题 | 完成 |
| [安装指南](../../docs/guides/install.md) | 安装、升级、降级、卸载、原生依赖、更新检查 | 完成 |

## 2. G5 条款与实际

| G5 项 | 结果 | 证据 / 边界 |
|---|---|---|
| npm 更新提示、手动安装 | 通过（macOS） | 065 / `updates/npm.ts`；不自动更新 |
| 升级前数据库备份 | 通过（macOS） | `preUpgradeBackup` / 启动集成测试；Windows 待实机 |
| 三平台实机结果 | 未通过 | macOS Apple Silicon 已验证；Windows 11 / Ubuntu 待用户 |
| 支持范围与限制公开 | 通过 | `docs/known-limitations.md` |
| 安全复核 / 发布清单 / 文档 | 通过 | 本切片文档 |
| `larness.md` 31 / 42.3 清单 | 复核中 | 以当前 spec / ADR / 文档为准；不宣称全部历史条目已实现 |

**G5 结论：未通过。** 缺口是 Windows / Ubuntu 实机结果与 M5-4 关闭；不是文档缺失。

## 3. 基线验证

- macOS Apple Silicon：`pnpm check`（562 / 10 skip）、`pnpm build`、`platform-smoke`、`verify-npm-pack` 通过。
- npm：`larness@0.1.0` 已发布（M5-3）。
- CI：已按用户要求删除；不再以 CI 作为门禁。
- 文档命令与当前仓库对齐；未来版本变更需同步更新。

## 4. 未验证 / 残余

- Windows 11：安装/TUI/终端/命令/PM2；当前终端/命令对 win32 返回 `RESOURCE_UNAVAILABLE`。
- Ubuntu 22.04/24.04：check、node-pty 编译回退、PM2、路径/锁。
- macOS Intel：不支持。
- 真实第三方兼容端点、GLM 图片输入、真实长会话压缩。
- 认证 E2E 批量时序抖动、Monaco CSP `unsafe-eval`、本地发布无 provenance。

## 5. 结论

M5-5 的文档、复核与发布清单完成；M5-5 保持 `review`，G5 保持未通过，等待用户三端实机结果后再关闭。
