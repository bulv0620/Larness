# 任务：命令 allowlist 与本轮审批复用

> 状态：`done`（2026-11-27，CA-1～CA-3 收口）。一个任务一个提交。
> 开始前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| CA-1 | allowlist 分类与测试 | 095 | `done` |
| CA-2 | 本 Turn 审批复用 | CA-1 | `done` |
| CA-3 | 契约/描述、全量验证与收口 | CA-2 | `done` |

## 任务卡

### CA-1 allowlist 分类与测试

- 状态：`done`
- 目标：常见只读/验证命令 L1；危险 flags/路径/shell 元字符仍 L2；L3 不变。
- 交付物：`commandAllowlist.ts`、`commandAllowlist.test.ts`、`commandTool.ts`。
- 验收：A1/A2/A4（分类部分）。
- 测试：`commandAllowlist.test.ts`、`commands.test.ts`。

### CA-2 本 Turn 审批复用

- 状态：`done`
- 目标：批准一次后同 Turn 相同工具+参数哈希不再询问；不同参数/跨 Turn 仍问。
- 交付物：`toolExecutor.ts`、`turnRunner.ts`、`commands.test.ts`。
- 验收：A3。
- 测试：`commands.test.ts`、`toolExecutor.test.ts`。

### CA-3 契约/描述、全量验证与收口

- 状态：`done`
- 目标：工具描述、051/契约、ADR/DECISIONS、STATUS/ROADMAP；全量检查。
- 交付物：文档与验收记录。
- 验收：A1–A4；`pnpm check`、`pnpm build`。

## 验收记录

（完成后填写：定向测试、`pnpm check`、`pnpm build`、未运行项、偏差。）

### 2026-11-27（macOS arm64）

- 定向：`commandAllowlist.test.ts` 3 项、`commands.test.ts` 17 项通过（含同一 Turn 相同命令只生成 1 个 approval）。
- 整仓：`pnpm check` 退出码 0（web 55 文件 / 322 项、agent 72 项 + 1 跳过、server 184 文件 / 991 项 + 14 跳过）；`pnpm build` 退出码 0。
- 覆盖：只读/验证命令 L1；`--prefix`/`exec`/`dlx`/绝对路径/shell 元字符/引号/路径逃逸仍 L2；sudo/chmod L3；同一 Turn 相同 `toolName + paramsHash` 复用批准；不同参数仍审批。
- 未运行：E2E、真实 Provider 会话。真实审批体感由用户实机验证。
- 偏差：复用仅限同一 Turn、精确参数哈希；不做持久 always-allow 或宽前缀。allowlist 只是审批分类，不是沙箱。
