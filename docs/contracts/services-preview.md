# 开发服务、预览与 Agent 结果卡片契约

> 本契约适用于 M3 的终端开发服务和隔离预览。当前实现见 [M3 技术契约](m3-preview.md) 与 [M3 收尾记录](../../specs/040-services-preview/closure.md)。正式服务有独立 [运维与部署契约](deployment.md)，分域规则见 [ADR-048](../adr/ADR-048-service-domain-separation.md)。

## 1. 开发服务的归属与控制者

聊天服务浮窗跟随当前开发范围。临时服务由 Terminal 中实际启动的进程提供，ServiceManager 负责登记、关联日志和撤销预览。源进程退出即退登，关闭终端 Tab 终止该终端关联的开发进程。

ServiceManager 不再提供 NativeProcessAdapter 独立启动临时服务，也不能为已运行终端再 spawn 一份。临时退登仅取消活跃登记 / 预览资格，不删除终端输出、审计、历史事件或源码；独立“停止服务”只终止已核验监听进程树，不关闭 Shell（ADR-045）。一个终端可登记多个 endpoint，每个关联执行身份和 endpoint；源命令退出但交互 Shell 存活时也应退登该命令的服务。

开发 AI 与人工调用同一开发后端。后端按真实 clientSessionId、projectId / workspace scope、Turn / ToolCall（仅 AI）、policySnapshotId / approvalId 执行授权与审计。

## 2. Terminal → 登记 → 预览流程

1. Agent 经终端工具或用户经终端启动 dev；前后端可以是不同 terminalId，各有项目来源。
2. Agent / 用户提交发现的 endpoint 供登记，或受控探测产生候选；**日志中的 URL 只是候选，不自动授权**。后端核对终端归属、该次执行仍活跃、实际监听与可核验的本地目标，不扫描并收养无关主机服务。
3. 事务保存临时服务绑定与注册事件，发布服务卡片；登记不得再启动进程。允许同一绑定重复请求返回同一 serviceId。
4. 目标监听 / 健康检查成功且允许预览后，生成绑定 serviceId 与相对页面路径的预览结果卡片；未 ready 显示 starting / unavailable，不提供虚假可用入口。
5. 点击卡片 → 验证当前认证 / 服务归属 → PreviewRegistry 核对活跃绑定 → 发短期票据 → Browser Tab 加载独立预览来源 → HTTP / WS 转发到 Larness 主机已核验的本地端口。
6. 源进程停止、终端结束、绑定身份不明或监听被其他进程接管，立即禁止新预览并关闭已有代理流；持久化退登 / 状态事件后更新所有客户端。端口后来被占用不能继承原授权；重新启动应重新登记 / 校验，不能仅凭端口号复活旧票据。

源状态不明、DB 写失败、重启恢复尚未完成时失败关闭。终端事件和定期对账共同驱动失效；不能只依赖浏览器在线或只依赖日志正则。进程后代 / endpoint 归属识别的各平台实现及检测延迟须在 M3-0 PoC 明确，不把未知绑定标 ready。

前端页面访问后端 API 仍需项目本身的开发代理 / 相对路径配置，不能承诺注册两个端口就自动解决 CORS / Cookie / API 路由。生产正式访问地址由部署 / 反代配置提供，与管理端内嵌预览地址不同；登记不自动把端口暴露公网。

## 3. 开发服务状态与 DTO

开发服务沿用 M3 的 DTO 和 `serviceId`。字段和精确状态语义见 [M3 技术契约](m3-preview.md)。

- `kind=temporary`：必须有 terminalId、terminalExecutionId、endpointGeneration；不能有可由 ServiceManager 执行的独立启动配置。状态 `REGISTERING / STARTING / RUNNING / UNHEALTHY / UNREGISTERED / UNKNOWN`；未验证不能 RUNNING。退登后不在活跃卡片列表，详情可显示 ended。
- endpoint 由后端核验和归一化，不接受任意 upstream 或正式运维目标。
- 临时日志引用终端执行输出和游标。临时服务进程未知即预览不可用，已核验监听不等于业务 HTTP 健康。

## 4. 开发 REST 与 Agent 工具

所有接口沿用已认证 Cookie、Origin / CSRF、资源授权、Zod、稳定错误码、限流、幂等与审计；来源 sessionId 只展示不授权。变更使用 Idempotency-Key，同键不同参数 CONFLICT。

| 方法 / 路径 | 用途 / 输入 |
|---|---|
| GET `/api/services?projectId=&kind=&status=&cursor=&limit=` | 开发服务分页，`kind` 仅为 `temporary`。默认 50、最大 200 |
| GET `/api/services/:id` | 详情、进程来源 / 状态、可用操作；不返回凭据 |
| POST `/api/services` | `{ kind: "temporary", terminalId, name, endpoint }`。后端产生执行身份，人工准备动作经批准/执行后登记，Agent 沿 Turn 授权调用共同核心 |
| GET `/api/services/:id/logs?cursor=&limit=` | 受控读取关联日志，明确游标过期 / 截断；不接受文件路径 |
| DELETE `/api/services/:id` / POST `/api/services/:id/stop` | 分别退登和停止已核验的开发进程。停止保留 Shell，见 ADR-045 |
| POST `/api/previews/resolve` | 浏览器点击后用已授权的开发服务 ID 和相对路径领取短期票据，模型只返回结构化目标。见 m3-preview |

开发 Agent 工具为 `register_temporary_service`、`list_services` 和 `resolve_service_preview`。这些工具只处理适用的临时服务。登记字段与实际监听地址的区别见 [M3 技术契约](m3-preview.md#2-管理rest与agent风险)。开发进程的 Agent 控制走现有终端工具，资源退出或对账失败仍会自动退登。

读取为 L0。登记按真实 Turn 策略授权，autonomous 对已授权动作免人工步骤，标准/严格按风险询问，只读拒绝写入。后端核验开发服务归属、参数、锁、幂等与审计。运维 ID 或授权不能用于开发接口与工具。

## 5. 开发事件与存储

- 开发服务 streamId=serviceId。`service.registered`、`service.status`、`service.unregistered` 随业务状态与 seq 同一事务提交后广播，按开发服务作用域补拉。
- 临时源退出后，先将预览内存路由置为拒绝，再提交状态 / 退登事件；DB 故障不能让旧路由继续开放，恢复后对账补齐记录，不伪造事务已提交。
- 临时日志与终端输出共用来源、脱敏与保留策略。
- 现有 `services` 保存开发绑定与历史。活跃绑定核验终端、执行、endpoint 与 generation，终态记录不能让新进程复用旧授权。正式运维记录使用独立仓储。
- Tab、服务卡片顺序、selectedServiceId 不进业务表。

## 6. 文件与预览结果卡片

卡片保存结构化目标，不保存秘密 / 预览票据，不直接执行任意链接。拟议结果载荷：

```ts
type ResourceResultTarget =
  | { kind: "file"; scope: { projectId: string } | { sessionId: string }; path: string; version?: string }
  | { kind: "preview"; serviceId: string; path: string };
```

M2 文件修改工具结果 / 持久化 artifact 事件可附 file target；M3 的 `register_temporary_service` 成功（RUNNING）后附 preview target（含可选服务名），`resolve_service_preview` 也返回 preview target。前端渲染“查看文件 / 打开预览”卡片，点击重新鉴权和解析当前资源，沿 resource-views 去重。版本已变化显示当前状态，不为卡片保存历史文件正文；服务已结束明确不可预览，不自动重启它。兼容已有 artifact 字段，以新增结构化字段接入并同步 shared schema / 测试，不把 markdown 任意 URL 当执行指令。

## M4-R3 服务类型契约

开发预览为项目终端持有的 temporary（svc_），登记只建资源/预览身份，不启动或持久化进程；PM2 持久服务（tgt_ 与完整 pm2Name）通过命令部署和运维，不能直接登记成临时预览。模型每次请求固定注入两类生命周期及本项目真实登记资源摘要，不靠用户重复提示。工具 schema/描述和登记结果标明 temporary，后端实际监听归属与预览项目/身份校验保持。详见 [系统命令上下文](agent-command-context.md#系统固定的服务生命周期契约m4-r3)。
