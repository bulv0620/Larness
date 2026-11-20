# 实施计划：项目指令、项目记忆与用户偏好

> 对应 [spec](spec.md)。本文件只讲“怎么做”，不改变需求。spec 为 `ready`（2026-11-20 人类确认 D1–D11），决策见 [ADR-072](../../docs/adr/ADR-072-project-memory.md)（accepted）。

## 1. 技术方案

把“项目知识”拆成三条互不混用的链路：

- **指令链路（只读、人写）**：`resolveProjectInstructions` 在每次 Turn 装配时读取 `AGENTS.md`、`.larness/instructions.md` 与 `project.settings.instructions`，做路径/编码/大小校验，按优先级截断，产出带来源标签的 system blocks。
- **自动记忆链路（可写、证据驱动）**：Agent 通过 `remember` 写入；服务端校验证据、scope/kind、秘密与内容策略，按规则决定 `active` 或 `review`；同 Turn 不注入，下个 Turn 生效。
- **偏好链路（全局、低容量）**：只保存用户明确表达的跨项目偏好；与项目记忆共用表但用 `scope` 隔离；全局偏好完整注入，项目记忆只注入索引。

增长控制是核心设计，不是后置优化：

- **硬预算**：项目 active 64 KiB / 300 条、总占用 192 KiB；全局 active 8 KiB / 50 条、总占用 24 KiB。
- **淘汰**：写入超过 90% 时先清理旧 revision/review/evicted，再把 revision 裁到 3 个，最后按评分淘汰非固定 active 到 80%；固定项超预算则拒绝新写入。
- **保留**：revision 3 个 / 30 天；review 20 条 / 14 天；rejected/expired/evicted 30 天；抑制项 90 天。
- **注入**：全局偏好 ≤512 token，项目索引 ≤1,024 字符，正文按需读取，总计 ≤2,000 token。
- **进程内存**：只查询索引与单次正文，不把全部记忆加载到内存。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 逐条确认后生效 | 最可控 | 打断工作，用户会关掉或忽略；不符合“无感” | 不采用 |
| 全自动写入、无证据 | 最无感 | 噪声、错误归纳、prompt injection 持久化 | 不采用 |
| 自动写入 + 证据 + 低频 review | 无感且可控 | 需要证据校验与评分实现 | **采用** |
| 文件式记忆（`.larness/memory.md`） | 可版本化、可见 | 污染 git、需锁、并发/审计弱、秘密易进仓库 | 不作为主存储 |
| 向量检索 / embedding | 语义命中好 | 原生依赖、成本、不可解释、评测不足 | 不采用 |
| 全量对话摘要当记忆 | 实现简单 | 噪声大、预算不可控、与会话摘要重复 | 不采用 |
| 只按条数限制 | 实现简单 | 单条正文可无限长，实际占用仍膨胀 | 不采用；改为字节 + 条数双上限 |

## 3. 目录与文件变更

```text
新增：
  specs/086-project-memory/{spec,plan,tasks}.md
  apps/server/src/modules/projects/instructions.ts
  apps/server/src/modules/memory/{repository,service,budget,eviction,retention}.ts
  apps/server/src/api/memories.ts
  apps/server/src/modules/agent/memoryTool.ts
  apps/server/drizzle/0034_memory.sql
  apps/server/test/projects/instructions.test.ts
  apps/server/test/memory/{repository,service,budget,retention,api}.test.ts
  apps/server/test/agent/{memoryTools,memoryContext}.test.ts
  apps/web/src/features/projects/MemoryPanel.tsx
  apps/web/src/features/projects/MemoryPanel.test.tsx
  apps/web/src/features/projects/MemoryDialog.tsx
  docs/adr/ADR-072-project-memory.md（编号以实施时为准）

修改：
  apps/server/src/db/schema.ts
  apps/server/src/modules/agent/contextAssembler.ts
  apps/server/src/modules/agent/profiles.ts
  apps/server/src/bootstrap/start.ts
  apps/server/src/api/projects.ts
  apps/server/src/modules/projects/service.ts（settings.memory）
  apps/server/src/db/cleanup.ts（记忆保留期清理）
  packages/agent/src/kernel/profile.ts（memory pack）
  packages/shared/src/config.ts
  packages/shared/src/events.ts
  apps/web/src/lib/{queries,workspaceApi}.ts
  apps/web/src/features/projects/ProjectSettings*.tsx
  apps/web/src/lib/eventReducer.ts
  docs/contracts/{rest-api,ws-events,data-model}.md
  specs/051-agent-tool-contract/spec.md（工具描述与正反例）
```

## 4. 实施步骤

1. **先写失败测试**：
   - 指令来源顺序、20k 截断优先级、越界符号链接、二进制与不可读文件。
   - 成功命令后自动学习、下个 Turn 生效、同 Turn 不生效。
   - 证据无效/冲突/决策类进入 review；用户接受/拒绝/忘记/恢复。
   - 预算淘汰、固定项、保留期清理、抑制项、跨项目隔离、私有项目。
   - 秘密拒绝与“记忆不能授权”的反例。
2. **指令解析**：新增 `instructions.ts`；`realpath` 校验在 `project.realPath` 内；单文件 64 KiB、合计 20k 字符；产出 `sources`、`warnings`、`blocks`。
3. **数据层**：Drizzle schema + `0034` 迁移；`memories`、`memory_revisions`、`memory_suppressions`；`scope` 从第一天存在；active key 唯一用 partial unique index；repository 只暴露带 `projectId` 的方法。
4. **预算与淘汰**：`budget.ts` 负责字节统计、90%/80% 水位、评分与淘汰；`retention.ts` 负责 revision/review/rejected/expired/evicted/suppression 的保留期清理；所有写操作在事务内完成“改行 + revision + 审计 + 预算检查”。
5. **Agent 工具**：`remember`、`read_memory`；`requiresProject: true`；加入 `memory` pack 与 `coding`/`plan` Profile；证据校验、scope/kind 矩阵、限流与秘密扫描在工具层执行。
6. **全局偏好**：`scope=global` 只允许 `preference`；写入要求 `user_statement`；内容过滤项目路径/代码/项目名/业务数据；项目可关闭全局偏好读写。
7. **上下文装配**：指令 → 全局偏好 → 项目索引 → 会话摘要；全局偏好 ≤512 token，项目索引 ≤1,024 字符；bump `PROMPT_VERSION`；索引按 kind + key 固定排序；同 Turn 写入不进入当前装配。
8. **REST / WS / 契约**：新增 memories 路由与 `memory.changed`；补错误码、DTO、预算接口、配置键；同步 `docs/contracts/*` 与 `packages/shared`。
9. **Web**：设置页“Larness 记住了什么”；预算条、活动记录、review、编辑/固定/忘记/恢复；不弹逐条确认。
10. **验证与文档**：运行第 7 节检查；补 ADR、051 工具契约、ROADMAP、STATUS 与验收记录。

## 5. 数据与迁移

- 新表：`memories`、`memory_revisions`、`memory_suppressions`。
- 新索引：active key 唯一（partial，scope + project + key）、`(scope,project_id,status)`、`(expires_at)`、revision 唯一。
- 迁移 `0034` 只新增表/索引，不改现有列；旧库升级后无记忆，行为与现状一致。
- `bytes` 在写入时按 key + title + body 的 UTF-8 字节计算，避免用字符数低估中文/emoji 占用。
- 回滚：先关闭 `agent.memory.enabled` 与项目开关；彻底回滚时 drop 三张新表。
- 备份：沿用升级前数据库备份；记忆清理只删旧 revision/review/rejected/expired/evicted 与抑制项。
- SQLite 物理文件可能保留高水位；逻辑行数与字节受预算约束，必要时在维护任务中执行增量 vacuum，但不作为本切片前置。

## 6. 回滚策略

- **配置回滚**：关闭全局或项目记忆开关，立即停止注入与工具暴露；数据保留。
- **提示回滚**：恢复上一版 `PROMPT_VERSION` 与 system prompt；旧 Turn 记录不受影响。
- **数据回滚**：drop 新表；不影响现有 project/session/turn/summary 数据。
- **UI 回滚**：隐藏记忆面板，REST 端点可保留但前端不调用。
- **自动学习回滚**：把 `remember` 的自动 active 规则改为全部 review，无需改表结构。

## 7. 验证命令

```bash
pnpm check
pnpm build
pnpm test:e2e
# 定向验证
pnpm --filter @larness/server exec vitest run test/projects/instructions.test.ts
pnpm --filter @larness/server exec vitest run test/memory
pnpm --filter @larness/server exec vitest run test/agent/memoryTools.test.ts test/agent/memoryContext.test.ts
pnpm --filter @larness/web test:file src/features/projects/MemoryPanel.test.tsx
```

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自动学习噪声过多 | 用户频繁纠正、信任下降 | 证据约束、置信度阈值、每 Turn 限流、纠正后置信度下降、低频自动淘汰 |
| 记忆过期导致错误动作 | 构建/部署失败或写错路径 | TTL + stale 标记 + “可变状态先实测”；行动前工具仍校验真实状态 |
| 记忆成为 prompt injection 通道 | 持久化恶意指令 | 只注入不可信数据；不参与授权；证据校验；同 Turn 隔离；高风险内容进 review |
| 秘密写入记忆 | 泄漏到数据库/日志 | 写入与注入双向扫描；日志不记正文；错误不回显正文 |
| 全局偏好泄漏项目数据 | 跨项目隐私问题 | 全局只允许 preference；内容过滤；私有项目关闭全局；审计可见 |
| 预算淘汰误删重要记忆 | 用户丢失知识 | 固定项豁免；7 天可恢复；80% 预警；淘汰有审计 |
| 上下文预算膨胀 | 成本上升、缓存失效 | 全局 512 token、索引 1,024 字符、总 2,000 token、固定排序、正文按需 |
| 指令文件读取越界 | 读取项目外文件 | realpath 校验 + 普通文件 + 大小/编码限制；残余 TOCTOU 记录 |
| 并发编辑覆盖 | 多窗口丢更新 | `expectedUpdatedAt` + 409；revision 保留历史 |
| 迁移与旧库兼容 | 升级失败 | 只新增表/索引；升级前备份；迁移测试覆盖空库与存量库 |
| 自动学习让模型自我强化 | 错误事实被反复使用 | 同 Turn 不注入；证据必须来自真实事件；纠正/忘记写抑制项 |

## 9. 未决事项

- Q-060～Q-070 已于 2026-11-20 确认，见 [spec 第 13 节](spec.md#13-已确认决策) 与 [ADR-072](../../docs/adr/ADR-072-project-memory.md)。
