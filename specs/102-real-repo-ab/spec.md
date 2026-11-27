---
id: 102-real-repo-ab
title: 外部真实仓库 A/B 模式
milestone: 发布后
status: active
depends_on: [098-benchmark, 101-deep-repo-benchmark]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 外部真实仓库 A/B 模式

> 状态：`active`（2026-11-27；外部模式与测试、`pnpm check`/`build` 已通过；真实样例基线已失败，opencode 已完成，Larness 实跑待用户 Key）。6 个合成 fixture 已证明工具面与探索效率同级；下一步需要在真实仓库上跑一个真实任务，而不是继续加小 fixture。

## 1. 背景与问题

现有 runner 只接受 `tasks.ts` 里的静态 fixture。真实仓库任务需要：

- 把一个已准备好的本地仓库复制到临时目录；
- 可选执行一次 setup（例如依赖已随副本带入，或显式安装）；
- 以复制后的工作树为 baseline，运行同一条 prompt；
- 记录与 fixture 相同的 steps/toolCalls/toolFailures/tokens/duration/verify/diff；
- 不修改源仓库，不读取用户 Larness 数据目录。

没有这个入口，真实仓库 A/B 只能靠人工在 TUI 里操作，无法复跑或对比。

## 2. 目标

- G-1：`pnpm bench:agent -- --repo <path> --prompt <text> --verify "<command>"` 可运行外部仓库。
- G-2：复制仓库时排除 `.git`、`.larness`、`tmp`；源仓库保持不变。
- G-3：可选 `--setup "<command>"` 在复制后、baseline 前执行；失败则停止。
- G-4：`--id` / `--title` 可覆盖任务名；`--print` 可输出外部任务 manifest。
- G-5：现有 6 个 fixture 模式、指标、dump 与安全边界不变。
- G-6：提供一个真实的 Larness 样例任务（099 回归）与运行命令。

## 3. 非目标

- NG-1：不自动 `git clone`、不自动选真实仓库、不自动安装依赖。
- NG-2：不自动运行 opencode；opencode 侧仍按现有手动协议。
- NG-3：不把真实仓库内容提交到仓库或写入日志。
- NG-4：不新增 REST/WS/DB/迁移或生产依赖。

## 4. 用户故事

- 作为维护者，我希望把真实项目复制到临时目录后，用一条命令让 Larness 跑指定 prompt，并得到与合成 fixture 相同的指标，以便和 opencode 做同条件对比。

## 5. 验收场景

### A1 外部仓库运行

```gherkin
Given 一个含 package.json、src/math.js、test/math.test.js 的本地仓库
When 运行 --repo <dir> --prompt "..." --verify "node --test"
Then 在输出目录复制一份项目
And 运行 Agent 后执行 verify
And 源仓库文件与 git status 不变
```

### A2 复制边界

```gherkin
Given 源仓库含 .git、.larness、tmp 和普通源码
When 复制到 benchmark 项目目录
Then .git/.larness/tmp 不进入副本
And 普通源码与 node_modules（若存在）保留
```

### A3 参数校验

```gherkin
Given 只传 --repo 缺少 --prompt 或 --verify
When 启动 runner
Then 退出码非 0 并给出缺项
```

### A4 setup

```gherkin
Given --setup "node scripts/bootstrap.js"
When 复制完成
Then setup 在副本中执行
And setup 失败时停止且不运行 Agent
```

### A5 兼容

```gherkin
Given 不传 --repo
When 运行现有 fixture
Then 行为与 098–101 完全一致
```

### A6 样例真实任务

```gherkin
Given 当前 Larness 仓库副本
When 把 099 的 expectedVersion/version 丢弃逻辑回退，保留测试
Then 目标测试失败
And prompt 要求修复 edit 参数容错
And verify 命令为目标测试
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `BenchmarkTask` 增加可选 `repo`；外部任务 `files=[]`。 |
| R-2 | MUST | 复制源仓库时排除 `.git`、`.larness`、`tmp`，保留其他文件。 |
| R-3 | MUST | 复制后在副本内 `git init`/commit/tag baseline；不写源仓库。 |
| R-4 | MUST | `--setup` 使用 shell 在副本执行；非零退出停止。 |
| R-5 | MUST | `--repo` 模式要求 `--prompt` 与 `--verify`；错误信息明确。 |
| R-6 | MUST | `--print` 支持外部任务；不要求 Key。 |
| R-7 | MUST | 现有 fixture 行为、指标、dump 不变。 |
| R-8 | MUST | 样例任务与 opencode 手动命令写入文档。 |

## 7. 接口与契约变更

- CLI：新增 `--repo`、`--prompt`、`--verify`、`--setup`、`--id`、`--title`。
- `BenchmarkTask`：新增可选 `repo?: string`。
- 输出：外部任务使用同一 `results.json` 结构；`task.id` 来自 `--id` 或目录名。
- REST / WS / DB / 配置：无。

## 8. 数据与迁移

- 无 schema/迁移；副本与结果只落在 `--out` 临时目录。
- 源仓库不写入；不读取 Larness 数据目录。

## 9. 安全、权限与审计

- 外部仓库由操作者显式传入；runner 只复制到临时目录。
- `--setup` / `--verify` 是操作者显式命令，在副本中执行；不接收模型生成的命令。
- 不记录 Key；不把仓库内容写入日志或仓库。
- 沿用 benchmark 的 autonomous 会话与项目根边界；不新增权限路径。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| repo 不存在/不是目录 | 退出非 0 | 明确路径错误 |
| 缺 prompt/verify | 退出非 0 | 列出必需参数 |
| setup 失败 | 停止，不运行 Agent | setup 退出码与尾部输出 |
| 复制失败 | 停止 | 文件系统错误 |
| verify 失败 | 仍写 results | verify exitCode/stdout/stderr |

## 11. 可观测性

- 复用 `model.usage` / `tool.*` / `turn.completed`；不新增事件。
- 复制与 setup 的耗时不计入 prompt duration；结果文件记录 verify/diff。

## 12. 测试计划

- 单元：`externalRepo.test.ts` 覆盖参数、复制排除、ID 生成。
- 集成：临时小仓库 + `LARNESS_BENCH_FAKE=1` 外部模式 smoke，verify=0。
- 文档：样例 Larness 099 任务与 opencode 命令。
- `pnpm check`、`pnpm build`。
- 真实 Larness/opencode A/B 需用户 Key，未跑时明确记录。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否默认复制 node_modules | 是；真实仓库通常需要现成依赖，且复制不修改源 | 实现后按样例验证 |
| 是否支持自动 clone | 否；先本地路径，避免网络/认证 | 后续需要时 |
| setup 超时 | 10 分钟 | 无 |

## 14. 完成定义

- [x] A1–A5 通过；
- [x] 样例 A6 文档与基线准备命令可用；
- [x] `pnpm check`、`pnpm build` 通过；
- [ ] 真实 A/B 记录（opencode 已完成；Larness 待用户 Key 实跑）。
