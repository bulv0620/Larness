# Agent A/B 协议

> 对应 [098 spec](spec.md)。目标：同一个模型、同一份 fixture、同一权限模式下，比较 Larness 与 opencode 的完成度、步骤、工具调用、耗时与 token。

## 1. 任务套件

`apps/server/scripts/agent-benchmark/tasks.ts` 提供 5 个任务：

| ID | 能力 | 初始状态 |
|---|---|---|
| `single-file-fix` | 单文件 bug + 定向测试 | `node --test` 失败 |
| `cross-file-refactor` | 跨文件重命名 + 测试 | `node scripts/verify.js` 失败 |
| `long-file-edit` | 600 行文件中定位常量并修改 | `node --test` 失败 |
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
