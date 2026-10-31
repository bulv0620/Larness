# STATUS

> 最后更新：2026-10-31 20:10 (+08:00)  
> 当前阶段：**Spec 初始化完成，等待第一个实现任务**

## 里程碑

| 阶段 | 名称 | 状态 | 说明 |
|---|---|---|---|
| S0 | 视觉 Demo | `ready` | spec/plan/tasks 已就绪，待执行 `D0-1` |
| M0 | 工程底座与可信启动 | `ready` | 依赖 S0 验收；spec 已细化 |
| M1 | 项目、会话与最小 Agent | `ready` | spec 已细化，进入前需复核 |
| M2 | 开发资源与窗口层 | `draft` | 仅路线图级范围，启动前补全 spec |
| M3 | 本机服务与 Preview | `draft` | 含预览隔离 PoC |
| M4 | 部署闭环与权限加固 | `draft` | 依赖 M3 |
| M5 | 多模型、自动化与更新 | `draft` | 依赖 M4 |

## 当前工作

- 进行中：无
- 下一个任务：`D0-1` — Web 工作区脚手架（`specs/000-visual-demo/tasks.md`）
- 阻塞项：无

## 已冻结

- 产品与安全边界：`CONSTITUTION.md`
- 技术栈：`docs/architecture/stack.md`
- 决策记录：`docs/adr/DECISIONS.md`
- 任务顺序与门禁：`specs/ROADMAP.md`

## 待人类确认（不阻塞 D0）

| 问题 | 默认方案 | 截止 |
|---|---|---|
| 设备凭据是否在 V1 引入 WebAuthn | M0 使用 opaque token，WebAuthn 作为 P1 | M4 公网验收前 |
| 预览独立来源方案 | 开发用 `*.preview.localhost`，生产要求独立域 | M3 开始前 |
| PM2 交付方式 | 随包依赖 + 可选外部安装 | M3 开始前 |
| 仓库许可证 | 未定，暂不添加 LICENSE | 公开发布前 |

完整列表见 [docs/open-questions.md](docs/open-questions.md)。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-31 | 初始化 spec 工程：宪法、Agent 手册、架构/契约、路线图、S0–M1 详细 spec、M2–M5 草案 |
