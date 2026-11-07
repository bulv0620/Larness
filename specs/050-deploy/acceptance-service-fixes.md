# M4-R2 人工验收纠错

> 2026-11-07 用户确认 M4 与后续修改全部验收通过，见 [G4 收尾](closure.md)。下文保留当时的验证记录。

2026-11-07，分支 task/m4-r2-service-ops-fixes，必要校验；G4 保持 review，界面待人类。

## 原因与修复

- 用户的 todo-list 服务真实运行在 `<dataDir>/pm2`，实际 PID 92979，与默认 `~/.pm2` 是不同实例。全局安装的 PM2 可操作多个实例。保持既有实例，服务列表增加实际 pm2Home，弹窗提供带正确引用的同实例终端查询命令。
- 上轮前端控制请求遗漏 apiFetch 的 csrf:true，且 body 预先 JSON.stringify，导致现有 helper 再次序列化。改为对象 body 与 csrf:true。原 UI 测试 mock 了 API，后端集成直接 inject，所以漏掉传输缺陷；本轮新增未 mock apiFetch 的实际 fetch 边界测试，检查请求头与 JSON 对象。
- 用户项目配置日志为项目 `.pm2/out.log`，原实例目录约束拒绝。用户明确批准 ADR-052 后，允许实际唯一 PM2 应用登记、且属于该服务 canonical 项目根的精确普通日志。拒绝其他项目、越界、最终 symlink、namespace/身份未知；保留 O_NOFOLLOW、文件身份重验、限额与脱敏。历史项目路径不授予读取权限。

## 验证

先写测试并看到失败：Web 请求缺 CSRF；真实 PM2 项目日志为 503；文件边界测试因项目日志不被允许而失败，随后实施。

- Web `ServiceOpsDialog.test.tsx` + `api.test.ts`：2 文件、4 项通过，涵盖实际请求序列化/CSRF、实例命令、既有人工按钮和所属项目入口。
- `LARNESS_POC_PM2=1` 下 `pm2-cli.test.ts`、`service-ops-logs.test.ts`、`service-ops-pm2.test.ts`：3 文件、3 项通过。真实项目目录 stdout 日志可读；启停/重启、幂等/中断、认证/CSRF/写锁与旧产物服务兼容保持；日志含秘密被脱敏，跨项目/链接/身份未知被拒绝。
- Server / Web / shared typecheck、9 个本轮 TS/TSX 文件 Biome 与 git diff --check 通过。
- 本机只读核验：指定真实 PM2_HOME 的 pm2 list 找到 todo-list、PID 92979；以只读数据库和新 ServiceOpsRuntime.logs 读取实际用户服务日志成功，408 字节。未打印日志正文、凭据或 PM2 env；未启停、重启或迁移用户服务。私有测试实例均清理。

未跑全量 pnpm check、生产构建、浏览器 E2E、真实模型、双客户端/跨平台。原有 M4-R0/R1 改动保留，本轮未提交。重启管理面加载后端修复、刷新 Web 后手动验证日志与按钮。用户可从弹窗折叠区域复制同实例查询命令；关闭管理面不终止已托管 PM2 服务。
