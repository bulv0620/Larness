# M3 技术契约候选

> 候选，2026-11-05；M3-1 已按 §1–§3 落地 temporary 服务表、登记 resource-action、`/api/services` 读接口、Agent 工具与 `service.*` 事件；预览路由/票据（§4）仍待 M3-3。配套[ADR-043](../adr/ADR-043-development-preview-authorization.md)（已 accepted）与[评审包](../../specs/040-services-preview/review.md)。G-Spec-M3 已于 2026-11-05 批准方案与 PoC 边界；字段/时限仍是候选，由 M3-0 与 G-PoC 冻结。远程独立注册域 HTTPS 实测延后至上线实验，远程分项标未验证。尚无 API/schema/配置实现；与服务总契约的冲突以本候选明确列出的变更为评审对象，不把旧草案当已实现接口。

## 1. 执行身份与登记
- terminalId标识PTY资源；后端已有launchId标识该次PTY启动；新terminalExecutionId标识此次已验证的服务进程树/监听实例。它不是TerminalLease.generation、TurnId、terminalId或仅PID。
- 登记先确认已授权scope与terminal一致，再核对terminal launch、监听owner及birth、终端后代关系/服务工作负载边界、指定端口独占监听（不限制绑定地址，允许通配）。执行身份和endpointGeneration只由后端产生；原有ps文本不能当强身份已证实。M3-0验证现有OS工具/接口是否足够，不新增原生库。
- 手动/AI在同一个保留Shell里重新启动后可重新登记；不得因为原PTY还RUNNING就沿用旧execution/grant。同一存活执行/端点幂等返回同一serviceId；不同请求名不悄悄重命名已有服务，冲突返回CONFLICT。多个endpoint可关联同一执行，分别授权generation。
- 登记必须明确服务工作负载根及监听owner；绑定的源执行结束即退登，即使Shell或孤立子进程还存活也不继承登记。新的服务工作负载须重新核验登记；Shell空闲、端口移交无关进程、归属未知均不可替代。无法证明的重父化/多owner/SO_REUSEPORT拒绝。进程退出可证明时立即撤销；未知标UNKNOWN、撤路由、保留终端，不发信号“修复”。
- 日志URL仅候选；无全主机扫描或后台自动收养。人工在服务空态通过“登记服务”选择当前项目终端/loopback端口，Agent调用同一登记能力。0.0.0.0/:: 监听按 ADR-044 允许登记，预览经 127.0.0.1 拨号；访问失败显示不可用，不自动改绑定。

## 2. 管理REST与Agent风险
所有管理接口要求现有会话、scope与限流；POST还要求Origin/CSRF，变更沿用操作幂等/锁/审计。请求采用strict Zod，拒绝多余授权字段；名称1–80字符、端口1–65535、host仅127.0.0.1或::1，协议本阶段固定http（WS复用同一监听），无任意URL/文件路径/客户端PID。

| 方法/路径 | 输入/结果候选 | 风险/语义 |
|---|---|---|
| GET /api/services | projectId必填；kind仅temporary，status可选；opaque cursor；limit默认50/最大200 | L0，仅当前授权项目；prj_default归一已有精确scope |
| GET /api/services/:id | 脱敏Service DTO、来源终端与可用操作 | L0，终态可查、无凭据 |
| POST /api/services | `{kind:"temporary",terminalId,name,endpoint:{host,port,protocol:"http"}}`；executionId不由客户端填 | L2；仅登记不spawn；沿用既有资源动作prepare/审批/execute模式，拒绝参数替换；自主直接授权 |
| GET /api/services/:id/logs | cursor、limit沿现有terminal输出字节/游标上限；返回terminalId、nextCursor、truncated/gap、脱敏chunk | L0；关联终端混合输出，非精确每命令日志；不复制第二份无限存储 |
| POST /api/preview/resolve | `{serviceId,path:"/",mode:"embedded"\|"external"}`，path仅规范化同服务相对pathname/query，无scheme/host/反斜杠/编码逃逸 | L0读授权下领取短期bootstrap；必须CSRF、no-store、受限重试；回复隔离origin/受控入口/票据/expiry，浏览器内存暂存 |

候选工具：register_temporary_service=L2；list_services/get_service/read_service_logs/resolve_service_preview=L0。只有登记工具结果可含`{kind:"preview",serviceId,path}`，不附票据；解析工具面向模型仅返回可打开的结构化目标与状态，实际凭据仅在点击时发给浏览器。解析不替用户启动浏览器或运行项目进程。standard/strict登记走真实审批；readonly登记deny、读已登记服务allow；autonomous所有合法动作allow、不造approvalId。人工动作继承现有资源动作显式授权机制，不伪造Turn或信任请求自报策略。

人工POST登记的响应为资源动作（PREPARED/WAIT_APPROVAL及actionId），通过现有`/api/resource-actions/:id`查询、`/decision`决定及`/execute`执行；execute成功才返回serviceId。M2目前这些路由实际绑定GitManager，实现M3时须按resource kind分派，不能只改前端假装通用。Agent走现有Turn工具审批后调用同一登记核心，不再制造第二次人工审批。自主只针对已授权Agent，人工动作不会从其他会话借用自主策略；后端operation_id/请求快照/审批/fencing及事务保证沿用，具体resource_actions kind扩展在M3-1同迁移完成。

返回稳定错误：现有UNAUTHENTICATED/ORIGIN_INVALID/CSRF_INVALID/VALIDATION_ERROR/NOT_FOUND/RESOURCE_UNAVAILABLE/RESOURCE_LOCKED/CONFLICT/APPROVAL_INVALID与PREVIEW_TARGET_INVALID；拟新增PREVIEW_UNAVAILABLE（来源/服务/会话不可用）、PREVIEW_DISABLED（网关未启用）、PREVIEW_GRANT_INVALID（票据/访问grant无效），细节不泄漏PID/秘密。未知身份或会话撤销不得200伪报成功。重复票据消费拒绝；禁止通过GET签发长期访问权限。

## 3. Service DTO、存储与事件
候选DTO：`id, projectId, sourceSessionId?, name, kind:"temporary", status, terminalId, terminalExecutionId, endpointGeneration, endpoint:{host,port,protocol}, previewEligible, reasonCode?, createdAt, updatedAt, endedAt?`。原始进程身份快照仅服务端保存。RUNNING表示身份/监听已核验，不等于业务HTTP健康；404/登录跳转/业务报错不因此伪报进程退出。

状态：REGISTERING→STARTING→RUNNING；未知→UNKNOWN并即时撤预览；源退出/主动终止→UNREGISTERED，终态不得复活。UNHEALTHY仅有独立健康证据才用，不以HTML文案/日志猜测。失效历史不在活跃列表，旧卡片显示“服务已结束/暂不可用”，不自动重启；重新登记发新身份。

M3-1一份新增services迁移，包含上述temporary字段、scope引用、source identity证据json与timestamps；同迁移同步必要resource_actions kind扩展，不含PM2/config/desiredState；执行/端点活跃唯一性与幂等操作共同约束。内部generation使用随机UUID/现有前缀约定，不能由外部指定。终端输入租约表无需变更。临时日志仍引用现有terminal存储，时间/输出不保证按Shell每条命令精确切片，UI明确“关联终端输出”。

`service.registered/status/unregistered`使用现有resource_events事务seq/补拉；状态payload含kind/status/terminalId/terminalExecutionId/endpointGeneration/reasonCode?，无秘密/原始进程信息。日志只携游标引用，不重复声称关键状态持久化。状态已持久化方可广播；DB失败先禁内存代理，再恢复对账，不发送伪成功。重启临时路由/grant全部失效，记录标UNKNOWN/UNREGISTERED，不重建PTY或自动重新登记。

## 4. 预览授权与转发
1. 管理端POST resolve核验会话/项目/活跃绑定，生成crypto随机一次性票据（256bit、服务端仅hash、TTL30秒），绑定clientSessionId/serviceId/generation/预览host/入口path与使用上下文（iframe或外部）。多次点击可发不同票据，消费原子一次；过期重新解析无需新人工确认。
2. 浏览器向独立来源受控bootstrap通过POST body消费，不把票据放URL/query/referrer；受控页面不运行项目脚本。验证确切管理Origin/登记目标/票据未用，再换opaque grant与重定向到已校验相对路径；消费失败不转发项目。嵌入与外部不能假设共享分区Cookie，分别bootstrap。
3. grant最多15分钟且不超管理会话，host-only/HttpOnly，HTTPS Secure；内嵌跨站的SameSite/Partitioned实测冻结。管理会话登出/撤销/过期、服务失效、应用重启均撤grant和既有流。管理端仅可在其会话有效时续领，项目页不能自行获得管理票据。
4. 每个grant独立随机host，host路由不是认证；请求需有效grant与活跃generation。Cookie鉴权只消费预览Cookie，绝不接受管理Cookie代替。明确验证Host/SNI/可信反代、WS Origin与grant，禁止通配管理CORS/危险postMessage。iframe `allow-scripts allow-forms allow-same-origin`且确实跨来源，其他权限默认关闭；外部窗口noopener/noreferrer。
5. 固定dial已核验的数值本地地址/端口（回环/通配用127.0.0.1，具体本机地址用该地址），不DNS解析上游，不跟随302/307到其他源。仅允许同预览origin相对/可验证同上游的Location映射；其他导航给明确不可用/外部链接，不代理新目标。拒绝CONNECT/TRACE；HTTP常规方法仅转当前已授权项目服务，body不写日志。strip hop-by-hop、管理认证/CSRF/转发身份头及预览grant，Host按核验上游重建，X-Forwarded-*由网关重建；项目Cookie限当前预览host，不允许Domain扩大，保留项目应用登录且拒绝覆盖网关保留Cookie名。保留并组合项目CSP/X-Frame-Options；无法嵌入则外部打开，不通用删头。浏览器脚本仍可发外网请求，绝不宣称浏览器或OS网络沙箱。
6. 每次建立上游连接前后重验监听owner/birth/launch/generation，成功前不发项目请求；禁用跨generation连接复用，失效销毁现有HTTP/WS。最多1秒对账、核验证据最大2秒陈旧，核验超时/异常直接拒绝。PoC必须记录connect竞态残余，不声称纯端口代理原子绑定进程；若串绑或身份不足返回评审，不降低授权标准。

候选资源预算（M3-0需实测，变化须更新候选/评审）：每client每service最多32个活动HTTP和8个WS，全实例最多256个上游连接；connect/身份探测2秒、普通HTTP首响应头10秒、空闲60秒；非流式请求/响应各16MiB，SSE/WS按64KiB单帧或chunk、1MiB排队上限与背压处理，WS最长grant剩余寿命；取消/超限断开并稳定反馈。不得为支持Vite关闭身份/授权/预算；上传、大资源/特殊流式兼容性按实测披露。

## 5. 配置候选与支持矩阵
现有`preview.enabled=false`默认不变。拟新增可选`preview.mode:"local"|"remote"`（默认local）、`preview.listenHost`（仅loopback，默认127.0.0.1）、`preview.port`（默认3211，可改、端口冲突报不可用，禁止静默抢占）、`preview.baseDomain`（local固定preview.localhost；remote必填独立注册域）、`preview.publicOrigin`（remote为baseDomain的HTTPS基础origin，用于导出各grant子域的scheme/port，local由已核验host/port推导）；remote公网入口由外部DNS/TLS/反代显式配置。字段仅候选、旧配置兼容迁移不在本次执行。remote模式与管理端共享注册域、未知域、IP/publicOrigin含path/userinfo/query、反代未配置均拒绝启用。

| 场景 | 推荐行为/验收 |
|---|---|
| 管理端localhost、本机浏览器 | 独立*.preview.localhost监听；解析/HTTP Cookie/iframe必须Chromium实测，不假定浏览器行为 |
| 管理端HTTPS、远程浏览器 | 独立注册域与通配TLS/反代；项目端口仍loopback，只网关被反代 |
| 通过局域网IP管理、无预览域 | 登记/日志仍可用；禁远程内嵌，提示配置独立HTTPS来源；不能给远程用户localhost链接冒充可访问 |
| 跨站Cookie受限/项目拒绝iframe | 提供同等鉴权的隔离来源外部打开；不降级同源iframe或关浏览器保护 |
| 其他浏览器/OS或无法证明进程身份 | 未验证标不支持/不可用，不由macOS/Chromium结果外推 |

## 6. PoC和实现门禁
PoC仅临时测试数据/真实PTY/loopback服务/专用测试来源，不能使用源码目录放Larness数据，不能改实际配置、真实配对或暴露已有项目。先失败测试，记录OS/Node/浏览器版本、命令和延迟分布；关闭全部测试资源后复核残留。

P1：两个终端、同PTY Ctrl+C/再启动/Agent重新输入/人工接管；同时验证租约generation不当执行身份。P2：短命父进程、子服务、端口复用/PID身份变化/重复监听/探测失败，旧grant和旧流失效。P3：独立来源/管理Cookie/应用Cookie/CSRF/CORS/Host/票据重放/泄漏/会话撤销。P4：真实Vite6 HTTP/WS/HMR和前端相对API代理后端，浏览器网络确认无直连端口回退；不能用Mock网络替代。P5：DB故障/重启/慢消费者/超限、两认证客户端隔离grant、普通/只读/自主策略。

G-Spec-M3 已于 2026-11-05 按推荐批准，仅先启动 M3-0；G-PoC 依据 poc.md 确认精确身份适配器、Cookie 交换/支持矩阵、限额/时限与残余风险后才可 M3-1。远程独立注册域 HTTPS 实测延后至后续上线实验，本次 PoC 只验本机 `*.preview.localhost` 并把远程标未验证；不以本机两个端口冒充已验证独立注册域。方案变化/新依赖/关键失败回评审，不暗中缩水。
