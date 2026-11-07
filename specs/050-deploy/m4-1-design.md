> 历史方案记录。2026-11-07 当前 Agent 命令部署以 [ADR-050](../../docs/adr/ADR-050-pm2-cli-deployment.md) 和 [当前 spec](spec.md) 为准。

# M4-1 技术冻结：Validate / Build / Artifact / Plan

> 2026-11-06，M4-1 开工前评审记录。G-Spec-M4 / G-PoC-M4 已通过。本文件冻结 M4-1 的后端接口、数据、安全与失败边界；实际 PM2 Apply、健康探测、版本切换记录归 M4-3，运维 REST / WS / Agent 工具归 M4-3 / M4-3b。

## 1. 范围

M4-1 交付正式服务发布的**准备阶段**：

1. 正式目标（formal target）身份与来源项目绑定；
2. 项目部署输入的严格校验；
3. 真实构建进程、构建日志与不可变产物；
4. 产物哈希、内容寻址路径与篡改校验；
5. 部署计划（plan）：版本、旧/新产物、影响、健康与恢复策略、规范化哈希、时效；
6. 拒绝把开发服务 ID、PTY、临时监听端点当作正式目标。

明确不在 M4-1：PM2 守护、进程启动/替换、HTTP 健康探测、授权/审批、REST/WS/UI、Agent 工具、环境秘密注入。D2 的“实例命名空间启动 + 真实健康”在 M4-3 完成；M4-1 只保证其前置的产物/计划真实、完整、可核验。D3 的旧/新版本绑定在计划层验证，真实替换在 M4-3。D8 的能力限制在计划中显式记录。

## 2. 部署输入（后端内部 schema）

`DeploymentSpecSchema`（`@larness/shared`，strict）：

```json
{
  "version": "2026.11.06-1",
  "build": {
    "command": ["pnpm", "build"],
    "cwd": ".",
    "outputDir": "dist",
    "timeoutMs": 300000
  },
  "start": {
    "command": ["node", "main.js"],
    "cwd": "."
  },
  "health": {
    "path": "/api/health",
    "port": 4100,
    "timeoutMs": 30000,
    "intervalMs": 500
  },
  "recovery": {
    "strategy": "restart",
    "maxAttempts": 3
  }
}
```

约束：

- `version`：1–64 字符，`^[A-Za-z0-9][A-Za-z0-9._+-]*$`；同一正式目标内版本唯一。
- `command`：argv 数组 1–64 项，每项 1–4096 字符、无 NUL/控制字符；`shell:false` 执行，不拼接命令字符串。
- `cwd` / `outputDir`：项目根内相对路径；禁止绝对路径、`..`、空段、NUL；`outputDir` 不能是项目根本身或 `.git`；构建后 realpath 必须仍在项目根内。
- `health.port`：1024–65535，且不能占用受管 Larness 端口（Server / 预览），由调用方传入的保留端口列表校验。端口是正式服务配置，不是对现有监听端口的收养。
- `health.path`：以 `/` 开头、无 `..`、无控制字符、≤1024。
- `recovery.strategy`：`restart | none`；`maxAttempts` 0–10。
- 未知字段一律拒绝（strict）；任何 `serviceId`、`terminalId`、`endpoint`、`host`、`pid` 等开发资源字段不能作为目标或出现在 spec 中。

目标引用只允许：

```json
{ "projectId": "prj_…", "target": { "targetId": "tgt_…" } }
{ "projectId": "prj_…", "target": { "name": "web" } }
```

`DeploymentTargetIdSchema = ^tgt_[a-f0-9-]{36}$`。`svc_*`、`trm_*`、`cmd_*`、终端 ID、端口、URL 会因 schema 不匹配被拒绝；strict schema 还会拒绝额外字段。

## 3. 数据（唯一迁移 0011_deployments）

| 表 | 关键列 | 说明 |
|---|---|---|
| `deployment_targets` | `id, project_id, name, current_artifact_id, current_version, created_at, updated_at` | 独立正式 ID；`UNIQUE(project_id, name)`；`current_*` 是最近一次**已记录成功**的部署指针，M4-1 只读，M4-3 成功后更新 |
| `deployment_builds` | `id, target_id, project_id, request_key, requested_by, status, spec_json, spec_hash, reason_code, log_ref, started_at, ended_at, created_at` | `UNIQUE(request_key)`；真实构建记录；不含秘密/原始环境 |
| `deployment_artifacts` | `id, build_id, target_id, project_id, version, artifact_hash, artifact_path, size_bytes, file_count, spec_json, spec_hash, source_json, created_at` | `UNIQUE(build_id)`、`UNIQUE(target_id, version)`；不可变产物元数据；`artifact_path` 相对 `dataDir/artifacts/deploy` |
| `deployment_plans` | `id, target_id, project_id, artifact_id, previous_artifact_id, previous_version, version, plan_json, plan_hash, status, expires_at, request_key, requested_by, created_at` | `UNIQUE(request_key)`；计划文档与哈希分开保存；状态先支持 READY/EXPIRED/INVALIDATED/CANCELLED，预留 M4-2/3 状态 |

约束：

- 所有 ID 前缀：`tgt_` / `bld_` / `art_` / `plan_` + UUID。
- `deployment_artifacts.artifact_path` 不能是绝对路径、不能含 `..`；读取/校验时重新 realpath 并限制在产物根内。
- 迁移非破坏；旧表、旧数据、资源流序号、锁/fencing 不变。`schemaVersion` 从 10 升至 11。
- 不在 M4-1 删除产物或目标；保留策略在 M4-3 冻结。

## 4. 构建与产物

- 构建进程使用 `@larness/resources` 的 `runCommand`：`shell:false`、独立进程组、超时、取消、输出上限 1 MiB、环境白名单（PATH/HOME/TMPDIR/LANG/TERM 等）。
- 构建前获取项目写锁（`resourceType:"project"`，短 TTL 续租），与 Agent 文件/Git 写互斥；拿不到返回 `RESOURCE_LOCKED`，不启动进程。
- 构建前记录 `source`（Git branch / HEAD / dirty；非 Git 为 null），并写入产物元数据。
- 构建成功后：
  1. `outputDir` 必须存在、是目录、realpath 在项目根内且不是根/`.git`；
  2. 递归复制到 `dataDir/artifacts/deploy/.staging/<buildId>`，**不跟随符号链接**，拒绝特殊文件、越界、超限；
  3. 逐文件计算 SHA-256，并按排序后的 `(relativePath, size, fileHash)` 计算树哈希；
  4. 原子 rename 到 `dataDir/artifacts/deploy/<targetId>/<artifactId>/payload`；
  5. 写 `artifact.json` 清单（`version:1, artifactId, targetId, hash, files[]`），文件权限 0400，目录 0700；
  6. 事务写入 artifact 与 build 成功状态。
- 限额（M4-1 默认，测试可注入更小值）：单文件 / 总大小 ≤ 512 MiB、文件数 ≤ 20,000、路径长度 ≤ 1024、深度 ≤ 32。超限失败并清理 staging，不产生 artifact。
- 构建日志写 `dataDir/logs/deploy/<buildId>.log`，≤1 MiB，0600；输出经 `OutputRedactor`（已知秘密 + 字段模式）处理。日志读取做路径限制与大小检查。
- 产物不可变性：内容只读（文件 0400）、不覆盖已有产物目录、写入使用 `O_EXCL` / `O_NOFOLLOW`；校验时重新计算树哈希，不信任 DB 单字段。
- 失败 / 超时 / 取消：build 状态为 `FAILED` / `FAILED`（`TIMED_OUT`）/ `CANCELLED`；无 artifact；target 当前版本不变；staging 清理；已写日志保留。进程组停止沿用 `runCommand` 的 TERM→KILL 与身份复核。
- 启动恢复：`recover()` 把残留 `RUNNING` build 标为 `FAILED`（`INTERRUPTED`），不向持久 PID 发信号、不删除未知产物。

## 5. 计划

计划文档（规范化 JSON，作为 `planHash` 的输入）：

```json
{
  "version": 1,
  "targetId": "tgt_…",
  "projectId": "prj_…",
  "artifactId": "art_…",
  "artifactHash": "…64 hex…",
  "artifactVersion": "2026.11.06-1",
  "previousArtifactId": null,
  "previousVersion": null,
  "specHash": "…64 hex…",
  "source": { "branch": "main", "commit": "…", "dirty": false },
  "health": { "path": "/api/health", "port": 4100, "timeoutMs": 30000, "intervalMs": 500 },
  "recovery": {
    "strategy": "restart",
    "maxAttempts": 3,
    "previousArtifactAvailable": false,
    "databaseRollback": "unsupported"
  },
  "impact": {
    "scope": "single-service",
    "firstDeploy": true,
    "restartRequired": true,
    "downtime": "brief",
    "replacesVersion": null,
    "replacesArtifact": null
  },
  "expiresAt": 1790000000000
}
```

- `planHash = SHA-256(canonicalJson(planDocument))`；canonical JSON 对对象键递归排序、数组保持顺序、拒绝非有限数。
- 计划 TTL 30 分钟；读取时过期即置 `EXPIRED`，不可执行。
- `createPlan` 校验：artifact 属于 target/project；target 属于 project；artifact 的 spec 哈希与记录一致；`expectedCurrentArtifactId` 与 target 当前指针一致；同版本同产物视为无变化并拒绝；同版本不同产物被 `UNIQUE(target_id, version)` 拒绝。
- D8：计划显式记录 `databaseRollback:"unsupported"`，只声明是否保留旧产物，不承诺数据库回滚。
- `verifyPlan`：重算 planHash、核对 target/artifact/current 指针、重算 artifact 哈希；任一不符返回失败并标记 `INVALIDATED`。M4-2 授权与 M4-3 apply 前必须调用。

## 6. 错误与安全

新增稳定错误码：

| 码 | HTTP | 用途 |
|---|---|---|
| `DEPLOY_TARGET_INVALID` | 400 | 目标格式/项目不匹配、开发资源冒充正式目标 |
| `DEPLOY_SPEC_INVALID` | 400 | 部署输入 schema / 路径 / 端口 / 限额校验失败 |
| `DEPLOY_BUILD_FAILED` | 422 | 真实构建失败、超时、输出无效；不伪报 artifact |
| `DEPLOY_ARTIFACT_INVALID` | 409 | 产物缺失、越界、哈希不符、不可信 |
| `DEPLOY_PLAN_INVALID` | 409 | 计划内容/哈希/绑定不一致 |
| `DEPLOY_PLAN_EXPIRED` | 410 | 计划过期 |
| `DEPLOY_CONFLICT` | 409 | 版本/目标/请求键冲突、并发构建 |
| `DEPLOY_UNAVAILABLE` | 503 | 数据目录/产物根不可用 |

- 所有输入 Zod strict；错误不返回主机绝对路径、命令环境或秘密。
- 构建环境不继承 `LARNESS_*` / API Key / Cookie；输出脱敏；日志/DB/计划不含秘密。
- 不宣称沙箱：构建执行项目代码，仍受当前 OS 用户权限限制；M4-1 只做时间、输出、路径与进程树边界。
- 产物、日志、PM2 运行数据均在源码目录外；本任务不写用户项目以外的源码。
- 不加未鉴权接口；M4-1 不新增 HTTP/WS 路由，后续路由必须沿用既有鉴权/CSRF/Origin 守卫。

## 7. 测试计划（先失败）

1. `0011` 迁移：空库与 v10 升级、表/索引/约束、旧数据保留、`foreign_key_check`、schemaVersion=11。
2. 输入校验：开发服务 ID / PTY / endpoint 冒充目标、跨项目 target/artifact、绝对路径 / `..` / 符号链接输出、根目录输出、保留端口、非法健康路径/版本/名称、未知字段。
3. 真实构建：成功产物内容/哈希/权限/来源/日志；同 requestKey 幂等不二次 spawn；失败/超时/取消无 artifact 且 target 不变；输出符号链接/超限拒绝；环境秘密不继承、日志脱敏；并发项目锁拒绝。
4. 计划：确定性哈希、绑定旧/新版本与影响、TTL 过期、无变化/版本冲突、artifact 篡改、planJson 篡改、D8 限制。
5. 恢复：残留 RUNNING build 标 FAILED/INTERRUPTED，不产生 artifact。
6. `pnpm check`、`pnpm build`；不新增浏览器 UI，未跑浏览器 E2E 需如实记录。

## 8. 验收映射

| 场景 | M4-1 覆盖 | 后续 |
|---|---|---|
| D1 构建失败/取消 | 真实构建失败/超时/取消，无 artifact，target 不变 | — |
| D2 首次部署有效产物/计划 | 真实产物哈希、目标、计划 | PM2 启动 + 健康在 M4-3 |
| D3 v1→v2 | 计划绑定 previous/new version/artifact 与影响 | 真实替换在 M4-3 |
| D8 不可逆迁移/恢复限制 | 计划显式 `databaseRollback:"unsupported"`、旧产物可用性 | 恢复执行在 M4-3 |
| D6/D12 目标边界 | 拒绝开发服务 ID/PTY/监听端点、严格 target schema | 授权在 M4-2、运行在 M4-3 |
