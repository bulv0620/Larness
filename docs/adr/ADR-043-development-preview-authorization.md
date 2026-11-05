# ADR-043 开发预览来源、票据与服务执行身份

- 状态：accepted；2026-11-05 人类按[评审包](../../specs/040-services-preview/review.md)推荐批准 G-Spec-M3，仅授权先做 M3-0。第 5 条“拒绝 0.0.0.0/:: 通配监听”已由 [ADR-044](ADR-044-preview-binding-simplification.md) 修订；身份/票据/隔离条款继续有效。远程独立注册域 HTTPS 实测延后至后续上线实验，本 ADR 的远程条款仍是设计约束，但未获实测验证，不得宣称已支持。
- 关联：[040评审包](../../specs/040-services-preview/review.md)、[技术候选契约](../contracts/m3-preview.md)、ADR-030/038/040/042。

## 背景
M2已有真实PTY、Shell保留、输入租约和进程清理；没有服务登记/预览授权实现。terminal.status=RUNNING只说明PTY存活；输入租约generation不是命令执行身份。现有进程birth来自ps文本，不是不可伪造内核句柄。M3不能用日志URL、PID、端口可连接或Shell存活推断服务属于该终端。

管理Cookie当前host-only但不按端口隔离；只换端口不足以隔离项目代码。公网跨站iframe的Cookie可受浏览器限制，不能假定SameSite=None即可工作。Vite可能在HMR失败时直连开发端口，不能把这种回退当代理成功。

## 拟议决策

> 2026-11-05 批准为 accepted；下列 1–9 条为约束，精确字段/时限/JA3 适配由 M3-0 PoC 冻结。第 1 条远程部分与第 3 条跨站 Cookie 实测延后至上线实验，标未验证。

1. 每次预览使用独立host，绑定serviceId/endpointGeneration/访问grant；本机候选`<opaque>.preview.localhost`，只供Larness主机上的浏览器。远程内嵌要求独立注册域、通配DNS/TLS及明确反代配置；不内置公网隧道，不让远程浏览器访问它自己的localhost。未知Host在路由分派前拒绝，预览Host绝不挂载管理API/静态管理页。
2. 已鉴权管理端POST解析后领取30秒一次性bootstrap票据；受控bootstrap消费票据，换只读当前服务的短期预览访问grant（最长15分钟且不超过管理会话），再导航项目路径。票据不进查询串、日志、模型/事件或持久布局；消费页不加载项目内容，响应no-store/no-referrer，票据不透传上游。不能把随机host当凭据。
3. Cookie方案为PoC候选：预览独立host-only/HttpOnly Cookie，HTTPS使用Secure；跨站iframe验证SameSite=None/Partitioned，外部顶层打开使用独立bootstrap/grant。预览访问Cookie永不透传上游；应用自身Cookie单独限域处理。浏览器阻止内嵌时可提供隔离来源外部打开，不要求关闭浏览器保护，不退化同源iframe。仅本机HTTP的兼容性必须实测；未证实的组合不声称支持。M3正式实现前在G-PoC冻结精确交换/Cookie协议。
4. 服务登记仅接受terminalId、固定loopback地址族、端口和展示名；后端核验活跃终端launch身份、可证明的服务进程/后代、进程出生身份、实际监听及独占归属，生成terminalExecutionId与endpointGeneration。客户端不得声明executionId/PID/策略/上游URL。新进程/新监听一律重新登记，Ctrl+C不代表关闭PTY；租约移交不失效仍存活服务。
5. 先核对精确目标的监听，不扫描/收养主机端口。不接受0.0.0.0/::通配监听、管理/IPC/预览监听或不明归属；不能把连接目标改写成127.0.0.1来掩盖原本对外监听。不改源码/重启用户进程来自动修复。初始Agent命令、同一Shell后续人工/AI命令均须验证；不支持的daemonize/重父化/共享监听失败关闭。
6. 失效先拒绝路由并关闭已建立HTTP/WS/流，再写事件；每次新上游连接前后重验绑定、不跨generation复用连接，最多1秒对账、距上次成功核验超过2秒则拒绝。检测到退出立即失效；正常负载实测退出至拒绝及旧流断开≤2秒，超过不得通过。定时器不提供硬实时保证，停顿后恢复先核验。只读状态失败不杀终端或服务。
7. PID+启动时间/前后两次监听快照仍存在外部进程在connect之间替换端口的竞态；PoC必须展示测得的拒绝能力和不可消除窗口，不宣称绝对无竞态。若平台无法形成足够身份证据或测试出现串绑，则关闭该平台/模式并回评审；不得为通过测试降级成“端口存在即授权”。若需新增原生/代理依赖，先另行批准，不在本提案授权安装。
8. 预览固定目标、有限方法/请求/连接预算、逐跳头/凭据过滤、响应Cookie限域、重定向不跟随到新上游、管理API拒绝跨站读写及WS。项目登录Cookie和项目CSP保留安全边界，不通用删除安全头、不注入绕过浏览器认证的脚本。最小iframe权限为scripts/forms/same-origin（不同host），无顶层导航/弹窗/下载/摄像头等默认许可；不称OS沙箱。
9. register为L2；查询/关联日志/领取当前已登记服务的预览凭据为L0，POST领取仍要求CSRF。standard/strict登记需真实审批；readonly拒绝登记但可查看已获授权登记；autonomous直接策略授权，无人工审批/确认。保留资源范围/预算/锁/幂等/审计，不接受客户端自报autonomous。UI点击不绕过资源动作授权。

## 备选与影响
- 同host不同端口：Cookie不隔离，拒绝。
- 管理站点同源路径代理：项目可触达管理来源，拒绝。
- URL永久token/随机host即授权：泄漏/撤销边界不足，拒绝。
- 全主机扫描或仅日志自动登记：归属不可信，拒绝。
- 先仅本机支持、远程只登记：可安全降级但不能声称公网内嵌已交付；如关键PoC失败，必须人类批准缩小范围。

补充ADR-011地址栏语义：输入localhost端口只能匹配已核验登记，绝不创建任意代理；补充ADR-030/038该次服务执行身份定义，不改变终端控制生命周期。拟改REST解析为POST、新增临时服务表和配置字段均仅草案，详技术契约；M4/PM2无改动。

## 验证、迁移与回退
批准G-Spec仅允许M3-0隔离真实PoC；G-PoC-M3确认后才能M3-1。先验证域名/浏览器Cookie、真实HTTP+WS/HMR及进程监听归属/端口复用；缺证据不填通过。实现时每任务独立迁移，旧终端不重建、不清空DB；管理端重启所有临时服务先失效。回退关闭预览路由与grant，保留终端/源码/历史，不杀无关进程。

## 一手依据
- [RFC6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)：Cookie不按端口隔离。
- [RFC6761 §6.3](https://www.rfc-editor.org/rfc/rfc6761#section-6.3)：localhost名称的loopback特殊处理；不能代替目标浏览器实测。
- [CHIPS官方说明](https://privacysandbox.google.com/cookies/chips)：分区Cookie受顶层站点分区，Secure等属性与浏览器支持需验证。
- [Vite6 server.hmr](https://v6.vite.dev/config/server-options#server-hmr)：反代需代理WS，失败可直连回退；验收须断言网络未绕过网关。
