# 074 实施计划：成果展示与临时文件折叠

> 对应 [spec](spec.md)。本文件只讲“怎么做”，不改变需求。G-074 确认 D-1～D-5 后更新本计划并进入实现。

## 1. 技术方案

1. **分类器（纯函数）**：输入本轮 touched 文件（路径、首次 `changeType`、最终 `version`）、项目忽略集合与文件系统探测结果，输出 `{ path, changeType, version, existed, category }[]`。规则：
   - `ENOENT` → `existed=false`、`category=process`；
   - 路径命中默认忽略 / 项目 `settings.ignore` / 生成与临时规则 → `process`；
   - 其余 → `deliverable`。
   - 同路径去重：`changeType` 取首次（创建优先），`version` 取最终；按首次出现顺序排序；超过上限时截断并保留计数。
2. **终态结算**：Turn 运行闭包已经维护事实（`recordFile`），在 `finalize` 调用前对本轮记录过的路径做一次有界 `stat`（不扫目录），把结果放进终态事件 payload 的 `fileResults`。事件仍在同一事务内先持久化再广播；核对失败（非 `ENOENT`）视为存在并记录错误码。
3. **客户端**：reducer 在终态事件上把 `fileResults` 挂到该轮用户消息项（与 `turnOutcome` 同层），重放时自然重建；`Timeline` 优先用它渲染成果与过程行，缺失时走现有分支。
4. **展示**：成果 chips（`deliverable` + 预览 / 终端）在上，过程行在下，默认收起；过程行展开列出路径、变更类型与已删除 / 仍存在，已删除不可点击，仍存在的复用现有打开动作。位置沿用最终答复页脚。
5. **`write_file` 卡片**：`tool.completed` 的文件目标生成条件从 `apply_patch` 扩到 `write_file`，前端复用 `FileResultCard`；有 `fileResults` 时成果区不以工具目标渲染，避免重复。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 终态事件携带 `fileResults` | 不新增事件类型；与现有终态同一事务；旧客户端忽略 | payload 变大；四种终态都要带 | 采用 |
| 新增 `turn.results` 事件 | 职责单一 | 新增事件类型、持久化与顺序约束；客户端多一个状态源 | 不采用 |
| 客户端自行推导（无服务端） | 无契约变更 | 浏览器无法核对存在性；忽略规则会与服务端分叉 | 不采用 |
| 模型声明成果 / 临时 | 语义最准 | 改工具 schema、prompt 与评测；有漏报与额外调用成本 | 不在本切片 |

## 3. 目录与文件变更

```text
新增：
  apps/server/src/modules/agent/turnResults.ts（分类器 + 核对）
  apps/web/src/features/chat/ProcessFilesRow.tsx（过程行）
  apps/web/src/features/chat/ProcessFilesRow.test.tsx
修改：
  apps/server/src/modules/agent/turnRunner.ts（终态结算、write_file 目标）
  apps/server/src/modules/agent/events.ts（如需要，仅类型/注释）
  packages/shared/src/events.ts（终态 payload 类型、MessageItem 可选字段）
  apps/web/src/lib/eventReducer.ts（保存 fileResults）
  apps/web/src/features/chat/Timeline.tsx（渲染分流）
  apps/web/src/features/chat/Timeline.test.tsx
  docs/contracts/ws-events.md、m2-resources.md、resource-views.md
删除：无
```

## 4. 实施步骤

1. 先写失败测试：分类器（存在 / 删除 / 忽略 / 去重 / 上限 / `EACCES`）。
2. 实现分类器与终态结算；断言四种终态都写出 `fileResults`，事件顺序与事务不变。
3. `write_file` 目标：补 `tool.completed` 用例（成功、失败、越权）。
4. Web：reducer 保存与重放；`Timeline` 分流；新增过程行组件与组件测试（删除、忽略、空态、历史回退、键盘）。
5. 契约与 051（若 D-1 采纳临时脚本约定）同步；浏览器检查浅 / 深色与窄屏。
6. 更新 `tasks.md`、`ROADMAP.md`、`STATUS.md`，关闭 Q-037。

## 5. 数据与迁移

- schema：无迁移；`agent_events` 复用既有 payload。
- 兼容：`fileResults` 可选；历史事件与旧客户端回退。
- 回滚：停止写入并让前端忽略；已写事件保留但不被旧版本读取。

## 6. 回滚策略

先回退前端分流（始终走旧渲染），再停止服务端写入。两步都可独立发布，不影响 Turn 终态、授权与数据。不删除已产生的事件。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
```

本机若缺少 node / pnpm，按仓库惯例运行定向包测试与 `tsc --noEmit` / `biome`，并在 `STATUS.md` 如实记录未运行项。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `stat` 阻塞终态 | 页脚延迟 | 只核对 touched 路径，设并发 / 数量上限 |
| 忽略规则与文件树分叉 | 用户困惑 | 复用同一 `isIgnoredFile` 与项目设置，规则集中一处 |
| 历史渲染变化 | 旧会话显示不一致 | 无 `fileResults` 一律走旧分支，并有回退用例 |
| 事件体积增大 | 大量文件时 payload 膨胀 | 上限 200 + 截断计数 |
| 写入与核对竞态 | 分类与实际略有偏差 | 文档说明为终态尽力核对；打开时仍有现有错误兜底 |

## 9. 未决事项

- [Q-037](../../docs/open-questions.md)：D-1～D-5 待 G-074 确认；其中 D-1 决定是否同步 051 的 `write_file` 描述。
