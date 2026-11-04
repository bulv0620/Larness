# M2-9 验收中间记录

状态：done（2026-11-04 人类授权继续后的自动化验收完成；G2 不自行通过）。

- 先行红测试：项目混合窗口、关闭丢 Tab、旧布局不拆分；手动 Shell Agent 控制被 FORBIDDEN 拒绝；rename 端点 404。
- pnpm check：server 392 / agent 32（live 1 项环境跳过）/ web 43 通过；lint 既有 5 warnings。
- pnpm build 通过；既有 chunk / zod 注释提示。
- Demo 15/15 通过；项目隔离、header 移除、右栏文件/Git、窗口关闭保留与恢复。
- 真实 PTY：人工 Shell 经 Agent acquire / 审批 send / read / release 成功；跨项目与持权人工拒绝、旧 generation 拒绝；名称改写 SQLite / 回读、控制字符拒绝；v8 有终端 / lease 升级 v9 保留原字段。
- 真实生产 M2 首轮：Agent dev / AI 人工接管 / 命令 / Git 4 项通过；文件旧 button→tab 选择器待适配，两个终端测试沿用已删除项目导致创建失败；新场景在 UI 控制就绪前输入，未等待状态，已修正。
- 定向复验：文件通过；同一终端测试刷新后选择变为独立会话，已保存的项目窗口被隐藏（PTY 不重建），需要修复 AppShell 会话 fallback / 导航恢复。该测试连续两次失败触发 §9.5，已提问，不继续改代码。复验最终 2/4：文件、租约失效 / 登出 / 窗口恢复通过；双观察者及新改名场景均在草稿刷新后失去项目选择。新场景已验证改名、默认 cwd 与关闭窗口保留，尚未到多 Tab 截图断言。
- 服务 / 真实隔离 Browser 后端仍属 M3；仅改入口与恢复，不宣称已交付。

## 继续后的最终结果

- 修复导航：快照 loading/error 不回退；草稿身份 / 项目持久化；旧 draft ID 恢复；有效项目不因其他最近会话被替换。新增导航测试先失败后 3/3。
- pnpm check：server 392 / agent 32（live 1 skipped）/ web 46；build 通过。
- 生产终端定向 3/3：双认证观察 / 输入 / 刷新 / 关闭终止，租约过期 / 登出 / 隐藏恢复，项目 cwd / 改名持久化 / 8 真实终端 Tab 的 32px 行高与无占位滚动条 / 终止真实资源。文件已在前次复验通过；Agent / 命令 / Git 4 项通过；Demo 15/15。
- 目视检查截图：larness-m2-9-terminal-tabs.png、larness-m2-9-dock.png（OS 临时目录）；浮栏位于输入框上方，header 无统一入口，右栏仅文件 / Git。
- 名称相同的轮询不再重写布局，避免周期性将手动滚动位置拉回当前 Tab。
- 无真实模型服务验证；Agent 以 FakeProvider 驱动真实 PTY / 审批工具验证。其他平台未实测。共享默认工作区按新增用户指令另起 M2-10。
