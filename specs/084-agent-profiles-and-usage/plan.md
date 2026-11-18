# 实施计划：Agent Profile 收敛与会话 Token 统计

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。§12 的决议见 spec 与 ADR-070。

## 1. 技术方案

把 Profile 从“能力边界”改为“执行模式”：

- 内核 `AgentProfileId` 收敛为 `coding | plan`；两个 Profile 共用完整工具包（读取、写入、命令、后台进程、Service Ops），`plan` 追加 `plan` 包。
- 服务端 `TOOL_PACK_CATALOG` 同步；`service-ops` Profile 删除，会话数据由迁移 `0034` 归一为 `coding`。
- 系统提示：两个 Profile 都注入项目后台任务与 PM2 契约；`plan` 额外注入计划策略。PM2 Turn 起点观察快照不再注入，模型按需调用 `list_service_ops`。
- `refresh_observations` 保留实现，但不再属于任何 Profile 的工具包；执行层继续以 `disabledToolsForProfile` 失败关闭。
- 会话用量：新增纯函数聚合 `turns.usage_json`，忽略非终态 Turn，统计已知 input/output/total/cache 与缺失 usage 的 Turn 数；REST 返回聚合 DTO，不新增表。
- `model.usage` 事件增加 `durationMs`（模型步骤墙钟）。前端用它和 `outputTokens` 计算最后一步实测速度，只在 Turn 进行中显示。
- 输入框下方由独立 `SessionUsageLine` 组件渲染：总量常驻（有已知 usage 时），速度仅进行中；缺失数据用 `≥` 与“部分统计”标注。
- 过程呈现：删除时间线底部独立状态栏；`TurnView` 的折叠标题行承载状态、波形、步骤/耗时与展开箭头；reasoning 不再渲染文本，也不触发自动滚动。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保留 `service-ops` 作为第三 Profile | 不改迁移 | 与“两个执行模式”冲突，用户仍需切模式部署 | 拒绝；按 084 收敛 |
| `plan` 继续只读 | 多一层权限边界 | 与完整执行 + 计划的用户目标冲突；审批策略已承担只读 | 拒绝；ADR-070 |
| 每轮注入 PM2 观察 | 模型无需调用工具 | 固定 token 成本、缓存前缀不稳定 | 拒绝；按需 `list_service_ops` |
| 用字符估算实时 token/s | 视觉连续 | 伪造精确度 | 拒绝；只用 Provider usage |
| 端上新表存会话用量 | 查询快 | 额外迁移与写入路径 | 拒绝；从 `turns.usage_json` 聚合 |

## 3. 目录与文件变更

```text
新增：
  specs/084-agent-profiles-and-usage/plan.md
  specs/084-agent-profiles-and-usage/tasks.md
  docs/adr/ADR-070-agent-profiles-and-usage.md
  apps/server/drizzle/0034_agent_profile_coding_plan.sql
  apps/server/src/modules/sessions/usage.ts
  apps/server/test/sessions/session-usage.test.ts
  apps/web/src/features/chat/SessionUsageLine.tsx
  apps/web/src/features/chat/SessionUsageLine.test.tsx
  apps/web/src/features/chat/ProcessWaveform.tsx（若需要独立动画组件）

修改：
  packages/agent/src/kernel/profile.ts
  apps/server/src/modules/agent/profiles.ts
  apps/server/src/modules/agent/contextAssembler.ts
  apps/server/src/modules/agent/turnRunner.ts
  apps/server/src/db/schema.ts
  apps/server/src/modules/sessions/{service,repository,turns}.ts
  apps/server/src/api/sessions.ts
  apps/server/drizzle/meta/_journal.json
  apps/web/src/features/chat/{Composer,Timeline}.tsx
  apps/web/src/lib/{workspaceApi,eventReducer,queries}.ts
  apps/web/src/stores/timelineStore.ts
  相关测试、契约与状态文档
删除：
  无
```

## 4. 实施步骤

1. 先写失败测试：Profile catalog / migration / 用量聚合 / `model.usage.durationMs` / 前端用量行 / 过程标题行。
2. Profile 收敛：类型、catalog、提示、API 枚举、UI 选择器、脚本与测试夹具。
3. 迁移 `0034` 与会话数据归一；更新 schemaVersion 断言。
4. 用量聚合与 REST；`model.usage` 增加步骤耗时。
5. 前端用量行：查询缓存、终态失效、格式化与缺失标注。
6. 过程呈现收敛：状态行、波形、reasoning 隐藏、滚动触发收敛。
7. 全量验证与文档回填。

## 5. 数据与迁移

- schema：无新表、新列。
- 迁移：`0034_agent_profile_coding_plan.sql` 将 `sessions.agent_profile='service-ops'` 更新为 `coding`。
- 兼容：旧事件、Turn、日志与 usage 保留；旧 `plan` 会话直接获得完整工具面，不做二次确认（`plan` 从来不是安全边界）。
- 回滚：应用回滚不回滚会话数据；如需恢复旧 Profile，只能向前迁移新增值。

## 6. 回滚策略

- Profile 与提示可通过版本回退应用恢复；迁移后的 `coding` 会话保持合法。
- 用量 API 与前端行是只读功能，出问题可移除路由与组件，不影响 Turn 执行。
- 过程呈现只改 Web；回退前端构建即可恢复旧状态栏。

## 7. 验证命令

```bash
pnpm --filter @larness/server test -- test/agent/profiles.test.ts
pnpm --filter @larness/server test -- test/sessions/session-usage.test.ts
pnpm --filter @larness/web test:file src/features/chat/SessionUsageLine.test.tsx
pnpm --filter @larness/web test:file src/features/chat/Timeline.test.tsx
pnpm check
pnpm build
pnpm test:e2e
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `service-ops` 迁移遗漏 | 启动时旧会话无法装配 | 迁移 + 启动前归一测试；`normalizeAgentProfile` 接受历史值的测试 |
| 移除 PM2 观察后模型不知道服务 | 部署任务多一次工具调用 | `list_service_ops` 描述与提示明确“按需读取” |
| usage 部分缺失被当成完整 | 误报 Token 总量 | `≥` + “部分统计” + 缺失 Turn 数 |
| 过程行状态抖动 | 视觉噪声 | 状态派生为单值；reasoning 不渲染、不触发滚动 |
| 全量检查受既有并行抖动影响 | 误判回归 | 失败项定点复跑并记录；不冒充全绿 |

## 9. 未决事项

- 无新增未决项；显示细节按 spec §12 的审核决议执行。
