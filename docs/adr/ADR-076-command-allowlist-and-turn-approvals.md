# ADR-076：命令 allowlist 与本轮审批复用

- 状态：**accepted（2026-11-27）**
- 批准记录：2026-11-27 人类选择「allowlist + 本轮批量」方案，要求 L3 保持 ask/deny、默认仍为 standard。
- 关联：[096 spec](../../specs/096-command-approvals/spec.md)、[051](../051-agent-tool-contract/spec.md)、[072](../072-agent-error-budget/spec.md)、[095](../095-single-agent-mode/spec.md)。

## 背景

标准审批下，`run_command` / `run_shell` 默认 L2，每条命令都要人工点一次；同一个 `pnpm check`、`git status` 或测试命令反复出现时，审批成为主要停顿来源。opencode 等工具默认允许常见验证命令，并支持本轮内复用批准。

## 决策

1. **默认策略不变**：新会话仍为 `standard`；`readonly` / `strict` / `autonomous` 语义不变；不把 autonomous 设为默认。
2. **命令 allowlist 降为 L1**：只读/验证类命令按结构化参数判定为 L1，标准策略下自动放行：
   - `git status|diff|log|show|rev-parse|ls-files`；`git branch` 仅无参数或 `-a/-v/-r/--list/--show-current`；
   - `pnpm/npm/yarn` 的 `test|check|typecheck|lint|build|verify` 及其 `:variant` 脚本；
   - `rg`、`ls`、`pwd`，以及 `node --version/-v`；
   - `run_shell` 仅接受无 shell 元字符、无引号、无绝对/`..` 路径的同一组简单命令。
   - 拒绝 `--prefix`/`--dir`/`-C`/`--global`/`-g`、`exec`/`dlx`/`add`/`install`/`remove`/`uninstall`/`publish`/`deploy` 等扩大范围或写操作；`git` 拒绝 `--output/-o/--no-index/--ext-diff/--textconv`；`rg` 拒绝 `--pre`。
3. **本轮审批复用**：用户批准一次工具调用后，同一 Turn 内相同 `toolName + 规范化参数哈希` 的调用不再请求审批；不跨 Turn、不持久化、不写数据库。不同参数、不同工具、不同 Turn 仍按原策略审批。
4. **L3 不因复用放行**：`sudo`/`chmod` 等在 `standard`/`strict` 仍 deny；`autonomous` 的既有语义本切片不改。
5. **审计/事件不变**：命令创建/执行、`tool.requested/started/completed`、审批记录沿用现有路径；复用不新增审批行，也不新增公开事件。

## 备选方案

- **持久 always-allow**：需要规则模型、撤销、UI 与迁移，本切片不做。
- **默认 autonomous**：会让 L3 也免审批，安全风险高，否决。
- **只按命令前缀复用**：不同参数可能扩大范围；先用精确参数哈希，allowlist 覆盖常见重复命令。
- **命令黑名单**：不是安全边界，否决。

## 影响

- **产品/UI**：常见验证命令不再弹审批；同一 Turn 内重复命令只问一次。审批面板与 TTL 不变。
- **安全**：allowlist 只是审批分类，不是沙箱；命令仍以 Larness 账户权限执行。L3 在 standard/strict 仍拒绝；项目锁、审计、秘密检查不变。
- **数据/契约**：无新表/列/事件；`commandRisk`/`shellRisk` 的 L1 集合扩大；工具描述需说明常见验证命令可能自动放行。
- **回滚**：移除 allowlist 与本轮复用集合，恢复原有 L2 分类与逐次审批；无数据影响。

## 验证

- 单元：allowlist 正反例（路径、flags、shell 元字符、L3）。
- 集成：同一 Turn 两次相同 L2 命令，第一次批准后第二次不再生成 approval 行；不同参数仍审批。
- 回归：`pnpm check`、`pnpm build`。
