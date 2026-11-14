# Windows 终端 Shell 任务

## M5-F1-SHELL Windows 交互终端自动选择 Shell

- 状态 `done`。
- 依赖 M5-F1（`done`），用户于 2026-11-13 确认选择顺序并授权实现。
- [规格](spec.md) · [计划](plan.md)
- [x] 补齐选择、回退、幂等和交互回归。
- [x] 实现并同步执行契约。
- [x] 记录 Windows 实机及全量检查结果。
- [x] 用户确认 Shell 修改验收通过并授权合并推送。

## 验收

- Windows 11 x64 build 26200、Node 24.22.2。新增回退和候选耗尽用例先在旧实现失败。实机用现行启动参数验证 PowerShell 7.6.9、Windows PowerShell 5.1 和 CMD 均能在 ConPTY 输入并正常退出。两个 PowerShell 均未写入探针历史文件。
- Shell、Agent 终端、模型上下文和工具契约定向复跑 18 项通过、2 项平台条件跳过。人工终端幂等与双客户端输入和缩放通过。默认工作区 Agent 输入及 7 项临时服务测试单独复跑通过。
- `pnpm build` 通过。认证 Chromium 分两组复跑共 6 项通过，覆盖人工终端、默认工作区和 Agent 终端。Windows 10 未在本次实测。
- 初次全量 `pnpm check` 的 Biome、全仓类型检查、Web 189 项及 Agent 57 项通过，Server 641 项通过、10 项失败、31 项跳过。失败包括两项在 `main`（`a72ed7e`）单独复现的恢复锁断言，以及命令、终端、默认工作区与临时服务用例。部分超时用例在上述定向复跑通过。全量结果保留为失败。
