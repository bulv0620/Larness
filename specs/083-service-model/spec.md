---
id: 083-service-model
status: ready
depends_on: [051-agent-tool-contract, 082-agent-kernel, 030-dev-resources, 040-services-preview]
owners: []
created: 2026-11-18
updated: 2026-11-18
---

# 项目开发服务与全局 PM2 运维分离

> 状态：`ready`（2026-11-18 人类明确确认方向）。本切片修正 082 中 Profile、项目服务、预览与 PM2 运维的边界；不改变终端只面向人类、Git 只面向人类的结论。

## 1. 目标

- G-1：`coding` 是完整开发模式，包含文件、搜索、有限命令、后台开发进程与日志/停止；不要求切到 `workspace`。
- G-2：项目服务 = 该项目中由 Agent 启动的后台开发进程（`ProcessManager`），侧栏显示数量，窗口显示名称、状态、端口、PID、日志与停止。
- G-3：删除“登记服务”功能和 Agent 的 `register_temporary_service` / `resolve_service_preview`；旧 `services` 表只保留历史读取。
- G-4：预览按需生成：用户点击运行中任务的“预览”时才校验项目归属、进程存活与端口监听并签发预览票据；不再要求预先登记。
- G-5：`workspace` Profile 改为 `service-ops`（服务运维），管理 Larness 隔离 PM2 实例中的全局服务：列表、日志、启动/停止/重启；不参与项目开发文件操作。
- G-6：PM2 投影不因 `namespace=default` 丢失；按 `larness:<projectId>:<serviceKey>` 名称关联项目，并显示 namespace 偏差。
- G-7：`command.run` 的 `STOP_UNCONFIRMED` 操作在进程确认退出后释放项目写锁，不再永久阻塞后续命令。
- G-8：终端仍然只面向人类；Git UI 仍然独立。

## 2. 非目标

- 不新增远程主机、容器或网络部署。
- 不改变 PM2 正式服务的构建/产物/部署授权模型；只修投影、可见性与运行控制。
- 不实现后台任务的跨 Larness 重启恢复；重启时仍停止临时开发进程。
- 不恢复 Agent 终端控制；终端工具继续不进入模型面。
- 不改变 082 的预算模型。

## 3. 角色与入口

| 入口 | 用途 |
|---|---|
| Chat 上方“服务” | 当前项目的 Agent 后台开发任务 |
| 左侧“服务运维” | Larness 隔离 PM2 的全局服务列表与控制 |
| 项目终端 | 仅人类使用 |
| Git 面板 | 仅人类使用 |

## 4. 验收场景

### A1 coding 启动开发服务

```gherkin
Given 默认 coding 会话
When Agent 调用 start_process 启动 node server.js（port=3000）
Then 项目侧栏服务数量增加
And 项目服务窗口显示该任务、端口 3000、PID、运行状态
And 刷新页面后仍可看到该任务
And 点击“预览”后返回可访问的预览票据
And 点击停止后进程组退出，任务状态变为 STOPPED
```

### A2 删除手动登记

```gherkin
Given 项目服务窗口
When 用户查看空态和详情
Then 没有“登记服务”按钮或登记表单
And Agent 工具面没有 register_temporary_service / resolve_service_preview
And 旧 services 记录不产生新的运行任务
```

### A3 预览按需

```gherkin
Given 一个 RUNNING 且声明 port 的后台任务
When 用户点击预览
Then 后端校验任务属于当前项目、进程存活且端口可连接
And 只为本次请求签发短期票据，不启动或重启任务
And 无 port、已停止或端口未监听时返回稳定错误
```

### A4 service-ops 与 PM2

```gherkin
Given Larness 隔离 PM2_HOME 中有一个 name=larness:<projectId>:<key>、namespace=default 的 online 应用
When 打开左侧服务运维
Then 该应用按项目关联显示，并标注 namespace 偏差
And 可读取日志、启动、停止、重启
And 不会把无关 namespace 的应用静默隐藏
```

### A5 旧命令不再永久锁项目

```gherkin
Given 存在 command.run 的 RECONCILIATION_REQUIRED 操作
And 其记录的进程/进程组已不存在
When 新命令尝试获取项目写锁
Then 该旧操作被确认结束并释放锁
And 新命令可以执行
```

### A6 旧会话与终端

```gherkin
Given 升级前的 workspace 会话
When 打开会话
Then Profile 归一为 service-ops
And 旧计划/终端/Git 事件仍可回放
And 人类终端不被 Agent 接管
```

## 5. 接口与数据变更

- `sessions.agent_profile` 值改为 `coding | plan | service-ops`；迁移 `UPDATE ... SET agent_profile='service-ops' WHERE agent_profile='workspace'`。
- `ProcessManager` 增加 `port`、`healthPath`、`previewEligible`；新增 `list_processes` 工具，`start_process` / `read_process_output` / `stop_process` 进入 `coding`。
- 项目服务窗口改用 `/api/processes?projectId=`；侧栏使用同一查询的计数。
- 预览新增 `processId` 目标；`PreviewRegistry` 支持进程目标，校验运行、项目、端口。
- 移除 `NamedServiceManager`、`/api/process-services`、`start_service/read_service_logs/stop_service`。
- 移除 Agent `register_temporary_service`、`resolve_service_preview`、`list_services`；保留 `/api/services` 只读兼容或删除写入口。
- `service-ops` Profile 工具：`list_service_ops`、`read_service_ops_logs`、`control_service_ops`；只操作 Larness PM2 投影。
- `ServiceOpsServiceDto` 增加 `namespace`；`reconcile` 接受 default namespace 的名称模式匹配，并记录偏差。
- 命令恢复：`rootHasWriter` 不再把已确认死亡的 `command.run` 当作永久屏障；命令恢复路径释放锁。

## 6. 失败与边界

| 条件 | 行为 |
|---|---|
| `start_process` 未给 port | 任务可运行、可看日志，但不可预览 |
| 任务已停止/端口不监听 | 预览返回 `PREVIEW_UNAVAILABLE` |
| PM2 namespace 不是 larness 但名称合法 | 显示服务并标注偏差；控制仍校验 targetId + pm2Name |
| PM2 名称无法解析项目 | 进入未关联列表，不自动猜测 |
| 旧 command 进程仍存活 | 保留锁并提示需要人工确认；不自动放行 |
| 旧 command 进程已死亡 | 确认结束、释放锁并写审计 |
| 无 PM2 | service-ops 显示不可用；项目开发服务仍可用 |

## 7. 测试计划

- 单元：ProcessManager port/预览校验、项目过滤、profile 目录、PM2 名称解析、命令锁恢复。
- 集成：coding 启动真实后台服务 → `/api/processes` 列表 → 预览 resolve → 停止；service-ops 列表包含 default namespace 的 Larness 名称；旧 command 操作释放锁。
- E2E：coding 新建会话启动服务、项目侧栏计数、服务窗口、预览、停止；服务运维弹窗显示 PM2 应用。
- 门禁：`pnpm check`、`pnpm build`、`pnpm test:e2e`、`pnpm test:e2e:prod`。

## 8. 完成定义

- A1–A6 通过；
- 项目服务不再依赖手动登记或 workspace；
- PM2 online 服务在服务运维可见；
- 旧命令不再永久锁项目；
- 契约、架构、STATUS、ROADMAP 同步更新。
