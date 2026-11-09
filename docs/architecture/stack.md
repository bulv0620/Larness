# 冻结技术栈

> 状态：已冻结（v1.0，2026-10-31）
> 变更规则：新增核心依赖或替换下表中的库，必须先写 ADR，说明收益、迁移与风险；不得在任务中“顺手换库”。

## 1. 原则

1. **单体优先**：一个 Server 进程、一个 SQLite、一个 Web 前端；不引入消息队列、Redis、微服务。
2. **类型贯通**：DTO / 事件 / 错误码集中定义，前后端共享；所有外部输入用 Zod 校验。
3. **原生依赖最小化**：主要运行时原生模块为 `better-sqlite3` 和 `node-pty`；每个平台发布前必须 PoC。
4. **不重复造轮子，也不叠加同类库**：一个领域只保留一个主库（见“禁止”）。
5. **版本策略**：使用 caret 范围并锁定 lockfile；主版本升级、替换原生依赖、改变构建产物结构必须走 ADR + 回归测试。

## 2. 运行时与工具链

| 领域 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js 22.22+（22.x）/ 24+ | 实测版本见[支持矩阵](../known-limitations.md) |
| 包管理 | pnpm 10 + workspace | `pnpm-workspace.yaml`；禁止 npm / yarn lockfile |
| 语言 | TypeScript 5.x，`strict` | ESM；`moduleResolution: bundler` |
| 构建（Server） | tsdown | 输出 `dist/`；原生模块 external；产物随 npm 包分发 |
| 构建（Web） | Vite 8 | 产物 `apps/web/dist`，生产由 Server 静态托管 |
| 开发运行 | tsx watch | Server 热重启；Web 用 Vite HMR |
| Lint / Format | Biome | 一个工具完成 lint + format；本地 `pnpm check` 调用 `biome ci` |
| 单元 / 集成测试 | Vitest | Server 用 Fastify `inject`；Web 用 Testing Library + happy-dom |
| E2E / 视觉 | Playwright | 桌面 Chromium；关键流程与截图基线 |
| 回归与发布 | 本地验证 | [发布清单](../process/release.md)；平台状态见[支持矩阵](../known-limitations.md) |
| 提交规范 | Conventional Commits | 见 `AGENTS.md` |

## 3. Server

| 领域 | 选择 | 说明 |
|---|---|---|
| HTTP | Fastify 5 | 插件：`@fastify/cookie`、`@fastify/static`、`@fastify/websocket` |
| 校验 | Zod | 请求 / 响应 / 配置 / IPC / 工具参数统一 |
| 数据库 | SQLite + `better-sqlite3` + Drizzle ORM | WAL、foreign_keys、busy_timeout；SQL 迁移文件；当前固定 `better-sqlite3@13.0.3` |
| 迁移 | drizzle-kit 生成 + 启动时 migrator | 迁移文件进版本库；启动前备份 |
| 初始化信任 | 本机 OS 权限 + IPC Token | ADR-025 取消未使用的管理员密码及 Argon2id 依赖；历史哈希保留 |
| Passkey / WebAuthn | `@simplewebauthn/server`（^14） | 注册 / 认证 ceremony 与验证；attestation `none`、UV required、resident key required |
| 日志 | pino + pino-roll | JSON 行；开发用 pino-pretty；按日 / 大小轮转；秘密脱敏 |
| WebSocket | `@fastify/websocket`（ws） | 握手鉴权、Origin 校验、事件序号 |
| 本机 IPC | Unix Domain Socket / Windows Named Pipe | 换行分隔 JSON；0600 权限 + 0600 Token 握手；可用平台追加 peer uid |
| TUI | Node readline/TTY + `@inquirer/prompts` + `picocolors` | ADR-027：单一输入所有者与独立屏幕，向导受控适配；fast-string-width / fast-wrap-ansi 计算显示列宽；不引 React / Ink |
| Diff / Patch | `diff`（jsdiff） | apply_patch 与 Diff 视图；不自行实现补丁解析 |
| HTTP 代理 | `undici` | 预览代理；禁止任意 upstream |
| PTY | `node-pty` | 平台 PoC；失败退路见 M2 |
| 进程托管 | `PM2`（PM2Adapter） | M4持久服务；M3临时dev由TerminalManager/PTY控制，Registry仅登记展示/预览（ADR-030/042），M3不引入PM2交付依赖 |
| 配置 | JSON + 环境变量 | `env-paths` 定位数据目录；Zod 校验 |

## 4. Agent

| 领域 | 选择 | 说明 |
|---|---|---|
| 模型调用 | Vercel AI SDK 7（`ai`） | 仅使用流式与工具调用能力；Larness 自管 Turn / 上下文 / 权限 |
| Provider | `@ai-sdk/deepseek`、`@ai-sdk/openai-compatible`（GLM） | 逐模型契约测试；能力声明不假设一致 |
| 工具 | Larness 自研 ToolRegistry | 不用 SDK 自带 agent 循环作为状态机 |
| 测试 | FakeProvider | 确定性脚本化流与工具调用，禁止真实 API 依赖单测 |

## 5. Web

| 领域 | 选择 | 说明 |
|---|---|---|
| 框架 | React 19 + TypeScript | 函数组件 |
| 构建 | Vite 8 | `VITE_USE_MOCKS` 控制 Phase 0 Mock |
| 样式 | Tailwind CSS 4 + CSS 变量 token | 语义色板；无 CSS-in-JS |
| 组件原语 | Radix UI + 自制 shadcn 风格组件 | 放在 `packages/ui` |
| 图标 | lucide-react | 本地 SVG；不用图标字体 / 外部 CDN |
| 路由 | React Router 8 | `/`、`/pair`；M0 后加 `/settings` |
| 服务端状态 | TanStack Query 5 | 缓存、失效、重试 |
| 客户端状态 | Zustand 5 | 窗口、布局、导航、草稿、实时游标 |
| 窗口 | react-rnd | 拖动 / 缩放 / 层级；最大化与隐藏由 WindowManager 控制 |
| 编辑器 | `@monaco-editor/react` | 按需加载；只读预览与编辑 |
| 终端 | `@xterm/xterm` + fit addon | WebGL 可选，默认 canvas |
| 通知 | sonner | 轻量 toast |
| Passkey 客户端 | `@simplewebauthn/browser` | `startRegistration` / `startAuthentication`；不支持时明确降级 |
| 字体 | 系统字体栈 | `-apple-system` / `ui-monospace`；不加载 Web 字体 |

## 6. Workspace 布局

```text
pnpm-workspace.yaml
package.json                 # 根脚本：dev / check / build / test / test:e2e
apps/
  web/                       # @larness/web
  server/                    # @larness/server
packages/
  shared/                    # @larness/shared
  agent/                     # @larness/agent
  resources/                 # @larness/resources
  ui/                        # @larness/ui
scripts/
app.js                       # 稳定入口（M0-9）
```

- 第一阶段（D0）创建 `apps/web`、`packages/shared`、`packages/ui` 与根配置；`apps/server`、`packages/{agent,resources}` 已在 M0-1 创建。
- 包之间用 `workspace:*` 引用；内部包不单独发布。
- `packages/shared` 不依赖 Node 或 React，可在两端使用。

## 7. 目标命令

```bash
pnpm install
pnpm dev
pnpm check            # biome ci + tsc --noEmit + vitest run
pnpm build
pnpm test:e2e
pnpm --filter @larness/web dev
```

当前命令由根 `package.json` 提供。

## 8. 禁止 / 避免

| 禁止 | 原因 |
|---|---|
| Electron / Tauri 桌面壳 | V1 明确 Web 优先 |
| Docker / K8s / 远程 SSH 执行 | 单机范围 |
| Prisma / TypeORM / Sequelize | 与 Drizzle + SQLite 重复；迁移不可控 |
| Redux / MobX / Jotai | 已选 Zustand + TanStack Query |
| axios | 使用 `fetch` / undici |
| CSS-in-JS（styled-components / emotion） | 统一 Tailwind token |
| GraphQL / tRPC | 契约以 REST + WS 为准 |
| 外部图标字体 / CDN 资源 | 离线可用与供应链 |
| 同源 iframe 预览不可信项目 | 违反预览隔离 |
| 命令字符串黑名单作为安全边界 | 违反宪法第四条 |
| 未列出的原生依赖 | 打包与跨平台风险 |

## 9. 依赖升级与新增

1. 新增运行时依赖：在任务中说明用途、体积、许可证、维护状态、替代方案；涉及 auth / crypto / pty / proxy / 更新时先写 ADR。
2. 升级主版本：单独任务；跑全量测试 + 平台冒烟；更新本文件。
3. 移除依赖：确认无引用、更新 lockfile、记录在提交信息。
4. 禁止 `*` / `latest` 版本；禁止从非官方 registry 安装。
