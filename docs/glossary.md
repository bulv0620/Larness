# 术语表

| 术语 | 英文 | 含义 |
|---|---|---|
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
| 窗口层 | Window Layer | 悬浮窗口容器，管理拖动、缩放、层级、最大化、隐藏 |
| 租约 | Lease | 终端交互输入等短时独占权，带过期与接管 |
| 栅栏令牌 | Fencing Token | 锁的单调递增标识，防止过期持有者继续写入 |
| 原生进程 | Native Process | 由 child_process / PTY 直接管理的开发服务 |
| 托管服务 | Managed Service | 由 PM2 管理的长期运行服务 |
| 预览来源 | Preview Origin | 加载项目页面的隔离来源，不得共享管理站 Cookie |
| 预览票据 | Preview Ticket | 绑定服务与会话的短期访问凭证 |
| 配对码 | Pairing Code | TUI 展示的一次性高熵码，用于兑换会话 |
| 设备凭据 | Device Credential | “始终允许”后签发的长期凭据，仅用于换取短期会话 |
| 失败关闭 | Fail Closed | 状态不确定时拒绝，而不是放行 |
| Spec | Spec | `specs/<slice>/spec.md`，描述做什么与验收 |
| Slice | Slice | 一个可独立验收的功能切片 / 里程碑包 |
| 门禁 | Gate | 里程碑或任务的强制验收检查点 |
