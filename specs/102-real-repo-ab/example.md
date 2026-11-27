# 样例：Larness 099 回归任务

> 真实仓库任务，不改产品代码。目标：在一个 Larness 副本里回退 099 的 `edit` 参数容错，保留测试和 spec，让 Agent 从失败测试修复。

## 1. 准备副本

复制当前仓库但排除 `.git`、`.larness` 和 `tmp`；保留 `node_modules`，避免重新安装。

```bash
REAL=/private/tmp/larness-real-task
rm -rf "$REAL"
mkdir -p "$REAL"

rsync -a \
  --exclude .git \
  --exclude .larness \
  --exclude tmp \
  /Users/bulv/Desktop/Larness/ "$REAL"/
```

生成“只回退 099 源文件改动”的反向 patch，并应用：

```bash
git -C /Users/bulv/Desktop/Larness \
  diff 40c15c9^ 40c15c9 -- packages/agent/src/tools/fileTools.ts \
  > /private/tmp/revert-099.patch

cd "$REAL"
git apply -R /private/tmp/revert-099.patch
```

确认基线失败（应看到 `expectedVersion`/`version` 被 strict schema 拒绝的断言失败）：

```bash
pnpm --filter @larness/agent test test/tools/fileTools.test.ts
```

## 2. Larness 运行

```bash
cd /Users/bulv/Desktop/Larness

LARNESS_BENCH_API_KEY="<your key>" \
LARNESS_BENCH_MODEL="deepseek-v4.1-flash" \
LARNESS_BENCH_ENDPOINT="https://opencode.ai/inference/go/openai/v1" \
LARNESS_BENCH_EFFORT="max" \
pnpm bench:agent -- \
  --repo "$REAL" \
  --prompt "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id larness-edit-arg-repair \
  --dump
```

结果在 `tmp/agent-benchmark/<timestamp>/larness-edit-arg-repair/results.json`。

## 3. opencode 运行

复制同一基线，避免覆盖 Larness 的项目：

```bash
OC_REAL=/private/tmp/larness-real-task-oc
rm -rf "$OC_REAL"
cp -cR "$REAL" "$OC_REAL"        # macOS APFS clone；非 macOS 用 rsync -a
cd "$OC_REAL"

PWD="$OC_REAL" \
/Applications/OpenCode.app/Contents/Resources/opencode-cli \
  --standalone run --auto --archived --format json \
  --model "opencode-go/deepseek-v4.1-flash#max" \
  "Users report that edit fails with VALIDATION_ERROR when callers include expectedVersion or version. Fix the edit tool so these two fields are ignored while other unknown fields remain rejected. Run the target test." \
  > /private/tmp/opencode-edit-arg-repair.jsonl
```

不要在脚本里只改 cwd 而不设 `PWD`；opencode 用 `PWD` 选项目根。`--standalone` 必须在 `run` 之前。

## 4. 验证

```bash
cd "$REAL"
pnpm --filter @larness/agent test test/tools/fileTools.test.ts
git diff --stat
```

预期只改 `packages/agent/src/tools/fileTools.ts`，测试通过。opencode 侧在 `$OC_REAL` 做同样验证。

## 5. 记录

把两边 `steps / toolCalls / toolFailures / prompt tokens / duration / verify / diff` 发回，写入 [tasks.md](tasks.md#验收记录)。
