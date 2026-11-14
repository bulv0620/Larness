# Windows 终端 Shell 实施计划

1. 在现有 Windows 平台工具基础上解析候选，通过短时启动探测验证版本和 PowerShell 历史设置。探测在创建资源前完成。
2. 人工终端与 Agent 开发终端复用同一启动参数。Windows 开发终端沿用固定 Node 引导程序传递获准的 argv。
3. 沿用已有终端的创建身份进行幂等比对，允许主机 Shell 可用性变化后重取既有结果。
4. 同步终端契约和 Agent 提示。运行 Shell 选择、真实 ConPTY、工具及浏览器回归。
