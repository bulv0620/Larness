# M4-R4 已删除服务退出列表

> 2026-11-07 用户确认 M4 与后续修改全部验收通过，见 [G4 收尾](closure.md)。下文保留当时的验证记录。

2026-11-07，`task/m4-r4-deleted-service-list`，按用户要求只做必要检查。

可靠 PM2 对账确认缺失后，当前服务运维列表与 Agent 摘要排除该服务，停止仍保留。内部 pm2Present 复用 config_json、与状态事件同事务提交，失联或身份冲突不改变存在性；同名重建恢复原目标。详情、产物、日志安全边界和历史记录保留。当前详情所选项消失时退回列表，关闭确认、停止查询其日志。无新增 API、迁移、依赖或授权变更。

- 先写回归：PM2 空快照时原列表仍返回一项；UI 刷新移除选中项后原停止确认仍打开，均复现失败。
- Web `ServiceOpsDialog.test.tsx`、`api.test.ts` 5 项通过；覆盖确认关闭/空列表及原操作边界。
- Server `service-ops-logs.test.ts`、`service-ops.test.ts`、`pm2-cli.test.ts`、`service-ops-pm2.test.ts` 6 项通过（`LARNESS_POC_PM2=1`）。真实私有 PM2 停止保留、删除移出 API/实际模型摘要、保留详情 ID、同名重建恢复旧 ID，兼容旧发布；未知观察保留存在性、已确认缺失不复活。
- Server/Web 类型检查、6 个变更 TS/TSX 文件 Biome、git diff --check 通过。未操作用户实例，测试临时实例已清理。

未运行全量 pnpm check、构建、浏览器 E2E 或真实模型。重启管理面加载修复后手动核对删除/停止列表。G4 保持 review；原工作和本轮未提交改动保留。
