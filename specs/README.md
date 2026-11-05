# Spec 编写规则

本目录把产品设计拆成可独立验收的切片（slice）。每个切片一个目录；`ready` 及以上状态必须包含 `spec.md`、`plan.md`、`tasks.md`，`draft` 允许只有 `spec.md`，转 `ready` 前补齐。

## 1. 目录与编号

```text
specs/
  ROADMAP.md              # 里程碑、任务、依赖、门禁（唯一进度总表）
  000-visual-demo/        # S0 视觉 Demo
  010-foundation/         # M0 工程底座与可信启动
  016-tui-experience/     # TUI 交互统一（已验收）
  020-workspace-agent/    # M1 项目、会话与最小 Agent
  030-dev-resources/      # M2 文件 / 终端 / Git / 窗口层（done，2026-11-05 G2通过）
  040-services-preview/   # M3 服务与预览（draft）
  050-deploy/             # M4 部署闭环（draft）
  060-extension/          # M5 多模型 / 自动化 / 更新（draft）
  _templates/             # 模板，不参与编号
```

编号规则：`0x0-<slug>` 对应里程碑（000 = 第 0 步，010 = M0，020 = M1，依此类推）。新增切片取当前里程碑下一个可用编号，并更新 `ROADMAP.md`。

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

## 7. 当前状态

| 切片 | 状态 | 说明 |
|---|---|---|
| `000-visual-demo` | done | 已验收（G-S0 通过，`D0-9` done） |
| `010-foundation` | ready | 可信启动与认证 |
| `020-workspace-agent` | ready | 项目 / 会话 / 最小 Agent |
| `016-tui-experience` | active | G-Spec-TUI / ADR-027 已通过，按序实现，见 ROADMAP |
| `030`–`060` | draft | 启动对应里程碑前补全 |

详细任务与依赖见 [ROADMAP.md](ROADMAP.md)。
