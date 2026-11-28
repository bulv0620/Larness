# 实施计划：搜索与目录列表默认忽略构建产物

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。

## 1. 技术方案

在 `packages/resources/src/files/fileService.ts` 的 `DEFAULT_IGNORED` 集合中加入常见包存储/构建目录名。`listFiles` 与 `searchCode` 已经共用 `isIgnoredFile(relativePath, name, extra)`，因此一处名单即可覆盖两条路径。

不解析 `.gitignore`，不引入 ripgrep；显式 `path` 作为遍历起点时保持现有行为（忽略只作用于遍历中遇到的子项，不拦截起点本身），这样用户仍可检查 `dist`。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 扩大 `DEFAULT_IGNORED` 名单 | 改动小、无新依赖、可立即修复根搜索预算问题 | 不覆盖任意 `.gitignore` 规则；`build`/`tmp` 同名源码目录会被默认跳过 | **采用**；文档写明边界，显式 `path` 可绕过 |
| 解析根 `.gitignore` | 更贴近用户仓库 | 否定规则、嵌套文件、glob 语义复杂；容易误忽略 | 后续切片 |
| 引入 ripgrep | 性能与 ignore 语义最好 | 原生二进制、多平台打包、依赖评审 | 后续切片/ADR |
| 只修 `searchCode` 不修 `listFiles` | 改动更小 | 目录列表仍被构建产物污染 | 否决 |

## 3. 目录与文件变更

```text
修改：
  packages/resources/src/files/fileService.ts        # DEFAULT_IGNORED + 工具描述
  packages/agent/test/tools/fileService.test.ts       # A1–A5 回归
  packages/agent/test/tools/fileTools.test.ts         # 模型工具层断言
  docs/contracts/agent-command-context.md             # 默认忽略与显式路径说明
  specs/README.md                                     # 切片索引
  specs/ROADMAP.md                                    # 8.18 切片登记
  STATUS.md                                           # 当前进行中
新增：
  specs/092-search-ignore/spec.md
  specs/092-search-ignore/plan.md
  specs/092-search-ignore/tasks.md
```

## 4. 实施步骤

1. 先写失败测试：
   - 在 `packages/agent/test/tools/fileService.test.ts` 增加 A1–A5；
   - 在 `packages/agent/test/tools/fileTools.test.ts` 增加默认忽略与描述断言；
   - 运行定向测试，确认失败原因是“默认忽略缺失”，而不是 fixture 写错。
2. 实现：在 `DEFAULT_IGNORED` 加入 `.pnpm-store`、`dist`、`build`、`coverage`、`test-results`、`tmp`、`.turbo`、`.vite`。
3. 更新 `list_files` / `search_code` 描述，说明默认跳过常见构建/包存储目录、显式 `path` 可进入。
4. 更新契约文档与切片索引/路线图/STATUS。
5. 运行定向测试、`pnpm check`，记录未运行项。
6. 提交一个任务（SI-1）。

## 5. 数据与迁移

- schema：无。
- 兼容：已有会话、项目设置、事件不变；工具描述变化会让下一 Turn 的 `toolsetHash` 变化一次。
- 回滚：从 `DEFAULT_IGNORED` 移除新增名称即可；无数据影响。

## 6. 回滚策略

移除名单新增项、恢复工具描述即可。显式 `path` 与项目 `ignore` 逻辑不改，因此回滚不影响安全边界。

## 7. 验证命令

```bash
pnpm --filter @larness/agent test test/tools/fileService.test.ts test/tools/fileTools.test.ts
pnpm --filter @larness/agent typecheck
pnpm exec biome check packages/resources/src/files/fileService.ts packages/agent/test/tools/fileService.test.ts packages/agent/test/tools/fileTools.test.ts
pnpm check
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 源码目录名为 `build` / `tmp` 被默认跳过 | 模型默认看不到该目录 | 工具描述写明；显式 `path` 可访问；后续完整 `.gitignore` 解析或项目 `ignore` 可覆盖 |
| 工具描述变化导致一次前缀缓存失效 | 升级后首次请求成本上升 | 预期的一次性成本；`toolsetHash` 会归因到 `tools` |
| 只覆盖固定名单，仍有其他构建目录 | 其他仓库仍可能被污染 | 本切片先修常见项；完整 `.gitignore`/ripgrep 另开切片 |
| 测试在 Windows 上路径分隔符不同 | 断言失败 | 使用 `path.join` 构造 fixture，断言使用 `/` 归一后的工具输出 |

## 9. 未决事项

- 完整 `.gitignore` 解析与 ripgrep 替换：后续切片，需评估原生依赖与多平台打包。
- 是否提供项目级“取消默认忽略”设置：本切片不做；显式 `path` 已提供逃生口。
