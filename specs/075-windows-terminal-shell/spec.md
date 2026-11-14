---
id: 075-windows-terminal-shell
title: Windows 交互终端自动选择 Shell
milestone: M5
status: done
depends_on: [066-cross-platform]
created: 2026-11-13
---

# Windows 交互终端自动选择 Shell

用户确认按 PowerShell 7 → Windows PowerShell 5.1 → CMD 的顺序选择，并授权实现。

## 目标与范围

新建 Windows 人工终端使用首个可启动的候选 Shell。Agent 开发终端启动时按同一规则选定 Shell，前台命令退出或被 Ctrl+C 中断后，在原 PTY 中进入该 Shell。现有资源继续使用已启动的 Shell。Shell 选择器、自动安装、`run_command`、PM2 和其他平台的 Shell 默认值均在本任务范围之外。

## 验收场景

| ID | Given | When | Then |
|---|---|---|---|
| W1 | Larness 进程 PATH 中有可用的 PowerShell 7 | 新建 Windows 人工终端 | 进入 PowerShell 7，交互输入可执行 |
| W2 | PowerShell 7 缺失或启动探测失败 | 新建终端 | 使用 Windows PowerShell 5.1，其也不可用时使用 CMD |
| W3 | Windows Agent 开发终端正在运行获准程序 | 程序退出或接收 Ctrl+C | 原终端进入交互 Shell，终端 ID 保持，获准程序只执行一次 |
| W4 | 所有候选均不可用 | 请求创建终端 | 返回 `RESOURCE_UNAVAILABLE`，没有可运行的终端 |
| W5 | 已有人工终端且主机 Shell 可用性发生变化 | 用相同幂等键重试同一请求 | 返回原终端，修改请求参数仍返回 `CONFLICT` |
| W6 | PowerShell 终端收到普通交互命令 | Shell 正常退出 | PowerShell 不把该终端的输入追加到用户的历史文件 |

## 接口与数据

终端 DTO 沿用 `shell` 字段，记录新建时选定的可执行文件。REST、WS、工具参数、数据库列及配置格式沿用现有契约。模型提示说明 Windows 的选择顺序，并要求输入前从终端输出确认当前提示符和语法。

## 权限与失败边界

由服务端在获准的创建流程中选择绝对路径。PowerShell 7 从 Larness 进程 PATH 的绝对目录查找，Windows PowerShell 5.1 和 CMD 使用系统路径。候选通过白名单环境中的有界启动探测，探测失败时继续按顺序选择。PowerShell 启动时禁用 profile 和 PSReadLine 历史保存。交互启动沿用主机脚本执行策略。

终端租约、项目权限、参数绑定、输出脱敏和受管进程清理沿用现有规则。实际 ConPTY 创建失败走现有失败与对账流程。成功选择后发生的环境变化可在下次创建时重新探测。

## 验证

测试覆盖优先级、启动失败回退、候选耗尽和幂等重试。Windows 实机验证人工终端交互、Agent 前台退出和 Ctrl+C 后继续输入，以及终端关闭和历史文件。运行模型上下文及工具契约回归、`pnpm check`、构建和认证终端 E2E。按平台记录结果。
