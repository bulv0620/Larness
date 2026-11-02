# 任务卡

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| I0-1 | 日志真实按天保留 | G1 | done |
| I0-2 | 初始化配置保留与崩溃恢复 | I0-1、ADR-024 | done |
| I0-3 | 已有凭据的主密钥启动校验 | I0-2、ADR-024 | done |
| I0-4 | 向导简化、取消密码与配置自动应用 | I0-3、ADR-024/025 | done |
| I0-5 | 日志清理与写入启动顺序 | I0-4 | done |

每个任务的验收按 spec 对应场景执行，pnpm check 通过后提交。ADR 未批准时仅执行 I0-1。

## I0-1
- [x] 失败测试：同日多文件、时间过期、无关文件/符号链接、清理失败可见；新增模块前测试因缺少实现失败。
- [x] 实现并验收：pnpm check 通过（agent 32 / server 241 / web 26）；pnpm build 通过。
- 实现：移除轮转库数量限制，按 mtime 清理，启动和每 24 小时执行，关闭/启动失败停止定时器并等待清理结束。
- 偏差：无；本任务不涉及 Web 或认证，E2E 留给 I0-4 最终验收。

## I0-2
- [x] 保留预置配置与环境值分离；并发唯一成功。
- [x] 文件/DB 中断恢复测试与启动集成；pnpm check（server 248 / agent 32 / web 26）、pnpm build 通过。
- 方案：提交前不触碰原文件；提交后 app_meta.init_pending 可重放发布，fsync 文件/目录后清理记录。发布失败业务关闭。非法配置/恢复记录、审计失败、并发和重启均有覆盖。

## I0-3
- [x] 丢失/错误/格式错误密钥拒绝、无密文允许生成、恢复原密钥可用。
- [x] 启动测试、全量检查：pnpm check（server 251 / agent 32 / web 26）、pnpm build 通过。
- 无新依赖/迁移；启动逐条验证所有持久化 secret；故障无 IPC/HTTP，锁可释放，原数据及密钥不覆盖。

## I0-4
- [x] 默认/高级设置、环境 URL、密码取消/历史哈希、重启顺序与失败测试。
- [x] check/build/demo/auth/prod E2E、真实构建进程 smoke、文档同步。server 261 / agent 32 / web 26；Demo 15 / auth 2 / prod 2。
- 详见 acceptance.md；协议 v2 随 TUI/server 一起升级；无破坏性迁移。

## I0-5
- [x] 先失败的启动顺序测试，验证清理完成后才创建 logger。
- [x] 保留每日调度/失败日志，check（server 263 / agent 32 / web 26）/build/真实进程 smoke 通过。
