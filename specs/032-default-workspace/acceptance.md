# M2-10 验收记录（2026-11-04）

状态：done；分支 task/m2-10-default-workspace。人类确认新未关联会话共享目录，旧独立会话保留原路径。G2 仍待人类，不进入 M3。

## 实现

- 复用既有全局终端目录 dataDir/sessions/global-terminal/workspace；新默认会话共享，不搬移任何旧记录 / 文件，不在创建失败或归档时删除共享内容。
- 精确 workspace:default 文件 / 终端 scope；统一共享目录文件事件、缓存与写锁；Session DTO workspaceKind 派生区分 project / default / session，无数据库迁移。
- 默认入口、文件树、真实 Shell 和跨默认会话的 global 视图组；旧独立会话仍按 session 独立。默认文件结果卡片使用明确 workspace scope。
- Agent 控制与读取用真实会话授权根匹配 PTY operation 根，不能凭 projectId=null 控制其他历史 / 项目资源；人工租约 / L2 输入审批 / 重放序号保留。
- 终端 cwd DTO 显示实际绝对目录；持久化及执行参数仍为根内相对目录。

## 自动化

- 先行红测试：新会话目录不共享、默认文件 REST 不存在、默认 root scope 不可用。补齐后 default-workspace.test.ts 5/5。
- 真实服务 / SQLite / PTY：共享文件保留、旧会话原路径 / 文件保留、默认精确根与未知 workspace / 未授权 / traversal 拒绝、符号链接根替换拒绝、会话别名读写同文件、写锁互斥与真实 WS file:workspace:default 广播、真实 Shell cwd。
- FakeProvider 经真实 ToolRegistry / TurnRunner：默认文件 patch、默认终端发现、L2 审批后的输入 / 输出 / 释放；跨历史根拒绝，file result target 精确指向 workspace:default。
- 新 workspaceScope 单测验证默认草稿 / 两个默认会话同组、项目和历史会话独立。
- pnpm check：server 397 / agent 32（live 1 项依环境跳过）/ web 47；既有 5 lint warnings，不新增依赖、不跳过失败测试。
- pnpm build：通过，既有 chunk / zod 注释提示。
- LARNESS_E2E_PORT=3329 pnpm test:e2e:prod --grep M2：9/9，包括 Agent、命令、默认工作区、文件冲突 / 草稿恢复、Git、双观察者、租约过期 / 登出、M2-9 8 Tab 滚动 / 改名。
- LARNESS_E2E_WEB_PORT=5194 pnpm test:e2e：15/15。

## 浏览器与目视

默认入口无需项目即可输入 / 创建终端；Shell 写文件后真实文件树出现，Monaco 修改 / 保存；两个新会话路径相同，刷新后读回原字节；切项目再返回恢复相同 terminalId 和文件 Tab。已目视检查 OS 临时目录的 larness-m2-10-default-workspace.png / larness-m2-10-default-terminal.png。

浏览器测试首次使用不存在的“已保存”文案（实际为“已同步”），修正后发现测试快捷键未按浏览器平台选择；使用既有文件 E2E 的平台键与指定编辑器焦点后通过，未修改产品以放宽验收。

仅验证 macOS / Chromium 与 FakeProvider 驱动真实资源，无实际模型服务或 Linux / Windows 验证。本次未运行全量认证 / M1 E2E，既有 auth 跳转抖动、CSP unsafe-eval、Git WS 未接线仍按 M2-8 已知项保留。
