# M4-4 验收记录：真实发布闭环与 G4 候选

> 2026-11-06，分支 `task/m4-4-integration-g4`。实测 macOS arm64、Node 20.19.3、PM2 7.1.2（临时 npm prefix）。**G4 需人类最终验收，本记录不自行标通过。**

## 1. 真实闭环证据

`pnpm test:pm2:m4` 运行 `m4-4-integration.test.ts`，通过真实认证 REST 完成：

1. TUI 受管入口 `startServer` 以临时 prefix 复用全局 PM2，`pm2Global=ready`。
2. 创建项目、构建 v1、生成计划、按 autonomous Session 申请授权、消费并 apply；真实 PM2 启动，HTTP `/health` 返回 v1，服务记录 `running/v1`。
3. 通过 REST 申请 restart 日常动作授权并执行，服务保持 v1 运行。
4. 构建/发布 v2，HTTP 返回 v2；发布记录保存 previous v1。
5. 构建 v3（健康返回 500），apply 失败并用 v2 回滚；HTTP 仍为 v2，部署状态 FAILED / `HEALTH_FAILED_ROLLED_BACK`。
6. 发布历史 3 条，日志包含 ready v2，`ops:<target>` 事件可重放。
7. 结束时停止临时 PM2 守护并清理临时数据。

`service-ops-pm2.test.ts` 另行覆盖 start/stop/restart、v1→v2、健康失败回滚、PM2 停止后 reconcile、合成秘密不进入应用环境/dump/日志。

## 2. M4 场景汇总

| 场景 | 证据 | 状态 |
|---|---|---|
| D1 检查/构建失败/取消 | M4-1 构建测试；M4-4 v3 失败不替换运行版本 | 覆盖 |
| D2 首次部署 | M4-4 真实 v1 apply + HTTP 健康 + 记录 | 覆盖 |
| D3 v1→v2 | M4-4 真实替换 + previousVersion/发布历史 | 覆盖 |
| D4 standard/strict 审批；篡改/过期/拒绝 | M4-2 授权测试；M4-3b 日常动作审批 | 覆盖（服务层） |
| D5 autonomous 免人工 | M4-2 autonomous 无人工记录；M4-4 REST autonomous apply | 覆盖 |
| D6 未鉴权/scope/hash/锁/取消 | M4-2/M4-3 REST 401/CSRF/404、scope/hash、锁测试 | 覆盖（服务层） |
| D7 健康失败/未知/恢复 | M4-3/M4-4 健康失败回滚；PM2 不可用 FAILED/unknown | 覆盖 |
| D8 不可逆迁移限制 | M4-1/M4-2 计划固定 databaseRollback unsupported | 覆盖（能力声明） |
| D9 人/AI 同版本动作 | M4-3b 人 REST 与 Agent 工具共用 runtime/授权/审计；**两客户端正式服务 UI 未跑** | 部分 |
| D10 DB RUNNING vs 实际 | M4-3 真实 PM2 停止后 reconcile failed | 覆盖 |
| D11 退出/重开对账 | M4-0 同 PID/健康；M4-3 不关闭守护 + reconcile；**完整重开浏览器路径未跑** | 部分 |
| D12 同版本 restart 不能换产物 | 日常动作只读当前 artifact/version；版本变更须 plan/apply | 覆盖 |
| D13 独立运维页/开发浮窗 | M4-3b 浏览器 E2E 独立入口/空态；正式服务列表浏览器展示未跑 | 部分 |
| D14 两类模型上下文 | context assembler 工具/schema/prompt/目标测试；**真实模型 Provider 调用未跑** | 部分 |
| D15 跨域伪造 | REST 404、TOOL_NOT_FOUND、伪造开发 Turn 拒绝；启用预览的完整反例未跑 | 部分 |
| D16 正式/临时身份独立 | 独立 ID/表/REST/事件；浏览器同时展示未跑 | 部分 |

## 3. 检查与未跑项

- `VITEST_MAX_WORKERS=3 pnpm check` 通过：web 125、agent 33（1 skipped）、server 492（9 skipped），合计 650 passed / 10 skipped；`pnpm build` 通过。
- `pnpm test:pm2:m4` 2 个真实 PM2 测试通过。
- `e2e-auth/service-ops.spec.ts` 独立入口/页面/空态通过；未在浏览器中同时展示真实正式服务与临时开发服务。
- 未运行：两独立认证客户端观察/操作同一正式服务、真实模型 Provider 的运维 Turn、启用预览的跨域反例、主机重启/开机自启、Linux/Windows、零停机。
- 因此本记录是 **G4 候选**，不是 G4 通过；需人类验收上述残余矩阵或明确接受范围。

## 4. 边界

- 只支持 Node 入口正式服务；非零停机；PM2 版本固定 7.1.2。
- Q-029 正式 secretRef 注入未交付；仅验证合成秘密不进入应用环境/dump/日志。
- 正式服务依赖 PM2 可用；初始化失败只限制运维，不阻塞开发。
- 数据/产物/PM2 运行目录在源码外；测试使用临时目录并清理。
