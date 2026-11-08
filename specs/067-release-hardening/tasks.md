# M5-5 任务：安全复核、发布清单与文档

> 状态：`todo | in_progress | blocked | review | done`。一个任务一个提交。
> 门禁：spec `ready`；M5-4 三端实机结果缺失时 G5 保持未通过。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M5-5-1 | 安全复核清单与残余风险 | 067 spec ready | `done` |
| M5-5-2 | 人工发布 / 升级 / 回滚清单 | M5-5-1 | `done` |
| M5-5-3 | 支持矩阵、已知限制与安装文档定稿 | M5-5-1 | `done` |
| M5-5-4 | G5 验收记录与索引同步 | M5-5-2、M5-5-3 | `review` |

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

- 状态：`review`
- 依赖：M5-5-2、M5-5-3
- 目标：G5 条款与实际方案一致，证据可查。
- 交付物：`specs/067-release-hardening/acceptance.md`；ROADMAP G5、STATUS、060 索引。
- 验收：A5、A6；三端未齐时 G5 不通过。
- 测试：文档链接 / 命令核对；macOS 基线复跑。
- 涉及路径：`specs/067-release-hardening/acceptance.md`、`specs/ROADMAP.md`、STATUS.md。
