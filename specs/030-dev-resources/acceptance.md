# M2 逐任务验收记录

## M2-1 文件管理与资源持久化底座（2026-11-03）

- 分支：`task/m2-1-file-manager`；本次只实施 M2-1。
- 前置：人类在 PoC 交付后明确“开始m2-1”，M2-0 / G-PoC-M2 通过。
- 状态：自动化与构建验证完成后进入 `review`，供人类抽查；M2-1b 保持 todo。

### 测试先行

先新增 API 测试，首次运行因缺少文件 / 目录路由得到 404，四项均失败。随后实现并补齐真实文件竞争、权限、故障注入与空库 / 升级库验证；没有 mock 文件后端、删测试或放宽验收。

### 已交付

| 场景 | 证据 |
|---|---|
| 完整文本读取 / 保存 | 2500 行、BOM / CRLF、中文、恰好 512 KiB、执行权限保留；原字节 SHA-256 |
| 路径与类型 | 相对根授权；fd / 路径替换、父目录链接、二进制 / 无效 UTF-8 / 超限拒绝；不把截断文本当底稿 |
| 目录 | 单层懒加载，默认忽略、目录优先、快照分页和变更后 cursor 冲突 |
| 鉴权 / 秘密 | 未授权、Origin / CSRF、项目会话伪装独立 workspace、项目移除后访问、dataDir 保护；固定测试凭据不进入响应 / 事件 / 操作 / 缓存 / 审计 |
| 并发 | 两次真实配对的客户端共享文件，输入版本冲突不覆盖；幂等键按实际浏览器会话隔离；Agent / 文件保存共用根冲突锁，父子项目写互斥 |
| 持久性 | 写意图失败不写源码；结果写入失败后保留不确定项、拒绝重叠写；重开 DB 后只核对既有字节、一次补记结果与序号，不重写外部变更 |
| fencing / 临时文件 | 写前与 rename 前检查有效租约；失败保留原内容；wx 名称碰撞保留已有文件，临时文件正常清理，恢复仅处理指定 operationId 且字节匹配的暂存文件 |
| 迁移 | 0005_resources 唯一新迁移；四张资源表及锁根字段，v4 项目 / 锁 / fencing 原样保留并回填根；原迁移不修改 |

对应测试：`test/api/files.test.ts`、`test/api/files-security.test.ts`、`test/resources/file-manager.test.ts`、`test/resources/file-storage.test.ts`；共 15 个新增用例。

### 验证

- `pnpm check`：server 316 / agent 32 / web 26；原有 live 测试 1 项按环境跳过。既有 5 个 optional-chain 警告保留。
- `pnpm build`：Server 四入口及 Web 通过；既有 Node 20 弃用与 Web chunk 体积提示保留。
- LARNESS_E2E_PORT=49503 pnpm test:e2e:prod：2/2 通过，含真实配对 / Passkey 与 M1 Agent 工具审批 / 刷新 / 模型切换 / 取消；默认 3210 被现有进程占用，改用临时空闲端口。
- 当前仅实测 macOS arm64 / Node 20.19.3，不外推其他平台。

### 范围、失败与回滚

- 本任务只交付后端与共享 DTO。文件监听、资源事件通知 / 补拉在 M2-1b；Monaco 编辑 / 草稿冲突交互在 M2-2，故此处不宣称完整 A2 通知及编辑器 UI 已完成。
- 文件与 SQLite 无跨系统原子事务；最后一次校验后的外部写入 / 路径替换窗口仍按已批准 spec / PoC 边界处理，不承诺对任意外部写者的原子 CAS。保留版本冲突、写意图和待对账阻塞，不提供强制覆盖。
- 未确认结果或临时文件身份时保持 RECONCILIATION_REQUIRED，由本机核实；不会自动覆盖源码、删除未知临时内容或仅凭锁 TTL 开放冲突写作业。
- 数据库仅存元数据 / 内容哈希，不存正文。测试文件 / 数据库位于 OS 临时目录并由 fixture 清理；没有迁移或重置用户运行数据。
- 无新增外部库：resources 显式引用仓库已有 shared / Zod。无 IPC / 认证流程 / 持久配置键变化。回滚先排空写操作并处理不确定项，再退程序；保留 0005 新表 / 列和用户源码，不执行破坏性 down migration。


## M2-1b 文件监听与资源事件补拉（2026-11-03）

- 分支：`task/m2-1b-file-watching`；人类在 M2-1 交付后明确“下一步”，前置 M2-1 标 done。本次仅 M2-1b。
- 测试先行：先新增真实 WS / REST 补拉用例，首次因文件订阅不支持、补拉路由 404 失败，再实施 watcher / 持久通知。

### 已交付与证据

| 场景 | 证据 |
|---|---|
| 原生文件变化 | 真实临时目录外部写、改名、删除；事件无正文，序号连续；事件收到时 SQLite 已有对应行 |
| 多客户端生命周期 | 两个 owner 共享一个真实目录句柄，释放其中一个不关其他引用，最后释放归零；WS close 释放订阅 |
| 有界与恢复 | 缩小限额验证部分监听 / 扫描上限；真实 watcher 包装注入原生错误、事件爆量、目录改名重建与重新挂载；恢复后新文件可见 |
| 存储失败 | SQLite trigger 拒绝 resource_events 插入，事务失败无通知 / 无事件行；解除故障后先补持久失效再发变更 |
| 断线与补拉 | 真实配对 / Cookie / WS；在线保存先落库后通知，断线后保存通过 REST 补拉；再次连接要求快照刷新，可读断线期间未监听的外部修改 |
| 保留与缺口 | 31 天前事件过期清理，保留新事件并标缺口；全部过期后 seq 从 2 继续到 3；人工删除记录返回 resyncRequired |
| 权限与凭据 | 未登录 401、未知 scope 拒绝、未来游标 400；非法订阅审计；已知测试凭据作为文件名时仅发 SCAN_FAILED，通知 / 补拉 / 缓存 / 审计无凭据 |
| 慢消费者 | 传输层预算注入 9 MiB bufferedAmount，验证关闭 1008 且不继续发送；持久补拉有真实 WS / SQLite 证据，未将传输桩当作后端实现 |

新增 `test/resources/file-events.test.ts`（3 项）、`file-watcher.test.ts`（6 项）；现有 WS、文件管理 / 恢复、清理、认证和 Agent 回归保留。

### 边界与回滚

- 每实例 128 个原生句柄、每次单层扫描 2000 项、待对账集合 256 项、50ms 合并与 2s 轮转。默认值和降级原因见 [契约 §12](../../docs/contracts/m2-resources.md#12-m2-1b-文件监听与事件恢复2026-11-03)。小限额故障用例不等于实测每种操作系统的句柄资源耗尽。
- 监听是快照失效通知，可能合并中间写入；每次订阅明确 resyncRequired=true，不能声称未监听的外部变化有完整事件历史。读取 / 保存时仍核验真实文件与版本。
- 后端手动刷新复用文件 / 目录 GET；当前无编辑器 UI，按钮 / Query 订阅与冲突交互在 M2-2。仅实测当前 macOS arm64 / Node 20.19.3，未外推其他平台。
- 无新迁移、外部依赖、配置键或 IPC；资源流固定保留 30 天。回退程序时保留既有 0005 表 / 序号，不恢复已过期事件，不执行 down migration；用户运行数据未改，测试数据由临时 fixture 清理。


### M2-1b 最终验证

- `pnpm check`：server 325 / agent 32 / web 26 通过；既有 live 测试 1 项按环境跳过，既有 Biome 5 个警告保留。
- `pnpm build`：Server 四入口 / Web 通过；既有 chunk 体积提示保留。
- `LARNESS_E2E_PORT=51985 pnpm test:e2e:prod`：Chromium 2/2 通过，真实 Passkey / 撤销及 Agent 审批 / 刷新 / 模型切换 / 取消。使用临时空闲端口，未停止用户现有服务。
- 状态 `review`，等待人类验收；M2-2 未开始。M2-1 已由人类“下一步”确认标 done。


## M2-2 Monaco 编辑与冲突恢复（2026-11-03）

- 分支：`task/m2-2-file-editor`；人类“下一步”确认 M2-1b，当前仅实现 M2-2，未启动 M2-3。
- 测试先行：草稿 / realpath 去重用例首次因缺 actions 模块失败；成功 apply_patch 的 file target 断言先因缺字段失败，再实现通过；组件验证新磁盘快照不覆盖草稿，卸载重建后仅明确重载才放弃文本。

### 实现与恢复边界

- 真实模式目录 API 单层懒加载 / 分页与刷新、完整文本 Query / Monaco、真实 PUT 保存；512 KiB 上限与 UTF-8 / 路径 / 版本 / 锁保护仍以后端为准。显式 Demo 保留只读静态数据，不在真实模式显示假内容。
- 文件 Tab 按授权 GET 的 realPath 去重，跨 scope 打开前重新授权；草稿和每文件模型独立。保存只提交草稿 baseVersion；冲突 Diff / 重载 / 手工合并显式选择，失败不清草稿。文件失效保留草稿供复制。
- 文件窗口 close / hide 保留 Tab 与草稿，主动关闭脏 Tab 提供保存并关闭 / 放弃 / 取消，刷新前提示；正文 / 草稿不进入 localStorage。
- 已开文件与已展开目录接入授权订阅和有限补拉，通知只使 Query 失效；重连 / 缺口刷新快照，降级可见且手动刷新仍可用。工具成功修改附 scope / path / version 卡片，点击重新授权读当前文件，不重执行工具。
- 本任务无新迁移、依赖、配置、认证 / IPC 变化；完整资源布局升级与其他资源窗口仍归后续任务。回退程序保留已有 DB / 文件，内存未保存稿在退出前须人工保存或复制。

### 定位记录

依 AGENTS §9.5 在长文件末行浏览器断言连续失败后暂停，经人类明确“继续”恢复。根因为 Playwright Desktop Chrome 的 Windows User-Agent 决定 Monaco 采用 Ctrl 快捷键，宿主 macOS 的 Meta 选择不适用；测试现按浏览器 UA 的相同规则选择按键，保留第 2500 行可见断言。输入使用 Monaco 公开 textarea 模式。

真实 Diff 卸载发现 `TextModel got disposed before DiffEditorWidget model got reset`，保留 pageerror 空数组断言；通过 Monaco 公开 API 管理独立 Diff 模型，先 setModel(null) 再释放编辑器 / 模型修复。未改依赖或过滤异常。测试竞争窗口通过真正写盘后继续 PUT 制造 409，不 mock 后端响应；初版测试 unroute 导致重复处理已修正。多 Tab 测试按实际包含脏标记的按钮名定位，验收语义未降低。

人工抽查：右侧选文件编辑；外部修改后查看差异 / 选择手工合并；关闭文件 Tab 取消或保存；窗口关闭后顶部文件入口恢复；不可编辑文件显示错误。未保存稿只在当前页面内存，刷新前须处理提示。


### M2-2 自动化证据

| 场景 | 证据 |
|---|---|
| 完整编辑 | 真实 2500 行 CRLF 文件，通过浏览器实际按键跳至末行；保存后直接回读磁盘字节 |
| 并发冲突 | PUT 发出时真实外部写入制造 409；磁盘 v2 保留、草稿仍在，Diff 与手工合并后以新版本保存 |
| 草稿与多 Tab | 窗口关闭后顶部恢复；切换另一个真实文件再回来草稿仍在；保存 / 取消 / 放弃均实际验证 |
| BOM 与换行 | BOM + CRLF 文件保存后 UTF-8 字节前缀 / 换行保持；后续放弃草稿不改变已保存文件 |
| 外部变化与失效 | 干净 Tab 自动显示真实外部新内容；删除文件后禁保存，关闭时保存失败仍保留提示 / Tab，随后可放弃 |
| 不支持编辑 | 512 KiB + 1 文件明确拒绝，磁盘长度未变；未保存正文不进入 localStorage，beforeunload 可取消 |
| 文件结果卡片 | 单工具与折叠多工具组的组件用例；真实 Agent 修改后点击打开、隐藏后重复点击只复用一个 Tab，不重执行补丁 |

草稿 / 动作 2 项、冲突组件 1 项、单 / 多工具卡片 2 项；既有 reducer 用例补 file target 断言。真实浏览器 FakeProvider 只替代模型，文件、SQLite、认证与 WS 为真实后端。

最终回归曾发现：Demo 顶部入口误用真实模式 restore 分支，已恢复显式 Mock 的原行为；单工具未走 ToolGroup，已补可见卡片并先红后绿验证。既有 M2-0 原生 watcher PoC 全量检查中一次超时，原用例单独复跑 4/4 通过；未修改 PoC / 超时 / 断言，不将其当新功能证据。

### M2-2 最终验证

- `pnpm check`：server 325 / agent 32 / web 31 通过；既有 live 1 项按环境跳过，既有 Biome 5 个警告保留；最终全量包含原 PoC 通过。
- `pnpm build`：Server 四入口 / Web 通过；既有 chunk 体积提示保留。
- `LARNESS_E2E_PORT=59928 pnpm test:e2e:prod`：真实 Chromium 3/3 通过（配对 / Passkey / 撤销、文件编辑与恢复、Agent 文件卡片与既有主流程）。
- `LARNESS_E2E_WEB_PORT=60041 pnpm test:e2e`：Demo 15/15 通过，含窗口项目筛选、文件只读预览、键盘和窄屏；最终与生产回归串行。
- 临时文件 / 数据库 / 端口均由 fixture 回收；未停止用户服务或改用户数据。仅实测 macOS arm64 / Node 20.19.3，不外推其他平台。
- 状态 `review`，等待人类 UI 验收；M2-3 保持 todo。

## M2-3 命令执行后端（2026-11-03）

- 分支 `task/m2-3-command-runner`；人类“继续”确认 M2-2 review 后，只实现本后端任务。先写真实命令测试确认缺执行模块失败，再实现；最终新增三份测试共 15 项，覆盖本任务 A7 / A17 / A18 / A20 / A21 / A23 的执行底座。Agent 工具审批与实时输出卡片仍属 M2-3b，未宣称这些用户流程已交付。
- `command-runner.test.ts`：真实 Node 非零退出、缺失可执行文件、超时、stdout / stderr 海量输出合计 1 MiB 上限、环境秘密不继承；已知秘密及敏感 JSON / Cookie / Authorization 在跨块、引号 / 转义边界脱敏。正文不进入状态事件或 SQLite。
- `commands.test.ts`：真实文件副作用验证相同 Turn / toolCall 重试只执行一次，参数绑定与跨 Turn 重名独立执行；运行中共同根拒绝文件保存和第二命令，取消前 CSRF 拒绝、重复取消收敛；组长默认 TERM 退出而子进程忽略 TERM 时，经启动快照复核后 KILL 清理，独立进程检查确认两者停止，再允许下一命令。
- 真 SQLite / 第二连接验证事件广播前已提交；注入创建审计失败不产生进程副作用；最终结果提交失败不广播完成并保持根阻塞；输出写失败不伪报成功。自有锁续租失败停止、旧 fencing 不能释放新锁、继承 Turn 锁不会被命令释放；服务器关闭停止活动命令。
- 真服务器启动恢复验证持久 PID 指向无关活进程时不发信号、标记 INTERRUPTED / RECOVERY_UNCONFIRMED 且过期后仍保持屏障。另以主动脱组并继承输出管道的真实子进程确认 STOP_UNCONFIRMED / truncated 与根持续阻塞，测试自行清理该专属子进程；不把超时、管道关闭或 TTL 当作已清理证明。
- 授权 REST 状态 / 输出 / 取消及实际 WebSocket command.status / REST 补拉通过；未来游标拒绝，缺失 / 过期输出提示 resync。真实项目和独立 workspace 范围、路径越界 / 注入 env 拒绝；磁盘 / DB / 审计不含已知测试秘密。假时钟覆盖正文 7 天、安全终态元数据 / 幂等记录 30 天清理，保留 stream 序号，未对账记录不自动删除。
- `command-migration.test.ts`：从已有 0005 数据库迁移到唯一 0006_commands，旧项目 / 锁 / fencing / stream seq 保留，新增命令表为空，外键检查通过。其余契约改动为 command 状态 topic / DTO / 查询端点；无新依赖 / 配置 / 认证 / IPC 协议。回滚需先停机并按数据备份恢复，不降版本直接运行旧程序处理新命令数据。
- 验证中修正空字段数据库更新与临时目录 canonical path；续租测试先结束旧 Turn 后重取锁，避免以仍活跃 Turn 的锁冒充可释放锁。保留原始错误 / 权限 / 并发断言，不跳过失败测试。
- 当前只实测 macOS arm64 / Node 20.19.3。进程启动时间与可执行文件快照是有限身份复核，最后检查到信号之间仍有竞态；原组长退出且无已登记同组成员匹配时保守阻塞。主动脱组并关闭管道无法保证发现或清理，不宣称 OS 沙箱、原子 PID 身份或其他平台可用。
- 最终 `pnpm check` 通过：server 340、agent 32、web 31，原 live 1 项按环境跳过；Biome 既有 5 条 warning。`pnpm build` 通过，既有依赖注释 / bundle 大小警告不影响构建。
- 临时空闲端口 `pnpm test:e2e:prod` 原样复跑 3/3（真实服务端 / SQLite / Chromium，内置 FakeProvider 仅替代模型网络）：认证、真实文件编辑 / 冲突 / 卡片、M1 Turn / 审批 / 重载 / 取消回归。首次 2/3，M1 在项目右键菜单未出现处失败；保留断言、未修改 UI / 测试，第二次全套通过，原因未证实。本任务没有新增命令 UI，新增命令接口通过上述真实 REST / WS / 进程集成测试验收。
- 状态 `review`；M2-3b 未开始，等待人类确认本任务结果。测试数据在专属临时目录，未修改用户运行数据。


## M2-3b Agent 命令工具与实时展示（2026-11-03）

- 分支 `task/m2-3b-agent-commands`；人类“下一步”确认 M2-3 后，按本任务 A6–A8 / A16 / A21 实施。先写真实命令集成测试确认缺 commandTool 模块失败，再写卡片测试确认缺界面模块失败；FakeProvider 仅替代模型网络，进程 / pnpm 项目脚本 / 文件 / SQLite / HTTP / WS 均真实运行。
- 新增 `test/agent/commands.test.ts` 14 项：任意 Node 脚本先审批、审批前无命令行记录 / 文件副作用，非零退出真实落库且脱敏结果返回模型；审批等待取消后审批失效 / 无进程 / 无后续模型步骤；执行中取消与超时清理、确认终态后释放锁；替换已批参数拒绝；短锁 TTL 下持续续租 / 传递同一 Turn 锁、剩余预算缩短命令超时、等待审批也计入预算。
- 同一测试集还验证标准策略下真实 pnpm test 可执行且不建审批；直接特权程序 L3 拒绝，flags / 同名绝对程序路径 / Shell 保守分类 L2，readonly / strict 策略正确；起始客户端在审批后撤销时不启动；含引号的已知凭据在摘要前拒绝；包含大量控制字符的模型结果仍为有效 JSON、受预算限制并标 truncated；持久 tool.command.created 关联失败时无进程副作用。
- 扩展原真实 WS 测试：实际接收 command.output，与已落盘 GET 输出的块游标一致；沿用原授权状态补拉 / 进程清理 / 重启屏障测试，不弱化断言。输出通知先写文件，不进入 SQLite；每次推送重查授权，断线不 cancel。
- Web 新增卡片组件测试 1 项，覆盖状态 / 输出、缺口提示、显式取消请求与终态；资源快照 / 输出在 TanStack Query，命令关联由 Agent 事件重放。最终输出读取按游标增量追加，WS 250ms 合并通知只失效输出 Query，状态事件另失效状态；保留活动 2s 补偿及终态最后一次补拉，避免反复读取完整历史与末尾输出丢失。
- 新增 `e2e-auth/commands.spec.ts`：真实 Chromium 配对后创建临时项目 / Turn；审批前无 command-effect 文件；批准后在运行中看到 public start，刷新保持同一资源 / 单次文件副作用，非零退出显示失败 / 退出码 7 / public finish，输出中不含固定敏感字段值；第二条真实命令持续写 ticks，点击取消后终态且文件停止变化，未创建 Terminal；保留页面错误断言。
- 验证期间修正新增测试对锁表不存在 released_at 列的笔误，改为实际 expires_at 活跃锁断言；未删测试或放宽清理 / 权限断言。输出 JSON 转义预算、审批等待预算、凭据引号和实时限流问题在交付前补齐对应实现与验证。
- 无新依赖、数据库迁移、配置或 REST 创建入口；turns.input_json 新增内部执行身份 / 策略快照，已有 Turn DTO 与模型文本输入不变。命令模型结果只含有界摘要；审批全文为脱敏的规范化参数摘要、哈希绑定实际执行，通用审计不保存原始命令正文。
- 平台边界承接 M2-3：仅实测当前 macOS arm64 / Node 20，不宣称 Shell 沙箱、完备风险分类、原子 PID 身份或任意脱组进程均可清理。卡片显示真实失败 / 中断 / 停止未确认原因，不能确认时继续保留项目受阻。

- 最终 pnpm check 通过（server 354 / agent 32 / web 32，原 live 1 项按环境跳过；既有 Biome 5 条 warning），pnpm build 通过（既有依赖注释 / bundle 大小提示）。生产浏览器首次 4/4，增量输出改动后最终全套再验 4/4；Demo 15/15。两类浏览器测试使用空闲临时端口串行运行，不复用或停止用户服务。
- 运行与失败终态截图已查看：`/var/folders/0_/s9y0kyfn4n7bpwb5cdlzs1yc0000gn/T/larness-m2-3b-running.png`、`larness-m2-3b-result.png`，1440×900 无布局溢出，状态 / 退出码 / 原因 / 脱敏输出与取消按钮可见。截图为本机临时验收产物，不进入版本库。
- 状态 review；M2-4 保持 todo。尚无真实 PTY / 项目 dev 终端交付，本任务不宣称这些后续能力完成；未修改用户运行数据。

## M2-4 TerminalManager 与输入租约后端（2026-11-03）

- 分支 `task/m2-4-terminal-manager`；人类“下一步”确认 M2-3b，并在执行期间明确“继续”。只实现本后端任务；无 xterm / 本地 Tab、Agent dev 工具或 AI 人工接管界面交付，M2-4b / 4c / 4d 未开始。
- 先写真实创建 / 终止用例，确认缺 TerminalManager 模块失败；短提示符测试确认旧固定尾缓冲无法即时显示，再实现最小前缀保留。新增敏感字段提示符 / 跨块引号边界测试，原跨块秘密 / JSON / Cookie / Authorization 全部分割断言保留并通过。
- `test/resources/terminals.test.ts` 16 项全部真实资源：人工 Shell 创建 / 持久幂等 / 共享列表 / 显式终止；两个独立配对客户端的真实 WebSocket 连接竞争同一租约，伪造连接拒绝、generation 递增、重复输入不重放、跳号拒绝、实际文件副作用与 stty resize；断线 / 到期 / 登出后输入权释放，旧请求拒绝且 PTY 继续。
- 真实 Shell 前台任务另建进程组，任务和子进程拒绝 TERM/HUP：终止后独立 ps 检查 Shell / 前台 Node / 子进程均已停止。内部 dev 后端用真实活动 Turn 上下文验证 frontend / backend 两个角色同时存活、同角色参数重试复用 / 不同参数 CONFLICT；运行中真实文件保存成功，活跃资源阻止移除项目，交付后 Turn 完成 / AbortSignal 不停止资源。此处内部授权断言是受控测试上下文，不冒充 M2-4c 工具审批已交付。
- 真输出文件与小配额故障夹具验证逐终端 / 总量轮转、0600、游标缺口 / 过期 / 未来游标；真实 PTY 读取固定测试秘密并跨块输出，已知秘密 / 敏感字段脱敏、管理环境不继承、非零退出保存真实 exitCode，启动摘要无测试秘密。全局 / 独立 workspace、风险确认 / cwd / env / Origin / CSRF / 客户端归属均有拒绝用例。
- 真 SQLite 重启验证持久 PID 指向无关活进程时不发信号，旧资源 INTERRUPTED / 租约作废，未知状态在 TTL 后仍阻止根写；测试自行清理其持有的无关 fixture 子进程。创建审计失败无半条资源 / 创建意图；输出失败停止真实 PTY并保留屏障；终态提交失败不广播成功，实际进程已停且记录结果不确定；终态和持久屏障双重写库失败时内存根屏障继续阻止写 / 新终端，查询不伪报运行。
- Server shutdown 保留活动 WS 的用例验证先停止 PTY / 保存 TERMINATED + SERVER_SHUTDOWN / 清空租约，再关闭 SQLite；重新打开真实 DB 验证终态，独立 ps 验证进程不存在。窗口 / 浏览器断线仅释放输入权，未触发 terminate。
- 唯一 `0007_terminals` 迁移：新增 terminals / terminal_leases、活跃项目 role 唯一索引与 principal / 序号列；v6→v7 升级保留原项目 / 锁 / fencing / stream 序号，终端表初始为空，外键检查通过。原 v5→v6 测试固定迁移目标，旧库夹具改 repository 填入数据，避免用依赖新表的当前 project service 操作旧 schema；没有改旧 SQL 或削弱原数据保留断言。
- 新增测试夹具修正了已有 HTTP 契约的返回码（缺 Origin 先 403，带 Origin 后未认证 401；logout=204；移除项目=200），产品接口未改。提示符脱敏的初次实现漏掉“冒号与引号分块”时原测试失败，修正后全部分割断言通过；未跳过、删除或放宽隐私 / 清理断言。
- 最终 pnpm check 通过：server 373 / agent 32 / web 32，原 live 1 项按环境跳过，既有 Biome 5 条 warning；pnpm build 通过（既有依赖注释 / bundle 大小提示）。生产浏览器 pnpm test:e2e:prod 4/4，回归认证 / 命令 / 文件 / M1，临时端口且不复用用户服务；本任务没有新增 UI，不把这四项当作 xterm 双浏览器验收。
- 打包产品补充冒烟：`pnpm --filter @larness/server exec tsx /tmp/larness-m2-4-built-smoke.mts`，使用既有 startManagedRuntime(dev:false) 启动真实构建产物，专属临时配置 / 数据、IPC 初始化与测试配对、HTTP 创建 PTY、真实 WS 租约 / 输入 / 输出标记、显式 terminate、受管 Server 清理均通过；脚本与输出 `/tmp/larness-m2-4-built-smoke.log` 为本机临时验收产物，不新增 headless 产品入口。实际为 macOS darwin arm64 / Node v20.19.3，不外推其他平台。
- 无新依赖、持久配置或 IPC / 认证协议变更；新增 Terminal REST / WS / 错误码和迁移已同步契约。源码与用户运行数据未被测试用作数据目录；临时项目、DB、进程均在 fixture 生命周期清理。不是 OS 沙箱，出生快照 / 最后信号存在竞态；未观察到的主动脱组后代不保证发现或清理，未知或 DB 失败保持受阻，不按存储 PID 误杀。
- 状态 review；M2-4b 保持 todo，等待人类确认本后端结果后再接真实终端界面。

- 补充验证：实际 WS 输入在 64 KiB/s 边界后拒绝，超过 8 KiB 的 Unicode 输入在 schema 边界拒绝；30 天清理只删除安全终态元数据 / 租约 / 幂等记录，保留活跃资源、stream 序号与 workspace 文件。native 工厂故障注入在创建真实 PTY 后抛异常，后端不能据异常认定未启动：记录 SPAWN_UNCONFIRMED / 根受阻，不继续创建；测试持有原始 native 句柄自行清理该专属 PTY。

- principal 存储负例：在真实 PTY 上预置未过期的 agent 租约记录，人工 acquire / input 均不能覆盖或冒用该 principal，缺浏览器连接不导致自动抢占；此用例只验共享存储的人类边界，不作为 AI 控制 / 审批能力完成证据。

## M2-4b 真实终端界面（2026-11-03）

分支 `task/m2-4b-terminal-ui`。M2-4 随人类“开始M2-4b任务”确认；本任务待人类 UI review，不启动 M2-4c。

### 实现与失败证据

- 先红：真实模式缺少终端入口、关闭窗口丢失 Tab、DTO 缺少写占用状态；分别在浏览器、窗口 store、真实终端集成中确认失败，再完成实现。
- 浏览器选择器歧义匹配创建确认框/终端窗口和侧栏/窗口入口，按 AGENTS §9.5 暂停；人类明确“继续”后限定窗口范围，未放宽断言。全套回归还发现侧栏自动选中了前序测试已清理的项目，测试明确从全局窗口创建，保留后端路径拒绝行为。
- 续租故障用例复现本地输入已关闭，但“释放输入权”没有释放服务器尚未过期的租约。修复为使用当前连接的权威租约 generation 释放；本地能力与持有状态分别展示，同代 acquire 保持输入序号。测试等待“你正在控制”后再打字，不把点击申请视为已经获权。
- 未知停止/恢复状态单测先失败后通过：仅明确停止/退出或明确未启动才移除 Tab，其他中断状态保留原因与视图。

### 自动化范围

- `pnpm check`：server 373、agent 32、web 34 通过；原 live 1 项按环境跳过。`pnpm build` 通过。已有 lint/大 chunk/Node 版本提示保持。
- `LARNESS_E2E_WEB_PORT=5324 pnpm test:e2e`：Demo 15/15 通过。
- `e2e-auth/terminals.spec.ts`：两独立真实配对上下文、真实 Shell PTY、xterm 输入与双方输出、单控制者、释放/换手、刷新同 terminalId 且无重复创建、终止故障保留 Tab、成功终止后另一端结束。
- 第二场景保留认证 WS，注入续租 HTTP 失败；验证显式释放，再等待真实 30s 到期、另一端取得控制、登出撤销、原端重新获权并实际运行 printf。关闭整个窗口后恢复相同资源/输出，仍需显式获取输入权；显式终止成功。
- 后端集成验证真实项目终端不占源码写锁；其他项目写作业持锁时 DTO `writeBlocked=true`，释放后不影响 PTY。既有 16 项终端集成继续覆盖序号/过期/权限/前台进程清理/重启/故障。
- 输出页有界、按游标去重；xterm 2000 行历史，额外可访问摘要最多 16,384 字符；断线不重放输入，过旧输出提示缺口。

### 人工抽查

1. 顶部“终端”打开资源列表，确认风险后新建；获取输入权并运行 `printf 'hello\n'`。
2. 另一已配对浏览器打开同一终端，核对只读、持有者/到期；第一端释放后第二端获得控制。
3. 关闭/最小化整个窗口，再恢复或刷新，核对资源未重建；主动关闭 Shell Tab 则终止，另一端显示已终止。
4. 项目内创建终端，核对项目筛选、来源、源码写占用提示；Shell 不受源码写锁串行保证覆盖。

仅实测 macOS arm64 / Node 20.19.3 / Chromium。浏览器使用临时数据和端口 3324，现有 fixture 关闭 Server/PTY 并清理；用户 3210 实例未停止。截图 `larness-m2-4b-observer.png` 在 OS 临时目录，可重跑生成，已目视检查。无新依赖/配置/迁移，无用户数据修改；Agent 自动创建 Tab/AI 控制留在 M2-4c/4d。

最终 `LARNESS_E2E_PORT=3324 pnpm test:e2e:prod`：6/6 通过（认证、命令、文件、M1 与两项真实终端）。全部场景在同一测试 Server 上运行，保留原断言；全套模式的日志选择器明确限定终端输出，避免匹配已有会话时间线。

### 验修复跑（2026-11-03）

- 人类要求开始 M2-4c，M2-4b 验收通过并标 done。按原清单复跑：`pnpm check`（server 373 / agent 32 / web 34，live 1 项按环境跳过）、`pnpm build`、生产浏览器 6/6、Demo 15/15；真实双浏览器输入 / 只读观察 / 换手 / 刷新与窗口恢复与前述一致。
- 环境注意：DSH `workspace-write` 沙箱禁止子进程启动 `/bin/ps`（EPERM）。`ManagedPty` 的进程快照与命令停止确认依赖该检查，故在此环境会误报“创建结果未确认 / INTERRUPTED / STOP_UNCONFIRMED”；在允许进程检查的环境重跑后全部通过。这不是产品回归，后续验收应避免在禁止 `ps` 的沙箱中判断终端 / 命令结果。
- 人工抽查第 4 项的项目筛选与写占用由真实集成用例覆盖；浏览器场景使用全局终端，不将两者混为同一证据。无源码 / 配置 / 用户数据变化。

## M2-4c Agent 项目开发终端工具（2026-11-03）

分支 `task/m2-4c-agent-terminals`。人类明确“开始m2-4c”后，按先红测试再实现推进；本任务交付启动 / 有界读取 / 显式停止三个工具与来源 Tab，不接 AI 输入 / 人工接管，后者仍属 M2-4d。

### 实现与失败证据

- 先红：Server 测试导入缺失的 `terminalTool` 模块；Web 测试导入缺失的 `openAgentTerminal` 并确认 terminal target 解析失败；E2E 在 FakeProvider 尚无 dev 分支时无法得到启动审批。补齐实现后再逐项转绿，未删除或放宽断言。
- `start_project_terminal` 复用 TerminalDevSchema 与 M2-4 的 `createDev`；L2 逐次审批绑定规范化参数和执行身份，已知凭据在摘要前拒绝；同项目 role 同参数复用并标 `reused`，不同参数 CONFLICT。`read_terminal_output` L0、`stop_project_terminal` L1，均只接受当前项目、Agent 创建的 dev 终端；human Shell 与其他项目 ID 拒绝。
- 工具结果 `tool.completed` 附 terminal resourceTarget 与发起客户端 ID；发起客户端实时插入非聚焦 `origin=agent` Tab，其他客户端仅失效终端列表；历史重放不复活已关闭 Tab，卡片点击才聚焦。修复浏览器测试清理：先终止 dev 终端并移除临时项目，再删除目录，避免后续终端列表因已删根失效（该失败是本任务 E2E 清理造成的测试隔离问题，不是产品回归）。

### 自动化范围

- `apps/server/test/agent/terminalTools.test.ts` 3 项真实资源：两个真实 PTY 经两次 L2 审批启动、模型只得到 terminalId / status、无源码锁残留；role 复用 / 冲突 / 12k 有界读取 / 显式停止 / Turn 取消保留已交付终端；审批参数篡改、human Shell 与跨项目访问拒绝。
- Web 新增 4 项终端测试：terminal target 解析、非聚焦插入、发起客户端过滤、首窗口不抢焦点；既有断线 / 停止确认断言保留。
- `e2e-auth/agent-terminals.spec.ts`：真实配对、临时项目 / 会话、两次真实启动审批、两个来源 Tab、真实 `FRONT_READY` 输出、只读观察与“获取输入权”；测试结束终止真实 PTY 并移除项目。
- 最终 `pnpm check`：server 376 / agent 32 / web 37，live 1 项按环境跳过；`pnpm build` 通过；`LARNESS_E2E_PORT=3324 pnpm test:e2e:prod` 7/7；`LARNESS_E2E_WEB_PORT=5324 pnpm test:e2e` Demo 15/15。全套复跑中 auth 撤销跳转出现 `/pair` 与 `/login` 的既有时序抖动（auth 单独连续 4 次通过，未改认证代码）；第 3 次全套 7/7 通过，M2-4c 与终端场景每次均通过。保留抖动记录，不宣称认证测试完全稳定。
- 浏览器截图 `larness-m2-4c-agent-terminals.png` 已目视检查：终端窗口显示 frontend / backend 两个 Tab、`FRONT_READY`、只读观察、输入权按钮与源码写占用提示。

### 边界

仅实测 macOS arm64 / Node 20.19.3 / Chromium；无新依赖 / 迁移 / 配置 / 认证协议，未修改用户运行数据。dev 进程仍是主机写者，不占源码写锁的例外按 ADR-029 执行；不宣称沙箱、服务 ready、端口 / 健康检查或 AI 输入已交付。2026-11-03 人类“确认并继续”，M2-4c 验收通过并标 done；M2-4d 未启动。

## M2-4d AI 终端控制与人工接管（2026-11-03）

分支 `task/m2-4d-agent-control`。人类确认 M2-4c 后继续；本任务实现 AI acquire / input / interrupt / release、Turn 结束只释放控制、人工原子接管与 UI，不启动 M2-5。

### 实现与失败证据

- 新增三个真实终端控制测试后首次运行：测试把 `connect` 参数顺序写反、provider 延迟步骤缺少 finish，均修正测试 / fixture；随后暴露工具组折叠导致错误码不可见，浏览器测试改为展开工具组后再断言。未删除或放宽租约、输入序号、旧 generation 或终端存活的断言。
- 管理器新增 agent principal 租约：30s TTL、活跃 Turn 续租、Turn 结束 / 取消 / 登出 / 过期清除；输入按 generation + inputSequence 校验，重复不重放、跳号拒绝、单 Turn 64 KiB/s 窗口；输入正文只用于 PTY 写入和审批哈希，不进入审批 scope / 审计 / Agent 事件 / 日志。
- 新增 `acquire_terminal_control`（L1）、`send_terminal_input`（L2）、`interrupt_terminal`（L2）、`release_terminal_control`（L1）并接入真实 Turn；输入 / 中断审批摘要只显示目标与字节数。人工接管新增 `POST /api/terminals/:id/takeover`，只允许当前终端订阅的活连接；agent / 空闲租约原子转 human，另一 human 持有拒绝。
- 前端在 agent 持有时显示“AI 控制中”与“接管控制”；成功后显示“你正在控制”。旧 generation 的 Agent 输入 / 中断 / acquire 被拒绝，AI 不自动抢回；Turn 完成 / 取消不停止终端。M2-4c 的读取 / 停止 / 来源 Tab 行为保留。

### 自动化范围

- `apps/server/test/agent/terminalControl.test.ts` 3 项真实 PTY：acquire / 输入序号 / 重复与跳号 / ETX 中断 / 真实 human 原子接管 / 旧 generation 拒绝 / 不自动抢回 / 登出撤销；FakeProvider 工具链 acquire → 审批输入 → 读取 → 中断，Turn 结束租约清空且终端 RUNNING；Turn 取消只释放控制。
- 输入正文扫描：审批 `scope_json`、审计 `details_json`、Agent 事件 `payload_json` 均不含测试输入明文，只记录 bytes / generation / sequence / ownerType。
- `e2e-auth/agent-terminals.spec.ts` 新增真实浏览器场景：两个启动审批后 Agent acquire，终端显示“AI 控制中”；人工点击“接管控制”显示“你正在控制”；延迟后的旧 generation 输入审批通过后被拒绝（展开工具组可见 `TERMINAL_LEASE_REQUIRED`），最终文本仍完成。
- 最终 `pnpm check`：server 379 / agent 32 / web 37，live 1 项按环境跳过；`pnpm build` 通过；`LARNESS_E2E_PORT=3324 pnpm test:e2e:prod` 8/8；`LARNESS_E2E_WEB_PORT=5324 pnpm test:e2e` Demo 15/15。截图 `larness-m2-4d-takeover.png` 已目视检查：AI 控制后人工接管、持有者 / 到期、释放输入权、Agent 仍在思考。
- 全套 8/8 本次首次通过；M2-4c 验收记录中的 auth 撤销 `/pair` 抖动未在本次出现，仍不宣称认证测试完全稳定。

### 边界

仅实测 macOS arm64 / Node 20.19.3 / Chromium；无新迁移 / 依赖 / 配置 / 认证协议，未修改用户运行数据。中断只发 ETX，不宣称已停止；不宣称沙箱、强 PID 身份或任意脱组清理。人工接管只共享输入控制，终端进程 / 项目所有权不变。

2026-11-03 人类“确认并继续”，M2-4d 验收通过并标 done；M2-5 未启动。

## M2-5 GitManager、资源动作与 Agent Git 工具（2026-11-03）

分支 `task/m2-5-git-manager`。人类确认 M2-4d 后继续；本任务交付 Git 结构化读、显式写、人工资源动作审批 / 幂等 / 快照重验与 Agent Git 工具，不交付 Git 资源区 / Diff / 审批 UI（M2-5b）。

### 实现与失败证据

- Git 执行层使用 `execFile` 无 Shell、环境过滤、`GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=/bin/false`，读操作强制 `--no-ext-diff --no-textconv`；porcelain v2 / log / branches 解析结构化数据，路径与分支名显式校验，原始 stderr 不回传。
- 人工动作 `resource_actions`：L1 创建 PREPARED、L2 创建 WAITING_APPROVAL；5 分钟有效，approve / reject 绑定实际客户端；execute 前重算快照，取项目写锁后再次核对，变化即 FAILED / GIT_CONFLICT；状态单次消费，重复 execute 返回同一结果。唯一 `0008_resource_actions` 迁移，v7→v8 保留项目 / 锁 / stream 数据。
- 首次实现发现 action 关联的 resource_operations 若保持 PREPARED 会被共同根屏障视为写入而阻塞自身锁；改为创建时 COMPLETED、执行时 WRITING，再收敛终态。另修正 for-each-ref 的 `%x1f` 字面量输出与 Agent 项目锁 executionId 复用 Turn 导致释放后仍阻塞的问题。
- 无外部 diff 执行、特殊文件名、只暂存显式路径、commit 只含已暂存、L2 推送审批 / 单次消费 / 过期 / 快照变化、ff-only pull、非快进 / 脏工作区、锁冲突重试、Git 不可用、API 401 / CSRF 均有真实测试。

### 自动化范围

- `apps/server/test/git/manager.test.ts` 7 项真实仓库 / 本地 bare remote：status / diff / log / branches 与快照、特殊文件名与显式 add / commit、push 审批 / 单次消费 / 快照变化 / 过期、ff-only pull / 非快进 / 脏分支 / 原文件保留、外部 diff 不执行、锁冲突后重试、Git 不可用、API 鉴权 / CSRF。
- `apps/server/test/agent/gitTools.test.ts`：FakeProvider 经真实 Turn 执行 git_status → L1 add / commit → L2 push 审批，提交只含暂存内容、远端 ref 更新。
- `apps/server/test/resources/resource-actions-migration.test.ts`：v7→v8 空 resource_actions、项目 / 锁 / stream 保留、外键检查。
- 最终 `pnpm check`：server 388 / agent 32 / web 37（live 1 项按环境跳过）；`pnpm build` 通过；`LARNESS_E2E_PORT=3324 pnpm test:e2e:prod` 7/8，唯一失败是既有的 auth 撤销跳转 `/pair` 抖动（auth 单独运行通过，未改认证代码），M2-5 无 UI；Demo 15/15。
- 本轮未新增真实浏览器 Git UI 证据；Git 资源区 / Diff / 审批界面与 git WS 失效事件按计划在 M2-5b 接线，不把 REST / Agent 工具测试当 UI 验收。

### 边界

仅实测 macOS arm64 / Node 20.19.3；无新依赖 / 配置 / 认证协议，唯一迁移为 0008_resource_actions。Git hooks / filters 仍可能执行主机代码，不宣称 `shell:false` 是沙箱；不提供 reset / clean / force / 删除分支 / rebase / merge / 远端管理。远端认证依赖主机既有配置，不提供网页密码；Git 不可用返回 GIT_UNAVAILABLE，不伪装本地降级。

2026-11-03 人类“通过并继续”，M2-5 验收通过并标 done；M2-5b 未启动。

## M2-5b Git 资源区、Diff 与审批界面（2026-11-03）

分支 `task/m2-5b-git-ui`。人类确认 M2-5 后继续；真实 Git 资源区、Diff、选择性暂存 / 提交、分支、pull / push 审批面板上线，模型离线可用。

### 实现与失败证据

- 真实 GitPanel 接 M2-5 API：3s 状态刷新、branch / ahead / behind、staged / unstaged / untracked / conflicts、显式路径 add、仅暂存内容 commit、分支创建 / 切换、L2 pull / push 审批 / 拒绝 / 执行一次；错误后重查，不自动 stash / merge / reset。
- Diff 窗口按项目 + 路径只读展示统一 Diff；二进制 / 超限明确提示，不写文件。真实模式不再显示服务 / Browser 假入口，顶部只保留文件 / 终端。
- 首次 E2E 打开 `a.txt` 命中了文件树而非 Git 区，已用 `data-testid=git-panel` 限定；另发现 Git branches/log 路由返回未 await 的 Promise 导致服务端 unhandled rejection，已改为 `await`。未放宽断言。
- 组件测试覆盖真实 status、选择 / 暂存 / 提交、L2 审批 / 执行；真实 Chromium 覆盖 diff、暂存、提交、创建 / 切换分支、push 审批与远端 ref 更新。

### 自动化范围

- `apps/web/src/features/git/gitPanel.test.tsx` 2 项：状态 / 选择 / 暂存 / 提交请求；pull/push 计划 → 批准 → 执行一次，重复执行受状态限制。
- `e2e-auth/git.spec.ts`：真实临时仓库 / bare remote、项目 / 会话、Git 区 status、Diff、暂存、提交、分支创建 / 切换、push 审批、远端 ref 校验；截图 `larness-m2-5b-git.png` 已目视检查。
- 最终 `pnpm check`：server 388 / agent 32 / web 39；`pnpm build` 通过；生产 E2E 8/9，唯一失败为既有 auth 撤销 `/pair` 抖动（auth 单独通过，Git / 终端 / 文件 / M1 全通过）；Demo 15/15。

### 边界

仅实测 macOS arm64 / Node 20.19.3 / Chromium；无新依赖 / 迁移 / 配置 / 认证协议。git WS 失效事件尚未接线，Git 区依赖查询轮询；Git hooks / filters 仍是主机代码，不宣称沙箱。M2-6 未启动。

## M2-6 统一资源身份与布局恢复（2026-11-03）

分支 `task/m2-6-resource-windows`。人类授权自动完成 M2 后续任务；本任务统一 viewKey / 布局版本 / 资源对账，不新增后端接口或迁移。

### 实现与失败证据

- WindowTab 增加 `viewKey` / `createdAt`：文件按 realpath、终端按 terminalId、Diff 按 projectId + path；Git Diff staged / worktree 复用同一视图并更新 staged 元数据，不同项目同路径不误复用。既有文件跨 scope realpath 去重测试保留。
- 布局持久化升到 v3：迁移补身份 / 创建时间、修正失效 activeTab、移除空窗口；真实模式丢弃 `prj_larness`、Demo 终端 / 服务 / Browser、无 file 元数据的文件 Tab、无 git 元数据的 Diff Tab。真实模式顶部只显示文件 / 终端，已有窗口恢复 filter / activeTab / 最小化状态。
- 首次测试把不同项目 Diff 期望成两个窗口，实际同一 kind 窗口按项目分组插入；修正断言为同一窗口两个项目 Tab，未改产品分组语义。
- 窗口 close / minimize、文件 / Diff 关闭无终止副作用；终端 Tab 关闭仍走已确认 terminate（M2-4b 既有真实浏览器证据）。Git 区仍以 3s 轮询，未新增 git WS 事件。

### 自动化范围

- `apps/web/src/stores/windowLayout.test.ts` 2 项：v2→v3 迁移补 viewKey / createdAt、丢弃 Demo / 服务 / Browser、移除空窗口；Git Diff 同项目 staged / worktree 复用、跨项目同路径独立。
- 既有 `files.test.ts` realpath 去重 / 隐藏窗口草稿、`terminals.test.ts` 关闭窗口保留 Tab / 停止确认、M2-4b 双浏览器恢复与 M2-5b Git 真实浏览器流程继续通过。
- 最终 `pnpm check`：server 388 / agent 32 / web 41；`pnpm build` 通过；`LARNESS_E2E_PORT=3324 pnpm test:e2e:prod -g M2-5b` 通过。全套 / Demo 交由 M2-8 汇总。

### 边界

仅实测 macOS arm64 / Node 20.19.3 / Chromium；无新依赖 / 迁移 / 配置 / 认证协议。服务窗口无 Tab、Browser 预览与 git WS 失效事件仍在 M3 / 后续统一接线；不把筛选当授权，不把布局恢复当资源重建。M2-7 未启动。

## M2-7 跨资源锁、fencing 与恢复（2026-11-03）

分支 `task/m2-7-locks-fencing`。人类授权自动完成 M2；本任务以真实集成测试集中验证文件 / Git / 命令 / 终端共享锁边界，未新增迁移 / 依赖 / 配置。

### 实现与证据

- 新增 `apps/server/test/resources/cross-resource-locks.test.ts`：同一根项目持锁时，Git add 与文件保存均被拒绝（GIT_CONFLICT / RESOURCE_LOCKED）且文件未变；无重叠根的另一个项目 Git add 可并行成功；释放后同一 Git 动作可重试成功；旧锁 handle 的 renew / release 返回失败，新写者获得更高 fencing token。
- 既有证据：`agent/projectWriteLock.test.ts` 续租 / 过期 / 旧 token；`api/files.test.ts` 父子根冲突与项目移除受阻；`resources/commands.test.ts` 真实命令拿锁 / 取消 / 继承锁；`resources/terminals.test.ts` dev 终端不占源码锁、前台进程树停止、重启未知 PID 不发信号、Server 关闭清理；文件事件 / 命令 / 终端缺口语义与 DB/审计失败用例保留。
- 跨资源固定顺序未新增第二套锁；Git / 文件 / 命令共用 `resource_locks` 与根包含判断，终端继续按 ADR-029 作为非长持锁主机写者。A23 TUI 退出清理沿用既有真实 PTY 回归（`test:tui:pty`）。

### 验证

- `pnpm check`（server 389 / agent 32 / web 41）、`pnpm build` 通过；M2-8 执行全套 check / build / Demo / auth / prod / 初始化 / 统一入口 / TUI 回归。
- 仅实测 macOS arm64 / Node 20.19.3；不宣称 OS 沙箱、强 PID 身份、原子 PID 回绕防护或任意脱组清理。无进行中的新锁实现，M2-8 未关闭 G2。

## M2-8 M2 整体交付与 G2 候选（2026-11-03）

分支 `task/m2-8-acceptance`。人类授权自动完成 M2 后续任务；本任务汇总真实资源、回归、smoke 与 G2 证据。**未自行通过 G2，等待人类验收 / 纠错。**

### 全部命令结果

- `pnpm check`：server 389 / agent 32（live 1 项按环境跳过）/ web 41；Biome 通过（既有 warning 保留）。
- `pnpm build`：通过（既有 Monaco / chunk 体积提示）。
- `pnpm test:smoke:init`：PASS；built runtime 在损坏 config 前恢复已提交设置、历史哈希保留。
- `pnpm test:smoke:unified`：PASS（HTTP dev/built/dev、HTTPS dev/built、legacy config）。首次 dev 因 Vite 预构建 zod 的 eval、built 因 Monaco TS worker 的 eval 触发 CSP；开发脚本源允许 `blob:` + `unsafe-eval`，生产 `script-src` 增加 `'unsafe-eval'` 以支持本地 Monaco TS worker（无远程脚本；这是安全姿态变更，待人类 review）。
- `pnpm test:tui:pty`：15 项 PASS（TUI 模式 / 屏幕恢复、子进程 / 锁 / IPC 释放、配对 / 阅读 / 信号）。
- Demo：15/15。
- 生产浏览器：8/9。唯一失败为既有 auth 撤销跳转 `/pair` vs `/login` 抖动（连续 4 次全套复跑均出现，auth 单独运行通过；未改认证代码 / 断言）；文件、M1、命令、Git、终端、AI 终端控制全部通过。
- Git 真实浏览器：临时仓库 / bare remote、Diff、暂存、提交、分支、push 审批 / 远端 ref 通过。

### A1–A31 / G2 映射

| 范围 | 证据 |
|---|---|
| A1–A5 文件 | M2-1/1b/2 真实文件、监听、冲突、realpath / 截断测试；文件 E2E |
| A6–A8 命令 | M2-3/3b 真实进程、审批、取消、输出上限；命令 E2E |
| A9–A12 终端 / 锁 | M2-4/4b 真实 PTY 双客户端、租约、窗口恢复；跨资源锁测试 |
| A13–A18 Git / fencing | M2-5/5b 真实 repo / remote、审批 / 快照 / 单次、锁与重启；Git E2E |
| A19 事件 / 缺口 | M2-1b / 3b / 4 补拉、轮转、缺口测试 |
| A20 / A21 失败 / 秘密 | 各资源 DB / 审计失败、脱敏扫描、秘密不落库测试 |
| A22 模型离线 | 文件 / Git / 终端直接 REST + 组件 / 浏览器测试，不依赖 Provider |
| A23 TUI 退出 | TUI PTY 15 项，子进程 / 锁 / IPC / PTY 清理 |
| A24 视图去重 | 文件 realpath、Git projectId + path、终端 ID 的 viewKey 测试 |
| A25–A27 dev 终端 | M2-4c 真实双 PTY、L2 审批、role 复用、Turn 独立生命周期 |
| A28–A29 Tab / 文件卡片 | M2-4b + 2 关闭失败保留 / 成功终止；文件结果卡片测试 |
| A30–A31 AI 控制 / 接管 | M2-4d 真实租约、序号、ETX、人工原子接管、旧 generation 拒绝 |

### G2 待人类确认的已知边界

- auth 全套抖动未修复；不宣称认证 E2E 稳定。
- 生产 CSP 因 Monaco TS worker 允许 `unsafe-eval`；无远程脚本，但削弱 CSP 防护，需人类接受或另立方案。
- Git WS 失效事件尚未接线（Git 区 3s 轮询）；服务窗口 / Browser 预览 / 临时服务属 M3，不在 M2 验收冒充完成。
- 仅实测 macOS arm64 / Node 20.19.3 / Chromium；Linux / Windows / CI 未验收。Git hooks / filters、PTY 脱组、PID 回绕仍按既有边界不宣称沙箱 / 强身份。

**G2 状态：候选，等待人类验收 / 纠错；M2 不标 done。**

## M2-8 Git 审批测试纠错（2026-11-04）

- 修复前：审批请求 mock 设置 decision 后，响应解析和 React 渲染仍未完成，立即 getByRole 导致找不到“执行一次”。既有失败日志确认页面仍为 WAITING_APPROVAL。
- 修复：等待执行按钮出现且 enabled，再点击；检查执行完成后审批面板关闭，并断言 execute 请求恰好一次。无产品代码、契约或权限变化。
- 验证：GitPanel 2/2；pnpm check（server 389 / agent 32 / web 41，agent live 1 项按环境跳过）；pnpm build 通过。既有 lint / 构建警告保留，G2 仍待人类。
