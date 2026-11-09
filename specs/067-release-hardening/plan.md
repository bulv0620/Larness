# M5-5 实施计划：安全复核、发布清单与文档

> 对应 [spec](spec.md)。只做文档与复核，不新增功能；三端实机结果仍由 M5-4 提供。

## 1. 技术方案

1. **证据优先**：安全复核逐项引用 `apps/server/src`、`packages`、`docs/contracts`、ADR、测试或验收记录；没有证据的项标“未验证”。
2. **清单可执行**：发布清单给出可直接复制的命令、检查项和失败处理；所有步骤本地执行，不依赖 CI。
3. **文档收口**：安装 / 升级 / 降级 / 卸载、支持矩阵、已知限制、安全边界集中到 `docs/`，README 只保留入口。
4. **G5 对齐**：把旧签名更新/自动回滚条款替换为 npm 提示 + 手动安装 + 升级前备份；三端结果未齐时 G5 不通过。
5. **不夹带代码**：发现安全缺陷另开任务；本切片只改文档与验收记录。

## 2. 备选方案与取舍

| 方案 | 结论 |
|---|---|
| 只写一句“已做安全评审” | 不采用；无可复核证据 |
| 自动生成文档 | 不采用；需要人工判断与证据链接 |
| 用 CI 证明三端 | 不采用；用户已删除 CI，三端由实机结果决定 |
| 把 M5-4 未验证项写成通过 | 不采用；违反验收原则 |

## 3. 目录与文件变更

```text
新增：
specs/067-release-hardening/spec.md / plan.md / tasks.md / acceptance.md
docs/security/review.md
docs/process/release.md
docs/known-limitations.md

修改：
docs/guides/install.md
README.md
STATUS.md
specs/ROADMAP.md
specs/060-extension/spec.md
```

## 4. 实施步骤

### M5-5-1 安全复核

- 按 spec §6 R-1 列表逐项核对；记录结论、证据路径、残余风险。
- 覆盖认证 / Passkey / CSRF / Origin / HTTPS、IPC、Agent 工具与审批、锁、Secret Store、日志、预览、PM2、调度、npm 更新、备份。
- 发现必须修复的缺陷另开任务，不在文档任务中改代码。

### M5-5-2 发布清单

- 写 `docs/process/release.md`：版本、构建、检查、包内容、临时安装、dry-run、真实 publish、tag、安装验证、回滚/降级。
- 明确无 CI、Windows/Ubuntu 手工验证、`npm deprecate` 失败处理。

### M5-5-3 支持矩阵与文档

- `docs/known-limitations.md`：支持矩阵、macOS Intel 不支持、Windows 终端/命令未实现、Linux 编译工具、Node.js 22 / 24+ 与实测版本、PM2、自动更新等。
- 更新 `docs/guides/install.md` 与 README；不复制过期契约细节，链接 ADR/契约。

### M5-5-4 G5 验收记录

- 更新 ROADMAP G5 条款；写 `acceptance.md` 证据表。
- 记录人类确认的 G5 条件通过范围，Windows / Ubuntu 保留发布后跟踪。

## 5. 数据与迁移

- 无数据库变更；不改迁移、配置、契约语义或 npm 包。
- 文档中的备份/降级步骤对应 M5-3 已实现行为。

## 6. 回滚策略

- 文档提交可单独 revert；不影响代码。
- 若复核发现代码缺陷，保留文档为“未通过”，另开修复任务；不在本切片直接改代码。

## 7. 验证命令

```bash
pnpm check
pnpm build
node scripts/platform-smoke.mjs
node scripts/verify-npm-pack.mjs
```

文档链接检查与版本核对为人工步骤。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 复核过浅 | 虚假安全感 | 每项证据路径；未验证明确标注 |
| 文档与代码漂移 | 用户误操作 | 链接契约/ADR；发布前核对版本 |
| 三端结果缺失 | 仅有 macOS 验收证据 | 明确条件通过范围，其他平台待实机 |
| 发现缺陷却夹带修改 | 范围失控 | 另开任务 |
| 发布命令本机差异 | 发布失败 | 清单记录 Node/OS/npm 与输出 |

## 9. 未决事项

详见 [遗留问题](../../docs/open-questions.md)。
