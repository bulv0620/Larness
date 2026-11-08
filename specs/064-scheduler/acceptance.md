# M5-2 调度器验收记录（2026-11-07）

> 状态：`done`（2026-11-08 用户确认当前范围先过）。真实 Agent、休眠、视觉等未验证项保留为边界，不冒充已验证。
> 实现范围：M5-2-1 / M5-2-2 / M5-2-3；M5-2-4 为整体验证记录。

## 1. 验收矩阵

| 场景 | 结果 | 证据 / 边界 |
|---|---|---|
| A1 Cron 脚本任务 | 通过（自动化） | `test/jobs/runtime.test.ts` 认领 / 推进 / 成功；auth E2E `jobs.spec.ts` 创建 → 立即执行 → 成功输出 |
| A2 固定间隔与错过触发 | 通过（单元） | `schedule.test.ts` 间隔；`runtime.test.ts` `skip` 不补跑、`run_once` 只补 1 次 |
| A3 并发与重叠 | 通过（单元） | `runtime.test.ts` 活动运行时记录 `skipped` / `JOB_OVERLAP`；全局并发 2 由实现常量与运行器限制 |
| A4 超时与取消 | 通过（单元） | `scriptRunner.test.ts` 真实子进程超时 / 取消；`agentRunner.test.ts` Turn 取消 / 超时；UI 取消按钮未做 E2E |
| A5 Agent 任务权限 | 部分 | `agentRunner.test.ts` 失败 / 成功 / readonly 上下文；策略写入任务与会话；真实 Provider 未验证 |
| A6 重启恢复 | 通过（单元） | `runtime.test.ts` 启动把 `queued` / `running` 标 `interrupted`；真实进程重启未做 E2E |
| A7 失败提示 | 部分 | 侧栏角标、`summary.failedLast24h`、任务失败展示已实现；缺少自动化角标 E2E |
| A8 时区与 DST | 通过（单元） | `schedule.test.ts` 春季 02:30 → 03:30、秋季 01:30 只执行一次、Asia/Shanghai |
| A9 鉴权与项目边界 | 通过（集成） | `api.test.ts` 401 / CSRF 403、项目校验、404；审计记录 `job.created` |
| A10 输出、环境与脱敏 | 通过（单元） | `scriptRunner.test.ts` 环境白名单、64 KiB 截断、秘密形状脱敏、临时文件清理 |
| A11 限额 | 部分 | 手动触发 10 秒限流有 API 断言；100 个任务上限未做满额测试 |
| A12 生命周期 | 通过（集成） | `service.test.ts` 启停、运行历史游标、归档后不可读；删除 UI 有 E2E |

## 2. 自动化检查

- `pnpm check`：通过（web 141、agent 40 通过 / 1 跳过、server 553 通过 / 10 跳过）。
- `pnpm build`：通过。
- Demo E2E：19/19 通过。
- auth E2E `jobs.spec.ts`：1/1 通过（创建 → 立即执行 → 刷新后历史 → 删除）。
- 全量 auth E2E：15 通过 / 3 失败；其中 2 个 terminals 用例在单独重跑时通过（既有批量抖动），`conversation.spec.ts` 仍使用 M5-1e 之前的「计划 · x/y」直出选择器，单独重跑仍失败，属于本切片前的既有测试债务，未在本次改动。
- `pnpm check` 未覆盖 E2E；上述 auth 结果如实记录，不冒充全绿。

## 3. 未验证 / 已知边界

- **真实 Agent 任务**：没有使用真实 Provider 跑完整定时任务；本地 FakeProvider 覆盖成功、超时、取消。
- **真实人工取消确认**：Agent 长任务取消到 Turn 终态的时延未实测。
- **休眠 / 唤醒**：未在真实系统休眠后验证错过触发与下一次计算。
- **角标 E2E**：失败角标只做组件 / 数据层，没有 Playwright 断言。
- **任务数上限**：100 个任务的上限未做满额测试。
- **视觉**：浅色 / 深色、窄屏的任务面板截图尚未归档；等待人工验收。
- **平台**：仅 macOS；Windows 脚本任务未支持，Linux / Windows 行为归 M5-4。
- **外部通知 / 重试**：明确不在本切片。

## 4. 结论

M5-2 的三项实现任务已交付，自动化检查与核心失败路径通过；真实 Agent、休眠、视觉和全量 E2E 的已知债务如上。2026-11-08 用户确认当前范围先过，M5-2 关闭；Agent 创建 / 修改定时任务仍不在范围（NG-7）。
