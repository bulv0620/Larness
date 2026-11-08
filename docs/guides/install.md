# 安装、升级与卸载

> 状态：M5-3 进行中；先验证 macOS arm64。Linux / Windows 与完整预编译矩阵见 M5-4。

## 安装

要求：

- Node.js **20.19+**（当前开发基线；macOS arm64 已验证）
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
- macOS arm64 使用上游预编译；如果安装时下载失败，会回退到 `node-gyp`，需要 Xcode Command Line Tools。
- `npm install -g --ignore-scripts` 会跳过原生模块安装，不受支持。
- Linux / Windows 的预编译与安装说明在 M5-4 完成。

## 更新检查

- 检查只读公共 npm registry，不发送项目、路径、凭据或安装 ID。
- 不提供关闭开关；检查失败静默，不阻塞启动。
- 同一新版本只提示一次；不下载、不安装、不重启。
