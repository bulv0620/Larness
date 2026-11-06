# 服务、预览与 Agent 结果卡片契约

> 2026-11-05：产品分工按[ADR-042](../adr/ADR-042-service-deploy-boundary.md)修订，补充ADR-030/040。M3仅temporary开发登记与隔离预览，persistent/PM2/正式发布整体属于M4。下列REST/DTO/DB为分阶段设计草案，G-Spec/PoC未通过，不代表已实现；[部署授权契约](deployment.md)说明自主免人工。

> 本轮技术候选（待审批）详[m3-preview](m3-preview.md)/[ADR-043](../adr/ADR-043-development-preview-authorization.md)：原GET解析改POST、登记executionId改由后端生成；下表已同步候选差异，不是已实现API。

## 1. 两类服务和唯一进程控制者

| 项目 | temporary 临时服务 | persistent 持久服务 |
|---|---|---|
| 实施阶段 | M3：开发服务与隔离预览 | M4：持久运行与版本发布 |
| 来源 | Terminal 中启动的实际前端 / 后端等监听进程 | 构建后交由 PM2 的正式服务 |
| 生命周期控制者 | TerminalManager 与终端中的进程 | PM2Adapter |
| 服务模块职责 | 注册绑定、状态 / 关联日志展示、预览目标登记与撤销 | PM2 启停 / 重启、日志 / 健康 / 对账、配置与部署记录 |
| 界面入口 | 聊天浮栏的服务浮窗，跟随当前开发范围 | 左侧「服务运维」，独立于当前聊天与项目选择 |
| 界面操作 | 看详情、打开所属终端、可用时打开预览 | 看详情 / 日志、按当前策略授权启停 / 重启（自主免人工）、打开可用地址 |
| 退出 | 源进程退出自动退登；关闭终端 Tab 终止该终端全部关联服务 | 显式 PM2 停止，保留服务配置 / 部署记录；删除另走确认流程 |

ServiceManager 不再提供 NativeProcessAdapter 独立启动临时服务，也不能为已运行终端再 spawn 一份。临时退登仅取消活跃登记 / 预览资格，不删除终端输出、审计、历史事件或源码；独立“停止服务”只终止已核验监听进程树，不关闭 Shell（ADR-045）。一个终端可登记多个 endpoint，每个关联执行身份和 endpoint；源命令退出但交互 Shell 存活时也应退登该命令的服务。

AI 与人调用同一后端能力：临时进程通过 Terminal 工具 / UI 控制，持久服务通过服务工具 / PM2Adapter 控制。后端按真实 clientSessionId、projectId / workspace scope、Turn / ToolCall（仅 AI）、policySnapshotId / approvalId 执行授权与审计。不能让“来源是 AI”或“来源是手动”成为跳过策略的理由。

## 2. Terminal → 登记 → 预览流程

1. Agent 经终端工具或用户经终端启动 dev；前后端可以是不同 terminalId，各有项目来源。
2. Agent / 用户提交发现的 endpoint 供登记，或受控探测产生候选；**日志中的 URL 只是候选，不自动授权**。后端核对终端归属、该次执行仍活跃、实际监听与可核验的本地目标，不扫描并收养无关主机服务。
3. 事务保存临时服务绑定与注册事件，发布服务卡片；登记不得再启动进程。允许同一绑定重复请求返回同一 serviceId。
4. 目标监听 / 健康检查成功且允许预览后，生成绑定 serviceId 与相对页面路径的预览结果卡片；未 ready 显示 starting / unavailable，不提供虚假可用入口。
5. 点击卡片 → 验证当前认证 / 服务归属 → PreviewRegistry 核对活跃绑定 → 发短期票据 → Browser Tab 加载独立预览来源 → HTTP / WS 转发到 Larness 主机已核验的本地端口。
6. 源进程停止、终端结束、绑定身份不明或监听被其他进程接管，立即禁止新预览并关闭已有代理流；持久化退登 / 状态事件后更新所有客户端。端口后来被占用不能继承原授权；重新启动应重新登记 / 校验，不能仅凭端口号复活旧票据。

源状态不明、DB 写失败、重启恢复尚未完成时失败关闭。终端事件和定期对账共同驱动失效；不能只依赖浏览器在线或只依赖日志正则。进程后代 / endpoint 归属识别的各平台实现及检测延迟须在 M3-0 PoC 明确，不把未知绑定标 ready。

前端页面访问后端 API 仍需项目本身的开发代理 / 相对路径配置，不能承诺注册两个端口就自动解决 CORS / Cookie / API 路由。生产正式访问地址由部署 / 反代配置提供，与管理端内嵌预览地址不同；登记不自动把端口暴露公网。

## 3. 状态与 DTO 草案

Service 公共字段：`id, projectId?, workspaceSessionId?, sourceSessionId?, name, kind, status, endpoint?, previewEligible, createdAt, updatedAt`。

- `kind=temporary`：必须有 terminalId、terminalExecutionId、endpointGeneration；不能有可由 ServiceManager 执行的独立启动配置。状态 `REGISTERING / STARTING / RUNNING / UNHEALTHY / UNREGISTERED / UNKNOWN`；未验证不能 RUNNING。退登后不在活跃卡片列表，详情可显示 ended。
- `kind=persistent`：runtime 固定 pm2，保存受管 PM2 标识 / 配置引用 / 部署关联；不得信任客户端自报 PID / PM2 ID。状态 `STOPPED / STARTING / RUNNING / UNHEALTHY / STOPPING / FAILED / UNKNOWN`，desiredState 与 observedState 分开。
- endpoint 由后端归一化为已验证的本地 host / port / 协议，不接受任意 upstream；正式 publicUrl 独立字段且不能自动用于预览。
- 临时日志引用终端执行输出和游标，不复制出第二套无限日志；持久日志由 PM2Adapter 受控读取、轮转 / 脱敏。持久 stdout / stderr 默认沿数据契约 14 天 / 100 MiB，细分限额实施前冻结。
- 临时服务进程未知即预览不可用；持久服务数据库记录不能代替 PM2 实际状态。进程存在不等于 HTTP 健康。

## 4. REST 与工具草案

所有接口沿用已认证 Cookie、Origin / CSRF、资源授权、Zod、稳定错误码、限流、幂等与审计；来源 sessionId 只展示不授权。变更使用 Idempotency-Key，同键不同参数 CONFLICT。

| 方法 / 路径 | 用途 / 输入 |
|---|---|
| GET `/api/services?projectId=&kind=&status=&cursor=&limit=` | 活跃临时登记 + 持久服务分页；默认 50、最大 200 |
| GET `/api/services/:id` | 详情、进程来源 / 状态、可用操作；不返回凭据 |
| POST `/api/services` | `{ kind: "temporary", terminalId, name, endpoint }`；后端产生执行身份，人工准备动作经批准/执行后登记，Agent沿Turn授权调用共同核心；不spawn。详m3-preview；持久配置属M4 |
| GET `/api/services/:id/logs?cursor=&limit=` | 受控读取关联日志，明确游标过期 / 截断；不接受文件路径 |
| POST `/api/services/:id/actions` | M4：仅 persistent 的结构化 start / stop / restart，参数/配置快照授权（人工审批仅按策略需要）；temporary 返回 CONFLICT 并提示所属终端入口 |
| POST `/api/preview/resolve` | `{serviceId,path,mode}`；CSRF/no-store，浏览器点击领取短期票据，模型仅结构化目标；详m3-preview，待Q-002 PoC。不接受任意upstream |

当前 Agent 服务工具为 `register_temporary_service` / `list_services` / `resolve_service_preview`。登记字段与实际监听地址的区别见 [M3 技术契约](m3-preview.md#2-管理rest与agent风险)。临时服务没有独立 Agent start/stop/restart 工具。人工 API/UI 提供 DELETE（仅退登）与 stop（终止已核验监听进程树、保留 Shell），见 ADR-045。资源退出或对账失败仍会自动退登。持久服务的启停工具归 M4。

读取L0，登记/PM2/部署等业务动作均按真实策略快照授权：autonomous无人工审批/确认停等，标准/严格按风险询问，只读拒绝写入。部署必须有M4计划/产物完整性和授权记录，但人工批准不是自主模式的前置条件；不得用启停接口偷换产物/config绕过计划。卡片/工具名称不构成授权，不免除鉴权/范围/锁/幂等/审计。

## 5. 事件与存储草案

- 服务 streamId=serviceId；`service.registered` / `service.status` / `service.unregistered` / `service.action.*` 在业务状态与 seq 同一事务提交后广播；resource-events 重放沿 M2 底座。
- 临时源退出后，先将预览内存路由置为拒绝，再提交状态 / 退登事件；DB 故障不能让旧路由继续开放，恢复后对账补齐记录，不伪造事务已提交。
- `service.log` 是有界输出游标流，不冒充关键状态事件。临时日志与 terminal 输出共用来源 / 脱敏 / 保留策略。
- `services` 增加 kind、scope、terminal_id?、terminal_execution_id?、endpoint_generation?、pm2_identity?、config_ref?、desired_state?、observed_state、endpoint_json?、preview_eligible、timestamps；kind 联合约束，temporary 不带 PM2 控制配置，persistent 不带终端进程所有权。
- 活跃临时绑定 `(terminal_id, terminal_execution_id, normalized_endpoint, endpoint_generation)` 唯一；终态记录不能让新进程复用旧授权。PM2 标识绑定 Larness 实例命名空间，不能误操作别的 PM2 应用。
- Tab / 服务卡片顺序 / selectedServiceId 不进业务表；临时绑定迁移由M3-1负责，persistent/PM2与发布记录迁移由M4相关任务负责，每任务最多一份，不修改已应用迁移或清空库。

## 6. 文件与预览结果卡片

卡片保存结构化目标，不保存秘密 / 预览票据，不直接执行任意链接。拟议结果载荷：

```ts
type ResourceResultTarget =
  | { kind: "file"; scope: { projectId: string } | { sessionId: string }; path: string; version?: string }
  | { kind: "preview"; serviceId: string; path: string };
```

M2 文件修改工具结果 / 持久化 artifact 事件可附 file target；M3 的 `register_temporary_service` 成功（RUNNING）后附 preview target（含可选服务名），`resolve_service_preview` 也返回 preview target。前端渲染“查看文件 / 打开预览”卡片，点击重新鉴权和解析当前资源，沿 resource-views 去重。版本已变化显示当前状态，不为卡片保存历史文件正文；服务已结束明确不可预览，不自动重启它。兼容已有 artifact 字段，以新增结构化字段接入并同步 shared schema / 测试，不把 markdown 任意 URL 当执行指令。

## 7. 未决技术事项（不影响已确认产品分工）

M3：Q-002隔离域/票据/反代PoC、Q-026终端执行到endpoint身份与失效时限。M4：Q-003 PM2交付/命名空间、Q-027 TUI退出/升级对正式服务影响。PM2问题不再阻塞M3；M2/G2已验收，终端工具沿用已实现契约，本文件的服务/预览/发布草案不宣称已实现。

## 8. 分阶段交付与授权规则
M3 交付临时服务登记、日志和开发预览，当前项目服务浮窗沿用原归属和入口。M4 交付正式服务与部署闭环，由左侧「服务运维」展示正式服务，发布与日常运维复用同一套 PM2、健康、日志与对账实现。正式地址和隔离预览地址各自定义，查询和动作的 scope 由后端授权。见 [ADR-047](../adr/ADR-047-service-operations-entry.md)。
已授权自主Agent的首次部署/替换/启停/恢复没有额外“生产始终人工批准”或确认弹窗。只有策略要求人工时才产生WAIT_APPROVAL/approvalId；自主记录真实policySnapshotId/计划哈希和策略允许，不伪造人工批准。切回普通策略后新动作按新策略，不改运行中快照。
