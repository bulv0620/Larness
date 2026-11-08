---
id: 066-cross-platform
title: 跨平台安装与运行 PoC
milestone: M5
status: done
depends_on: [060-extension, 065-launcher-updater]
owners: [human]
created: 2026-11-08
updated: 2026-11-08
---

# 跨平台安装与运行 PoC（M5-4）

> 状态：`done`（2026-11-08 人类确认当前范围通过）。macOS Apple Silicon 已开发验证；CI 已删除。Windows 11 / Ubuntu 的支持承诺保留，实机与 Windows 终端/命令实现作为发布后跟踪项，未验证项不标通过。
> 背景：`larness@0.1.0` 已发布，仅验证 macOS arm64 + Node 20/22/24。M5-4 验证 macOS Apple Silicon、Ubuntu、Windows 11，并把安装 / 预编译 / 平台限制公开。

## 1. 背景与问题

Larness 依赖本机 PTY、SQLite、PM2、文件锁和进程树；这些能力在 macOS / Linux / Windows 上差异明显。当前：

- 只验证 macOS Apple Silicon；
- `node-pty@1.1.0` 提供 macOS / Windows 预编译，**没有 Linux 预编译**，Linux 安装可能回退到编译；
- `better-sqlite3@12.6.2` 提供 Node 20/22/24 的 macOS / Linux（含 musl）/ Windows 预编译；
- TUI、终端、PM2、文件锁、命令进程树的 Windows/Linux 行为未验收。

M5-4 不新增产品能力，只把“在哪些平台、以什么方式可用”验证清楚，并修复必要的平台差异。

## 2. 目标

- **G-1 支持矩阵**：明确 macOS Apple Silicon、Linux x64（glibc）、Windows x64 与 Node 20/22/24 的已验证组合。
- **G-2 npm 安装**：每平台用公共 npm `larness` 全局安装，`larness` 能启动 TUI/Server/Web；不引入 MSI / zip 安装器。
- **G-3 原生依赖**：记录 `better-sqlite3` / `node-pty` 的预编译与编译回退；Linux 无 `node-pty` 预编译时给出可操作要求。
- **G-4 核心链路**：至少验证项目、会话、Agent 文本、终端、命令、文件、Git、PM2 服务启停与日志。
- **G-5 本地冒烟与手动矩阵**：保留 `platform-smoke` / `npm pack` 本地脚本；三平台结果由人类在真实设备上验证并记录。仓库不配置 CI。
- **G-6 限制公开**：未验证组合、需要编译工具、Windows/Linux 特有限制写入安装文档与验收记录。

## 3. 非目标

- **NG-1 WSL 冒充 Windows**：WSL 可单独记录，但不计作 Windows 原生支持。
- **NG-2 Alpine / musl 支持承诺**：`better-sqlite3` 有 musl 预编译，但 `node-pty` 仍需编译；musl 不作为 M5-4 必验组合。
- **NG-3 Windows ARM64 / Linux ARM**：不承诺；可作为实验记录。
- **NG-4 MSI / zip / 系统服务安装器**：安装只走 npm；OS 服务管理器守护留后续。
- **NG-5 CI 自动化**：仓库不配置 CI；三平台验证由人类在真实设备执行，脚本只作为本地辅助。
- **NG-6 自动更新 / 签名**：M5-3 已决定只提示 npm 更新；不变。

## 4. 用户故事

- 作为 macOS Apple Silicon 用户，我希望在 Node 20/22/24 下都能 npm 安装并启动。
- 作为 Linux 用户，我希望知道是否需要 build-essential / Python，以及哪些功能已验证。
- 作为 Windows 用户，我希望用 PowerShell 安装 `larness` 后能打开 TUI、终端和项目会话。
- 作为维护者，我希望有可复用的本地冒烟脚本和验收表，在三台实机上记录结果。

## 5. 验收场景

### A1 macOS Apple Silicon 安装

```gherkin
Given macOS Apple Silicon、Node 20/22/24
When npm install -g larness 并运行 larness --version
Then 安装成功，版本与 npm 一致
And TUI/Server 可启动，SQLite 与 PTY 可用
```

### A2 Ubuntu x64 安装

```gherkin
Given Ubuntu 22.04 / 24.04 x64、Node 20/22/24
When npm install -g larness
Then better-sqlite3 使用预编译
And node-pty 使用预编译或按文档编译成功
And larness 启动，终端可创建
```

### A3 Windows x64 安装

```gherkin
Given Windows 11 x64、Node 20/22/24、PowerShell
When npm install -g larness 并运行 larness
Then TUI 启动，Server/Web 可访问
And 可创建项目、终端与会话
And 不把 WSL 结果当作 Windows 原生结果
```

### A4 原生依赖缺失 / 编译回退

```gherkin
Given node-pty 没有当前平台预编译
When npm install -g larness
Then 文档给出编译工具要求（Linux: build-essential/python；macOS: Xcode CLT；Windows: VS Build Tools）
And 安装失败时错误可操作，不谎报安装成功
```

### A5 终端与命令

```gherkin
Given 各平台安装完成
When 创建终端、发送输入、Ctrl+C、关闭 Tab
Then PTY 正常，进程树被清理，不残留子进程
And Windows 的 ConPTY / 进程终止行为记录差异
```

### A6 PM2 服务

```gherkin
Given 各平台已安装 PM2 或允许 TUI 补装
When 启动 / 停止 / 重启一个 Node 服务并读取日志
Then 状态与实际进程一致
And Windows 的 PM2 限制（信号、日志、守护）如实记录
```

### A7 文件 / Git / 路径

```gherkin
Given Windows 反斜杠路径、盘符、大小写不敏感文件系统；Linux 区分大小写
When 读取 / 保存 / 重命名 / Git 操作
Then 路径边界与冲突检测正确，不越界
```

### A8 三平台实机验证

```gherkin
Given 三台真实设备（macOS Apple Silicon、Ubuntu、Windows 11）
When 操作者按验收表执行 check / build / platform-smoke / pack 安装
Then 每个平台单独记录结果与限制
And 失败平台不被标记为通过
```

### A9 安装文档

```gherkin
Given 用户选择平台
When 阅读安装文档
Then 能看到 npm 命令、Node 版本、原生依赖、已验证功能、未验证限制
And 不出现“全平台支持”的未证实表述
```

### A10 发布包内容

```gherkin
Given npm pack 产物
When 在三个平台安装
Then 不依赖 pnpm / 源码目录；dist、drizzle、web、LICENSE 完整
And 不包含平台无关的测试 / 数据 / 秘密
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 支持矩阵显式写为：macOS Apple Silicon、Ubuntu 22.04/24.04 x64 glibc、Windows 11 x64；Node 20/22/24。 |
| R-2 | MUST | 安装方式只走公共 npm 全局安装；不新增 MSI / zip 安装器。 |
| R-3 | MUST | `better-sqlite3` 固定 `12.6.2`，覆盖 Node 20/22/24 与三平台预编译；不得升级到缺 Node 20 预编译的版本。 |
| R-4 | MUST | Linux 无 `node-pty` 预编译时，安装文档要求 build-essential / python / make；Windows / macOS 使用包内预编译。 |
| R-5 | MUST | 仓库不配置 CI；三平台由人类实机验证并填写验收表。macOS Apple Silicon 当前已开发验证；Ubuntu / Windows 的结果由实机决定，未验证不得标通过。 |
| R-6 | MUST | Windows 原生支持以 PowerShell/cmd 验证；WSL 结果单列，不冒充 Windows。 |
| R-7 | MUST | 终端、命令、PM2、文件/Git 至少各有一个平台冒烟；失败或未验证功能明确标注。 |
| R-8 | MUST | 路径处理使用 `node:path`；Windows 盘符 / 反斜杠 / 大小写不敏感边界有测试或记录。 |
| R-9 | MUST | 进程树终止、PTY 关闭、信号差异在 Linux/Windows 有实测或明确未验证。 |
| R-10 | MUST | 安装文档包含每平台 Node 版本、原生依赖、已验证 / 未验证功能与限制。 |
| R-11 | MUST | 失败平台不进入“通过”；验收表逐平台列出结果。 |
| R-12 | SHOULD | 安装冒烟使用 `npm pack` 后的 tarball 做临时全局安装，而不是只跑源码测试。 |
| R-13 | SHOULD | 记录 Windows / Linux 特有限制（PM2 信号、文件锁、路径大小写、终端行为）。 |
| R-14 | SHOULD | 不新增原生依赖；若必须新增，先更新安全 / 平台评估。 |

## 7. 接口与配置

- 无新产品 REST / WS / IPC 接口；只有平台适配与安装文档。
- `engines.node` 保持 `>=20.19`；已验证 Node 20/22/24。
- 无 CI；本地脚本 `scripts/platform-smoke.mjs` 与 `scripts/verify-npm-pack.mjs --install` 供三台实机复用。
- 安装文档按平台拆分命令；不新增 `larness` 子命令，除非跨平台 smoke 需要只读诊断。

## 8. 数据与迁移

- 不新增数据库表；各平台数据目录由 `env-paths` 解析，需验证权限 / 路径。
- 升级前备份在 Windows 上的 `chmod` / 文件锁行为需验证；失败仍拒绝迁移。
- 不修改项目源码目录或 PM2 数据。

## 9. 安全、权限与审计

- 安装 / 运行仍以当前用户权限；不请求 sudo / 管理员权限，除非用户自行决定 npm prefix。
- Windows 不声称 AppContainer / 沙箱；Linux 不声称 namespace 隔离。
- PM2 仍是进程管理器，不是安全沙箱。
- 平台差异不得降低现有认证、CSRF、项目边界、锁和审计要求。
- 文档不得把未验证平台写成“支持”。

## 10. 失败、边界与恢复

| 场景 | 行为 | 用户可见信息 |
|---|---|---|
| Linux 缺 node-pty 预编译/编译工具 | 安装失败 | 安装 build-essential/python 后重试 |
| better-sqlite3 预编译缺失 | 编译回退或失败 | 需要工具链 / 支持的 Node 版本 |
| Windows 无 PM2 / 权限不足 | TUI 提示不可用 | 安装 PM2 / 用户级 prefix |
| Windows 路径大小写冲突 | 拒绝 / 冲突提示 | 不静默覆盖 |
| ConPTY 不可用 | 终端失败 | 明确错误，不伪造终端 |
| Linux 文件锁 / 信号差异 | 记录并限制 | 文档标注 |
| 实机平台失败 | 该平台不标通过 | 验收表记录 |
| WSL 测试 | 单列 | 不作为 Windows 原生证据 |

## 11. 可观测性

- 安装冒烟输出 OS / arch / Node / npm / 版本 / 原生模块结果。
- 每个平台保存独立日志；失败保留安装日志。
- 验收表：平台、Node、安装、启动、终端、PM2、文件/Git、结果。
- 不记录秘密、数据目录内容或用户项目内容。

## 12. 测试计划

- **单元 / 集成**：现有 `pnpm check` 在三平台 × Node 矩阵通过；平台条件测试启用。
- **安装**：`npm pack` → 临时全局 prefix → `larness --version` / 启动冒烟；三平台。
- **平台冒烟**：PTY、命令取消、PM2 start/stop/log、文件保存 / 冲突、Git 状态、路径边界。
- **实机**：macOS Apple Silicon、Ubuntu 22.04/24.04、Windows x64；Node 20/22/24。
- **手动**：Windows 11、Ubuntu、macOS Apple Silicon 实机；记录限制。

## 13. 开放问题与待确认决策

| ID | 决策（2026-11-08 用户确认） |
|---|---|
| D1 | Windows 11 x64 原生（PowerShell/cmd）；WSL 单列，不计 Windows 原生 |
| D2 | Linux 先验证 Ubuntu 22.04 / 24.04 x64 glibc；musl / ARM 不承诺 |
| D3 | Linux 接受 build-essential / python 编译回退；暂不自建 node-pty Linux 预编译包 |
| D4 | 平台顺序 macOS Apple Silicon → Linux → Windows；Node 20/22/24 |
| D5 | 仓库不配置 CI；三平台由人类实机验证；安装只走 npm，不做 MSI/zip |

已确认后：spec 转 `ready`，本地冒烟脚本与安装文档先行；仓库不配置 CI。

## 14. 完成定义

- [ ] A1–A10 通过，或逐项记录未验证；
- [ ] 三平台安装 / 启动 / 核心冒烟结果；
- [ ] Node 20/22/24 矩阵；
- [ ] `better-sqlite3` / `node-pty` 预编译或编译要求文档化；
- [ ] 三平台实机结果与安装文档；
- [ ] `pnpm check` / `build` / Demo / auth E2E 回归；
- [ ] 人类验收。
