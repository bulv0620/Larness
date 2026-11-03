# M2-0：原生资源与边界 PoC

> 2026-11-02（+08:00）。实验已完成，任务为 `review`，**G-PoC-M2 待人类确认**。这是技术可行性证据，不代表文件 / 终端 / 命令产品接口已上线，不启动 M2-1。

## 环境与复现

| 项目 | 实测 |
|---|---|
| OS / 架构 | macOS，Darwin 27.0.0，arm64 |
| Node / 原生 ABI | v20.19.3 / 115 |
| pnpm | 10.12.4 |
| node-pty | 1.1.0，MIT；lockfile 精确版本与完整性校验 |
| 间接依赖 | node-addon-api 7.1.1（原生构建支持，非新增替代库） |
| npm 解包体积 | 64,363,742 bytes；包含多平台预编译资源，尚未做发布裁剪 |
| 构建 | tsdown 0.21.10；原生模块 external，JS 依赖 bundle |

执行：

```bash
pnpm --filter @larness/server exec vitest run test/resources/m2-poc.test.ts
pnpm test:poc:m2
pnpm check
pnpm build
pnpm test:tui:pty
```

测试先行：新增四项真实系统资源测试，首次因 PoC 模块不存在而失败；补齐实现后 4/4 通过。中断测试曾错误地用 `sleep; printf` 判断中断，Shell 按语义继续下一条命令；已改为 `sleep && printf` 验证被中断命令不会走成功分支，保留中断后 Shell 仍可输入的断言。

## 原生安装与 built 寻址

原 npm 1.1.0 包在当前机器的 `prebuilds/darwin-arm64/spawn-helper` 为 0644，真实 spawn 报 `posix_spawnp failed`。将包复制到临时目录，仅改 helper 为 0755 后，真实 PTY 输出及 exitCode=0 均通过。

已用 `patches/node-pty@1.1.0.patch` 在官方 prebuild 安装脚本内修正 macOS helper 执行位；pnpm `patchedDependencies` 记录补丁哈希，`onlyBuiltDependencies` 显式允许 node-pty。重新应用补丁时官方 install / postinstall 成功执行。没有手改共享 node_modules 作为交付方案，也没有替换原生库。包内 pty.node + spawn-helper 必须一起交付并保留权限；升级版本时补丁需重新验证，不能自动沿用。

`test:poc:m2` 先运行源码入口，再以与 Server 相同的 ESM / Node / external 策略编译 PoC。它在 OS 临时目录复制 native 包、better-sqlite3 / bindings / file-uri-to-path 及迁移，**不使用指向源码或现有 node_modules 的符号链接**。由普通 `node` 在该目录执行 built JS，源码 / built 两份结果一致，原生寻址、输入、中断及清理通过。产品仍保留原四个构建入口；PoC 不加入产品入口。

## 实验结果

| 范围 | 真实证据 | 结论 |
|---|---|---|
| PTY | `/bin/sh` 输入 / 输出；resize 后 `stty size` 为 37×103；ETX 中断 sleep；之后仍可输入；确认退出 | 通过 |
| PTY 开发进程树 | node-pty 启动 Node 及后代；进程组 TERM 后有限等待、KILL；逐 PID 检查父子不再运行 | 通过（受控、未脱组 fixture） |
| 命令取消 / 超时 | 真实父子进程忽略 TERM；AbortSignal 显式取消 / 真实 deadline 触发同一清理链；强制停止后检查父子退出 | 通过 |
| 续租失效 | 真实临时 SQLite 锁在假时钟到期后续租失败，触发 AbortSignal，等待受管父子停止 | 通过 |
| supervisor 退出 | 独立进程管理真实子进程；发 SIGTERM 后执行清理，检查 supervisor 与受管子进程退出 | 原型通过；非产品 TerminalManager 接线验收 |
| 文件身份 / 版本 | fd 保留旧 inode；rename 替换后识别路径 inode 不同；旧 SHA-256 保存被拒绝；保留 CRLF | 通过 |
| 路径 | 根外符号链接、父目录替换为根外链接均拒绝；根外内容保持原样 | 已覆盖指定注入点，见下述最终竞态边界 |
| 原子保存 | 同目录 `wx` 临时文件、写入 / fsync、再校验版本及身份、rename；临时文件清理 | 可行性通过，不是外部写者的原子 CAS |
| watcher | 原生 change / rename / delete；有界队列溢出、ENOSPC 故障注入后失效重扫；目录改名 / 原路径重建时 inode 变化 | 通过；ENOSPC 为显式注入，不是耗尽主机资源 |
| watcher 限额 | 真实建立 128 个目录 watcher，第 129 个拒绝，finally 关闭全部句柄 | 通过 |
| 根冲突域 | canonical 同根 / 祖先 / 子根互斥；前缀同名兄弟不误判；无重叠项目、独立 / 全局 workspace 可同时持锁 | 通过 |
| 恢复阻塞 | 写进程仍存活时锁过期、关闭并重新打开真实 DB；持久记录保留身份，未知停止状态仍拒绝新写 | 原型通过；不是产品 Server 崩溃恢复已实现 |
| fencing | 旧 token 的写前检查、续租、释放及停止确认不能影响新代锁；确认真实退出后才能接管 | 通过 |
| 身份不符 | 对当前受控 fixture 使用不匹配启动身份，停止拒绝、原进程仍存活、冲突域仍受阻 | 通过；未人为制造 OS PID 回绕 |

根协调原型只在临时数据库创建 `m2_poc_writers`，复用现有锁服务及 fencing。该表不是产品迁移或第二套产品锁；M2-1 要将冲突域 / 停止确认放入统一 operation 协调协议，所有产品写入口首次接入时即采用。项目登记 / 移除 / 根变化也须在该协议下协调，不能按 projectId 独立放行。

## 已验证的边界与后续接线要求

1. **外部写入没有原子 CAS**：实验在最后一次版本校验与 rename 之间真实写入，rename 仍会替换该次外部修改。这是 spec §6 已明确的残余窗口；不能将当前原型作为可抵抗任意外部程序竞争的文件 API。M2-1 必须保留授权、fd / 路径身份重验、写意图、失败对账与冲突测试；不承诺由应用锁消除最后瞬间的文件 / 父目录替换竞态。
2. **进程组不是沙箱**：本次证明的是受控父子进程组的清理。交互 Shell 的前台 job 可能另建进程组，任意脚本也可能 daemonize / 脱组；不能仅对主 PTY 发信号就宣布整树停止。M2-3 / M2-4 须核对执行后代、退出与身份；无法确认则保持作用域受阻，不能按 TTL 自动接管。
3. **PID / ps 不构成强身份**：启动时间及命令核对只用于本次持有子进程句柄的 fixture。ps 存在精度及检查后变化窗口；重启后没有持有的进程句柄时，即使文本相同也不能据此自动误杀。未知旧写者保持阻塞，要求本机核实，不宣称已经解决任意 PID 复用或重启自动清理。
4. **监听只是失效提示**：队列、目录句柄或扫描限额触发后，必须提示部分监听 / 重扫；原路径重建时重查身份并重新附着，不能继续信任旧 watcher。保存正确性仍依赖版本重验，不依赖事件完整。
5. **产品接线仍按任务顺序**：实际 Server 资源生命周期、TUI 清理钩子、审批 / 鉴权、资源事件持久化、双客户端输入租约、输出轮转等在 M2-1～M2-8 实施。现有真实 TUI 回归通过，只证明既有 Server / Web 退出恢复，不把 supervisor 原型误称为产品 PTY 已接线。

## 回归与清理

- `pnpm check`：server 301 / agent 32 / web 26；agent 原有 live 测试 1 项按环境跳过。现有 Biome optional-chain 警告未扩展到本任务修复。
- `pnpm build`：Server 四入口及 Web 通过；既有 Node 20 弃用提示及 Web 大 chunk 提示保留。
- `pnpm test:tui:pty`：15 个检查场景通过，含 dev / built、Ctrl+C、SIGTERM、SIGHUP、启动失败、配对与阅读页面；子进程、锁及 IPC 清理通过。
- 所有文件、SQLite、fixture HOME / TMPDIR、native 副本与 PoC 构建产物均在 OS 临时目录，finally 清理；每次受控进程停止后检查父子退出。没有读写真实项目、用户配置 / 凭据或运行数据库。
- 本任务无产品 UI / REST / WS / 配置键 / 迁移变化，不运行新的资源浏览器 E2E，也不宣称 M2 后续验收场景已完成；完整浏览器回归归 M2-8。

## 人类门禁

- [x] M2-0 实验与当前 macOS 平台证据完成。
- [ ] 人类确认 G-PoC-M2：接受上述实测结果、原生安装补丁及已由 spec 明确的边界后，再开始 M2-1。

不从当前 macOS arm64 结果外推 Linux / Windows / x64 支持。回滚只需撤回本任务代码 / 依赖 / 补丁；没有产品数据迁移，无须删除任何用户数据。

2026-11-02 初次验证；2026-11-03（+08:00）最终全量 check、源码 / built PoC 复验通过，临时目录与匹配 fixture 进程残留均为 0，完成文档与提交收尾。
