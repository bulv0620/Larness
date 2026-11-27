---
id: 092-search-ignore
title: 搜索与目录列表默认忽略构建产物
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract, 082-agent-kernel]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 搜索与目录列表默认忽略构建产物

> 状态：`done`（2026-11-27；自动验证通过，E2E 与真实 Provider 会话未运行）。
> 本切片只处理**默认忽略**；完整 `.gitignore` 语义与 ripgrep 替换属于后续切片，不在本切片内。

## 1. 背景与问题

`list_files` 与 `search_code` 的目录遍历只跳过 `DEFAULT_IGNORED` 中的 `.git`、`node_modules`、`.larness`（`packages/resources/src/files/fileService.ts:14`）。仓库根目录常见的包存储与构建产物（`.pnpm-store`、`dist`、`build`、`coverage`、`test-results`、`tmp`、`.turbo`、`.vite`）会被当作项目源码扫描。

本机实测（2026-11-27，Larness 仓库）：

- `.pnpm-store` 有 32,767 个文件，目录名排序在 `apps` 之前；
- 根目录 `search_code("assembleContext", maxFiles: 2000)` 返回 **0 条**，`scannedFiles=2000`、`scanBudgetExhausted=true`；
- 把 `path` 指到 `apps/server/src` 后正常返回匹配；
- `list_files` 在 depth 1/2 也会显示 `.pnpm-store`、`test-results`、`tmp`。

模型据此很容易得出“仓库里没有这个符号”的错误结论，或去读/改构建产物。这是一个会直接影响任务完成度的工具行为缺陷。

## 2. 目标

- G-1：`list_files` 与 `search_code` 默认跳过常见包存储与构建产物目录。
- G-2：根目录搜索不再被这些目录消耗 `maxFiles` 预算，真实源码能被找到。
- G-3：显式指定 `path` 进入被忽略目录时仍然可用（默认忽略只约束遍历，不禁止显式访问）。
- G-4：项目设置中的 `ignore` 继续按既有语义叠加，不改变审批、路径校验或项目边界。

## 3. 非目标

- NG-1：不实现完整 `.gitignore` 解析（嵌套 `.gitignore`、否定规则、glob、全局 excludes）。
- NG-2：不引入 ripgrep 或新的原生依赖；替换检索引擎另开切片。
- NG-3：不新增项目设置、REST、WebSocket、IPC、数据库列或迁移。
- NG-4：不改变文件读写权限、项目根校验、符号链接策略或审批级别。
- NG-5：不改变 `read_file` 的显式读取行为；显式路径仍按现有权限读取。

## 4. 用户故事

- 作为在 monorepo/含包存储的仓库里工作的用户，我希望 Agent 的根目录搜索先看源码，而不是把预算花在 `.pnpm-store` 和 `dist` 上。
- 作为需要检查构建产物的用户，我希望能显式把 `path` 指到 `dist`，而不是被默认忽略永久挡住。
- 作为项目维护者，我希望自定义的 `ignore` 设置继续生效，不需要为常见目录逐个配置。

## 5. 验收场景

### A1 根目录搜索跳过默认忽略目录

```gherkin
Given 项目根有 .pnpm-store/、dist/、build/、coverage/、test-results/、tmp/、.turbo/、.vite/
And 每个目录里都有包含 "target" 的文件
And src/target.ts 也包含 "target"
When 调用 search_code(query="target")
Then 只返回 src/target.ts
And 不返回任何默认忽略目录下的路径
```

### A2 目录列表跳过默认忽略目录

```gherkin
Given 同 A1 的目录结构
When 调用 list_files(path=".", depth=3)
Then 结果包含 src 与 src/target.ts
And 不包含 .pnpm-store、dist、build、coverage、test-results、tmp、.turbo、.vite 及其子项
```

### A3 根搜索预算不被忽略目录消耗

```gherkin
Given .pnpm-store/ 中有两个匹配文件
And src/target.ts 中有一个匹配文件
When 调用 search_code(query="target", maxFiles=2)
Then 返回 src/target.ts
And scanBudgetExhausted=false
```

### A4 显式路径仍可进入被忽略目录

```gherkin
Given dist/bundle.ts 包含 "target"
When 调用 search_code(query="target", path="dist")
Then 返回 dist/bundle.ts
```

### A5 项目 ignore 与普通文件名不受影响

```gherkin
Given 项目设置 ignore=["generated/"]
And generated/out.ts 与 src/build.ts 都存在
When 调用 search_code(query="target")
Then generated/out.ts 被跳过
And src/build.ts 仍被扫描（文件名不是目录名 build）
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `DEFAULT_IGNORED` 增加 `.pnpm-store`、`dist`、`build`、`coverage`、`test-results`、`tmp`、`.turbo`、`.vite`。 |
| R-2 | MUST | `list_files` 与 `search_code` 共用 `isIgnoredFile`，两条路径都生效。 |
| R-3 | MUST | 显式 `path` 作为遍历起点时不被默认忽略拦截；忽略只作用于遍历中遇到的子项。 |
| R-4 | MUST | 现有 `ignore` 参数继续叠加，不改变匹配语义。 |
| R-5 | MUST | 工具描述说明默认跳过常见构建/包存储目录，并提示可用显式 `path` 进入。 |
| R-6 | MUST | 不新增 REST / WS / IPC / 数据库 / 配置变更。 |

## 7. 接口与契约变更

- 模型工具：`list_files` / `search_code` 的默认遍历行为与描述变化；显式 `path` 语义不变。
- REST / WS / IPC / 数据库：无变更。
- 前缀缓存：工具描述变化会改变 `toolsetHash`，升级后首次请求会出现一次 `tools` 前缀断裂；这是预期的一次性成本，不修改 `PROMPT_VERSION`。
- 契约文档：更新 [Agent 命令与 PM2 系统上下文](../../docs/contracts/agent-command-context.md) 的“工具”段，写明默认忽略与显式路径。

## 8. 数据与迁移

- 新表 / 新列：无。
- 索引 / 约束：无。
- 迁移与回滚：无。
- 保留与备份：无。

## 9. 安全、权限与审计

- 身份与授权：不变；默认忽略不是安全边界，显式路径仍走 `resolveInput` 的项目根校验。
- 审批级别：不变；`list_files` / `search_code` 仍为 L0。
- 秘密处理：默认忽略会减少对包存储/构建产物的意外读取，但不承诺秘密扫描；显式读取仍按现有秘密策略处理。
- 审计事件：无新增；工具调用事件形状不变。
- 失败关闭：路径越界、符号链接、不可读目录继续按现有错误返回，不因忽略名单改变。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 源码目录恰好叫 `build` / `tmp` | 默认遍历跳过；显式 `path` 仍可访问 | 工具描述说明默认忽略；结果不静默影响显式路径 |
| 项目需要额外忽略 | 继续使用项目设置 `ignore` | 现有设置入口 |
| 项目需要完整 `.gitignore` 语义 | 本切片不支持；记录为后续切片 | 文档说明边界 |
| 显式 `path` 指向不存在目录 | 现有 `NOT_FOUND` / `VALIDATION_ERROR` | 稳定错误码 |

## 11. 可观测性

- 日志：无新增。
- 指标 / 状态：沿用 `search_code` 的 `scannedFiles` 与 `scanBudgetExhausted`；本次修复后，根搜索不应再因忽略目录提前耗尽。
- 诊断入口：工具结果中的 `scannedFiles` / `truncated` / `scanBudgetExhausted`。

## 12. 测试计划

- 单元 / 集成（`packages/agent/test/tools/fileService.test.ts`）：
  - A1：默认忽略目录不进入搜索结果；
  - A2：`list_files` 不返回默认忽略目录；
  - A3：`maxFiles` 预算不被 `.pnpm-store` 消耗；
  - A4：显式 `path="dist"` 仍可搜索；
  - A5：`src/build.ts` 不被误伤，项目 `ignore` 仍生效。
- 工具层（`packages/agent/test/tools/fileTools.test.ts`）：
  - `list_files` / `search_code` 的模型工具结果体现默认忽略；
  - 工具描述包含“默认跳过常见构建目录”的说明。
- E2E：不新增；本切片是资源层行为，单元/集成覆盖足够。
- 手动：在本仓库根目录执行一次 `search_code("assembleContext")`，确认命中 `contextAssembler.ts`；用临时目录复现 A1–A5。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否在本切片直接解析完整 `.gitignore` | 否；先做显式默认名单，完整语义另开切片 | 用户可在后续切片确认 |
| 是否用 ripgrep 替换 Node 扫描 | 否；涉及原生依赖与多平台打包，另开切片 | 后续 ADR/依赖评审 |

## 14. 完成定义

- [x] A1–A5 自动化通过；
- [x] `pnpm check` 通过（退出码 0）；
- [x] 工具描述、契约文档、`tasks.md`、`STATUS.md`、`ROADMAP.md` 已更新；
- [x] 没有新增行内提示或 UI 变更；
- [x] 按 2026-11-27 用户确认的调研清单实施默认忽略名单。
