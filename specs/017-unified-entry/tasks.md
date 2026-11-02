# 任务：统一运行入口

> 2026-11-02 人类明确“开始实现”，批准 G-Spec-U / ADR-028 及优先于 M2 的顺序实施。U0-1/U0-2 已完成，U0-3 自动化完成，待人类抽查。

| ID | 任务 | 依赖 | 状态 | 预估 |
|---|---|---|---|---|
| U0-0 | ADR/spec/契约草案与评审包 | T0-3 done；人类授权补充文档 | done | 0.5 天 |
| U0-1 | 受管 Vite 与限定 HTTP/HMR 转发基础 | U0-0 done；G-Spec-U / ADR-028 accepted | done | 2 天 |
| U0-2 | supervisor 接线与共享配置/统一初始化 | U0-1 done | done | 1–2 天 |
| U0-3 | 同目录模式切换、真实 HMR 与整体交付 | U0-2 done | review | 2 天 |

## U0-0 文档

- [x] 已读取宪法/状态/路线图和相关契约，复核现有源码与冻结 ADR；
- [x] 写明单入口、私有目标/HMR 安全、旧配置一次性对齐、非目标和测试；
- [x] 六份设计文档的 12 个本地链接、Markdown-only 范围及 pnpm check（server 290 / agent 32 / web 26）检查通过，更新状态并单独提交；
- 不包含任何代码/依赖/实际配置修改，不把草案标为 accepted。

## U0-1 转发基础

- 目标：子进程 strict Zod 控制消息、代号和固定目标；真实 Vite wrapper；限定 HTTP/HMR、头/路径/CSP、超时/背压/关闭；生产路径隔离。默认产品入口仍不切换。
- 交付：独立模块与集成装配、DEV_WEB_UNAVAILABLE 错误 schema / 契约；Vite 动态加载不污染生产构建。
- 测试先行：伪造/晚到 IPC、SSRF/编码穿越/symlink、敏感头/Set-Cookie、Origin/会话失效、API/WS 不被抢、流取消/超限；再启动真实 Vite，验证 React/CSS/worker/HMR 与 CSP。
- 验收：U5–U9 / U11–U12 的基础部分；实际 Vite 和恶意输入均覆盖，pnpm check/build 通过。
- 不包含：默认启动切换、config.json 写入/迁移、初始化及完整模式切换承诺。
- [x] 2026-11-02 人类批准后声明 in_progress，task/u0-1-dev-web-foundation；
- [x] 失败测试 → 实现 → 定向与全量检查 → 契约同步 → 独立提交；整体安全抽查留在 U0-3，见 acceptance.md。

## U0-2 入口接线

- 目标：同一有效端口/URL 的 dev 与打包启动，私有 ready/attach、Web 真就绪、Vite 失败监控、初始化重启和退出清理；取消 5173 初始化特例。
- 交付：supervisor/main/init 与实际路由接线，旧配置拒绝及一次性对齐说明；配置/环境优先级不变。
- 测试先行：默认/自定义/覆盖 URL、legacy 3210/5173 无写入诊断、外部 HTTPS 端口不同、已初始化不再 init、发布恢复顺序、启动竞态/故障/信号、同目录锁冲突。
- 验收：U1 / U3–U4 / U9–U10 / U13；实际受管 dev 统一地址，pnpm check/build、PTY/init smoke 通过。
- 不包含：自动改网络配置、数据合并/重置或数据库降级。
- [x] U0-1 done 后于 2026-11-02 声明 in_progress，task/u0-2-unified-entry；
- [x] 失败测试 → 接线 → 验证 → README/当前契约同步 → 独立提交；整体验收/人类抽查留在 U0-3。

## U0-3 整体验收

- 目标：同一临时目录/浏览器在 dev → 打包 → dev 切换，真实模型假凭据、Passkey 与数据保留；HMR/业务 WS、HTTPS 反代与故障清理回归。
- 交付：可重复的真实验收命令、U1–U13 证据与脱敏界面记录、平台结论；所有测试使用可丢弃工作区。
- 测试先行：模式切换与 HMR 真实链路先复现现状失败，再完善验收夹具，不用 mock 冒充后端。不改源码/用户数据来凑通过；实际产品缺陷按本任务范围修复并复验。
- 验收：U1–U13，pnpm check/build、Demo/auth/prod E2E、PTY、初始化 smoke 和新真实验收；人类抽查同一地址下切换、热更新和 TUI 退出。
- 不包含：公开新版本发布、三平台未经实测支持声明或其他里程碑功能。
- [x] 2026-11-02 U0-2 done 后声明 in_progress，task/u0-3-unified-entry-acceptance；
- [x] 自动化证据和当前文档同步、独立提交；check/build、统一入口 smoke、初始化 smoke、真实 PTY、Demo/auth/prod E2E 通过，见 acceptance.md；
- [ ] 人类 G-Task 通过，全部任务 done 后将 spec 关闭。
