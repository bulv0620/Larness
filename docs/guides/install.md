# 安装、升级与卸载

> 状态：macOS Apple Silicon 已验证；Windows 11 / Ubuntu 待实机。支持矩阵与限制见 [known-limitations](https://github.com/bulv0620/Larness/blob/main/docs/known-limitations.md)；发布流程见 [release](https://github.com/bulv0620/Larness/blob/main/docs/process/release.md)。不支持 macOS Intel。

## 安装

要求：

- Node.js **22.22+（22.x）/ 24+**，请使用对应主版本的最新补丁版；macOS Apple Silicon 已验证 22.23.4 和 24.22.2
- 发布包固定 `better-sqlite3@13.0.3`。其 npm 包内含 Node-API 预编译文件，macOS Apple Silicon 已在 Node 22 和 24 实测
- macOS 需要 Xcode Command Line Tools 仅在原生依赖没有可用预编译时使用
- Ubuntu 的 `node-pty` 没有预编译，可能需要 `build-essential`、`python`、`make`
- Windows 安装、启动与原生模块仍待实机验证；终端、命令当前不可用，见 [known-limitations](https://github.com/bulv0620/Larness/blob/main/docs/known-limitations.md)
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

Larness **不会自动更新**。TUI 启动时和每日检查公共 npm 并提示新版本。等待 Agent Turn、部署和数据库写入完成后，正常退出 TUI，再安装新版本。

```bash
npm install -g larness@latest
```

升级后重启 `larness`。新版本首次启动会在数据库迁移前自动备份到数据目录的 `backups/`；备份失败会拒绝迁移并退出。

## 降级

先等待在途作业完成并正常退出 TUI，再安装旧版本。

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
- macOS Apple Silicon 使用上游预编译。`node-pty` 安装回退编译时需要 Xcode Command Line Tools。
- `npm install -g --ignore-scripts` 会跳过原生模块安装，不受支持。
- npm 11 会提示 `install-scripts` 未审查；脚本仍会执行。若被策略阻止，使用：
  `npm install -g larness --allow-scripts=node-pty@1.1.0`
- npm 11 全局安装可能把 `node-pty` 的 `spawn-helper` 解压成不可执行；Larness 在创建终端前会修复该文件权限（仅 macOS），不需要用户手动 chmod。
- Linux 安装可能需要编译 `node-pty`；Windows 原生终端/命令尚未实现。

## 相关文档

- [支持矩阵与已知限制](https://github.com/bulv0620/Larness/blob/main/docs/known-limitations.md)
- [本地发布 / 升级 / 回滚清单](https://github.com/bulv0620/Larness/blob/main/docs/process/release.md)
- [安全复核](https://github.com/bulv0620/Larness/blob/main/docs/security/review.md)

## 更新检查

- 检查只读公共 npm registry，不发送项目、路径、凭据或安装 ID。
- 不提供关闭开关；检查失败静默，不阻塞启动。
- 同一新版本只提示一次；不下载、不安装、不重启。
