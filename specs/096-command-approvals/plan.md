# 实施计划：命令 allowlist 与本轮审批复用

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

新增 `commandAllowlist.ts`：对结构化 `run_command` 与受限 `run_shell` 做保守分类，命中返回 true；`commandRisk`/`shellRisk` 在 L3 检查之后、原有 L2 默认之前返回 L1。

审批复用使用现有 `hashApprovalParams`：`executeTool` 计算 `toolName + hash(approvalParams)`；`approvedParams` 命中时跳过审批请求。`TurnRunner` 在批准后把该 key 加入本 Turn 的 `Set`，不持久化。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 持久 always-allow | 长期少问 | 需要规则/撤销/UI/迁移 | 后续 |
| 默认 autonomous | 最省事 | L3 也免审批 | 否决 |
| 精确参数哈希复用 | 安全、无迁移 | 不同参数仍问 | **采用** |
| 命令前缀复用 | 更少问 | 可能扩大范围 | 后续评估 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/commandAllowlist.ts
  apps/server/test/agent/commandAllowlist.test.ts
  docs/adr/ADR-076-command-allowlist-and-turn-approvals.md
  specs/096-command-approvals/{spec,plan,tasks}.md
修改：
  apps/server/src/modules/agent/commandTool.ts        # risk 分类 + 描述
  apps/server/src/modules/agent/toolExecutor.ts       # approvedParams
  apps/server/src/modules/agent/turnRunner.ts         # 本 Turn 集合
  apps/server/test/agent/commands.test.ts             # 集成复用
  docs/adr/DECISIONS.md
  docs/contracts/agent-command-context.md
  specs/051-agent-tool-contract/spec.md
  specs/README.md / specs/ROADMAP.md / STATUS.md
```

## 4. 实施步骤

1. 写 allowlist 正反例测试与审批复用集成测试（红）。
2. 实现 `commandAllowlist.ts`，接入 `commandRisk`/`shellRisk`。
3. `toolExecutor` 支持 `approvedParams`；`turnRunner` 维护本 Turn 集合。
4. 更新工具描述/契约/状态；跑定向、`pnpm check`、`pnpm build`。
5. 提交，快进 main。

## 5. 数据与迁移

- 无。

## 6. 回滚策略

移除 allowlist 分支与 `approvedParams` 复用，恢复逐次审批；无数据影响。

## 7. 验证命令

```bash
pnpm --filter @larness/server test test/agent/commandAllowlist.test.ts test/agent/commands.test.ts test/agent/toolExecutor.test.ts
pnpm --filter @larness/server typecheck
pnpm exec biome check <changed files>
pnpm check
pnpm build
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| allowlist 过宽 | 自动执行非只读命令 | 保守 flags/path/metachar 检查；测试反例 |
| 复用跨参数 | 越权执行 | 精确规范化参数哈希，仅同 Turn |
| L3 被放行 | 高风险 | L3 检查在 allowlist 之前；standard/strict 仍 deny |
| 审批行减少影响审计 | 追责困难 | 命令执行审计不变；复用不新增 approval 行 |

## 9. 未决事项

- 持久 always-allow、前缀复用：后续切片。
