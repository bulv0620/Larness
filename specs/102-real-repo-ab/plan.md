# 实施计划：外部真实仓库 A/B 模式

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

1. `externalRepo.ts` 提供纯函数：
   - `createExternalTask(input)`：校验 repo/prompt/verify，生成 `BenchmarkTask`；
   - `copyExternalRepo(source, target)`：复制工作树，排除 `.git`、`.larness`、`tmp`；
   - `splitCommand(text)`：把简单命令字符串拆成 argv（不支持引号/管道）。
2. `BenchmarkTask` 增加可选 `repo?: string`。
3. `runTask` 在 `repo` 存在时先复制，再可选 setup，再 `git init`/commit/tag baseline；否则走现有 `seedTask`。
4. CLI 解析新增 `--repo`、`--prompt`、`--verify`、`--setup`、`--id`、`--title`。
5. `--print` 在外部模式下输出单任务 manifest。
6. 样例任务写入 `specs/102-real-repo-ab/example.md`：Larness 099 回归。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 直接把真实仓库塞进 `tasks.ts` | 改动少 | 仓库大、含历史/秘密风险 | 不做 |
| 自动 git clone + install | 全自动 | 网络/认证/依赖不可控 | 不做 |
| 本地 repo + copy + optional setup | 可控、可复跑 | 操作者需准备仓库 | 采用 |
| 用 git worktree | 快、无复制 | 不保留未提交文件；清理复杂 | 不做 |

## 3. 目录与文件变更

```text
新增：
specs/102-real-repo-ab/{spec,plan,tasks,example}.md
apps/server/scripts/agent-benchmark/externalRepo.ts
apps/server/test/benchmark/externalRepo.test.ts

修改：
apps/server/scripts/agent-benchmark/agent-benchmark.ts
apps/server/scripts/agent-benchmark/tasks.ts        # BenchmarkTask.repo?
specs/098-benchmark/protocol.md                     # 外部仓库章节
specs/ROADMAP.md / specs/README.md / STATUS.md       # 切片登记
```

## 4. 实施步骤

1. 先写 `externalRepo.test.ts`：参数校验、copy 排除、命令拆分。
2. 实现 `externalRepo.ts`。
3. 给 `BenchmarkTask` 加 `repo`，改 `runTask`/CLI/`--print`。
4. 用临时小仓库跑 `LARNESS_BENCH_FAKE=1` 外部模式 smoke。
5. 写样例 Larness 099 任务准备命令。
6. 跑 `pnpm check`、`pnpm build`。
7. 更新协议/ROADMAP/README/STATUS；提交。
8. 用户用真实 Key 跑 Larness 外部任务；opencode 侧按协议跑同一副本。

## 5. 数据与迁移

- 无 schema/迁移。
- 源仓库只读；副本与结果在 `--out`。

## 6. 回滚策略

删除外部模式分支与新增文件即可；现有 fixture 路径不变。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/benchmark/externalRepo.test.ts
LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --repo <tmp-repo> --prompt "..." --verify "node --test"
pnpm --silent bench:agent -- --repo <tmp-repo> --prompt "..." --verify "node --test" --print
pnpm check
pnpm build
```

真实样例：

```bash
pnpm bench:agent -- \
  --repo /private/tmp/larness-real-task \
  --prompt "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id larness-edit-arg-repair --dump
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 复制大仓库慢/占空间 | 准备时间长 | 操作者可先用小仓库；样例用 clonefile `cp -cR` |
| node_modules 相对链接失效 | 测试无法运行 | 复制保留相对链接；smoke 验证 |
| setup 命令注入 | 操作者显式命令 | 不接受模型生成命令；文档说明 |
| 真实任务不可解 | A/B 无意义 | 样例先手动确认目标测试失败、预期修复通过 |

## 9. 未决事项

- 是否需要在 runner 中自动清理副本；当前保留供检查。
