# 任务：文件工具作用域：放开项目外读取

> 状态：`done`（2026-11-27）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| ER-1 | [路径解析与读类工具放开外部路径](tasks.md#er-1-路径解析与读类工具放开外部路径) | 020 / 082 | `done` |
| ER-2 | [服务端 readScope 注入与工具描述](tasks.md#er-2-服务端-readscope-注入与工具描述) | ER-1 | `done` |
| ER-3 | [契约、安全文档与整仓验证](tasks.md#er-3-契约安全文档与整仓验证) | ER-2 | `done` |

## 任务卡

### ER-1 路径解析与读类工具放开外部路径

- 状态：`done`
- 依赖：020 / 082
- 目标：`read_file`、`list_files`、`search_code` 可按 `readScope` 读取项目外绝对路径；写入工具不变。
- 交付物：
  - `pathGuard.ts`：`resolveReadPath`、`ReadPathPolicy`、`resolveCanonicalPath`、`FORBIDDEN`；
  - `fileService.ts`：三个读函数接受 `access` 并返回 `rootScope`，外部结果 `path` 为绝对路径；
  - `fileTools.ts`：从 `ToolContext.readScope` 透传，更新三条描述；
  - 单元测试覆盖绝对 / 相对 / `..` / 符号链接 / `<dataDir>` / 根级目录 / 未启用。
- 验收：spec A1–A4、A6–A8。

### ER-2 服务端 readScope 注入与工具描述

- 状态：`done`
- 依赖：ER-1
- 目标：生产链路默认启用外部读取，同时保证 `<dataDir>` 硬闸始终有值。
- 交付物：
  - `ToolContext.readScope` 与 `ExecuteToolInput.readScope`；
  - `TurnRunner` 按 `dataDir` 的 realpath 注入；`dataDir` 缺失时不放行（失败关闭）；
  - `SYSTEM_POLICY_BASE` 增加读取范围说明，`PROMPT_VERSION=109-1`。
- 验收：spec A1、A2、A6。

### ER-3 契约、安全文档与整仓验证

- 状态：`done`
- 依赖：ER-2
- 交付物：`docs/architecture/security.md` 路径边界改写、`docs/contracts/agent-command-context.md` 同步、`pnpm check` / `pnpm build` 记录。

## 验收记录

### 2026-11-27（macOS arm64）

- 定向：`packages/agent` 的 `fileService.test.ts` 26 项、`fileTools.test.ts` 11 项通过；`apps/server` 的 `pathGuard.test.ts` 7 项通过 + 1 跳过（Linux 伪文件系统）、`toolExecutor.test.ts` 5 项、`contextAssembler.test.ts` 15 项、新增 `externalRead.test.ts` 1 项通过。
- 整仓：`pnpm check` 退出码 0（biome 808 文件；web 322 项；agent 37 项；server 1016 通过 + 15 跳过）；`pnpm build` 退出码 0。
- 覆盖：项目外绝对读取、`rootScope=external` 与绝对路径、无 `readScope` 时仍拒绝、`<dataDir>` 与符号链接指向它均 `FORBIDDEN`、根级 / 主目录 `INVALID_PATH`、写入工具与 `run_command.cwd` 不变。
- 调整：`contextAssembler.test.ts` 的“低水位锚点”用例改为按当前 prompt/工具体积探测窗口。新增 prompt 行改变了块对齐，旧用例依赖固定对齐；断言本身（锚点不动 + 追加 2 条消息）未放宽。
- 未运行：真实 Provider 会话、E2E、Windows / Linux 实机；P4（`run_command.cwd` 外部路径）未开始。
