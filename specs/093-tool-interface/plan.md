# 实施计划：工具面与结果预算

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

分三层：

1. **资源层**：新增 `writeTextFile`（覆盖/可选版本校验）与 `editTextFile`（字面量替换、唯一匹配、CRLF 容错）；保留 `createTextFile` 供旧调用与测试。
2. **工具层**：`ToolResult` 增加 `modelText`；`read_file` 输出带完整 version 与行号的文本；`edit` 新工具；`write_file` 改走 `writeTextFile`；`search_code`/`run_command` 输出纯文本；结果/批预算联动放大。
3. **运行时**：`toolMessageContent` 优先 `modelText`；`turnRunner` 识别 `edit` 与覆盖写入的 `created`，记录 `file.changed`；命令输出 32KB 且不重复 stdout/stderr。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只加行号，不改结果预算 | 改动最小 | 50KB 页会被 16k 字符上限/12k 批预算截断，等于没改 | 否决 |
| 给 read 单独返回超长 JSON | 不动 `ToolResult` | JSON 转义/重复字段浪费 token；模型阅读差 | 否决 |
| `ToolResult.modelText` + 保留 `data` | 模型读自然文本，UI 仍有结构 | 需要改 toolMessageContent、折叠与回放 | **采用** |
| `write_file` 强制 expectedVersion | 最安全 | 无法直接整体覆盖；每次都要先 read | 否决；改为可选 |
| `edit` 用正则/脚本 | 灵活 | 注入/ReDoS/不可预测 | 否决；字面量替换 |

## 3. 目录与文件变更

```text
修改：
  packages/resources/src/files/fileService.ts          # writeTextFile/editTextFile
  packages/agent/src/tools/types.ts                    # ToolResult.modelText
  packages/agent/src/tools/fileTools.ts                # read 行号/edit/write 覆盖/描述
  packages/agent/src/tools/registry.ts                 # 可能无需改（注册由 createFileTools 返回）
  apps/server/src/modules/agent/turn/toolResults.ts    # modelText 优先/预算
  apps/server/src/modules/agent/turn/toolReplay.ts     # 纯文本折叠兼容
  apps/server/src/modules/agent/turnRunner.ts          # 命令 modelText/上限/edit/file.changed
  apps/server/src/modules/agent/profiles.ts            # core.write + edit
  apps/server/test/agent/turnRunner.test.ts            # 命令/文件事件/modelText
  apps/server/test/agent/compaction.test.ts            # 纯文本折叠/预算
  apps/server/test/agent/toolContract.test.ts          # edit 注册/参数
  apps/server/test/agent/profiles.test.ts              # codingTools + edit
  packages/agent/test/tools/fileService.test.ts        # 资源层 edit/write
  packages/agent/test/tools/fileTools.test.ts          # 工具层 read/edit/write/描述
  docs/contracts/agent-command-context.md              # 工具面说明
  specs/README.md / specs/ROADMAP.md / STATUS.md
新增：
  specs/093-tool-interface/spec.md
  specs/093-tool-interface/plan.md
  specs/093-tool-interface/tasks.md
```

## 4. 实施步骤

1. 先写失败测试：
   - 资源层 `writeTextFile`/`editTextFile`（覆盖、新建、版本冲突、唯一匹配、replaceAll、CRLF、二进制）；
   - 工具层 read 行号/50KB、modelText、edit、write 覆盖、描述；
   - 服务层 turnRunner 的 `file.changed`、命令 32KB、modelText、预算折叠；
   - 契约层 edit 注册/Pack/风险。
2. 实现 `writeTextFile`/`editTextFile` 并导出。
3. 加 `ToolResult.modelText`，改 `toolMessageContent` 与纯文本折叠。
4. 改 `read_file`/`search_code`/`run_command` 的 modelText 与预算。
5. 加 `edit` 工具、`write_file` 覆盖、Profile Pack、turnRunner 事件。
6. 跑定向测试，修到全绿；再跑 `pnpm check`。
7. 更新契约/任务/状态，提交。

## 5. 数据与迁移

- schema：无。
- 兼容：旧 `tool.replay` 的 JSON 内容仍可折叠；新纯文本结果用带 `folded:true` 的 JSON 包装折叠。
- 回滚：移除 `modelText` 分支、恢复 `createTextFile`、移除 edit 即可；无数据影响。

## 6. 回滚策略

按文件回退：资源层新函数可保留但不调用；`ToolResult.modelText` 可选，回退 `toolMessageContent` 分支即可；`edit` 从 registry/Pack 移除。无迁移。

## 7. 验证命令

```bash
pnpm --filter @larness/agent test test/tools/fileService.test.ts test/tools/fileTools.test.ts
pnpm --filter @larness/server test test/agent/turnRunner.test.ts test/agent/toolContract.test.ts test/agent/profiles.test.ts test/agent/compaction.test.ts
pnpm --filter @larness/agent typecheck
pnpm --filter @larness/resources typecheck
pnpm --filter @larness/server typecheck
pnpm exec biome check <changed files>
pnpm check
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 50KB 读取导致单批上下文暴涨 | 128k 窗口压力 | 24k 批预算 + 折叠最旧；1M 窗口可容纳 |
| `write_file` 覆盖误伤并发编辑 | 丢外部修改 | 可选 expectedVersion；项目锁；`file.changed` 版本 |
| read 行号被模型带进 patch | patch 失败 | 工具描述明确“行号仅引用”；edit 用原文匹配 |
| modelText 绕过 JSON 截断 | 超长结果进上下文 | `toolMessageContent` 对 modelText 也做 80k 上限 |
| 纯文本回放折叠破坏配对 | provider 拒绝 | 折叠仍返回字符串；call/result 配对不变 |
| 工具数组变化 | 一次前缀缓存失效 | 预期；`toolsetHash` 归因 `tools` |

## 9. 未决事项

- 跨 Turn L1 操作日志、单 Profile/计划、审批 allowlist、流式执行：后续切片。
- `search_code` 正则：后续切片，需 ReDoS 防护。
