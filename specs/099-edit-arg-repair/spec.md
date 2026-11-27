---
id: 099-edit-arg-repair
title: edit 工具参数容错：忽略 expectedVersion/version
milestone: 发布后
status: done
depends_on: [093-tool-interface, 098-benchmark]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# edit 工具参数容错：忽略 expectedVersion/version

> 状态：`done`（2026-11-27；工具层测试、`pnpm check` 与 `pnpm build` 通过）。

## 1. 背景与问题

`cross-file-refactor` 的 live benchmark 中，模型两次把 `apply_patch`/`write_file` 的 `expectedVersion` 带进 `edit`，`edit` 的 strict schema 返回：

```
VALIDATION_ERROR: invalid tool arguments: <arguments> — Unrecognized key: "expectedVersion"
```

`edit` 本身会在读写前后做版本校验，不需要调用方传 `expectedVersion`。这是跨工具字段混淆，直接失败会浪费一步；应像已有 `file_path`/`old_string` 别名一样，在 `repairArgs` 中丢弃。

## 2. 目标

- G-1：`edit` 收到 `expectedVersion` 或 `version` 时丢弃该字段，继续执行 `oldString`/`newString` 替换。
- G-2：其他未知字段仍严格拒绝；不放宽 schema。
- G-3：`edit` 的版本冲突与路径校验不变。

## 3. 非目标

- NG-1：不把 `apply_patch`/`write_file` 的字段全部混入 `edit`。
- NG-2：不改变工具描述、风险级别、项目锁或审批。
- NG-3：不新增工具/事件/接口。

## 4. 验收场景

### A1 多余版本字段被忽略

```gherkin
Given a.txt 存在且 oldString 唯一
When 调用 edit 并额外传 expectedVersion="0"*64
Then 丢弃 expectedVersion，替换成功
And 返回 replacements=1
```

### A2 其他未知字段仍拒绝

```gherkin
Given edit 参数包含 expectedVersion 和 unknownField
When 校验
Then unknownField 仍返回 VALIDATION_ERROR
```

### A3 原错误路径不变

```gherkin
Given oldString 多处匹配且未 replaceAll
Then 仍返回 INVALID_PATCH
```

## 5. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | `repairEditArgs` 删除 `expectedVersion`、`version`。 |
| R-2 | MUST | 只删除这两个已知混淆字段；其他未知字段仍由 strict schema 拒绝。 |
| R-3 | MUST | 版本冲突、路径、CRLF、replaceAll 行为不变。 |
| R-4 | MUST | 补工具层回归测试；不新增接口/迁移。 |

## 6. 测试计划

- `packages/agent/test/tools/fileTools.test.ts`：A1/A2；现有 edit 测试继续通过。
- `pnpm check`、`pnpm build`。

## 7. 完成定义

- [x] A1–A3 通过；
- [x] `pnpm check` 与 `pnpm build` 通过；
- [x] `tasks.md` / `STATUS.md` / `ROADMAP.md` 更新。
