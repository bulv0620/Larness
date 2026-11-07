# M4-R1 服务运维 UI 与人工控制验收

> 2026-11-07 用户确认 M4 与后续修改全部验收通过，见 [G4 收尾](closure.md)。下文保留当时的验证记录。

2026-11-07，分支 `task/m4-r1-service-ops-ui`。按用户要求只做必要校验，UI 待人类验收，G4 保持 review。

## 交付

- 弹窗使用项目服务窗一致的卡片列表→详情、状态徽标、信息卡与深色日志样式，移除可见副标题。保留项目关系、实际状态、有限日志、旧发布历史和所属项目会话入口。
- 人类可启动、停止、重启 PM2 已有服务；停止/重启先确认准确服务/项目，取消不发请求，执行中禁用，失败显示提示并刷新真实观察。运行状态与健康核验分开。
- 新增严格人工控制 REST，复用资源操作意图、客户端认证/CSRF、项目→服务 fenced 租约锁、精确 PM2 身份复核与幂等。成功状态/事件/审计同事务，失败不自动重试；中断意图租约到期后标失败，不重放副作用。无新 Agent 工具/依赖/迁移，不改配置/环境，不重建缺失应用。

## 必要验证

测试先失败：Web 回归捕获旧副标题和缺失卡片/按钮；真实 PM2 回归捕获控制端点 404，随后实现。

- `pnpm --filter @larness/web test src/features/serviceOps/ServiceOpsDialog.test.tsx src/features/windows/ServiceWindow.test.tsx`：2 文件、8 项通过。新服务运维 3 项覆盖列表/详情/项目会话、启动、停止确认/取消/失败，原服务窗 5 项回归通过。最后 UI 细调后重跑新 3 项通过。
- `LARNESS_POC_PM2=1 pnpm --filter @larness/server test test/resources/pm2-cli.test.ts`：真实私有实例通过。两项目命令部署、人工停止/启动/重启、新 PID、同键不重复重启、同键异参/错误名称/未确认参数/未登录/缺少 CSRF/项目写锁拒绝；模拟副作用后中断的持久意图不重放。日志、Agent 命令停止与管理面退出后持久运行继续通过。修正鉴权测试的 Origin 输入后通过，未放宽拒绝断言。
- 同组运行的 `test/resources/service-ops.test.ts` 与 `test/resources/service-ops-pm2.test.ts`：2 文件、4 项通过，兼容旧产物服务与真实 PM2。
- Server、Web、shared typecheck 通过；本轮 10 个变更 TS/TSX 文件 Biome 与 `git diff --check` 通过。
- 进程测试仅使用源码外临时目录、临时 npm prefix、私有 PM2_HOME，结束清理，不操作用户服务。

## 未运行与交接

未运行全量 `pnpm check`、生产构建、浏览器 E2E、真实模型、双客户端矩阵与跨平台验证。浏览器测试期待已同步，但未执行。手动步骤见 [G4 清单中的 M4-R1](g4-manual.md#服务运维界面与人工控制m4-r1)。浅/深色及窄屏、视觉一致性和人工实际交互由用户验收。

保留 M4-R0 既有未提交改动，本轮也留在工作区；未运行全量提交门禁，因此未创建提交。无新增开放产品问题。M4-R1 交付 review，G4 未自行通过。
