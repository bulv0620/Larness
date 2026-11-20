# 086 验收记录

> 实现分支：`task/086-project-memory`；日期：2026-11-20（macOS）。
> spec 仍为 `ready`，本文记录自动验证结果；人类视觉/真实使用验收尚未完成，因此不把切片标为 `done`。

## 1. 自动验证

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm check` | 通过 | Web 49 文件 / 272 项；Agent 8 文件 / 63 通过 + 1 跳过；Server 157 文件 / 779 通过 + 14 跳过 |
| `pnpm build` | 通过 | server（四入口）+ web 构建完成；仅既有大 chunk 警告 |
| `pnpm test:e2e` | 通过 | Mock Chromium 24/24 |
| 迁移 | 通过 | 空库、存量库、幂等、备份与 pre-upgrade 用例；schemaVersion 36 |
| 定向记忆测试 | 通过 | `test/memory/{service,budget,retention,api,longRun}.test.ts`、`test/agent/{contextAssembler,profiles,toolContract}.test.ts` |

## 2. 验收场景对照

| 场景 | 结果 | 证据 / 边界 |
|---|---|---|
| A1 指令文件自动加载与合并 | 通过 | `test/projects/instructions.test.ts`、`contextAssembler.test.ts` 顺序断言 |
| A2 缺失、不可读、过大 | 通过 | 同上：缺失跳过、二进制跳过、64 KiB 读取上限、20k 截断 |
| A3 指令文件越界 | 通过 | 符号链接越界不读取并警告 |
| A4 自动学习项目事实 | 通过 | `test/memory/service.test.ts` 命令证据自动 active；同 Turn 不注入 |
| A5 查看、纠正、忘记 | 通过（接口/组件） | API 编辑/删除；`MemoryDialog.test.tsx` 列表、预算、忘记确认 |
| A6 同 key 更新不重复 | 通过 | 同 key 新证据 supersede 旧 active；列表仅一条 active |
| A7 证据不足/冲突进入 review | 通过 | 决策类 review；review 接受/拒绝 API 与 UI |
| A8 跨项目偏好 | 通过 | 全局 preference 在项目 B 可见；项目事实不可见 |
| A9 全局与项目隔离 | 通过 | 私有项目 `globalEnabled=false` 时全局偏好不可见、不可写 |
| A10 硬预算与淘汰 | 通过 | `longRun.test.ts` 80 次写入后 active ≤64 KiB、total ≤192 KiB |
| A11 有界保留 | 通过 | `retention.test.ts` revision 3 个、review/rejected/expired/evicted/suppression 清理 |
| A12 过期与陈旧 | 通过（单元） | `isMemoryStale` 30/180 天；过期 active 不注入 |
| A13 秘密与注入内容 | 通过 | `longRun.test.ts` 凭证、绝对路径、指令性文本被拒 |
| A14 同 Turn 不自我强化 | 通过 | `contextAssembler.test.ts` 当前 Turn 写入不注入，下个 Turn 注入 |
| A15 关闭与项目删除 | 通过（数据层） | `MEMORY_DISABLED`、级联删除 revision/抑制项；UI 开关未接入 |
| A16 长期使用不膨胀 | 通过（加速模拟） | 80 次写入约等于长期 churn；非真实 30 天 |

## 3. 未验证 / 已知边界

- **未做真实 30 天使用**：A16 是加速写入模拟，不代表真实项目的记忆质量与命中率。
- **未做真实 Provider 行为验收**：模型是否稳定调用 `remember`、是否会把一次性状态误记为事实，尚未用真实会话统计。
- **未做浏览器中的记忆面板视觉验收**：`MemoryDialog` 只做了 happy-dom 组件测试；窄屏、长文本、大量记忆滚动未人工检查。
- **`memory.changed` 未做浏览器 E2E**：服务端广播与客户端 schema 已接线，但没有 Playwright 用例覆盖实时刷新。
- **项目设置开关**：记忆对话框已提供“启用项目记忆 / 允许跨项目偏好”开关；未做浏览器视觉验收。
- **`remember` 的自动覆盖率未验证**：v1 依赖 Agent 主动调用，未加入 Turn 结束 curator；若真实使用中覆盖率低，需要后续切片。
- **淘汰恢复与总预算压力**：总占用超限时可能直接删除 recovery/evicted 行以守住 192 KiB，此时 7 天恢复窗口不再保证。
- **迁移编号**：spec 写预计 0034，实际因存量迁移为 `0036_project_memory`；已同步契约与 ADR。
- **未提交**：截至记录时改动尚未提交；提交前以最终 `git status` 为准。

## 4. 复跑命令

```bash
pnpm check
pnpm build
pnpm test:e2e
pnpm --filter @larness/server exec vitest run test/memory
pnpm --filter @larness/web test:file src/features/memory/MemoryDialog.test.tsx
```
