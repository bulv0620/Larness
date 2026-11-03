# 实施计划：M2 开发资源与窗口层

> 2026-11-02 G-Spec-M2 / ADR-029 已批准，按最新 spec 一次一个任务；M2-0 证据见 [poc.md](poc.md)，G-PoC-M2 已于 2026-11-03 确认通过。

2026-11-03 人类在阅读 PoC 交付后明确“开始m2-1”，G-PoC-M2 通过，以下按顺序实施。

## 1. 复用基础与模块边界

| 现有基础 | M2 做法 |
|---|---|
| `packages/resources/src/files/fileService.ts` / `pathGuard.ts` | 保留 M1 按行工具；增加完整文本读写入口，统一路径校验与版本算法，不用截断文本作编辑底稿 |
| Server `modules/locks` / `agent/projectWriteLock.ts` | 复用持久锁表、续租和 fencing，抽出受管资源共同使用的执行协调；实现根目录冲突域，不另起布尔锁 |
| Server `agent/toolExecutor.ts` / `approvalService.ts` | Agent 保留 Turn 审批；新增命令 / Git 工具；人工 Git 由独立资源动作承载 |
| Server `ws/server.ts` / `publisher.ts` | 补资源级授权、持久事件重放、独立输出游标、连接身份和终端输入；M1 Session seq 不变 |
| Web `windowStore` / `WindowLayer` / `WindowTabs` | 先核对 S0 实现与 accepted resource-views 的差异，补 viewKey、布局版本和资源对账，不重做窗口框架 |
| Web FileWindow / TerminalView / DiffView / 右栏 | 替换真实模式数据；Mock 保留在显式 Demo 路径，不进入真实资源验收 |

资源进程适配器放 `packages/resources/src/{commands,terminals,git}`；HTTP / WS 身份、授权、DB repository、审计和业务编排留在 `apps/server`。`packages/shared` 定义 Zod DTO / 输入 / 事件与错误码，不引入 Node 或 React。Web 以 TanStack Query 保存服务器快照，Zustand 只放视图、未保存草稿和回放游标。

## 2. 顺序与门禁

1. 人类审 [review](review.md)：G-Spec-M2 / ADR-029，批准任务拆分、限制与 M2-0 验证范围。
2. **M2-0**：只做阻断性 PoC，先写可失败的验收脚本，真实 node-pty / 发布寻址 / 进程树 / 文件身份 / watcher / 锁丢失与重叠根。形成 poc.md，人类确认 G-PoC-M2。失败按原门禁停止，不安装替代依赖。
3. **M2-1 → M2-1b → M2-2**：文件 API 和锁 / 写意图 / 资源事件底座 → 监听与重放 → Monaco 保存冲突。
4. **M2-3 → M2-3b**：CommandRunner 生命周期 → Agent 工具、预算与取消接线。
5. **M2-4 → M2-4b → M2-4c → M2-4d**：PTY 后端 / 租约 → xterm、双客户端与真实输入 → Agent 项目 dev 终端启动 / 读取 / 停止、用途去重与 Turn 独立生命周期 → AI 输入 / 中断 / 人工接管。
6. **M2-5 → M2-5b**：Git 后端 / 人工动作 / Agent 工具 → 状态、Diff 与审批 UI。
7. **M2-6 → M2-7 → M2-8**：统一资源窗口和恢复 → 跨资源并发故障矩阵 → 整体验收。

始终一次一个任务。M2-7 是集中验收与必要修正，不是此前绕开锁的理由。每项遵循红测试 → 最小实现 → 验收 / check / build → 状态与单任务提交；UI / 安全 / 契约任务进入 review 供人类抽查。

## 3. 关键实现方案

### 文件及监听

M2-0 先验证打开 fd 后校验文件身份、写前 realpath / hash 重验以及同目录临时文件原子替换的可行边界；不能保证的外部写竞态明确记录。M2-1 以 PoC 结论固化流程，不假设 SQLite 与文件系统可以原子提交。持久化 operation 写意图后执行文件写，再事务写版本缓存 / 结果 / 关键事件；崩溃后对账，不自动覆盖用户修改。临时文件只为原子保存、立即清理，不作为 Larness 运行数据保留在项目中。

监听只覆盖已展开目录 / 已打开文件，有界队列、去抖、失败重扫与手动刷新。建议上限：每实例 128 个目录 watcher、每次对账 2000 项，超限明确提示部分监听并保留保存时版本检查。Node 平台递归监听不一律假设可用，使用目录级监听；PoC 记录改名、删除、爆量和 ENOSPC。file_events 提示失效而非复制文件正文。

### 执行协调、取消与恢复

受管写命令和 Git 写共用执行协调器：解析授权根 → 授权 / 审批快照 → 获取根冲突锁 → 持久化操作与启动意图 → spawn → 持久化状态 → 广播。开发 / 交互 PTY 使用同一身份 / 生命周期 / 审计底座，但不长期持源码写锁，此例外已按 ADR-029 批准；不允许普通写任务仅更改用途绕过锁。Agent 已持 Turn 项目锁时以同 executionId 传递有效 handle，不重复获取导致自锁；不能把旧 handle 当永久授权。锁嵌套沿固定顺序，失败撤回部分获取。

文件保存需同一协调器。项目根相同或互为祖先视为冲突；项目移除 / 根变化和新项目登记必须与冲突域计算协调，不能在活跃写期间换锁身份。PoC 确认单实例协调与持久根映射方案后写入 poc.md，不先开放不完整锁语义。

活跃进程管理独立于浏览器；终止分温和信号 / 有限等待 / 强制停止和实际退出确认，平台适配先以实机 macOS 为准。POSIX 进程组不保证约束主动 daemonize / 脱组的任意程序；检测到无法确认清理则资源 INTERRUPTED / 作用域受阻，要求本机排查，不宣称进程树绝对隔离。重启使用存储的实例 / 启动身份对账，不能单凭可复用 PID 误杀；恢复确认不了则失败关闭。

### 输出与秘密

stdout / stderr 必须持续排空；增量聚合、有界环、磁盘轮转与慢消费者背压分层。脱敏器在分块边界保留有限尾部，避免秘密跨块逃逸；测试使用固定假秘密，不读取真实凭据。PTY 保存渲染字节流的脱敏版本；控制字符仅交给 xterm，不作为 HTML。命令摘要 / 日志不保存输入正文或任意环境。

### Git

GitAdapter 使用 executable + args / shell:false；解析 porcelain NUL 格式，文件名可含空格 / 换行，不按空格 split。status 不开启可选写锁；diff 禁 external diff / textconv，测试恶意仓库配置。Git 写命令可能执行 hooks / filters，应按任意主机代码执行处理。Git 工作区已无锁时的快照变化返回冲突，重试需新计划 / 批准。

人工资源动作与 Agent 审批路径最终调用同一 Manager；远端动作执行前原子消费批准并重新核对规范化参数、HEAD / index / refs / 远端摘要。Git push 远端已发生而本地记录失败时标结果不确定，不自动再次推送；人工核对远端后恢复。pull 冲突不自动 stash / merge。

### 客户端

窗口布局 localStorage 加版本校验，旧 Demo resourceId 不当作真实 ID；找不到资源标 unavailable，不自动创建。顶部入口枚举真实资源以便关闭 / 最小化窗口后恢复；主动关闭终端 Tab 请求 terminate 并确认终态后移除，不能靠恢复 Tab 重新启动已终止资源。恢复 Tab / filter / active / geometry，不存完整文件、输出或输入租约。

Monaco 对每个 viewKey 保留独立 model / 脏状态；完整读取、版本比较、Diff 与手工合并；卸载编辑器前处理草稿。租约 owner 与项目写占用用不同提示展示；输入只发当前连接 generation，重连不能自动恢复旧控制权。服务 / Browser 真实入口保持 M3 能力未开放，不显示 mock 假运行。

## 4. 数据、依赖与回滚

- 新增表 / 字段和迁移归属见 [契约 §7](../../docs/contracts/m2-resources.md)；资源事件序号事务分配；已应用迁移不修改。
- M2-0 经批准才声明 node-pty 依赖、记录精确 lockfile 版本、许可证 / 架构 / ABI、external 与伴随资源；不新增 watcher 库或第二套 UI / 状态库。
- 无破坏性迁移、IPC / 认证更改或用户配置自动迁移；无新持久配置键。
- 回滚先排空 / 显式终止新资源，再回退应用代码；新增 DB 表保留，不删源码、数据或会话 workspace。失败审批不能被回滚重用。

## 5. 验证与风险

每任务先证实测试因缺少目标行为而失败，再实现；不为文档草案编造功能测试通过记录。完成一次 check / build 后只在新改动或失败需要时重跑。

最终运行现有命令 `pnpm check` / `pnpm build` / `pnpm test:e2e`；auth / prod 因共享 IPC 定位文件串行；运行 `pnpm test:smoke:init`、`pnpm test:smoke:unified`、`pnpm test:tui:pty`。M2-8 新增独立资源 E2E 与 smoke，必须真实临时文件 / Git / 子进程 / PTY，FakeProvider 只替代模型。临时仓库不放项目源码内，测试完检查进程、端口和目录清理。

| 风险 | 处理 |
|---|---|
| dev 终端与编辑并行，脚本可能写源码 / 生成文件 | 明确其不在源码写作业串行保证范围；逐次审批、监听 / 内容版本；按 ADR-029 的批准边界实施 |
| 子进程脱组、续租失败、PID 复用 | PoC / 身份验证 / 不确认即阻塞，不把 fencing 宣传为 OS 约束 |
| 原生模块 ABI / 路径不兼容 | PoC 验证实际 built 目录和 Node 版本；失败回评审 |
| watcher 丢事件 / 大目录成本 | 有界监听、显式失效 / 重扫、保存时重验 |
| 外部最后瞬间写盘、Git 远端结果不确定 | 记录边界、对账与冲突，不自动覆盖或重试副作用 |
| 草稿丢失、恢复旧 Mock Tab | 关闭脏确认、刷新提示、布局版本与资源核实 |

预估仅用于拆分：实现约 19–30 个工作日，另计人类评审 / 平台环境等待；不是交付承诺。单任务明显超过 2 天或实际超过原估计两倍时依 AGENTS 停止拆分。未决事项 Q-021～Q-025 见 spec / review。

## 6. Agent 项目开发终端（评审修订）

一次性测试 / 构建仍用 CommandRunner；Agent 为前后端各创建一个 mode=dev 的项目 PTY。M2-4 支持 dev 程序参数及 role 去重的持久结构，M2-4b 接来源与本地 Tab；M2-4c 注册 start_project_terminal / read_terminal_output / stop_project_terminal，经过现有审批与工具关联链路。命令正文不靠键盘注入已有 Shell，不申请虚假浏览器租约。

发起浏览器仅在资源持久化后插入 Agent 来源 Tab，不抢焦点；其他客户端列表更新即可。resource ownership 归项目，已交付资源不随创建它的 Turn 结束 / 取消；未交付创建被取消必须停止并清理。前后端能常驻，Agent 可继续改代码；不推断其 ready 或允许预览。服务登记 / 健康检查 / Preview 仍属 M3。

## 7. ADR-030 生命周期接线

Window close / minimize 只改本地 visibility；TerminalTab close 调 terminate mutation，stopping 禁重复副作用，成功后移除本地 Tab，失败保留并重查。资源终态广播使其他客户端停止输入并显示 ended。Browser / File / Diff Tab close 只结束对应内容（文件处理脏状态）。不能把通用 unmount cleanup 连接到 terminate。

M2-2 / M2-3b 补文件结果 target 卡片，M2-4 / 4b 补精确执行身份 / 退出事件与关闭终止，M2-6 移除 services Tab 数据结构并预留独立卡片窗口 filter / selectedServiceId，旧布局迁移不操作资源。M2-4d 补输入 / 中断 / 人机租约交接，技术草案见 m2-resources §10，工具 schema 按 G-Spec-M2 确认的契约实施。服务注册 / 卡片内容 / 预览在 M3，不在 M2 顺手实现。

## M2-1 落地补充

采用既有 resource_locks.root_real_path 持久根映射、resource_operations 保存写意图 / 版本 / fenced token，不建立第二套锁。事务内校验重叠根及登记 / 移除，M1 Turn 与新文件 API 共用锁；独立 workspace 也纳入。保存临时文件名与 operationId 绑定，正常完成立即清理，启动只对该操作且字节匹配的临时文件进行对账，不扫描删除源码。源码落盘与 DB 分离，结果失败保持不确定状态受阻；恢复只查当前字节，不回写旧稿。精确状态与新增字段见 m2-resources §11。监听 / WS / 编辑器按后续任务接线。
