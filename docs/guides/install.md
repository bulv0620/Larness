# 安装、升级与卸载

> 状态：M5-4 进行中；macOS Apple Silicon 已验证，Windows 11 / Ubuntu 待实机确认。不支持 macOS Intel。

## 安装

要求：

- Node.js **20.19+ / 22 / 24**；macOS Apple Silicon 已在 20.19.3、22.23.4、24.22.2 验证
- 发布包固定 `better-sqlite3@12.6.2`，该版本提供 Node 20 / 22 / 24 的 macOS Apple Silicon 预编译；不升级到 12.11+（缺少 Node 20 预编译）或 13（engines 要求 Node 22+）
- macOS 需要 Xcode Command Line Tools 仅在原生依赖没有可用预编译时使用
- npm 全局目录可由当前用户写入；否则按 npm 文档配置用户级 prefix，不建议 `sudo`

```bash
npm install -g larness
larness
```

`larness` 启动 TUI、Server 与 Web，和 `node app.js` 的受管入口一致。首次运行按初始化向导配置，随后在 TUI 配对浏览器。

```bash
larness --version   # 当前版本
larness status      # 只读状态快照
larness doctor      # 本机诊断
```

## 升级

Larness **不会自动更新**。TUI 启动时和每日检查公共 npm，发现新版本只提示：

```bash
npm install -g larness@latest
```

升级后重启 `larness`。新版本首次启动会在数据库迁移前自动备份到数据目录的 `backups/`；备份失败会拒绝迁移并退出。

## 降级

```bash
npm install -g larness@<version>
```

如果数据库已经升级到更高 schema，旧程序会拒绝启动，避免用旧代码打开新库；此时应安装支持该 schema 的版本，或按备份恢复（先停止 Larness，保留当前数据库副本）。

## 卸载

```bash
npm uninstall -g larness
```

卸载不会删除数据目录、项目源码或 PM2 服务。需要彻底清理时，按数据目录说明手动处理。

## 原生依赖

- `better-sqlite3` 与 `node-pty` 是原生模块。
- macOS Apple Silicon 使用上游预编译；如果安装时下载失败，会回退到 `node-gyp`，需要 Xcode Command Line Tools。
- `npm install -g --ignore-scripts` 会跳过原生模块安装，不受支持。
- npm 11 会提示 `install-scripts` 未审查；脚本仍会执行。若被策略阻止，使用：
  `npm install -g larness --allow-scripts=better-sqlite3@12.6.2,node-pty@1.1.0`
- npm 11 全局安装可能把 `node-pty` 的 `spawn-helper` 解压成不可执行；Larness 在创建终端前会修复该文件权限（仅 macOS），不需要用户手动 chmod。
- Node 20 安装时 `cookie@2` / `content-disposition@3` 会显示 engine warning（这两个传递依赖声明 Node ≥22）；Node 20 的测试与运行已验证，后续可再评估固定 Fastify 传递版本。
- Linux / Windows 的预编译与安装说明在 M5-4 完成。

## 更新检查

- 检查只读公共 npm registry，不发送项目、路径、凭据或安装 ID。
- 不提供关闭开关；检查失败静默，不阻塞启动。
- 同一新版本只提示一次；不下载、不安装、不重启。
