# 085 验收记录

> 对应 [spec](spec.md) / [tasks](tasks.md)。记录自动门禁与未验证范围，不把未运行项写成已通过。

## 2026-11-19 自动门禁（macOS）

- `pnpm check`：首次完整运行通过（14:24）；后续复跑在 `test/resources/m2-poc.test.ts` 的 native watcher 用例超时（`PoC timeout: native watcher change`），单文件复跑 4/4 通过。该用例与本切片改动无关（085 未改文件监听），按既有环境性脆弱用例记录，不冒充最终全量绿。
  - Biome：690 files，无修复
  - Typecheck：shared / ui / web / resources / agent / server 全部通过
  - Tests：Web 265、Agent 63（+1 skip）、Server 742+（+14 skip；仅上述 m2-poc 1 项失败）
- `pnpm build`：通过（Vite 大 chunk 警告为既有）
- `pnpm test:e2e`：24/24 通过（Chromium，Mock）
- 定向测试：
  - `contextRollover` / `continuation` / `turnRunner` / `spendCap` / `stall` / `job agentRunner`：77 项通过
  - `eventReducer` / `TimelineContinuation`：19 项通过
- 覆盖点：
  - 默认任务级 token 上限关闭，旧 30 窗口上限不再截断；
  - 85% 输入窗口换页，原 Turn 为 `terminalReason=continued`；
  - 无工具事实时用最近 assistant 消息 fallback 接续；
  - 默认接续深度取消，整链 24h 紧急墙钟；
  - 单次模型请求 600s 上限；
  - `continued` 在 Job 中判为未完成，UI 显示 “Continuing...”，不展示最终答案。

## 未验证 / 待人类验收

- 真实 Provider 的多小时长任务：未在本环境运行；需要在有凭据的真实会话中验证换页次数、检查点事实质量、最终完成率。
- 视觉验收：Timeline 的 “Continuing...” 与自动继续标记只通过组件测试，未做人工截图确认。
- 真实项目中的上下文压缩质量与换页后重复执行风险：定向测试未覆盖全部 Provider 差异。
