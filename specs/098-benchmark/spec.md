---
id: 098-benchmark
title: Agent 基准任务与请求级 A/B
milestone: 发布后
status: done
depends_on: [092-search-ignore, 093-tool-interface, 094-operation-log, 095-single-agent-mode, 096-command-approvals, 097-streaming-reads]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# Agent 基准任务与请求级 A/B

> 状态：`done`（2026-11-27；fixture、fake runner smoke、`pnpm check` 与 `pnpm build` 通过；Larness 与 opencode 实机 A/B 已完成，5/5 verify 全 0，结果与复跑命令见 [protocol](protocol.md#51-2026-11-27-实机-ab)）。

## 1. 背景与问题

092–097 改完工具面、跨轮记忆、计划、项目指令、审批与流式读取后，仍缺少**可重复的任务基线**。继续凭体感优化，无法判断哪项改动真正缩小了与 opencode 的差距，也无法定位“Larness 看起来不聪明”是上下文、工具面、审批还是模型参数导致。

## 2. 目标

- G-1：提供 5 个固定基准任务，覆盖单文件修复、跨文件重构、长文件编辑、多轮连续修复与大仓库符号定位。
- G-2：任务 fixture 可在离线环境生成，并在 Agent 运行前验证“确实失败”。
- G-3：Larness runner 记录 steps、tool calls、tool failures、墙钟、tokens、最终状态、验证命令结果与 diff 统计。
- G-4：可选 dump 每一步实际模型请求（system/messages/tools/thinking），用于与 opencode 请求级对比。
- G-5：提供与 opencode 的手动 A/B 协议；同一 fixture、同一模型/effort、同一权限模式。
- G-6：基准代码不进入生产路径，不影响 `pnpm check` 的产品行为。

## 3. 非目标

- NG-1：不在 CI 中调用真实 Provider；不保存 API Key。
- NG-2：不自动控制 opencode（CLI/桌面版本差异大）；只提供同 fixture 与协议。
- NG-3：不做统计显著性/大规模评测；首版是 5 个可复现任务。
- NG-4：不新增 REST/WS/DB/事件或产品 UI。
- NG-5：不把基准结果写入仓库；默认落在 `tmp/agent-benchmark/`。

## 4. 用户故事

- 作为维护者，我希望用同一组任务对比改动前后的 Larness，而不是凭感觉。
- 作为用户，我希望看到同一任务在 Larness 与 opencode 的 steps/tokens/耗时/完成度差异。
- 作为调试者，我希望 dump 实际请求，确认工具面、计划、历史与 opencode 的差异。

## 5. 验收场景

### A1 任务 fixture 基线失败

```gherkin
Given 任一基准任务
When 生成 fixture 并运行 verify 命令
Then verify 退出码非 0
```

### A2 Larness runner 指标

```gherkin
Given 配置了 LARNESS_BENCH_API_KEY 与模型
When 运行 runner
Then results.json 含每个 prompt 的 steps/toolCalls/toolFailures/tokens/耗时/状态
And 含最终 verify 退出码与输出尾部
And 含 git diff --stat
```

### A3 请求 dump

```gherkin
Given 运行 runner 时加 --dump
Then 写出每一步的 system/messages/tools/thinking/model
And 不包含 API Key
```

### A4 手动 A/B

```gherkin
Given runner 生成的 fixture 与 baseline 提交
When 在 opencode 中 reset --hard baseline 并运行同一 prompt
Then 可用同一 verify 命令和 diff 统计对比
```

### A5 无 Key 失败关闭

```gherkin
Given 未设置 LARNESS_BENCH_API_KEY
When 运行 runner 且未使用 --print
Then 打印使用说明并以非 0 退出
And 不发起网络请求
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 5 个任务定义含 prompts/files/verify，fixture 可离线生成；101 起增加第 6 个 `checkout-discount`。 |
| R-2 | MUST | runner 用临时 DB/数据目录，不读写用户 Larness 数据。 |
| R-3 | MUST | 指标来自事件：`tool.requested`/`tool.failed`/`model.usage`/`turn.completed`。 |
| R-4 | MUST | 最终 verify 独立执行，记录退出码、stdout/stderr 尾部。 |
| R-5 | MUST | `--dump` 只写本地文件、不含 Key；默认关闭。 |
| R-6 | MUST | `--print` 无需 Key，输出任务 manifest 供 opencode 手动运行。 |
| R-7 | MUST | 任务 fixture 在 Agent 运行前 verify 失败；测试覆盖。 |
| R-8 | MUST | 不新增生产依赖/接口/事件/迁移。 |

## 7. 接口与契约变更

- 脚本：`pnpm bench:agent -- --task single-file-fix|all --out <dir> [--dump] [--print]`。
- 环境：`LARNESS_BENCH_API_KEY`、`LARNESS_BENCH_MODEL`（默认 `deepseek-v4.1-flash`）、`LARNESS_BENCH_ENDPOINT`（默认 opencode-go OpenAI 兼容端点）、`LARNESS_BENCH_EFFORT`（默认 `max`）。
- 输出：`tmp/agent-benchmark/<timestamp>/<task>/results.json`、可选 `requests.jsonl`、`project/`（git 仓库，baseline tag）。
- 无生产 REST/WS/DB 变更。

## 8. 数据与迁移

- 无；基准数据只在临时目录。

## 9. 安全、权限与审计

- 不读取用户 Larness 数据目录；使用临时 DB。
- Key 只从环境变量读取，不写入日志/结果/dump。
- Fixture 是合成小项目；dump 可能含 fixture 内容，默认关闭，文件权限 0600。
- Runner 使用临时项目的 autonomous 审批，避免人工停等；这是基准专用，不改变产品默认。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| 无 Key | 打印用法，退出 1 | 不发起网络 |
| 任务 verify 基线通过 | 任务定义错误，runner 报错 | 明确任务 ID |
| Provider 失败 | 记录 status/error，继续下一任务 | results 中有错误 |
| 超时/取消 | 记录状态，关闭 CommandManager | results 中有状态 |
| 模型不支持工具 | 记录失败，不伪造完成 | results 中 status/toolFailures |

## 11. 可观测性

- `results.json`：每任务/每 prompt 指标、verify、diff、baseline commit。
- `requests.jsonl`：可选请求 dump。
- 控制台：任务进度与汇总表。

## 12. 测试计划

- `apps/server/test/benchmark/tasks.test.ts`：每个 fixture 生成后 verify 非 0；文件路径/内容存在。
- `apps/server/scripts/agent-benchmark/tasks.ts` 类型检查。
- Runner 的 `--print`/无 Key 路径可手动验证；不进入 CI。
- `pnpm check`、`pnpm build`。

## 13. 开放问题

| 问题 | 默认 | 需要谁决策 |
|---|---|---|
| 是否自动驱动 opencode | 否；首版手动 | 后续 |
| 任务数量/难度 | 5 个；后续扩展 | 用户可增补 |

## 14. 完成定义

- [x] A1–A5 自动化/手动路径可用（A1/A5 自动化，A2–A4 为本地 runner + 协议）；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] 任务套件、协议、`tasks.md`、`STATUS.md`、`ROADMAP.md` 更新；
- [x] 无生产依赖/接口/数据库变更。
