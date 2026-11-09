# M5-5 任务：安全复核、发布清单与文档

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 门禁：spec `ready`；G5 已按人类确认的 macOS 当前范围条件通过。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-5-1 | 安全复核清单与残余风险 | 067 spec ready | `done` |
| M5-5-2 | 人工发布 / 升级 / 回滚清单 | M5-5-1 | `done` |
| M5-5-3 | 支持矩阵、已知限制与安装文档定稿 | M5-5-1 | `done` |
| M5-5-4 | G5 验收记录与索引同步 | M5-5-2、M5-5-3 | `done` |

## 任务卡

### M5-5-1 安全复核清单与残余风险

- 状态：`done`
- 依赖：067 spec ready
- 目标：逐项复核安全边界并留下证据。
- 交付物：`docs/security/review.md`；结论 / 证据 / 未验证 / 残余风险。
- 验收：A1；不把未验证写成通过。
- 测试：文档检查；必要时引用现有测试路径。
- 涉及路径：`docs/security/review.md`、`docs/architecture/security.md`、ADR、契约。

### M5-5-2 人工发布 / 升级 / 回滚清单

- 状态：`done`
- 依赖：M5-5-1
- 目标：可复制的本地发布流程。
- 交付物：`docs/process/release.md`。
- 验收：A2、A3；无 CI；失败处理与回滚命令。
- 测试：按清单 dry-run / 包检查（不真实发布）。
- 涉及路径：`docs/process/release.md`、`docs/guides/install.md`。

### M5-5-3 支持矩阵、已知限制与安装文档定稿

- 状态：`done`
- 依赖：M5-5-1
- 目标：集中公开平台、Node、原生依赖与限制。
- 交付物：`docs/known-limitations.md`；更新 `docs/guides/install.md` / README。
- 验收：A3、A4；Windows 未实现不写成支持。
- 测试：链接与版本核对。
- 涉及路径：`docs/known-limitations.md`、`docs/guides/install.md`、README.md。

### M5-5-4 G5 验收记录与索引同步

- 状态：`done`
- 依赖：M5-5-2、M5-5-3
- 目标：G5 条款与实际方案一致，证据可查。
- 交付物：`specs/067-release-hardening/acceptance.md`；ROADMAP G5、STATUS、060 索引。
- 验收：A5、A6；保留三端各自的实机结果和未验证状态。
- 测试：文档链接 / 命令核对；macOS 基线复跑。
- 涉及路径：`specs/067-release-hardening/acceptance.md`、`specs/ROADMAP.md`、STATUS.md。

### DOCS-1 产品门户、规格导航与对齐复核

- 状态：`done`（2026-11-08）
- 依赖：M5-5-4；用户直接要求。
- 验收：根 README 只介绍产品使用；独立规格入口可导航全部切片；核对当前实现并集中列出遗留事项。
- 测试：入口范围、目录覆盖、相对链接及 Node 24.22.2 下的 `pnpm check`（743 通过、11 跳过）、`pnpm build`、`node scripts/verify-npm-pack.mjs` 均通过。
- 实现对照：`package.json` / `app.js` 核对安装和启动；Server 路由及共享 schema 核对预览、PM2 与调度入口；`updates/npm.ts`、`db/preUpgradeBackup.ts`、命令与终端 manager 核对升级和平台限制。
- 差异与验证缺口集中在 [遗留问题](../../docs/open-questions.md)，其中更新规范与当前实现的差异保留待决。

### DOCS-2 Node.js 支持说明与依赖盘点

- 状态：`done`（2026-11-09）
- 依赖：DOCS-1；用户直接要求。
- 验收：现行文档统一为 Node.js 22 / 24+，实测版本单列；历史记录保留。查询 workspace 直接依赖的 npm 最新版。
- 范围：依赖只盘点；运行时检查、安装元数据、平台状态和安全边界不变。
- 验证：`pnpm outdated -r` 查到 24 个直接依赖有新版。文档版本口径核对和 `git diff --check` 通过；Node 24.22.2 下 `pnpm check`（743 通过、11 跳过）、`pnpm build`、`pnpm verify:pack` 通过。

### DOCS-3 现行文档与 Node.js 检查对齐

- 状态：`done`（2026-11-09）
- 依赖：DOCS-2；用户直接要求。
- 验收：现行架构、REST、数据、测试与门禁说明和实现一致；历史结果保留；npm、doctor 和发布冒烟统一接受 Node.js 22 / 24+。
- 范围：不变更业务接口、依赖和数据；更新安全上位规范走独立 ADR 审批。
- 验证：Node 20 和 23 回归用例先失败，修正后 5 项版本用例均通过。Node 24.22.2 下 check（748 通过、11 跳过）、build、平台冒烟和 npm 包内容检查通过；236 份 Markdown 相对链接和锚点有效。
- 后续：[ADR-055](../../docs/adr/ADR-055-npm-update-security.md) 已批准，宪法第十二条与 ADR-007 的指引见 DOCS-4。

### DOCS-4 落实 ADR-055 更新安全规范

- 状态：`done`（2026-11-09）
- 依赖：DOCS-3；用户明确确认 ADR-055。
- 验收：宪法、ADR 索引、发布和恢复指引与现行实现一致，历史验收及未验证平台保留。
- 验证：Node 24.22.2 下 `pnpm check`（748 通过、11 跳过）、236 份 Markdown 相对链接及锚点校验、`git diff --check` 通过。
