# G4 手动验收清单（M4）

> 2026-11-06。G4 由人类手动验收；本清单只提供可复现步骤与当前缺口，不代表已通过。默认 macOS、本机 `pnpm`/Node 20。

## 1. 自动化证据（先跑）

```bash
VITEST_MAX_WORKERS=3 pnpm check
pnpm build
pnpm test:pm2:m4
LARNESS_E2E_PORT=3330 LARNESS_E2E_WEB_PORT=5330 pnpm test:e2e:auth --grep "service operations"
```

预期：check 650 passed / 10 skipped；build 成功；PM2 测试 2/2（临时 prefix 安装 7.1.2，真实启动/替换/回滚/对账）；浏览器独立入口 1/1。测试不会改动默认数据目录或全局 PM2。

## 2. 手动启动与入口

```bash
pnpm dev
```

- TUI 首次启动会检查全局 PM2；缺失时安装 `pm2@7.1.2`。安装失败时应提示原因并仍允许开发功能。
- 浏览器打开 TUI 显示的地址，完成 Passkey/配对登录。
- 左侧底部点击「服务运维」：应打开符合现有 Dialog 风格的弹窗，显示「正式服务 · 独立于当前聊天」和空态；URL 不跳转；关闭弹窗回到原工作区。聊天/资源区不显示正式服务，聊天浮窗也不显示正式服务。
- 点击「自动化任务」（暂为占位）不应影响服务运维弹窗。

## 3. 已有正式服务的页面操作

如果已通过 Agent/REST 创建正式服务：

1. 服务列表显示实际 `observedState`、版本、PID、健康时间。
2. 启动/停止/重启按钮调用后端授权；autonomous 会话直接执行，standard/strict 显示「需要人工审批」并出现批准/拒绝；readonly 应拒绝。
3. 操作后页面状态、PID、日志和发布历史刷新；失败保留真实 reasonCode，不伪报成功。
4. 发布历史显示首次/替换、版本、失败/回滚原因；日志读取有界。
5. 运维 Agent 输入框：选择会话后发送「检查并重启」；创建绑定该目标的运维 Turn，聊天页应看到工具结果。普通开发 Turn 不应出现运维工具。

## 4. 直接检查 PM2/数据

```bash
# 受管 PM2 实例（默认数据目录；测试/独立数据目录替换路径）
PM2_HOME="$HOME/Library/Application Support/larness/pm2" \
  "$(npm root -g)/pm2/bin/pm2" list
```

- 应用名应为 `larness-<targetId>`，namespace `larness`；停止 TUI（正常退出）后正式服务应保持运行，重开 TUI 后页面通过 `reconcile` 显示实际状态。
- PM2 不可用时页面显示失败/未知，不应自动拉起无关进程。

## 5. 当前缺口（手动验收需明确）

- **页面/Agent 尚无新建正式部署的完整入口**：M4-4 的首次部署/版本替换/回滚通过已认证 REST 自动化验证；运维页目前展示已有服务并执行日常动作，不提供“选择项目→构建→计划→发布”按钮。
- **未跑**：两个独立认证客户端同时观察/操作同一正式服务；真实模型 Provider 的运维 Turn（仅组装上下文/工具测试）；启用预览的跨域矩阵；主机重启/开机自启；Linux/Windows；零停机。
- Q-029 正式 `secretRef` 注入未交付；只验证合成秘密不进入应用环境/dump/日志。

如手动验收需要“在页面上从项目创建并发布一个正式服务”，需另立 UI/Agent 构建发布入口任务后再验收。
