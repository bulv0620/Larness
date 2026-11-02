# 任务：M3 临时服务登记、持久服务与 Preview

> draft，2026-11-02。保留 M3-1～M3-6 ID；补 M3-0 / M3-3b / M3-5b 细分，均 todo。依赖满足也不得跳过 G-Spec-M3。仅文档规划，未开始实施；每卡估 1–2 天，实际超出先拆分。一次一个任务、先红测试、单任务提交。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| M3-0 | 服务 / 预览身份与退出 PoC | G2；G-Spec-M3；Q-002 / 003 / 026 / 027 | `todo` |
| M3-1 | 临时服务登记、查询与退出退登 | M3-0 | `todo` |
| M3-2 | 服务窗口项目筛选、卡片与详情 | M3-1 | `todo` |
| M3-3 | PreviewRegistry、HTTP / WS 固定上游 | M3-1 | `todo` |
| M3-3b | 预览隔离与生命周期安全矩阵 | M3-3 | `todo` |
| M3-4 | Browser 与 Agent 预览卡片 / HMR | M3-2/M3-3b | `todo` |
| M3-5 | PM2 持久资源、隔离交付与对账 | M3-1；Q-003 / Q-027 | `todo` |
| M3-5b | 持久服务人工 / AI 统一动作接线 | M3-4/M3-5 | `todo` |
| M3-6 | M3 整体交付与 G3 | M3-5b | `todo` |

## 任务卡

### M3-0 服务 / 预览身份与退出 PoC

- 状态：`todo`；依赖：G2；G-Spec-M3；Q-002 / 003 / 026 / 027；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：真实 PTY / 端口、临时证书 / 浏览器、隔离 PM2；记录平台和残留清理。
- [ ] 交付：PTY 后代与 endpoint 身份、端口复用、独立来源 / HTTPS / WS、PM2 与 TUI 退出策略记录，失败不放行未知目标。
- [ ] 验收：S4–S9/S11/S12，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-1 临时服务登记、查询与退出退登

- 状态：`todo`；依赖：M3-0；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：同终端多个 endpoint、命令退而 Shell 活、重复登记、源未知、DB 故障 / 跨项目拒绝。
- [ ] 交付：services 临时绑定迁移、scope 授权、查询 / 登记、源退出 / 对账退登、日志引用与事件；不 spawn / PM2。
- [ ] 验收：S1/S4–S6/S9/S12/S13，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-2 服务窗口项目筛选、卡片与详情

- 状态：`todo`；依赖：M3-1；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：真实列表 / 详情、两客户端、过滤不停止、临时退登及旧详情失效；不显示模拟运行指标。
- [ ] 交付：无服务 Tab；左上筛选 + 卡片 / 详情 / 关联日志 / 打开终端；窗口隐藏恢复，顶部主机采样。
- [ ] 验收：S1/S2/S4/S5/S15，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-3 PreviewRegistry、HTTP / WS 固定上游

- 状态：`todo`；依赖：M3-1；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：真实 HTTP+WS、终止 / 端口复用、重定向 / host / 非法目标 / 票据过期、DB 失败关闭。
- [ ] 交付：核验活跃登记 / generation、固定 loopback 上游、短期票据、HTTP / WS 代理与撤销已有连接。
- [ ] 验收：S3/S6–S9/S13，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-3b 预览隔离与生命周期安全矩阵

- 状态：`todo`；依赖：M3-3；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：真实浏览器跨来源攻击、管理端口 / 元数据负例、旧票据 / 流失效和秘密扫描。
- [ ] 交付：独立来源 / Cookie / CSP / SSRF / 头过滤、慢消费者 / 断线恢复、失效路由 / 审计故障矩阵。
- [ ] 验收：S6–S9/S13/S15，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-4 Browser 与 Agent 预览卡片 / HMR

- 状态：`todo`；依赖：M3-2/M3-3b；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：真实 Vite 与后端、点击卡片 / 重复点击、源停止不重启、独立来源无管理凭据。
- [ ] 交付：登记地址 / 卡片解析、Browser Tab 去重、停止后的失效页；项目 dev 前后端 API 与 HMR。
- [ ] 验收：S3/S8/S14/S15，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-5 PM2 持久资源、隔离交付与对账

- 状态：`todo`；依赖：M3-1；Q-003 / Q-027；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：隔离 PM2_HOME、启动 / 停止 / restart、误标运行修复、权限 / 失败 / 重启 / 原生交付记录。
- [ ] 交付：PM2Adapter 与命名空间 / 配置、持久字段迁移、实际状态 / 日志 / 健康、生命周期 PoC。
- [ ] 验收：S10–S13，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-5b 持久服务人工 / AI 统一动作接线

- 状态：`todo`；依赖：M3-4/M3-5；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：同动作两来源、篡改 / 过期 / 重放、失败重查、停止保留配置 / 历史、临时动作拒绝。
- [ ] 交付：服务卡片与工具共用动作授权 / 参数审批 / 锁 / 幂等 / 审计；M4 部署边界。
- [ ] 验收：S2/S10/S11/S13，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。

### M3-6 M3 整体交付与 G3

- 状态：`todo`；依赖：M3-5b；全局 G-Spec-M3 / 技术问题门禁均需满足。
- [ ] 先失败测试：check / build、Demo / auth / prod、初始化 / 统一入口 / TUI 回归；记录真实平台与清理。
- [ ] 交付：真实 dev / 登记 / Browser / 前后端 / PM2 / 双客户端闭环，acceptance.md 和 G3 人类验收。
- [ ] 验收：S1–S15，按 spec 与服务契约完成真实资源 / 权限 / 失败证据。
- [ ] 验证：`pnpm check` / `pnpm build`；UI / 安全有浏览器和人类 review；最终全量回归。
- [ ] 更新 spec / contract / tasks / ROADMAP / STATUS，单任务提交；涉及 schema 每任务最多一迁移。
- 计划路径：packages/resources/；apps/server/src/modules/services / preview / api / ws；apps/web/src/features/windows / services；packages/shared；e2e* / scripts / 本切片验收记录（按任务相关部分修改）。
