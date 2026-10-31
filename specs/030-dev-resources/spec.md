---
id: 030-dev-resources
title: M2 开发资源与窗口层
milestone: M2
status: draft
depends_on: [020-workspace-agent]
owners: [human]
created: 2026-10-31
updated: 2026-10-31
---

# M2 开发资源与窗口层（草案）

> **状态：draft。** 开始 M2 前必须补全验收场景、契约与任务卡，并经人类确认。  
> 源设计：`larness.md` 第 4.4、4.6、4.7、17–18、36、38 章。

## 1. 目标

- 文件：文件树、读写、版本冲突、文件监听、Monaco 多 Tab 编辑。
- 命令：短命令执行（超时 / 输出上限 / 取消 / 环境白名单），并作为 Agent 工具接入。
- 终端：真实 PTY、多客户端观察、输入租约、隐藏 / 恢复不重建。
- Git：状态、Diff、分支、提交与高风险操作审批。
- 窗口层：真实资源的多 Tab、项目筛选、顶部入口恢复、布局持久化。
- 并发：项目写锁、文件版本校验、fencing token、死锁顺序。

## 2. 非目标

- 服务托管与预览（M3）；部署（M4）。
- Git 图形化复杂操作（rebase 可视化、冲突编辑器）；M2 只做基础结构化操作。
- 远程仓库管理、多远端 UI。
- Windows 全量终端支持（M5 前只做 PoC 记录）。

## 3. 任务范围（待细化）

| ID | 任务 | 关键交付 |
|---|---|---|
| M2-1 | FileManager | 树、读写、版本 hash、监听、忽略规则、审计 |
| M2-2 | 文件窗口 | Monaco、多 Tab、同文件复用、冲突 Diff / 重新加载 |
| M2-3 | CommandRunner | spawn 数组参数、超时、输出截断、取消、env 白名单、`run_command` 工具 |
| M2-4 | TerminalManager | node-pty、xterm、环形缓冲、多客户端、输入租约、显式终止 |
| M2-5 | GitManager | status / diff / log / branch / add / commit / pull / push（审批 + 锁） |
| M2-6 | 窗口接入 | 顶部入口、多 Tab、项目筛选、隐藏恢复、布局持久化 |
| M2-7 | 锁与并发 | `resource_locks`、fencing、固定顺序、冲突 UI |
| M2-8 | M2 验收 | G2 门禁、E2E、平台冒烟 |

## 4. 预验收场景（需补全）

- 打开文件树 → Monaco 编辑 → 保存 → 外部修改 → 再次保存提示冲突，不静默覆盖。
- Agent 运行 `pnpm test`：输出流式展示、可取消、超时终止；不创建终端 Tab。
- 两个浏览器观看同一终端；一方输入时另一方只读；租约到期可接管；隐藏窗口不重建 PTY。
- 项目 A 的写 Turn 与项目 B 的写 Turn 可并发；同项目第二个写任务排队或拒绝；锁崩溃后过期回收。
- Git push 未审批被拒绝；审批后参数不可篡改；Diff 窗口内容与工作区一致。
- 关闭 / 隐藏窗口不终止 PTY / 命令；显式终止才停止。

## 5. 待决策

- node-pty 打包与 ABI（M2 前 PoC）；失败退路：仅 CommandRunner + 受限终端。
- Windows 终端 / 进程树 / 路径行为（M5 PoC）。
- 文件监听使用 `chokidar` 还是原生 fs.watch；待 M2-1 plan 决定（新增依赖需评审）。
- 终端回放缓冲大小、落盘策略与保留期。
- Git 写操作的具体审批范围（push / reset / force 必须逐次）。

## 6. 进入 M2 前必须完成

- [ ] 补全本 spec 的验收场景（≥ 10 条，覆盖失败与权限）；
- [ ] 冻结 `docs/contracts/rest-api.md` 中 terminals / files / git 接口；
- [ ] 确定锁表结构与获取顺序；
- [ ] 完成 node-pty 与 chokidar PoC（或选择替代）；
- [ ] 人类确认任务拆分与工期。
