# 术语表

| 术语 | 英文 | 含义 |
|---|---|---|
| Larness | Larness | 本项目 / 产品名；内部命名空间统一为 `larness` |
| 工作空间 | Workspace | 唯一的业务数据集合：项目、会话、终端、服务、Git、审计 |
| 客户端 | Client | 完成配对的浏览器实例；不是业务用户 |
| 操作者 | Operator | 能访问本机 TUI / IPC 的 OS 账户使用者 |
| 执行身份 | Execution Identity | 运行 PTY、构建、PM2 的实际 OS 账户 |
| 项目 | Project | 用户登记的本机目录及其元数据；删除关联不删源码 |
| 会话 | Session | 一段对话及其 Turn、事件、工作目录；可属于项目或独立 |
| 轮次 | Turn | 一次用户请求触发的完整 Agent 执行 |
| 事件 | Event | 持久化的状态变化记录，带 `seq`，用于重放 |
| 工具调用 | Tool Call | Agent 请求执行的结构化动作（读文件、跑命令等） |
| 审批 | Approval | 对 L2 / L3 能力的人工授权，绑定参数、范围、有效期 |
| 资源 | Resource | 后端拥有的对象：Terminal、Service、Turn、Deployment |
| 视图 | View | 客户端窗口 / Tab；关闭视图不终止资源 |
| Tab 归属 | Tab Origin | Tab 记录的资源所属项目与来源，用于分组/筛选，不用于授权 |
| 项目筛选 | Project Filter | 窗口内的 全部 / 指定项目 / 全局 视图筛选；只隐藏 Tab，不停止资源 |
| 视图键 | viewKey | 去重键：terminal ID、service ID、file realpath、browser service+URL、diff project+path |
| 窗口层 | Window Layer | 悬浮窗口容器，管理拖动、缩放、层级、最大化、隐藏 |
| 租约 | Lease | 终端交互输入等短时独占权，带过期与接管 |
| 栅栏令牌 | Fencing Token | 锁的单调递增标识，防止过期持有者继续写入 |
| 原生进程 | Native Process | 由 child_process / PTY 直接管理的开发服务 |
| 托管服务 | Managed Service | 由 PM2 管理的长期运行服务 |
| 预览来源 | Preview Origin | 加载项目页面的隔离来源，不得共享管理站 Cookie |
| 预览票据 | Preview Ticket | 绑定服务与会话的短期访问凭证 |
| 配对码 | Pairing Code | TUI 展示的一次性高熵码，用于兑换会话 / enrollment |
| 可信凭据 | Trusted Credential | “始终允许”后注册的 Passkey；证明持有私钥，不是长期 Token |
| Passkey | Passkey | 基于 WebAuthn 的无密码凭据；私钥在认证器 / 密码管理器，服务端只存公钥 |
| WebAuthn | WebAuthn / FIDO2 | 浏览器与认证器之间的公钥认证协议 |
| RP ID | Relying Party ID | Passkey 绑定的域名；V1 等于 canonical origin 的 hostname，IP 不可用 |
| Canonical Origin | Canonical Origin | 工作空间唯一允许的浏览器来源，如 `http://localhost:3210` 或 HTTPS 域名 |
| 可发现凭据 | Discoverable Credential | 认证器可自行选择、无需用户名先行的 Passkey（resident key） |
| Enrollment | Enrollment | `始终允许` 配对码兑换后的 5 分钟注册窗口，用于创建 Passkey |
| 认证器 | Authenticator | 生成 / 保存 Passkey 私钥的平台组件或硬件密钥 |
| 远程证明 | Attestation | 认证器对自身型号的证明；V1 使用 `none`，不做设备白名单 |
| 可同步标志 | Backup Eligible / State | Passkey 是否可被密码管理器同步；不等于物理设备绑定 |
| 失败关闭 | Fail Closed | 状态不确定时拒绝，而不是放行 |
| Spec | Spec | `specs/<slice>/spec.md`，描述做什么与验收 |
| Slice | Slice | 一个可独立验收的功能切片 / 里程碑包 |
| 门禁 | Gate | 里程碑或任务的强制验收检查点 |
