# Agent A/B 协议

> 对应 [098 spec](spec.md)。目标：同一个模型、同一份 fixture、同一权限模式下，比较 Larness 与 opencode 的完成度、步骤、工具调用、耗时与 token。

## 1. 任务套件

`apps/server/scripts/agent-benchmark/tasks.ts` 提供 6 个任务（101 起增加 `checkout-discount`）：

| ID | 能力 | 初始状态 |
|---|---|---|
| `single-file-fix` | 单文件 bug + 定向测试 | `node --test` 失败 |
| `cross-file-refactor` | 跨文件重命名 + 测试 | `node scripts/verify.js` 失败 |
| `long-file-edit` | 600 行文件中定位常量并修改 | `node --test` 失败 |
| `checkout-discount` | 31 文件跨模块折扣修复（101 新增） | `node --test` 失败 |
| `multi-turn-fix` | 两次连续修复，第二轮不能破坏第一轮 | `node --test` 失败 |
| `search-symbol` | 80 个模块中定位目标符号 | `node --test` 失败 |

每个 fixture 都是独立 ESM 小项目，含 `AGENTS.md`，验证命令为 `node --test` 或 `node scripts/verify.js`。

## 2. 共同条件

- 同一模型与 effort（例如 opencode-go `deepseek-v4.1-flash` + `max`）。
- 同一 fixture 初始提交（runner 创建的 `baseline` tag）。
- 同一权限模式：Larness runner 使用 `autonomous`；opencode 使用等价的 allow/跳过审批配置。
- 同一验证命令；不把 Agent 自己说的“完成”当作通过。
- 每个任务至少跑 1 次；要比较稳定性时跑 3 次，取中位数。

## 3. Larness 侧

```bash
export LARNESS_BENCH_API_KEY="<your opencode-go key>"
export LARNESS_BENCH_MODEL="deepseek-v4.1-flash"
export LARNESS_BENCH_ENDPOINT="https://opencode.ai/inference/go/openai/v1"
export LARNESS_BENCH_EFFORT="max"

pnpm bench:agent -- --task all --dump
```

- 结果：`tmp/agent-benchmark/<timestamp>/results.json`。
- 每个任务的 fixture：`tmp/agent-benchmark/<timestamp>/<task>/project`（git 仓库，`baseline` tag）。
- 请求 dump：`tmp/agent-benchmark/<timestamp>/<task>/requests.jsonl`（默认关闭，`--dump` 开启；文件 0600，不提交）。
- 指标：每 prompt 的 status、durationMs、steps、toolCalls、toolFailures、input/output/cache tokens；最终 verify exitCode/stdout/stderr 尾部；`git diff --stat` 与 `git status --short`。

无 Key 时可先检查 manifest 或做接线 smoke：

```bash
pnpm bench:agent -- --print

# 离线接线 smoke：fake provider 只修 single-file-fix，不调用网络
LARNESS_BENCH_FAKE=1 pnpm bench:agent -- --task single-file-fix --out /tmp/larness-bench-smoke
```

## 4. opencode 侧

runner 的结果目录里保留了 baseline。对每个任务：

```bash
cd tmp/agent-benchmark/<timestamp>/<task>/project
git reset --hard baseline
git clean -fd
```

然后在该目录用 opencode 运行任务的首个 prompt（或 `multi-turn-fix` 的两条 prompt，逐条发送），使用相同模型与 effort、允许工具执行。完成后：

```bash
node --test        # 或 node scripts/verify.js
git diff --stat
git status --short
```

如需要干净副本，可在 Larness 跑完后先 `cp -R project project-opencode`，再在副本里 reset；避免覆盖 Larness 的结果。

opencode 的 steps/tool calls/tokens 从它的会话 UI 或日志读取；请求内容使用它的日志/session 导出。Larness 的对应请求在 `requests.jsonl`。

### 4.1 opencode CLI（macOS 实机）

macOS 桌面版自带 CLI：`/Applications/OpenCode.app/Contents/Resources/opencode-cli`。非交互运行：

```bash
OC="/Applications/OpenCode.app/Contents/Resources/opencode-cli"
FIXTURE="/path/to/<task>/project"

cd "$FIXTURE"
git reset --hard baseline
git clean -fd

"$OC" --standalone run --auto --archived --format json \
  --model "opencode-go/deepseek-v4.1-flash#max" \
  "The test suite is failing. Find the cause, fix it, and run \`node --test\`." \
  > out.jsonl
```

两个必须注意的坑（2026-11-27 实机踩过）：

1. **`--standalone` 必须放在 `run` 之前**。放在后面会被忽略，CLI 会连到桌面 App 的后台 server；该 server 的项目根是 App 当前 workspace（通常是 Larness 仓库），不是 fixture。表现为工具去搜 `/Users/.../Larness`，甚至改到旧 fixture。
2. **脚本启动时必须设置 `PWD`**。opencode 用环境变量 `PWD` 决定项目目录和工具 cwd；只改子进程真实 cwd 不够。`cd` 会同时设置两者，所以手动跑通常没事。Python/Node 脚本里要显式 `env["PWD"] = fixture`。

多轮任务：从第一轮任一 JSON 事件的 `sessionID` 取会话 ID，第二轮追加 `--session <id>`。每个 `run` 都是独立进程；`--standalone` 会重新启动私有 server，因此原始耗时包含约 3–5 秒启动开销。

解析 JSONL：

- `step_finish` 数 = steps；
- `tool_use`（按 `part.id` 去重）= tool calls；
- `part.state.status == "error"` = tool failure；
- `part.tokens.input` **不含** cache；总 prompt = `input + tokens.cache.read`，`tokens.output` / `reasoning` 另计。

### 4.2 外部真实仓库（102）

runner 支持不进入 `tasks.ts` 的本地仓库模式：

```bash
pnpm bench:agent -- \
  --repo /path/to/prepared/repo \
  --prompt "..." \
  --verify "pnpm --filter @larness/agent test test/tools/fileTools.test.ts" \
  --id real-task \
  --dump
```

- 复制仓库到输出目录，排除顶层 `.git`、`.larness`、`tmp`；保留其它文件（包括 `node_modules`）。
- 可选 `--setup "<command>"` 在副本中、baseline 前执行；失败停止，不运行 Agent。
- 复制后用 `git init`/commit/tag `baseline`；源仓库只读。
- `--verify` 是简单 argv 字符串，不支持引号/管道；需要 shell 语法时用 `--setup` 并在 verify 中调用脚本。
- `--print` 同样支持 `--repo`，不要求 Key。
- 样例（Larness 099 回归）见 [102 example](../102-real-repo-ab/example.md)。
- 首个真实样例结果（2026-11-27，n=1）：Larness 13 步/23 调用/2 失败/299,718 tokens/59.5s；opencode 8 步/10 调用/157,152 prompt tokens/43.1s；双方 verify 0、同 diff。差距定位为宽搜索、整文件读取和一次错误 pnpm 命令。

## 5. 对比表

| 指标 | Larness | opencode | 备注 |
|---|---:|---:|---|
| verify 通过 | | | 唯一完成度硬指标 |
| steps | | | 模型步数 |
| tool calls | | | 含失败 |
| tool failures | | | 重试/补丁失败 |
| 墙钟 | | | 秒 |
| input tokens | | | |
| output tokens | | | |
| diff 行数 | | | 过大/过小都值得看 |

### 5.1 2026-11-27 实机 A/B

条件：opencode-go `deepseek-v4.1-flash` + `max`；Larness 标准策略（命令 allowlist 生效）；opencode `--standalone --auto`；同一 fixture 的 `baseline`；每任务 1 次（n=1，仅作方向性结论）。

| 任务 | Larness steps/calls/fail | opencode steps/calls/fail | Larness 墙钟 | opencode 墙钟 | Larness prompt tokens（其中 cache） | opencode prompt tokens（其中 cache） | verify |
|---|---:|---:|---:|---:|---:|---:|---:|
| single-file-fix | 5/7/1 | 6/8/0 | 11.2s | 19.8s | 23,260（21,504） | 44,910（39,552） | 0/0 |
| cross-file-refactor | 5/12/0 | 5/11/0 | 12.2s | 23.4s | 25,378（22,784） | 38,756（32,768） | 0/0 |
| long-file-edit | 7/8/0 | 5/5/0 | 13.3s | 12.7s | 35,269（32,640） | 35,811（30,976） | 0/0 |
| multi-turn-fix | 10/14/2 | 10/11/0 | 30.5s | 27.0s | 55,483（49,280） | 83,022（76,032） | 0/0 |
| search-symbol | 5/6/0 | 5/6/0 | 8.7s | 15.3s | 21,557（20,224） | 35,462（30,592） | 0/0 |
| **合计** | **32/47/3** | **31/41/0** | **75.8s** | **98.3s** | **160,947（146,432）** | **237,961（209,920）** | **5/5** |

- 完成度：两边都 5/5、verify 全 0；opencode 0 次工具失败，Larness 3 次失败全部是“修改前先跑测试”的预期非零退出，不是工具错误。
- 步骤基本持平（32 vs 31）；工具调用 Larness 多 15%（47 vs 41），主要来自每个任务先 `list_files`、long-file 重复 `search_code`、以及 multi-turn 第一轮顺手修了第二个失败。
- 上下文：Larness prompt tokens 少 32%，非缓存输入少 48%（14,515 vs 28,041）；输出 token 多约 20%。
- 墙钟：原始总耗时 Larness 少 23%；opencode 每次 `run` 含约 3–5 秒独立 server 启动，粗略扣除后两边总耗时接近（约 75s）。
- `multi-turn-fix` 口径不完全对等：Larness 第一轮把 a、b 都修了，第二轮只复核；opencode 第一轮只修 a，第二轮修 b。这放大了 Larness 第一轮的调用/token，缩小了第二轮。
- 结论：这批小任务上，Larness 的完成度、步骤和速度与 opencode 同级，未复现“明显更笨/更慢”；剩余差距主要在 long-file 类任务的探索效率（Larness 8 次调用 vs opencode 5 次）和上下文组织，而不是工具失败或权限停等。
- 100 切片后（2026-11-27）long-file 两次复测均为 5 步/5 调用，tokens 22,620–23,048，耗时 10.0–10.1s，verify=0；旧值 7 步/8 调用/35,269 tokens/13.3s。
- 100 后全任务 n=1：long-file 5/4，single/search 基本持平，cross/multi 单次回退；定向复测 cross 回到 5/11、multi 回到 10/14/2，确认回退是计划选择与延迟离群导致的方差。见 [100 tasks](../100-exploration-efficiency/tasks.md#2026-11-27-全任务复测与定向复核)。
- 101 新增第 6 个任务 `checkout-discount`（31 文件，两文件修复）；live A/B（n=1）：Larness 6 步/12 调用/38,698 tokens/18.8s，opencode 8 步/12 调用/75,253 prompt tokens/18.7s，双方 verify 0、同 diff。

## 6. 请求级对比

重点看：

- system 是否包含环境、项目指令、计划策略；
- tools 的名称/描述/schema 是否与模型习惯一致；
- 历史是否保留工具结果、操作日志与计划；
- 审批/权限是否造成停等；
- `thinking`/`maxOutputTokens` 是否一致；
- 工具结果格式（纯文本 vs JSON）与截断上限。

## 7. 安全与边界

- 不把 API Key 写入结果、dump、日志或仓库。
- `requests.jsonl` 可能包含 fixture 内容；只在本地 `tmp/` 保留，不提交。
- runner 不读取用户 Larness 数据目录；使用临时 DB。
- 结果不进入 CI；真实模型调用由操作者显式执行。
