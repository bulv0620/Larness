# 074 任务清单

> 状态：`done`（2026-11-12）。用户确认 D-1～D-5 后按 RS-1 → RS-5 顺序实现并验证。
> 一个任务一个提交；开始前在 `STATUS.md` 登记，完成后勾选本表并更新 `ROADMAP.md`。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| RS-1 | 服务端成果分类与终态 `fileResults` | — | `done` |
| RS-2 | `write_file` 统一文件结果卡 | — | `done` |
| RS-3 | 成果区与过程行渲染 | RS-1、RS-2 | `done` |
| RS-4 | 契约与文档同步 | RS-1、RS-2、RS-3 | `done` |
| RS-5 | 验收与状态回填 | RS-4 | `done` |

## 任务卡

### RS-1 服务端成果分类与终态 `fileResults`

- 状态：`done`
- 依赖：无
- 目标：Turn 终态前对本轮 touched 文件做一次存在性与路径分类，去重后写入终态事件。
- 交付物：
  - `apps/server/src/modules/agent/turnResults.ts`：`isProcessFile`、`classifyTurnFile`、`collectTurnFileResults`（上限 200、`ENOENT` → 不存在、非 `ENOENT` 保留为成果并回调）。
  - `TurnRunner` 在 `finalize` 前收集；四种终态事件附 `fileResults`（非空时）与 `fileResultsOmitted`（超出上限时）。
  - 忽略集合：默认 `.git` / `node_modules` / `.larness` + 项目 `settings.ignore`（`DEFAULT_IGNORED` 由 resources 导出）+ 生成 / 临时目录与后缀。
- 验收：分类器 6 项；`turnRunner` 覆盖交付 / 临时 / 已删除 / 项目忽略 / 失败 Turn。
- 测试：`apps/server/test/agent/turnResults.test.ts`、`turnRunner.test.ts`。

### RS-2 `write_file` 统一文件结果卡

- 状态：`done`
- 依赖：无
- 目标：成功 `write_file` 与 `apply_patch` 一样生成 `resourceTarget`，前端共用一个文件卡片。
- 交付物：`tool.completed` 的 file target 生成条件扩展；scope 仍来自执行上下文。
- 验收：创建文件后出现可打开卡片，且 `tool.completed` 携 `resourceTarget`。
- 测试：`turnRunner.test.ts` 的 `write_file` 用例补断言；Web `Timeline` 用例覆盖分类渲染。

### RS-3 成果区与过程行渲染

- 状态：`done`
- 依赖：RS-1、RS-2
- 目标：成果区以 `fileResults` 为准渲染，新增过程行折叠与回退。
- 交付物：
  - `ProcessFilesRow`：默认收起，显示总数 / 已清理数，展开列路径、创建 / 修改、已删除；仍存在且有权时复用 `FileResultCard` 打开。
  - `Timeline`：有 `fileResults` 时只渲染交付文件与预览 / 终端，隐藏同轮文件产物；无 `fileResults` 沿用原规则；超出上限显示「另有 N 个文件未列出」。
  - `eventReducer`：终态事件解析 `fileResults` / `fileResultsOmitted` 到该轮用户消息项，重放一致。
- 验收：临时文件删除、忽略路径、去重、历史回退、空态、上限提示。
- 测试：`Timeline.test.tsx` 新增 3 项、`eventReducer.test.ts` 新增 2 项。

### RS-4 契约与文档同步

- 状态：`done`
- 依赖：RS-1、RS-2、RS-3
- 交付物：`ws-events`（终态 `fileResults` / `fileResultsOmitted`、`write_file` 目标）、`m2-resources`、`resource-views`（过程行）、051（`write_file` 描述与 074 约定）。
- 验收：字段与实际事件逐项一致；相对链接有效。

### RS-5 验收与状态回填

- 状态：`done`
- 依赖：RS-4

## 验收记录

### RS-1～RS-5（2026-11-12，macOS arm64，本机）

- 环境：PATH 无独立 `node` / `pnpm`，用 Electron 内置 Node v24.21.0（ABI 149）作 `node`，pnpm 10.34.9 的 CLI 脚本运行。
- 通过：
  - `apps/server` `test/agent`：125 通过 / 8 失败；失败全部落在 `commands`、`terminalControl`、`terminalTools` 的真实进程 / PTY 用例，与既有基线同集合（多次运行 7–9 个波动）。
  - `apps/web`：39 文件 183 项通过。
  - `packages/agent`：57 通过 / 1 跳过。
  - 全包 `pnpm -r typecheck`、`biome ci .`（0 error，16 条既有 warning）、`pnpm build` 通过。
  - Demo E2E（Mock）：23/23 通过。
- 未运行 / 未验证：
  - 完整 `pnpm check`：本机 server 套件有既有 73 个环境性失败，无法全绿。
  - 真实认证 E2E 与新过程行的真实数据浏览器视觉验收：未运行；过程行由组件测试覆盖，等待用户视觉确认。
- 偏差：
  - `finalize` 改为 async 以便终态前核对文件；23 个调用点改为 `return await finalize(...)`，保持 finally 中的锁释放 / 清理顺序在终态写入之后。
  - R-9 的上限提示以 `fileResultsOmitted` 计数 + 文案实现，未截断计数本身。
  - 临时脚本识别仍依赖「放 `tmp/` + 用完删除」约定；未删除且不命中规则的脚本按普通文件进入成果。
- 关联：Q-037 关闭（见 `docs/open-questions.md`）。
