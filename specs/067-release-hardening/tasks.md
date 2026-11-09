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

### DEPS-1 兼容范围内的依赖升级

- 状态：`done`（2026-11-09）
- 依赖：DOCS-4；用户要求全面升级。
- 范围：各 workspace 直接依赖在现有 semver 范围内升级；冻结版本、原生模块升级与跨主版本升级单列评审。保持 REST、事件、数据和运行入口语义。
- 验收：Given Node 22 / 24 和现有 workspace，When 查询 npm 并安装升级后的锁文件，Then 各包声明一致，版本满足原范围与已验证 Node 版本，构建、回归和发布验证通过。安装或回归失败先核对依赖、peer 与 Node 要求，再调整候选版本。
- 验证：候选版本对照、冻结锁安装、check、build、平台冒烟、包内容检查。
- 结果：按 npm registry 解析当前版本范围，更新 16 个直接依赖与相关锁项；tsdown 声明下限与已锁定版本对齐。Node 22.23.4 / 24.22.2 冻结锁安装、check（各 748 通过、11 跳过）和平台冒烟通过。Node 24 构建、npm 临时安装及 Mock E2E（19 通过）通过。
- 偏差：Node 24 首轮 check 遇到 Chromium 未下载完成及两项终端时序超时，下载完成后以 `VITEST_MAX_WORKERS=3` 复跑通过。auth / prod E2E 各 15 通过、3 失败；升级前锁文件复现对话旧计划选择器失败，两个终端用例批量运行时配对超时，单独复跑均通过。未复跑真实 Provider 和其他 OS 实机。
- 后续：[ADR-056](../../docs/adr/ADR-056-dependency-major-upgrades.md) 已获批准，按批次升级。

### DEPS-2 AI SDK 7 与 Provider

- 状态：`done`（2026-11-09）
- 依赖：DEPS-1；ADR-056 accepted。
- 范围：同步升级 AI SDK、DeepSeek 与 OpenAI 兼容包。REST、事件、数据、工具授权及上下文语义保持原约定。
- 验收：给定现有消息和工具 schema，Provider 请求及流式工具续跑须保留参数、用量、推理、错误和取消语义。现有 Agent 执行契约正反例及本地 SSE 用例通过。
- 验证：Node 22 / 24 冻结锁、check、build、平台冒烟和 npm 安装；真实 Provider 用例按可用凭据记录。
- 结果：Node 22.23.4 / 24.22.2 冻结锁安装、check（各 750 通过、11 跳过）、构建、平台冒烟与 npm 临时安装通过。实际 SDK 的本地 SSE 测试先复现系统消息拒绝，再验证系统消息、工具 schema、续跑结果与用量。真实 Provider 无可用凭据，未运行。

### DEPS-3 SQLite 原生模块升级

- 状态：`done`（2026-11-09）
- 依赖：DEPS-2；ADR-056 accepted。
- 范围：升级固定的 better-sqlite3 版本与安装说明，保持应用迁移、数据格式和恢复流程。
- 验收：Node 22 / 24 冻结锁、check、build、平台冒烟与 npm 临时安装通过。旧库可读写并备份，回退可读取更新后数据。
- 结果：Node 22.23.4 / 24.22.2 冻结锁、check（各 750 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。SQLite 12 临时库经 13 读写及 VACUUM INTO 备份后，12 可读回并通过完整性检查。pnpm 跳过其隐式 node-gyp，使用上游包内 Node-API 二进制。Windows / Ubuntu 未实测。

### DEPS-4 Vite 8 与 React 插件

- 状态：`done`（2026-11-09）
- 依赖：DEPS-3；ADR-056 accepted。
- 范围：升级 Vite 和 React 插件，保持既有浏览器构建目标、受管前端代理和页面行为。
- 验收：Node 22 / 24 冻结锁、check、build、平台与安装冒烟通过；实际 Chromium 的 HMR、Nonce CSP、开发预览和生产入口验证通过。
- 结果：Node 22.23.4 / 24.22.2 冻结锁、check（各 750 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。保留 Vite 7 的浏览器构建目标。Node 24 真实 Chromium 受管 HMR/CSP、Mock E2E 19 项、开发预览和生产 Passkey 定向测试通过。

### DEPS-5 React Router 8

- 状态：`done`（2026-11-09）
- 依赖：DEPS-4；ADR-056 accepted。
- 范围：升级 React Router，并按 ADR-056 统一 Node 22 最低版本为 22.22.0。保持配对、鉴权跳转及 SPA 回退。
- 验收：Node 22 / 24 冻结锁、check、build、平台与安装冒烟通过；Node 22.21 拒绝，22.22 与 24 接受；真实浏览器 Passkey 和生产 SPA 通过。
- 结果：Node 22.23.4 / 24.22.2 冻结锁、check（各 752 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过；新增 Node 最低版本正反例。Chromium 开发 Passkey 与生产 Passkey / SPA 会话回归通过。

### DEPS-6 TypeScript 7 与测试构建工具

- 状态：`done`（2026-11-09）
- 依赖：DEPS-5；ADR-056 accepted。
- 范围：依次验证 TypeScript 7、Vitest 5、tsdown 0.23 后组合升级，保持严格类型、测试语义及四个 Server 产物布局。
- 验收：Node 22 / 24 冻结锁、check、build、平台与安装冒烟通过；原有测试和构建边界保持。
- 结果：TypeScript 7.0.2 移除旧 baseUrl，保留显式 paths；Vitest 5.1.0 定向与全量回归通过；tsdown 0.23.7 保持四入口和原生模块外置。Node 22.23.4 / 24.22.2 冻结锁、check（各 752 通过、11 跳过）、构建、平台冒烟和 npm 临时安装通过。Node 24 并行首轮文件监听超时，单独复跑通过；生产 Chromium Passkey 通过。
