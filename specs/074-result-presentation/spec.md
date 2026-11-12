---
id: 074-result-presentation
title: 成果展示与临时文件折叠
milestone: 发布后
status: done
depends_on: [051-agent-tool-contract]
owners: []
created: 2026-11-12
updated: 2026-11-12
---

# 074 成果展示与临时文件折叠

> 状态：`done`（2026-11-12）。用户确认 D-1～D-5 后实现并验证；验收记录见 [tasks](tasks.md#验收记录)。

## 1. 背景与问题

2026-11-12 `write_file` 上线后，会话页脚的「本次成果」开始出现非交付内容：临时测试脚本、生成目录里的产物、以及本轮创建后又删除的文件。现状由三处行为叠加造成：

1. **文件结果卡只认 `apply_patch`**：`tool.completed` 的 `resourceTarget` 仅由成功 `apply_patch` 生成；`write_file` 只发 `file.changed`，前端把它渲染成不可打开的文本产物（`已创建 <path>` + 版本号），与旁边的 pill 卡片不是同一套入口。
2. **没有「成果 / 过程」区分**：任何成功 `write_file` / `apply_patch` 都无条件生成产物条目；没有忽略规则，也没有在 Turn 终态核对文件是否仍存在。创建后删除的文件条目不会被回收，点击还会失败。
3. **没有终态结算**：成果区按「本轮动过的资源」拼接，无法回答「这轮最终留下了什么」。

影响：页脚噪声随轮次线性增长；真正要交付的文件被临时脚本淹没；已删除条目可点但必然报错；用户无法从成果区判断本轮是否留下了垃圾文件。

## 2. 目标

- G-1：成果区只展示 Turn 终态仍存在、且不在忽略 / 临时规则内的文件，以及预览、终端等资源入口。
- G-2：非成果的文件变更折叠为一行「过程文件」，可展开查看路径、变更类型与是否已清理。
- G-3：`write_file` 与 `apply_patch` 的文件结果使用同一卡片，可打开，并保留「文件已变化」提示。
- G-4：分类在服务端计算，历史 Turn 与旧客户端按现有行为回退，不出现空白或报错。

## 3. 非目标

- 不改变 Turn 生命周期、审批、工具授权、项目锁与审计。
- 不引入模型声明字段或新工具（如 `deliverable` / `temporary` 参数、`publish_result`）。
- 不改变文件树、Git、搜索的忽略语义；本切片只影响成果分类，不隐藏文件。
- 不做成果的手动移除、置顶、跨轮汇总或排序偏好。
- 不新增 REST / WS 端点，不新增数据库列。

## 4. 用户故事

- 作为项目开发者，我希望页脚只显示这轮真正留下的文件，以便直接打开交付物。
- 作为项目开发者，我希望看到临时脚本被清理的痕迹，以便确认没有留下垃圾文件。
- 作为在同一工作区切换项目的用户，我希望点击成果和过程文件仍按现有授权重新鉴权。

## 5. 验收场景

### A1 临时脚本被删除后不再出现在成果

```gherkin
Given 本轮 write_file 创建 tmp/probe.mjs，且在 Turn 结束前该文件被删除
When Turn 进入 completed
Then 成果区没有该文件卡片
And 过程行显示 1 个过程文件、其中 1 个已清理
And 展开过程行可见 tmp/probe.mjs · 已创建 · 已删除，且不可点击打开
```

### A2 保留的临时脚本按路径规则归入过程

```gherkin
Given 本轮创建 tmp/fixture.ts 并保留到 Turn 结束
When Turn 进入 completed
Then 该文件不进入成果区
And 过程行显示该文件，展开后仍存在的文件可按现有授权打开
```

### A3 正常交付文件只出现一次

```gherkin
Given 本轮 write_file 创建 docs/report.md，随后 apply_patch 修改同一文件
When Turn 进入 completed
Then 成果区只有一张文件卡片，路径为 docs/report.md，版本为最终版本
And 刷新或重放会话后结果一致
```

### A4 取消 / 失败 / 中断后仍可查看已产出结果

```gherkin
Given Turn 中途被取消、失败或中断，此前已创建或修改过文件
When 查看该轮
Then 终态提示与现有行为一致
And 仍存在且非忽略的文件出现在成果区，已删除的进入过程行
```

### A5 历史 Turn 回退

```gherkin
Given 打开发布前产生的历史 Turn，没有分类结果字段
When 渲染该轮
Then 沿用现有成果与产物渲染，不出现空成果区、重复卡片或错误
```

### A6 权限与已删除目标

```gherkin
Given 过程行中的文件仍存在，但当前会话已无权访问所在项目
When 点击该文件
Then 走现有重新鉴权流程并显示可恢复错误
And 错误与事件不包含绝对路径、文件内容或秘密
```

### A7 状态核对失败时不误隐藏

```gherkin
Given 终态核对某个文件时返回 EACCES 或其他非 ENOENT 错误
When 生成分类结果
Then 该文件按成果保留并可在打开时显示现有错误
And 日志只记录相对路径与错误码
```

### A8 空态

```gherkin
Given 本轮只有过程文件
When Turn 进入 completed
Then 只显示默认收起的过程行，不显示空成果区
And 本轮没有任何文件变更时，成果区与过程行都不显示
```

### A9 旧客户端

```gherkin
Given 旧版前端连接新版服务端
When 收到带分类字段的终态事件
Then 旧客户端忽略未知字段，按原逻辑渲染，不报错
```

## 6. 功能需求

| ID | 级别 | 需求 |
|---|---|---|
| R-1 | MUST | 文件分类由服务端在 Turn 终态计算：终态仍存在且非忽略 / 临时路径 → 成果；其余 → 过程。 |
| R-2 | MUST | 忽略集合由服务端 scope 决定：默认集合（`.git`、`node_modules`、`.larness`）+ 项目 `settings.ignore` + 本切片新增的生成 / 临时规则。清单为暂定默认，见 Q-037。 |
| R-3 | MUST | 同一路径只保留一条结果，按首次变更顺序输出；创建后修改再删除仍为一条「已删除」。 |
| R-4 | MUST | 过程行默认收起，显示总数与已清理数；展开后逐条显示路径、创建 / 修改与已删除 / 仍存在；已删除文件不可点击。 |
| R-5 | MUST | 成功 `write_file` 也生成文件结果卡；有分类结果时成果卡片按 `fileResults` 渲染，无分类结果时与 `apply_patch` 共用同一卡片与打开 / 版本变化提示。 |
| R-6 | MUST | 无分类结果的历史 Turn 沿用现有渲染；不得重新推导后改变历史展示。 |
| R-7 | MUST | 成果区在 Turn 终态后显示，位置沿用最终答复正文与复制 / 时间栏之间；无最终答复时独立显示。 |
| R-8 | MUST | 预览与终端结果入口不受文件分类影响，继续按现有规则展示。 |
| R-9 | SHOULD | 单 Turn 结果条目设上限（200），超出部分以 `fileResultsOmitted` 计数并在界面提示，不渲染全部条目。 |
| R-10 | SHOULD | 过程行可键盘操作，展开状态对辅助技术可读。 |
| R-11 | MAY | 提供「复制本轮文件清单」，文本只含相对路径与变更类型。 |

## 7. 接口与契约变更

- **Turn 终态事件**：`turn.completed` / `turn.failed` / `turn.cancelled` / `turn.interrupted` 的 payload 增加可选 `fileResults`，在终态前完成核对后一次发出：

  ```json
  {
    "fileResults": [
      {
        "path": "docs/report.md",
        "changeType": "created",
        "version": "sha256-hex",
        "existed": true,
        "category": "deliverable"
      },
      {
        "path": "tmp/probe.mjs",
        "changeType": "created",
        "version": "sha256-hex",
        "existed": false,
        "category": "process"
      }
    ]
  }
  ```

  字段约束：`path` 为项目内相对路径；`version` 为最后一次写入后的版本哈希；`existed` 为终态核对结果；`category` 为 `deliverable` 或 `process`；数组已按路径去重、按首次变更顺序排列。超出上限（200）时另附 `fileResultsOmitted` 计数，客户端显示「另有 N 个文件未列出」，不渲染其余条目。事件类型不变，旧客户端忽略这些字段。

- **`tool.completed`**：成功 `write_file` 增加与 `apply_patch` 相同的 `resourceTarget: { kind: "file", scope, path, version }`；scope 仍由服务端执行上下文生成，模型不可指定。同步 [m2-resources](../../docs/contracts/m2-resources.md) 中「当前由成功 apply_patch 生成」的表述。

- **前端**：Turn 存在 `fileResults` 时，成果区文件部分只由它渲染（`deliverable` 为文件卡片，`process` 为过程行）；同一 Turn 已有的 `file.changed` 产物条目与工具级文件目标不再在成果区重复显示，但仍保留在事件、检查点事实与工具详情中。无 `fileResults` 时沿用现规则。

- **契约同步**：[ws-events](../../docs/contracts/ws-events.md)（终态事件负载与 `fileResults` 字段）、[m2-resources](../../docs/contracts/m2-resources.md)（`write_file` 文件目标）、[resource-views](../../docs/contracts/resource-views.md)（成果与过程行位置、折叠规则）。

- **051 同步**：`write_file` 描述补充「临时脚本放 `tmp/`，并在 Turn 结束前删除」；工具 schema 不变，按 051 的持续约束同步描述、模型上下文与验收。

## 8. 数据与迁移

- 无数据库 schema 迁移：分类结果只进入 `agent_events` 的既有 payload。
- 历史数据：`fileResults` 缺失即走回退，不批量回填、不重写旧事件。
- 重放与刷新：客户端从事件重建结果，与服务端广播一致；未知字段不参与渲染判断。
- 回退：停止写出 `fileResults` 并让前端忽略即可回到现行为；已写事件保留字段，旧版本不会读取。

## 9. 安全与权限

- 不新增接口，不扩大任何 scope；分类只使用该 Turn 已授权的项目 / 会话范围。
- 事件只含项目内相对路径、版本哈希与分类，不含绝对路径、文件正文、命令或秘密。
- 分类由服务端根据真实执行结果与文件系统状态计算，禁止信任客户端提交或模型声明的分类。
- 打开成果 / 过程文件继续走现有授权读取与错误映射；已删除或越权目标失败关闭。
- 核对失败只记录相对路径与错误码，日志不得出现内容。

## 10. 失败与边界

| 场景 | 期望 |
|---|---|
| 文件在核对后被外部删除 | 卡片仍可点击，打开时按现有错误处理并提示文件已变化 / 不存在 |
| `stat` 返回 `ENOENT` | `existed=false`，进入过程 |
| `stat` 返回 `EACCES` / IO 错误 | 视为存在，保留为成果，记录错误码 |
| 中断由服务重启补写终态，无法核对文件 | 无 `fileResults`，回退现有渲染；恢复入口行为不变 |
| 事件重复投递 | 客户端按 Turn 幂等覆盖，不重复计数 |
| 同一路径多次写入 | 一条结果，`changeType` 取首次（创建优先），`version` 取最终 |
| 重命名 / 移动 | 按旧路径删除、新路径创建两条路径处理，不做跨路径合并 |
| 条目超过上限 | 只渲染上限内条目并显示「另有 N 个文件」；分类计数仍准确 |
| 忽略规则命中 | 归入过程，不改变文件树可见性 |
| 历史 Turn 无字段 | 回退，不显示过程行 |

## 11. 测试计划

- 单元：分类器（存在性、默认与项目忽略、生成 / 临时规则、去重、`changeType` 取首个、`version` 取最终、上限）。
- 服务端：Turn 四种终态都写出 `fileResults`；`stat` 失败分支；忽略规则来自实际项目设置；事件先持久化再广播；`write_file` 生成文件目标。
- Web：reducer 以 Turn 保存结果并支持重放；成果区只渲染 `deliverable`；过程行折叠 / 展开 / 计数 / 已删除不可点；历史无字段回退；`write_file` 与 `apply_patch` 同一卡片；空态。
- 可访问性：过程行 `aria-expanded`、键盘操作、朗读计数。
- 浏览器：浅色 / 深色与 320px 宽度下页脚不横向溢出；过程行展开不遮挡复制与时间栏。
- 命令：`pnpm check`；涉及构建产物或事件形状时 `pnpm build`；按需运行 Demo E2E 与相关认证 E2E。未运行项如实记录。

## 12. 已确认决策（2026-11-12，G-074）

| ID | 问题 | 暂定默认 |
|---|---|---|
| D-1 | 保留在项目内的临时脚本如何判定？ | 采用：约定「临时脚本放 `tmp/` 并在结束前删除」；不新增模型参数。已同步 051 的 `write_file` 描述。 |
| D-2 | 生成 / 临时默认清单 | `tmp/`、`.tmp/`、`temp/`、`dist/`、`build/`、`coverage/`、`.cache/`、`test-results/`、`playwright-report/`；后缀 `.tmp`、`.bak`、`.log`、`.swp`、`.orig`（已确认） |
| D-3 | 只有过程文件时过程行是否展开 | 默认收起，只显示计数（已确认） |
| D-4 | 结果条目上限 | 200（已确认） |
| D-5 | 是否允许用户手动从成果隐藏 | 本切片不做（已确认） |

## 13. 参考

- [现状卡片实现](../../apps/web/src/features/chat/Timeline.tsx)
- [文件结果卡](../../apps/web/src/features/files/FileResultCard.tsx)
- [Turn 终态与文件变更](../../apps/server/src/modules/agent/turnRunner.ts)
- [事件契约](../../docs/contracts/ws-events.md)
- [成果位置契约](../../docs/contracts/resource-views.md)
- [051 Agent 工具执行契约](../051-agent-tool-contract/spec.md)
