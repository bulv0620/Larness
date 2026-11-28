# 任务：新会话继承最近选择的审批策略

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| AD-1 | 服务端持久化项目默认审批策略 | — | `done` |
| AD-2 | Web 草稿继承显示与不回写 | AD-1 | `done` |
| AD-3 | 契约、文档与整仓验证 | AD-2 | `done` |

## 任务卡

### AD-1 服务端持久化项目默认审批策略

- 状态：`done`
- 依赖：无
- 目标：项目/默认工作区记住最近一次用户修改的策略，新会话按此创建，旧会话不变。
- 交付物：
  - `ProjectSettingsSchema.defaultApprovalPolicyId`（缺省 `standard`）
  - 默认工作区 `app_meta` 键与解析/写入辅助函数
  - `createSession` 创建时解析默认；`updateSession` 策略变化时在同一事务记住
  - `getDefaultProjectDto` 返回默认工作区当前值
- 验收：
  - 项目与默认工作区的新会话分别继承各自最近选择
  - 旧会话策略不被改写
  - 项目设置缺失/损坏回落 `standard`
- 测试：
  - `apps/server/test/sessions/service.test.ts` 新增默认继承、旧会话不变、项目隔离
  - `apps/server/test/sessions/api.test.ts` 新增 PATCH 后项目 DTO 与新会话
- 涉及路径：
  - `apps/server/src/modules/projects/service.ts`
  - `apps/server/src/modules/sessions/service.ts`
  - `apps/server/src/api/projects.ts`
  - 上述测试
- 备注：不新增 DB 列/迁移。

### AD-2 Web 草稿继承显示与不回写

- 状态：`done`
- 依赖：AD-1
- 目标：草稿会话显示项目默认策略；未改选时不回传，改选后按原逻辑保存。
- 交付物：
  - `ApiProject.settings.defaultApprovalPolicyId` 类型
  - `useProjectDefaultApprovalPolicy` 查询辅助
  - `Composer` 草稿策略来源与 `initialPolicy` 显式判断
  - 非草稿会话保存策略后刷新工作区快照
- 验收：
  - 草稿盾牌显示项目默认
  - 未改选发送不携带 `approvalPolicyId`
  - 改选完全自主仍走风险确认
- 测试：
  - `apps/web/src/features/chat/Composer.test.tsx`
  - `apps/web/src/lib/queries`/类型相关现有测试
- 涉及路径：
  - `packages/shared/src/domain.ts`
  - `apps/web/src/lib/workspaceApi.ts`
  - `apps/web/src/lib/queries.ts`
  - `apps/web/src/features/chat/Composer.tsx`
  - 上述测试
- 备注：不改审批引擎与工具契约。

### AD-3 契约、文档与整仓验证

- 状态：`done`
- 依赖：AD-2
- 目标：同步契约与状态，完成验证。
- 交付物：
  - `docs/contracts/rest-api.md`、`docs/architecture/security.md`
  - `STATUS.md`、`specs/ROADMAP.md`、本切片记录
- 验收：
  - `pnpm check` 与 `pnpm build` 通过
  - 记录定向测试与未运行项
- 测试：
  - server/web 定向用例
  - 整仓 `pnpm check`、`pnpm build`
- 涉及路径：文档与状态文件
- 备注：无。

## 验收记录（2026-11-27）

- 定向：server `sessions/service` 9 项、`sessions/api` 1 项、`projects/api` 3 项；web `SessionModel` 14 项、`Composer` 9 项、`timelineSendScroll` 3 项。
- 整仓：`pnpm check` 退出码 0（server 188 个文件通过 / 5 跳过，1018 项通过 / 15 跳过；web 与各包 typecheck 通过）；`pnpm build` 通过。
- 未运行：E2E 与真实浏览器人工验收未重跑；本次为服务端默认解析与 Composer 状态逻辑改动，按定向组件测试和构建验证。
- 行为边界：草稿默认策略查询失败时显示 `standard`，但发送不携带策略，最终以服务端创建时解析值为准；已有会话不回写。
