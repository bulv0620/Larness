# AGENTS.md — 编码 Agent 操作手册

本文件对在本仓库工作的所有 AI 编码 Agent 生效。开始任何实现前，先完整阅读本文件。

## 0. 一句话

按 `specs/ROADMAP.md` 的任务顺序，一次只实现一个已就绪任务；先写测试，再实现，跑通验收，更新状态，提交。

## 1. 每次会话的必读顺序

1. `CONSTITUTION.md` — 不可协商条款；
2. `STATUS.md` — 当前阶段、进行中任务、阻塞项；
3. `specs/ROADMAP.md` — 任务依赖与门禁；
4. 当前任务的 `spec.md` → `plan.md` → `tasks.md`；
5. 相关契约：`docs/contracts/*`、`docs/architecture/security.md`；
6. 需要背景时再读 `larness.md` 对应章节（不要从头读到尾）。

## 2. 当前阶段

- **S0、M0（macOS 范围）、M1、M2、M3 均已验收**。G2 与 G3 于 2026-11-05 通过，G3 后的 M3-7～M3-9 于 2026-11-06 通过统一验收。
- 验收范围见 `specs/030-dev-resources/closure.md` 和 `specs/040-services-preview/closure.md`。
- **阶段边界（ADR-042）**：M3只做开发服务/隔离预览，PM2持久运行/发布全部M4；完全自主覆盖所有已授权Agent业务动作（含部署），无人工审批/确认停等，计划/鉴权/锁/审计仍保留。
- **下一步为 M4 规格评审**。先处理 G-Spec-M4 及 Q-003、Q-027，再按门禁进入 M4-0。DeepSeek 官方接入与上下文用量列入 M5-1，依赖 G4。
- 本轮M2纠错及收尾按用户要求只做必要校验、界面自行验收；验证范围和未运行检查需如实记录，不冒充全量通过。后续里程碑依任务验收与当时用户指令确定检查范围。
- TUI 是受管前台入口（ADR-023）：`pnpm dev` / `node app.js` 启动 Server + Web 并进入 TUI；关闭即停止全部，不提供 headless 产品入口。

## 3. 工作循环（必须按顺序）

1. **选任务**：在 `ROADMAP.md` / `tasks.md` 中找到状态为 `todo`、依赖全部 `done` 的最小任务。
2. **读 spec**：确认目标、非目标、接口、失败路径与验收场景。spec 为 `draft` 时不得写代码，先补全并请人类确认。
3. **声明**：把任务改为 `in_progress`，更新 `STATUS.md`（任务 ID、分支、开始时间、计划改动）。
4. **测试先行**：先写会失败的测试（单元 / 集成 / E2E 按任务要求），确认失败原因正确。
5. **实现**：最小改动完成验收；不顺手重构无关代码，不引入未冻结依赖。
6. **验证**：运行该任务的验收命令与全量检查（见第 7 节），修复所有失败。
7. **收尾**：勾选 `tasks.md`，更新 `STATUS.md`，记录偏差与新增问题，提交。

一个任务未完成前不要开始下一个；一个提交只对应一个任务（允许包含该任务的测试与文档）。

## 4. Spec-first 门禁

- `status: draft` 的 spec 只用于规划，不能实现。
- 实现前 spec 必须至少包含：目标 / 非目标、验收场景（Given-When-Then）、接口与数据变更、安全与权限、失败与边界、测试计划。
- 如果实现中发现 spec 缺失关键决策：停止编码，在 `specs/<slice>/spec.md` 的“开放问题”中记录，向人类提问，不要自行发明产品行为。
- 契约变更（REST 路径、WS 事件、数据库列、配置键）必须同步更新 `docs/contracts/*` 与受影响的测试。
- Agent 能力、作用域、参数默认值、审批、生命周期或成功条件变更时，按 [Agent 工具执行契约](specs/051-agent-tool-contract/spec.md#持续约束) 同步工具描述、模型 schema、system prompt、受影响界面提示与验收。常规检查必须覆盖实际组装的模型上下文和执行层正反例。

## 5. 编码规范

- TypeScript `strict`；禁止无理由的 `any`、`@ts-ignore`、非空断言滥用。
- ESM；Node 内置优先；跨平台路径使用 `node:path`，不拼接 `/`。
- 所有外部输入（HTTP、WS、IPC、配置、工具参数、文件内容边界）用 Zod 校验；类型从 schema 推导。
- 错误使用稳定错误码（见 `docs/contracts/rest-api.md`），不把异常原文直接回给客户端。
- 时间统一 Unix 毫秒（UTC）；ID 使用 `crypto.randomUUID()` 加资源前缀。
- 日志结构化（pino），包含 `requestId` / `sessionId` / `turnId` 等关联 ID；禁止记录秘密。
- 数据库访问集中在 repository 层；事务内完成“写事件 + 递增序号”。
- 前端：函数组件 + hooks；服务端状态用 TanStack Query，视图状态用 Zustand；不复制服务器状态到本地 store。
- 样式：Tailwind + 语义 token；不引入第二套 UI 框架或 CSS-in-JS。
- 不提交注释掉的代码、调试输出、临时开关。

## 6. 安全红线（详见 CONSTITUTION）

- 不新增未鉴权接口；不以“前端不显示”代替授权。
- 不把 API Key / Token / Cookie / 配对码写入日志、事件、错误、测试快照。
- 不宣称沙箱；不实现“命令黑名单即安全”。
- 不允许同源 iframe 预览不可信项目；预览只走已登记服务。
- 不绕过审批、锁、幂等键或事件持久化。
- 不修改已冻结 ADR；需要变更时先写 ADR 并等待人类批准。

## 7. 命令

以下为冻结的目标命令；在对应任务创建脚本前，不要假设它们存在。

```bash
pnpm install
pnpm dev              # Server + Vite + TUI；关闭 TUI 停止全部
pnpm check            # biome + typecheck + unit tests
pnpm build            # server（四入口）+ web 构建
pnpm test:e2e         # Playwright（Chromium，Mock）
pnpm test:e2e:auth    # 真实 server + 虚拟认证器
pnpm test:e2e:prod    # 需先 pnpm build
pnpm --filter @larness/web dev
```

根脚本已落地；M0-1 再补齐 server、CI 与跨包构建。

## 8. 提交与分支

- 分支：`task/<task-id>-<slug>`，例如 `task/d0-1-web-bootstrap`。
- 提交信息：Conventional Commits，例如 `feat(web): add app shell layout (D0-2)`。
- 提交前必须通过 `pnpm check`；不得提交 `node_modules`、构建产物、数据库、日志、秘密。
- 不 force push 共享分支；不重写他人提交。

## 9. 何时停下来问人

出现以下任一情况，停止并提问：

1. 需要改变冻结决策、优先级、产品范围或验收标准；
2. 需要新增有安全影响或原生依赖的库（auth、crypto、pty、proxy、ORM、更新）；
3. 需要破坏性数据库迁移或删除数据；
4. 验收场景无法自动化，且人工验收标准不明确；
5. 同一测试 / 实现连续两次尝试仍失败，且原因不是明显的笔误；
6. spec 与 `larness.md`、contract、现有代码互相矛盾；
7. 任务实际工作量明显超出 spec 预估（需要拆任务）。

提问时给出：任务 ID、已尝试方案、失败证据、可选方案与建议，不要只问“怎么办”。

## 10. 禁止事项

- 禁止一次实现多个任务或顺手扩展范围；
- 禁止用 mock / 静态页面冒充后端完成；
- 禁止跳过失败测试、删除测试、放宽断言来“通过”；
- 禁止在未读 spec 的情况下按直觉实现；
- 禁止把 `docs/open-questions.md` 中的默认方案当成已批准决策；
- 禁止把项目源码目录用于存放 Larness 数据或构建产物。

## 11. 文档更新责任

每个任务结束前检查：

- `tasks.md` 勾选与备注；
- `STATUS.md` 当前状态与变更记录；
- 契约 / 数据模型 / 配置说明是否变化；
- 新增决策是否已写 ADR；
- 新增边界问题是否进入 `docs/open-questions.md`。
