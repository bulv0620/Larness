# 规格与工程入口

从 [AGENTS.md](../AGENTS.md) 进入工作流，依次阅读 [工程宪法](../CONSTITUTION.md)、[当前状态](../STATUS.md) 和 [路线图](ROADMAP.md)，再按当前任务阅读 `spec.md`、`plan.md`、`tasks.md`。接口与安全规则见 [工程文档](../docs/README.md)。发布后跟踪、待决事项与已发现的对齐差异集中在 [遗留问题](../docs/open-questions.md)。

## 1. 切片索引

### S0

- [000 S0 视觉 Demo](000-visual-demo/spec.md)

### M0

- [010 M0 工程底座与可信启动](010-foundation/spec.md)
- [015 初始化修复与体验收敛](015-initialization-hardening/spec.md)
- [016 TUI 页面与交互统一](016-tui-experience/spec.md)
- [017 开发与打包运行统一入口](017-unified-entry/spec.md)

### M1

- [020 M1 项目、会话与最小 Agent](020-workspace-agent/spec.md)

### M2

- [030 M2 开发资源与窗口层](030-dev-resources/spec.md)
- [031 M2-9 项目窗口与终端交互修正](031-project-windows/spec.md)
- [032 M2-10 共享默认工作区](032-default-workspace/spec.md)
- [033 M2-11 纯终端体验](033-terminal-experience/spec.md)
- [034 M2-12 右侧资源区简化](034-resource-sidebar/spec.md)
- [035 M2-13 固定默认项目](035-default-project/spec.md)
- [036 对话区重构与真实任务计划](036-conversation-experience/spec.md)
- [037 M2-16 对话区与外围视觉统一](037-conversation-theme/spec.md)
- [038 M2-17 消息框与紧凑审批](038-message-bubbles/spec.md)
- [039 M2-18 对话滚动边缘过渡](039-chat-edge-blur/spec.md)
- [041 M2-19 审批盾牌与上下文圆环](041-composer-controls/spec.md)
- [042 M2-20 终端空态与历史入口](042-terminal-entry/spec.md)
- [043 M2-21 Agent 关闭终端同步 Tab](043-agent-terminal-close/spec.md)
- [044 M2-22 Agent 终端保留 Shell](044-agent-shell/spec.md)
- [045 M2-23—M2-26 工作区体验收敛](045-workspace-polish/spec.md)
- [046 M2-27 Git 文件行补充动作](046-git-file-actions/spec.md)
- [047 M2-28 Git 空态与刷新提示收敛](047-git-feedback/spec.md)

### M3

- [040 M3 开发服务与隔离预览](040-services-preview/spec.md)
- [048 R0-1 M3/M4边界与完全自主部署文档同步](048-service-deploy-boundary/spec.md)
- [049 M3-7 工作区侧栏与窗口层修正](049-workspace-sidebar/spec.md)
- [051 Agent 工具描述与执行契约](051-agent-tool-contract/spec.md)
- [052 M3-11 工作区前端交互优化](052-workspace-polish/spec.md)

### M4

- [050 M4 命令行部署与 PM2 服务观察](050-deploy/spec.md)

### M5

- [060 M5 多模型、自动化与更新](060-extension/spec.md)
- [061 DeepSeek 官方接入、模型与思考档位](061-deepseek-integration/spec.md)
- [063 多 Provider、能力矩阵与上下文压缩](063-multi-provider/spec.md)
- [064 定时任务与调度器](064-scheduler/spec.md)
- [065 npm 分发与版本更新提示](065-launcher-updater/spec.md)
- [066 跨平台安装与运行 PoC](066-cross-platform/spec.md)
- [067 安全复核、发布清单与文档定稿](067-release-hardening/spec.md)
- [068 发布后界面与输出纠错](068-ui-fixes/spec.md)

### M6（草案）

- [070 运行时效率：前缀缓存、上下文预算与停止语义](070-runtime-efficiency/spec.md)
- [071 Turn 恢复与数据保留](071-turn-recovery/spec.md)
- [072 工具调用错误预算：补丁容错、参数修复与命令用法](072-agent-error-budget/spec.md)

各切片保留稳定编号与路径。详细任务状态及验收门以路线图为准；`acceptance.md`、`closure.md`、`poc.md` 和 `review.md` 记录当时的验证与决策。切片历史中的计划或待办按其记录日期阅读。

新增切片沿用三位编号，选择可用编号并在路线图登记所属阶段。模板见 [spec](_templates/spec.md)、[plan](_templates/plan.md)、[tasks](_templates/tasks.md)。

## 2. 状态

spec 的状态写在 front matter：

```yaml
---
id: 020-workspace-agent
status: ready        # draft | ready | active | done | blocked
depends_on: [010-foundation]
---
```

| 状态 | 含义 |
|---|---|
| `draft` | 只有范围，不可实现；启动前必须补全 |
| `ready` | 目标、验收、契约、任务齐全，可开始 |
| `active` | 有任务进行中 |
| `done` | 全部任务完成且门禁通过 |
| `blocked` | 存在未决边界或外部依赖 |

`ROADMAP.md` 是进度总表；`STATUS.md` 是当前会话视角的摘要。三者冲突时以 `ROADMAP.md` 的任务状态为准，并立即修正其他两处。

## 3. 任务 ID 与粒度

- 格式：`D0-1`、`M0-1`、`M1-1`（阶段前缀 + 序号）。
- 一个任务应能在 0.5–2 天内完成，并产生可验证的增量。
- 一个任务只对应一个提交；不允许“顺手”完成下一个任务。
- 任务必须有：目标、交付物、依赖、验收、测试、涉及路径。

## 4. 从 draft 到 ready

- [ ] 目标 / 非目标清晰，与其他切片不重叠；
- [ ] 至少 3 条 Given-When-Then 验收场景；
- [ ] 接口 / 数据 / 配置变更已写入 `docs/contracts/*`；
- [ ] 安全、权限、失败与恢复路径已覆盖；
- [ ] 任务拆到可执行粒度，依赖无环；
- [ ] 测试计划覆盖成功、失败、权限、并发；
- [ ] 人类负责人确认。

未满足以上条件时，Agent 必须停在 `draft`，先补 spec 并请求确认，不得直接实现。

## 5. 写作要求

- 用“必须 / 禁止 / 应当”区分强制级别；避免“尽量”“可能”。
- 验收写成可执行场景，而不是形容词；UI 任务附截图 / 视觉基线要求。
- 引用契约与宪法时给出相对链接，不复制大段内容。
- 失败路径与权限路径至少占验收场景的三分之一。
- 不在 spec 中写实现细节（放 `plan.md`）；不在 `plan.md` 中改需求。

## 6. 新增切片流程

1. 复制 `_templates/spec.md`、`plan.md`、`tasks.md` 到新目录。
2. 填写 front matter，初始状态 `draft`。
3. 在 `ROADMAP.md` 增加里程碑 / 任务行与依赖。
4. 完成第 4 节清单后改为 `ready`，并在 `STATUS.md` 指向它。
