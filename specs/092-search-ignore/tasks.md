# 任务：搜索与目录列表默认忽略构建产物

> 状态：`done`（2026-11-27）。一个任务一个提交。
> 开始前已在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| SI-1 | 默认忽略与回归测试 | 051、082 | `done` |

## 任务卡

### SI-1 默认忽略与回归测试

- 状态：`done`
- 依赖：[051 Agent 工具契约](../051-agent-tool-contract/spec.md)、[082 Agent 内核](../082-agent-kernel/spec.md)
- 目标：让 `list_files` / `search_code` 默认跳过常见包存储与构建产物目录，根搜索不再被 `.pnpm-store` 等目录耗尽预算；显式 `path` 仍可进入。
- 交付物：
  - `DEFAULT_IGNORED` 增加 `.pnpm-store`、`dist`、`build`、`coverage`、`test-results`、`tmp`、`.turbo`、`.vite`；
  - `list_files` / `search_code` 描述说明默认忽略与显式路径；
  - `packages/agent/test/tools/fileService.test.ts` 覆盖 A1–A5；
  - `packages/agent/test/tools/fileTools.test.ts` 覆盖工具层与描述；
  - `docs/contracts/agent-command-context.md`、切片索引、路线图、STATUS 更新。
- 验收：
  - A1：根搜索只命中源码，不命中默认忽略目录；
  - A2：`list_files` 不返回默认忽略目录；
  - A3：`.pnpm-store` 不消耗 `maxFiles` 预算，`scanBudgetExhausted=false`；
  - A4：`path="dist"` 显式进入仍可搜索；
  - A5：`src/build.ts` 不被误伤，项目 `ignore` 仍生效。
- 测试：
  - `pnpm --filter @larness/agent test test/tools/fileService.test.ts test/tools/fileTools.test.ts`
  - `pnpm --filter @larness/agent typecheck`
  - `pnpm exec biome check` 涉及文件
  - `pnpm check`
- 涉及路径：
  - `packages/resources/src/files/fileService.ts`
  - `packages/agent/test/tools/fileService.test.ts`
  - `packages/agent/test/tools/fileTools.test.ts`
  - `docs/contracts/agent-command-context.md`
  - `specs/092-search-ignore/*`
  - `specs/README.md`、`specs/ROADMAP.md`、`STATUS.md`
- 备注：不实现完整 `.gitignore` 语义，不引入 ripgrep；完整方案另开切片。

## 验收记录

### 2026-11-27（macOS arm64）

- 定向测试：`pnpm --filter @larness/agent test test/tools/fileService.test.ts test/tools/fileTools.test.ts` → 2 文件 / 25 项通过。
- 类型：`pnpm --filter @larness/agent typecheck`、`pnpm --filter @larness/resources typecheck` 通过。
- 规范：`pnpm exec biome check` 4 个改动文件通过。
- 整仓：`pnpm check` 退出码 0；web 55 文件 / 323 项、agent 8 文件 / 68 项（1 跳过）、server 181 文件 / 969 项（14 跳过）；typecheck 6 个包通过。
- 真实仓库回归：在本仓库根目录调用 `searchCode("assembleContext", limit=20)` → `scannedFiles=357`、`scanBudgetExhausted=false`，命中 `apps/server/src/modules/agent/contextAssembler.ts:726`；修复前根搜索返回 0 条。
- 未运行：E2E、真实 Provider 会话。本切片是资源层默认遍历行为，单元/集成覆盖足够；真实 Provider 行为在后续基准切片验证。
- 偏差：工具描述变化会使升级后第一次请求的 `toolsetHash` 变化，`prefixBreak` 归因到 `tools`；这是预期的一次性成本，未改 `PROMPT_VERSION`。
