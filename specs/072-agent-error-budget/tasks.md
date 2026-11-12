# 072 任务清单

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| EB-1 | 补丁信封修复：hunk 计数按正文重算、裸上下文行补空格、空行处理 | — | `done` |
| EB-2 | 参数修复层 `repairArgs` + `update_plan` 状态别名 + `apply_patch` 路径别名 | — | `done` |
| EB-3 | 命令用法：`test:file` 脚本、`AGENTS.md` 准确命令、`run_command` 示例 | — | `done` |
| EB-4 | 审查结论与状态回填（spec 数据、STATUS、ROADMAP） | EB-1～EB-3 | `done` |
| EB-5 | 失败呈现与重试语义：`tool.completed.supersedes`、时间线「已重试」与未解决失败计数 | EB-4 | `done` |

## 验收记录

### EB-1～EB-3（2026-11-12，macOS，本机）

- EB-1：`packages/agent/test/tools/fileService.test.ts` 新增 3 个用例（计数错误、裸行/空行、上下文不匹配仍失败关闭），15 通过。
- EB-2：`packages/agent/test/tools/registry.test.ts` 覆盖 `repairArgs` 在 `safeParse` 前运行且非法值仍拒绝；`apps/server/test/agent/plan.test.ts` 覆盖 `in_progress`/`completed` 归一为 `running`/`done`，`plan.updated` 存 canonical。
- EB-3：`@larness/web` 增 `test:file`；`AGENTS.md` 第 7 节列出单文件测试/biome/typecheck 与两处已知误用；`run_command` 描述补最小合法参数示例。
- 验证：`packages/agent` 55 通过 / 1 跳过；`apps/server test/agent` 116 通过 / 2 个既有环境失败（`commands.test.ts` 需要 PATH 上的 `node`/`pnpm`，本机没有）；`toolContract`、`plan`、`commandSecret` 14 通过；agent/resources/server `tsc --noEmit` 通过；改动文件 biome 通过。
- **未运行**：完整 `pnpm check` 与 `pnpm --filter @larness/web test:file`——本机 PATH 无 `pnpm`，`node` 只用 Codex 运行时替代。等价的 `vitest run src/features/models/ModelSettingsDialog.test.tsx`（cwd=apps/web）已通过（6/6）。
- **偏差**：本切片 3 个实现任务在同一分支交付（一个任务一个提交），未按任务各开分支。

### EB-5（2026-11-12，macOS，本机）

- 服务端：成功调用把同一 `(tool, 规范化参数)` 的更早失败 callId 收进 `tool.completed.supersedes`；不同参数不取代；`tool.failed` 事件不改，审计仍保留每次失败。
- 客户端：被取代的失败条目标 `retried`，摘要显示「失败 N 项（只算未解决）· 重试成功 M 次」，条目仍可展开查看原始输出。
- 验证：`turnRunner` 38（新增 2 个 supersede 正反例）、`apps/web` 168（含 reducer 与 Timeline 新用例）、`test/agent` 118 通过 / 2 个既有环境失败；web/server/shared typecheck 与改动文件 biome 通过。
