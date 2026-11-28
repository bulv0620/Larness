# 任务：工具面与结果预算

> 状态：`done`（2026-11-27，TR 系列任务全部收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| TI-1 | 资源层 write/edit 与测试 | 092 | `done` |
| TI-2 | modelText、预算与 read/search/command | TI-1 | `done` |
| TI-3 | edit 工具、write 覆盖、Profile/契约 | TI-2 | `done` |
| TI-4 | turnRunner 事件、验证与收口 | TI-3 | `done` |

## 任务卡

### TI-1 资源层 write/edit 与测试

- 状态：`done`
- 依赖：092
- 目标：新增 `writeTextFile`（覆盖/可选版本）与 `editTextFile`（唯一匹配/ replaceAll / CRLF）；补资源层测试。
- 交付物：
  - `writeTextFile`、`WriteTextFileResult`；
  - `editTextFile`、`EditTextFileResult`；
  - `fileService.test.ts` 覆盖 A3/A4/A8 的资源层部分。
- 验收：
  - 新建/覆盖/版本冲突；唯一/多处/replaceAll/CRLF/二进制/越界。
- 测试：
  - `pnpm --filter @larness/agent test test/tools/fileService.test.ts`
- 涉及路径：
  - `packages/resources/src/files/fileService.ts`
  - `packages/agent/test/tools/fileService.test.ts`

### TI-2 modelText、预算与 read/search/command

- 状态：`done`
- 依赖：TI-1
- 目标：`ToolResult.modelText`、`toolMessageContent` 优先纯文本、read 行号/50KB、search/command 文本输出、结果/批预算联动。
- 交付物：
  - `types.ts`、`toolResults.ts`、`toolReplay.ts`；
  - `fileTools.ts` read/search；
  - `turnRunner.ts` command modelText/32KB；
  - 相应测试。
- 验收：A1/A2/A5/A6。
- 测试：`fileTools.test.ts`、`turnRunner.test.ts`、`compaction.test.ts`。
- 涉及路径：`packages/agent/src/tools/*`、`apps/server/src/modules/agent/turn/*`、`turnRunner.ts`。

### TI-3 edit 工具、write 覆盖、Profile/契约

- 状态：`done`
- 依赖：TI-2
- 目标：注册 `edit`、`write_file` 覆盖、`core.write` Pack、工具契约矩阵与描述。
- 交付物：
  - `fileTools.ts` edit/write；
  - `profiles.ts` core.write + edit；
  - `toolContract.test.ts`、`profiles.test.ts`、`fileTools.test.ts` 更新。
- 验收：A3/A4/A7。
- 测试：`fileTools.test.ts`、`toolContract.test.ts`、`profiles.test.ts`。
- 涉及路径：`packages/agent/src/tools/fileTools.ts`、`apps/server/src/modules/agent/profiles.ts`、服务端测试。

### TI-4 turnRunner 事件、验证与收口

- 状态：`done`
- 依赖：TI-3
- 目标：edit/覆盖写入的 `file.changed`、命令输出测试、全量验证、文档与状态。
- 交付物：
  - `turnRunner.ts` 文件变更识别；
  - `turnRunner.test.ts` edit/modified 事件；
  - 契约文档、`tasks.md`、`STATUS.md`、`ROADMAP.md`。
- 验收：A3/A4/A5/A8；`pnpm check` 通过。
- 测试：`turnRunner.test.ts`、`pnpm check`。
- 涉及路径：`apps/server/src/modules/agent/turnRunner.ts`、`apps/server/test/agent/turnRunner.test.ts`、文档。

## 验收记录

### TI-1（2026-11-27）

- `pnpm --filter @larness/agent test test/tools/fileService.test.ts`：23 项通过。
- 覆盖 `writeTextFile` 新建/覆盖/版本冲突/越界，`editTextFile` 唯一/多处/`replaceAll`/CRLF/未找到/二进制/越界。

### 2026-11-27（macOS arm64）

- 定向：`packages/agent/test/tools/fileService.test.ts` 23 项、`fileTools.test.ts` 6 项；`apps/server/test/agent/turnRunner.test.ts` 59 项、`toolContract.test.ts`、`profiles.test.ts`、`compaction.test.ts`、`toolReplay.test.ts`、`contextAssembler.test.ts`、`toolExecutor.test.ts`、`commands.test.ts` 均通过。
- 整仓：`pnpm check` 退出码 0；web 55 文件 / 323 项、agent 8 文件 / 72 项（1 跳过）、server 181 文件 / 975 项（14 跳过）；typecheck 6 个包通过。
- 覆盖：read 行号/50KB/完整 version；`edit` 唯一/多处/`replaceAll`/CRLF/别名；`write_file` 新建/覆盖/`expectedVersion`/冲突；命令 32KB 与 `modelText` 不重复 stdout/stderr；纯文本折叠；`edit` 加入 `core.write`；`file.changed` 覆盖为 `modified`。
- 未运行：E2E、真实 Provider 会话。`pnpm build` 已通过（root build，exit 0）。本切片是工具/资源层行为，定向与整仓测试覆盖；真实模型行为由后续基准切片验证。
- 偏差：工具数组/描述变化会让升级后首次请求的 `toolsetHash` 变化，`prefixBreak=tools`；这是预期的一次性成本，未改 `PROMPT_VERSION`。
