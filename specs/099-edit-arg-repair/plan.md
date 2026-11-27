# 实施计划：edit 参数容错

> 对应 spec：`spec.md`。

## 1. 技术方案

在 `packages/agent/src/tools/fileTools.ts` 的 `repairEditArgs` 删除 `expectedVersion` 与 `version`，并加入删除列表；其他字段不动。

## 2. 文件变更

- `packages/agent/src/tools/fileTools.ts`
- `packages/agent/test/tools/fileTools.test.ts`
- `specs/099-edit-arg-repair/*`
- `specs/README.md` / `specs/ROADMAP.md` / `STATUS.md`

## 3. 实施步骤

1. 加失败测试：edit 带 `expectedVersion` 应成功；带 `unknownField` 仍失败。
2. 修改 `repairEditArgs`。
3. 跑定向、`pnpm check`、`pnpm build`。

## 4. 回滚

从删除列表移除两个字段即可；无数据影响。

## 5. 验证

```bash
pnpm --filter @larness/agent test test/tools/fileTools.test.ts
pnpm check
pnpm build
```
