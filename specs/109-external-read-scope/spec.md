---
id: 109-external-read-scope
title: 文件工具作用域：放开项目外读取
milestone: 发布后
status: done
depends_on: [020-workspace-agent, 051-agent-tool-contract, 082-agent-kernel]
owners: []
created: 2026-11-27
updated: 2026-11-27
---

# 文件工具作用域：放开项目外读取

> 状态：`done`（2026-11-27，用户确认“写不放开、不拒绝文件类型”）。P1–P3 已实现并整仓验证；P4（`run_command.cwd` 外部路径）未开始。
> 结论先行：拆掉“文件工具只能使用项目根”的墙，但只拆读、不拆写。读取类工具接受项目外绝对路径，写入类工具仍限制在当前项目根；`<dataDir>` 与伪文件系统是仅有的不可配置硬闸，不按文件类型或凭据目录名拒绝。

## 1. 背景与问题

当前文件工具被绑定到会话所属的项目根：

- Agent 侧 schema 本身并不限制路径：`packages/agent/src/tools/fileTools.ts:14` 的 `PathSchema` 只要求 1–4096 字符。
- 墙在资源层：`packages/shared/src/files.ts:13` 的 `FilePathSchema` 拒绝绝对路径、`..` 和冒号段；`packages/resources/src/files/fileManager.ts:39` 的 `normalizeFilePath` 重新套用同一 schema；`resolveFilePath`（同文件 :53）再逐段 `lstat` 拒绝符号链接并做 `realpath` + `isInsideRoot` 复核。
- `apps/server/src/modules/files/scope.ts:20` 把 project / default / session 解析成唯一 `root`，并保护 `<dataDir>`。
- `packages/resources/src/files/pathGuard.ts:69` 的 `resolveInsideRoot` 其实已经能处理绝对路径，只是最后仍然强制落在根内。

这条墙并不等于安全隔离：`run_command` 的 `executable` 可以是绝对路径，`run_shell` 更没有路径限制，`apps/server/src/modules/agent/commandTool.ts:102` 自己写了“可访问项目外文件，不是沙箱”。所以现状是**模型想读项目外文件只能绕到 Shell**，能力本来就有，只是少了结构化入口、结构化结果和文件级可见性。

用户诉求：拆掉这面墙的一部分，让读取参考仓库、兄弟目录、系统文档成为正常操作。

### 1.1 与 opencode 的对比

| 维度 | opencode（V2） | Larness 当前 |
|---|---|---|
| 路径输入 | 相对或 canonical 绝对路径 | 只接受项目根内相对路径 |
| 外部目录 | `external_directory` 默认允许，不逐次询问 | 硬拒绝 `PATH_OUTSIDE_PROJECT` |
| 特殊路径 | `.env` 默认 `ask`（V1 更保守） | 无差别拒绝所有外部路径 |
| 写入 | 与读取同一套路径规则 | 只能写项目根 |
| 信任模型 | 单用户本地 CLI | 单机多项目 + 服务端数据目录（DB、主密钥） |

opencode 的默认值是“读放开”，这正是要拆的部分；Larness 只多留一个 `<dataDir>` 硬闸，因为那里有数据库和主密钥。

参考：
- <https://opencode.ai/docs/permissions/>
- <https://opencode.ai/v1/docs/permissions/>

## 2. 目标

- G-1：`read_file`、`list_files`、`search_code` 接受项目外绝对路径，无需先配置白名单。
- G-2：写入类工具（`write_file`、`edit`、`apply_patch`）保持现状，只能写当前项目根，避免误改其他仓库和系统文件。
- G-3：保留一个不可配置的硬闸：`<dataDir>`；项目指令不能覆盖。
- G-4：项目内相对路径行为完全不变（向后兼容）。
- G-5：外部读取在工具结果里带 `rootScope=external` 与绝对路径，硬闸拒绝走现有 `tool.denied` 审计。

## 3. 非目标

- NG-1：不放开写。写外部路径需要根级 lease、版本冲突与回滚语义，单列后续切片。
- NG-2：不宣称沙箱。`run_command` / `run_shell` 的实际可达范围不变，也不因此变小。
- NG-3：不改变浏览器文件 REST API 的相对路径契约；文件树仍只显示项目根。
- NG-4：不引入逐次审批。完全自主策略（ADR-040）不变，控制点是硬闸而不是弹窗。
- NG-5：不实现“项目级外部根列表”。既然读默认放开，就不需要用户维护清单。
- NG-6：不按文件类型或凭据目录名拒绝（用户 2026-11-27 明确）。读取 `.env`、`~/.ssh` 等由使用者自行承担，不内置名单。
- NG-7：本轮不改 `run_command` 的 `cwd`；它仍只接受项目根相对路径，作为后续步骤单独评估。

## 4. 方案对比

| 方案 | 做法 | 优点 | 代价 | 结论 |
|---|---|---|---|---|
| T0 维持现状 | 只允许项目根相对路径 | 变更最小 | 用户痛点不解，模型继续绕 Shell | 不采纳 |
| T1 扩到父目录 | 根上移到项目父目录或仓库根 | 实现最小，适合 monorepo | 只能覆盖相邻目录，仍要配置/猜测 | 备选 |
| **T2 读放开、写不收** | 读类工具接受任意绝对路径；写类不变；`<dataDir>` 硬闸 | 直接解决痛点；无新配置；改动集中在解析层 | 本机文件暴露面变大，需要文档修订 | **采用** |
| T3 读写全放开 | 写入也接受绝对路径 | 最彻底，最接近普通 CLI | 需要文件锁、版本冲突、跨项目审计；误改风险高 | 不建议本轮 |

T2 的核心判断：**读取的价值高、破坏性低；写入的价值低、破坏性高**。拆读不拆写，是把墙拆到“刚好够用”的位置。

## 5. 方案细节

### 5.1 路径解析

新增 `resolveReadPath(policy, input)`（`packages/resources/src/files/pathGuard.ts`）：

```ts
type RootScope = "primary" | "external";

interface ReadPathPolicy {
  root: string;                 // 项目 realPath / 会话 workspace realPath
  allowExternal?: boolean;      // 缺省 false，保持旧行为
  protectedRoots?: readonly string[]; // <dataDir>，realpath 规范化
}

resolveReadPath(policy, input) => { absolutePath: string; rootScope: RootScope }
```

规则：

1. 相对路径：以 `root` 为基准，仍走现有 `resolveInsideRoot`；越界返回 `PATH_OUTSIDE_PROJECT`。
2. 绝对路径且 `allowExternal !== true`：返回 `PATH_OUTSIDE_PROJECT`，与当前一致。
3. 绝对路径且允许外部：`path.resolve` → 从最近存在祖先解析 `realpath`（复用 `resolveInsideRoot` 的祖先回溯），最终 canonical 路径可落在根外。
4. canonical 路径落在 `root` 内时 `rootScope="primary"`，否则 `"external"`。
5. 落在 `protectedRoots` 内一律 `FORBIDDEN`；符号链接先解析再判断，指向 `<dataDir>` 的链接同样拒绝。
6. 文件系统根、用户主目录本身、Windows 盘符根 / UNC 共享根：`INVALID_PATH`，要求指定具体子目录，避免误扫全盘。
7. Linux `/proc`、`/sys`、`/dev`：`FORBIDDEN`。它们的“文件”可能无限大或是设备节点，读取不安全。
8. 不按扩展名、文件名、目录名做额外拒绝。

### 5.2 硬闸清单（不可配置）

| 类别 | 内容 | 说明 |
|---|---|---|
| Larness 运行数据 | `<dataDir>` 全部（DB、`secrets/`、日志） | 与现有 `scope.ts:77` 的保护一致，扩大到所有读取 |
| 伪文件系统 | Linux `/proc`、`/sys`、`/dev` | 设备节点与动态文件，读取可能阻塞或无界 |
| 根级目录 | 文件系统根、主目录本身、盘符根、UNC 共享根 | `INVALID_PATH`，要求具体子目录 |

硬闸在每次解析时对存在的路径做 `realpath`，再复核是否落在受保护根内；根被替换为符号链接时按新目标判断。

### 5.3 工具行为

| 工具 | 变更后 |
|---|---|
| `read_file` / `list_files` / `search_code` | 相对路径 = 项目内；绝对路径 = 项目外（硬闸除外），结果 `rootScope=external` |
| `write_file` / `edit` / `apply_patch` | 不变，仅项目根相对路径 |
| `run_command` / `run_shell` | 不变；`cwd` 仍只接受项目根相对路径 |
| 浏览器文件 API | 不变，仍只接受 project / default / session 相对路径 |

`ToolContext` 增加可选 `readScope: { allowExternal: boolean; protectedRoots: string[] }`；未提供时按“只读项目内”处理。服务端在 `TurnRunner` 中按 `dataDir` 注入：`dataDir` 缺失时不放行外部读取（失败关闭）。

按 [051 契约](../051-agent-tool-contract/spec.md) 同步：

- 工具描述：`read_file` / `list_files` / `search_code` 写明“可传项目外绝对路径；`<dataDir>` 与伪文件系统会被拒绝；写入只能项目内”。
- system prompt：默认优先项目内路径；只有任务明确指向外部时才用绝对路径；不要尝试读取 Larness 数据目录。
- 结果：外部读取的 `path` 为绝对路径，summary 自然显示该路径；不新增前端组件。

### 5.4 审计与可观测性

- 外部读取成功：工具事件带 `rootScope=external`、绝对路径；不写 required 审计，避免噪声。
- 硬闸拒绝：现有 `tool.denied` required 审计自动记录失败工具调用与 `FORBIDDEN` 错误码。
- 路径解析失败：`VALIDATION_ERROR` / `NOT_FOUND`，日志只带路径，不带内容。

## 6. 失败与边界

| 场景 | 行为 | 错误码 |
|---|---|---|
| 读项目外普通文件 | 允许，`rootScope=external` | — |
| 读 `<dataDir>` 内任意文件 | 拒绝 + 审计 | `FORBIDDEN` |
| 符号链接指向 `<dataDir>` | 解析后拒绝 | `FORBIDDEN` |
| 写项目外路径 | 拒绝，与当前一致 | `PATH_OUTSIDE_PROJECT` |
| 读 `/`、主目录本身、盘符根 | 拒绝，提示指定子目录 | `INVALID_PATH` |
| 读 `/proc`、`/sys`、`/dev` | 拒绝 | `FORBIDDEN` |
| 目标不存在 | 读取返回 `NOT_FOUND` | `NOT_FOUND` |
| 相对路径含 `..` 或越界 | 拒绝，与当前一致 | `PATH_OUTSIDE_PROJECT` |
| Windows 盘符 / UNC / 大小写 | canonical 比较，测试覆盖 | — |
| 项目内相对路径 | 与当前完全一致 | — |

## 7. 分阶段实施

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | 本 spec 评审：确认“读放开、写不收”、不按文件类型拒绝 | done（2026-11-27） |
| P1 | `resolveReadPath` + `readTextFile` / `listFiles` / `searchCode` 接入；单元测试 | 1.5–2 人日 |
| P2 | `ToolContext.readScope`、`TurnRunner` 注入、工具描述与 system prompt | 1 人日 |
| P3 | `security.md` 与 `051` 契约同步、整仓检查 | 0.5 人日 |
| P4 | `run_command.cwd` 外部路径（单独评估） | 后续 |

本轮做 P1–P3；P4 不在本轮。

## 8. 验收场景

### A1 读取项目外文件

```gherkin
Given 项目 P 的根为 /work/app，且 dataDir 可用
When Agent read_file 路径 /work/reference/api.md
Then 返回内容与 sha256 version
And 工具结果标记 rootScope=external，path 为绝对路径
And 不获取项目写锁
```

### A2 硬闸拦截

```gherkin
Given <dataDir> 为 /Users/me/.larness
When Agent read_file 路径 /Users/me/.larness/secrets/master.key
Then 返回 FORBIDDEN
And 审计记录 tool.denied
```

### A3 符号链接绕过

```gherkin
Given /work/link 是指向 /Users/me/.larness 的符号链接
When Agent read_file 路径 /work/link/db.sqlite
Then 解析 realpath 后命中硬闸并返回 FORBIDDEN
```

### A4 写入仍受限

```gherkin
Given 项目 P 的根为 /work/app
When Agent write_file 路径 /work/reference/api.md
Then 返回 PATH_OUTSIDE_PROJECT，文件未改变
```

### A5 项目内回归

```gherkin
Given 项目 P
When 运行现有文件工具测试与真实任务
Then 相对路径行为、错误码与结果格式与当前版本一致
```

### A6 未启用时不放开

```gherkin
Given ToolContext 没有 readScope（例如测试或旧调用方）
When Agent read_file 路径 /work/reference/api.md
Then 返回 PATH_OUTSIDE_PROJECT
```

### A7 Windows

```gherkin
Given Windows 项目与 dataDir
When Agent 读取 D:\reference\a.md 或大小写不同的路径
Then 正常解析；命中硬闸仍返回 FORBIDDEN
```

### A8 全盘扫描防护

```gherkin
When Agent list_files 路径 /
Then 返回 INVALID_PATH，提示指定具体子目录
```

## 9. 测试计划

- 单元：`resolveReadPath` 的相对 / 绝对 / `..` / 符号链接 / 硬闸 / 根级目录 / 未启用。
- 单元：`readTextFile` / `listFiles` / `searchCode` 的外部路径显示与硬闸。
- 集成：工具层 `readScope` 开关与 `rootScope` 结果；写工具仍拒绝绝对路径。
- 手动：macOS `/tmp` 符号链接、Windows 盘符与 UNC、Linux 伪文件系统。

## 10. 开放问题

| 问题 | 已确认默认 | 需要谁决策 |
|---|---|---|
| 是否放开写？ | 不放开；需要时单列切片，必须带根级 lease 与版本冲突 | 用户（2026-11-27） |
| 是否按文件类型 / 凭据目录拒绝？ | 不拒绝；只保留 `<dataDir>` 与伪文件系统硬闸 | 用户（2026-11-27） |
| 其他已注册项目根是否硬闸？ | 不硬闸：属于用户自己的代码，读放开；写仍只限当前项目 | 用户（2026-11-27，隐含接受） |
| 外部读取是否需要默认上限？ | 沿用现有 1 MiB / 2000 行结果预算，不额外加 | 架构 |
| 是否保留配置开关？ | 首版不加；`readScope` 由服务端按 dataDir 注入 | 安全 |
| 是否对齐 opencode 的 `external_directory` 规则语法？ | 不对齐；固定硬闸，不引入规则引擎 | 架构 |
| `run_command.cwd` 是否也放开？ | 本轮不放开，单列后续 | 用户 |

## 11. 完成定义

- [x] A1–A8 通过；
- [x] 单元 / 集成 / 整仓检查通过；
- [x] `docs/architecture/security.md` 的“路径边界”表述改为“读放开、写受限、`<dataDir>` 硬闸”；
- [x] `051` 工具契约、system prompt 同步（三个工具的模型描述已写明“项目内或项目外绝对路径”，`051` 正文 2026-11-27 条目已补；system prompt 未按工具罗列读取范围，沿用工具描述）；
- [x] 项目内行为与当前版本一致。

> 2026-11-28 回填：P1–P3 已交付并整仓验证；P4（`run_command.cwd` 外部路径）按第 7 节明确不在本轮，仍未开始。
