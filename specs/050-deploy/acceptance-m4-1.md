# M4-1 验收记录：Validate / Build / Artifact / Plan

> 2026-11-06，分支 `task/m4-1-validate-build-plan`。实测平台 macOS arm64、Node.js 20.19.3。G-Spec-M4 / G-PoC-M4 已通过。

## 1. 交付

- 正式目标 `deployment_targets`、真实构建 `deployment_builds`、不可变产物 `deployment_artifacts`、发布计划 `deployment_plans`；唯一迁移 `0011_deployments`，schemaVersion 11。
- `DeploymentSpec` 严格校验：版本、argv 构建/启动命令、项目内 cwd/outputDir、健康路径/端口/超时、恢复策略；未知字段、开发服务/终端/命令 ID、端点、绝对路径、`..`、`.git` 输出、保留端口均拒绝。
- 构建使用 `runCommand`：`shell:false`、独立进程组、超时/取消、1 MiB 有界脱敏日志、环境白名单、项目写锁与续租；失败/超时/取消/锁丢失不产生 artifact，target 当前版本不变。
- 产物复制不跟随符号链接、拒绝特殊文件、大小/文件数/路径/深度限额；逐文件 SHA-256 与排序树哈希；文件 0400、目录 0700；`artifact.json` 清单与 DB 双重记录；`verifyArtifact` 重算内容，篡改返回 `ARTIFACT_HASH_MISMATCH`。
- 计划规范化 JSON + SHA-256 `planHash`，绑定 target/project/artifact/artifactHash/specHash/旧新版本/来源/健康/恢复/影响/有效期；TTL 30 分钟；`verifyPlan` 重算哈希、检查当前指针并重验 artifact。
- 启动时 `DeploymentManager.recover()` 把残留 `RUNNING` 构建标为 `FAILED/INTERRUPTED`，不删除未知产物；`startServer` 已实例化 manager 并接入关闭顺序，但 M4-1 未新增 REST / WS / Agent 工具。
- 共享 Zod schema/DTO、`DEPLOY_*` 稳定错误码、部署契约 M4-1 冻结、数据模型与 M4-1 设计文档同步。

## 2. 验收场景映射

| 场景 | 结果 | 证据 |
|---|---|---|
| D1 检查/构建失败或取消 | **覆盖**：真实失败、超时、取消、符号链接输出、超限、项目锁冲突均无 artifact，target 不变，日志保留 | `deployments.test.ts` 构建组 |
| D2 首次部署有效产物/计划 | **前置覆盖**：真实构建产物、哈希、目标、计划、影响与健康/恢复策略；PM2 启动与真实健康核验归 M4-3 | 构建/计划组；未运行 PM2 |
| D3 v1→v2 | **计划层覆盖**：previous/new artifact/version、影响、`previousArtifactAvailable`；真实替换/健康归 M4-3 | “binds the previous and next version” |
| D8 不可逆迁移/恢复限制 | **覆盖**：计划固定 `databaseRollback:"unsupported"`，只声明旧产物可用性；实际恢复执行归 M4-3 | 计划断言 |
| D6/D12 目标边界 | **覆盖**：`svc_*`/`trm_*`/`cmd_*`、endpoint、跨项目 target、额外字段均拒绝；restart 尚不存在 | 目标验证组 + strict schema |

## 3. 测试与检查

- 新增 `deployments.test.ts` 19 项、`deployments-migration.test.ts` 1 项，共 20 项通过；覆盖真实子进程构建、失败/超时/取消、幂等、符号链接、超限、环境秘密、日志脱敏、项目锁、Git 来源、计划哈希/过期/篡改/旧新版本、恢复。
- `VITEST_MAX_WORKERS=3 pnpm check` 通过：Biome 506 文件、全 workspace 类型；web 124、agent 33（1 skipped）、server 471（7 skipped），合计 628 passed / 8 skipped。该 8 项为既有 PoC 跳过（M3/M4 PM2 需专用命令）。
- `pnpm build` 通过。
- 未跑浏览器 E2E：M4-1 无 UI / 浏览器行为变化；未运行 PM2 启动、HTTP 健康、真实部署替换与恢复，这些按任务边界归 M4-3 / M4-4，不能由本记录宣称 D2/D3 端到端通过。
- 环境说明：首次在 DSH `workspace-write` 沙箱运行构建测试时，`/bin/ps` 被拒绝，既有 `runCommand` 返回 `STOP_UNCONFIRMED`；在允许进程检查的环境（本次最终为 danger-full-access）重跑全部通过。该限制与 STATUS 已记录的 M2-4b 环境问题一致，不是产品回归。

## 4. 数据与清理

- 测试使用 `mkdtemp` 临时项目/数据目录，结束后删除；测试产物位于临时 `data/artifacts/deploy`、`data/logs/deploy`，未写入项目源码目录。
- 未修改已应用迁移、用户源码、运行数据、配置、认证、IPC 协议；未安装依赖或 PM2。
- 仅 macOS arm64 实测；Linux / Windows、真实 PM2 与浏览器运维页未验证。

## 5. 未决与后续

- M4-2 需要消费 `DeploymentPlanDto` 与 `verifyPlan`，冻结授权记录/策略快照/TTL/idempotency 与人工审批绑定；开发工具审批不能直接复用。
- M4-3 需要消费 `verifyArtifact` 与 target 当前指针，真实启动/替换后更新 `current_artifact_id/current_version`，并验证健康、对账与恢复。
- M4-3b 才接入 `/api/service-ops/`、运维事件、Agent 工具与运维页。
- Q-029 正式服务 `secretRef` 注入与 PM2 dump/日志落盘检查仍在 M4-3 开工前处理。
