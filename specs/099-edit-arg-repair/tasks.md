# 任务：edit 参数容错

> 状态：`in_progress`。一个任务一个提交。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| EA-1 | 删除 expectedVersion/version 并补测试 | 098 | `done` |

## 任务卡

### EA-1 删除 expectedVersion/version 并补测试

- 状态：`done`
- 目标：`edit` 忽略 `expectedVersion`/`version`；其他未知字段仍拒绝。
- 交付物：`fileTools.ts`、`fileTools.test.ts`。
- 验收：A1–A3。
- 测试：`fileTools.test.ts`、`pnpm check`、`pnpm build`。

## 验收记录

（完成后填写。）

### 2026-11-27（macOS arm64）

- `fileTools.test.ts` 6 项通过：edit 带 `expectedVersion`/`version` 被丢弃并成功；`unknownField` 仍返回 VALIDATION_ERROR。
- 整仓：`pnpm check` 退出码 0（web 322、agent 72+1 跳过、server 997+14 跳过）；`pnpm build` 退出码 0。
- 来源：live benchmark 的 `cross-file-refactor` 有 2 次 `edit` 参数错误（`Unrecognized key: "expectedVersion"`）；修复后需重跑 live benchmark 取最终命令/失败指标。
