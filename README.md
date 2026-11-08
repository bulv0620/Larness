# Larness

Larness 是在自己电脑上运行的 AI 开发工作台。配对浏览器后，可以在同一个工作空间里和 Agent 协作，编辑文件、使用终端、管理 Git、预览开发服务，并查看本机运行的应用。

## 安装

```bash
npm install -g larness
larness
```

macOS Apple Silicon 已验证，使用 Node.js 20.19+、22 或 24。其他平台的状态见 [支持范围](https://github.com/bulv0620/Larness/blob/main/docs/known-limitations.md)。升级和卸载步骤见 [安装指南](docs/guides/install.md)。

## 开始使用

1. 在终端控制台（TUI）完成首次初始化，打开控制台显示的 Web 地址，默认是 `http://localhost:3210`。
2. 从浏览器发起配对，在本机控制台处理申请。可以临时授权，也可以通过 Passkey 保存可信凭据。
3. 在「设置与模型」添加模型 API Key，选择默认工作区或关联本机项目，然后开启对话。

## 可以做什么

- **开发协作**：使用 DeepSeek、GLM 或兼容端点，查看任务计划、工具执行进度和上下文用量。可以让 Agent 读写项目文件、运行命令，或把项目终端交给 Agent 操作。
- **本机预览与运维**：打开已登记的开发服务预览。通过项目会话使用 PM2 命令，在服务运维界面查看日志、启动、停止或重启正式服务。
- **定时运行**：从工作台设置 Cron 或固定间隔任务，运行 JavaScript 脚本或 Agent，查看运行历史。

退出控制台会停止 Web 管理面和临时开发资源。已由 PM2 托管的正式服务会继续运行。命令、项目脚本和定时任务使用 Larness 运行账户的权限，请在可信开发机上使用。

## 从源码运行

```bash
pnpm install
pnpm dev
```

构建后可用 `pnpm build` 和 `node app.js` 启动打包形态。

## 许可证

[MIT](LICENSE)
