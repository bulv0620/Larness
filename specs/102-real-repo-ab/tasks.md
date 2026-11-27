# 任务：外部真实仓库 A/B 模式

> 状态：`in_progress`。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| RRA-1 | [外部仓库模式与测试](tasks.md#rra-1-外部仓库模式与测试) | 098、101 | `done` |
| RRA-2 | [Larness 099 样例任务与文档](tasks.md#rra-2-larness-099-样例任务与文档) | RRA-1 | `in_progress` |

## 任务卡

### RRA-1 外部仓库模式与测试

- 状态：`done`
- 依赖：098、101
- 目标：`--repo` 模式复制本地仓库、可选 setup、运行 prompt、复用指标。
- 交付物：
  - `externalRepo.ts` 与测试；
  - `BenchmarkTask.repo?`；
  - CLI 参数与 `--print`；
  - fake smoke。
- 验收：
  - spec A1–A5；
  - `pnpm check`、`pnpm build`。
- 测试：
  - `pnpm --filter @larness/server test test/benchmark/externalRepo.test.ts`
  - `LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --repo <tmp> --prompt ... --verify "node --test"`
- 涉及路径：
  - `apps/server/scripts/agent-benchmark/agent-benchmark.ts`
  - `apps/server/scripts/agent-benchmark/tasks.ts`
  - `apps/server/scripts/agent-benchmark/externalRepo.ts`
  - `apps/server/test/benchmark/externalRepo.test.ts`
- 备注：复制排除 `.git`/`.larness`/`tmp`；源仓库只读。

### RRA-2 Larness 099 样例任务与文档

- 状态：`in_progress`
- 依赖：RRA-1
- 目标：用真实 Larness 副本回退 099 的参数容错，保留测试，形成可解的真实任务。
- 交付物：
  - `specs/102-real-repo-ab/example.md`；
  - 准备/验证/opencode 命令；
  - 真实 A/B 记录（或未运行原因）。
- 验收：
  - 基线目标测试失败；
  - 预期修复后通过；
  - 源仓库不被修改。
- 测试：
  - `pnpm --filter @larness/agent test test/tools/fileTools.test.ts`
- 备注：样例只用于 A/B，不改产品代码。

## 验收记录

### 2026-11-27（macOS arm64）

RRA-1：

- `externalRepo.test.ts` 4 项通过：命令拆分、任务生成、必填校验、复制排除 `.git`/`.larness`/顶层 `tmp` 且保留 `src/tmp`。
- fake smoke：临时仓库 + `--repo --prompt --verify "node --test"` 得到 `COMPLETED`、verify=0、steps=4、toolCalls=3、failures=1（修改前测试）、tokens=440；源仓库 `src/math.js` 保持原样。
- `--print` 输出外部任务 manifest（repo/files/verify/prompts）；缺 prompt 或 verify 时退出 1 并给出明确信息；setup 成功写入副本标记，setup 失败退出 1。
- `pnpm check` 退出码 0（web 322、agent 75+1 跳过、server 1006+14 跳过）；`pnpm build` 通过。

RRA-2：

- 真实副本 `/private/tmp/larness-real-task` 已准备：rsync 排除 `.git/.larness/tmp`，保留 `node_modules`；用 `git diff 40c15c9^ 40c15c9 -- packages/agent/src/tools/fileTools.ts | git apply -R` 只回退 099 源改动，保留测试/spec。
- 基线 `pnpm --filter @larness/agent test test/tools/fileTools.test.ts` 失败（1 failed / 8 passed），失败点为 `expectedVersion`/`version` 被 strict schema 拒绝。
- opencode 在同一副本（`/private/tmp/larness-real-task-oc`，git baseline）上完成：8 steps、10 toolCalls、0 toolFailures、input 19,936 + cache 137,216、output 882 + reasoning 570、43.1s、verify 0、diff 仅 `packages/agent/src/tools/fileTools.ts`（+10/-1）。
- Larness 实跑：**待用户 Key**。命令见 [example.md](example.md#2-larness-运行)；这是 RRA-2 唯一未完成项。
- 未运行：Larness 真实仓库实跑、opencode 第二次重复、全量 E2E。
