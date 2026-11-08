---
id: 060-extension
title: M5 多模型、自动化与更新
milestone: M5
status: draft
depends_on: [050-deploy]
owners: [human]
created: 2026-10-31
updated: 2026-11-07
---

# M5 多模型、自动化与更新（草案）

> **状态：draft。** 开始 M5 前补全多 Provider 能力矩阵、调度器、更新与跨平台验收。  
> 源设计：`larness.md` 第 4.3、4.9、21–22、40–43 章。

## 1. 目标

- 多 Provider：GLM / OpenAI-compatible 适配，能力声明、契约测试、上下文压缩与跨模型迁移（DeepSeek 部分见 061；其余见 063）。
- Scheduler：Cron / 固定间隔、JS 脚本与受限 Agent 任务、JobRun、限流、超时、失败通知。
- 更新：每日检查、手动安装、签名校验、独立 Launcher / Updater、UpdateLock、健康检查、回滚。
- 跨平台：Windows / Linux PoC、打包、安装说明、支持范围。
- 加固：安全评审、发布清单、文档定稿。

## 2. 非目标

- 多租户 / 云端托管。
- 插件市场、第三方扩展。
- 自动安装更新（必须人工触发）。
- 任意平台的无条件支持承诺。

## 3. 任务范围（待细化）

| ID | 任务 | 关键交付 |
|---|---|---|
| M5-1 | [多 Provider 与压缩](063-multi-provider/spec.md) | GLM / OpenAI-compatible、能力矩阵、上下文压缩、切模型体验（已交付） |
| M5-2 | [Scheduler](064-scheduler/spec.md) | 任务表、cron、JS / Agent 执行、JobRun、并发 / 超时 / 通知（done） |
| M5-3 | [Launcher / Updater](065-launcher-updater/spec.md) | 版本目录、签名、下载、切换、健康检查、回滚、UpdateLock（spec draft） |
| M5-4 | 跨平台 PoC | Windows / Linux 终端、路径、PM2、安装、更新 |
| M5-5 | 加固与发布 | 安全评审、发布清单、文档、已知限制 |

## 4. 预验收场景（需补全）

- GLM → DeepSeek 切换：当前 Turn 不受影响；下一 Turn 使用新模型；历史与任务状态可读。
- 上下文压缩后仍保留目标、已改文件、待办、失败验证、服务 ID、待审批动作。
- 定时任务：并发限制、超时、错过触发策略、时区 / DST、失败记录。
- 更新：签名错误 / 下载中断 / 健康检查失败均不启用坏版本；任务运行中等待安全点。
- 更新失败可回滚程序版本；数据库不可逆迁移给出恢复指引。
- Windows / Linux 冒烟结果与限制公开。

## 5. 待决策

- GLM 接入方式（官方 SDK / OpenAI-compatible）。
- 上下文压缩策略（摘要模型、触发阈值、保留字段）。
- 更新签名密钥管理与发布流程。
- Windows 支持范围与安装方式（MSI / zip / 脚本）。
- 是否提供遥测（默认关闭）。

## 6. 进入 M5 前必须完成

- [ ] 多 Provider 契约测试计划；
- [ ] 调度器时区 / 并发 / 失败策略；
- [ ] 更新签名与回滚演练；
- [ ] 跨平台 PoC 机器与验收清单；
- [ ] 发布候选的安全评审。
