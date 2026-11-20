# ADR-072 项目记忆与用户偏好：自动学习、证据约束与硬预算

- 状态：accepted（2026-11-20，人类确认按 086 推荐默认实施）。
- 关联：[086 spec](../../specs/086-project-memory/spec.md)、[ADR-050](ADR-050-pm2-cli-deployment.md)、[ADR-058](ADR-058-turn-recovery-retention.md)、[051 工具执行契约](../../specs/051-agent-tool-contract/spec.md)、[安全架构](../architecture/security.md)。
- 范围：项目指令文件、项目记忆、跨项目用户偏好、记忆预算/淘汰/保留与注入。全局记忆的跨设备同步、向量检索与自动人格推断不在本 ADR。

## 背景

Larness 没有跨会话记忆：`contextAssembler` 只读取数据库里的 `project.settings.instructions`，会话摘要与 Turn 检查点只服务当前会话/任务，[ADR-058](ADR-058-turn-recovery-retention.md) 明确把长期记忆排除在外。结果是每个新会话都要重新交代构建/测试约定，长任务换页后也会丢失早期事实，用户偏好无法跨项目沉淀。

但“自动记住一切”会带来四类问题：

1. **噪声与错误归纳**：模型把一次性状态、推测或错误结论写成长期事实。
2. **过期事实**：端口、版本、命令随环境变化，旧记忆导致错误动作。
3. **持久化 prompt injection**：项目文件或命令输出中的恶意内容被写进记忆，影响后续会话。
4. **无限膨胀**：只按条数限制挡不住正文、revision、review、淘汰项和抑制项累积，最终推高数据库、进程内存与上下文成本。

逐条确认虽然可控，但会打断工作，实际会被用户忽略或关闭，不符合“让 Agent 越来越懂我的使用场景”的目标。因此需要**默认自动、证据约束、硬上限、可纠正**的设计。

## 决策

1. **三层分离。** 指令层（`AGENTS.md`、`.larness/instructions.md`、数据库 instructions）是人写只读输入；项目记忆层保存项目事实/命令/坑/决策；用户偏好层保存跨项目偏好。三者不合并，不互相替代。
2. **默认自动学习，不要求逐条确认。** Agent 通过 `remember` 写入；项目 `fact` / `command` / `gotcha` 在证据有效、无冲突、置信度 ≥0.6 时直接 `active`。`decision` 默认 `review`；全局 `preference` 仅在用户明确表达、原文引用校验通过、置信度 ≥0.9 时直接 `active`。
3. **review 是低频例外，不是审批队列。** 只有证据不足、低置信度、冲突、决策类、全局非明确表达或高风险内容进入 `review`；不注入、不弹窗，只在设置页可见。
4. **证据由服务端校验。** `command` 必须来自当前 Turn 的成功命令；`preference` 必须带用户消息原文 quote 且为子串；`gotcha` 必须有失败后修复事件；`fact` 必须来自文件/命令观察。没有有效证据不自动生效。
5. **同一 Turn 不自我强化。** Turn N 写入的记忆不在 Turn N 注入，只在 Turn N+1 起生效；避免模型把自己刚写的内容当作已验证事实。
6. **硬预算与淘汰。** 项目 active ≤64 KiB / 300 条、总占用（含 revision/review/evicted/抑制）≤192 KiB；全局 active ≤8 KiB / 50 条、总占用 ≤24 KiB。超过 90% 时先清过期项、再裁 revision、最后按评分淘汰非固定项到 80%；固定项不淘汰，固定项本身超预算则拒绝新写入。
7. **保留期有界。** 每条记忆最多 3 个 revision 或 30 天；review 20 条 / 14 天；rejected/expired/evicted 30 天；淘汰项 7 天内可恢复；抑制项 500 条/项目 / 90 天。active 只按预算淘汰，不自动删除。
8. **全局偏好严格收窄。** `scope=global` 只允许 `preference`；只从用户明确表达学习；禁止项目路径、代码、项目名、客户数据与秘密；私有项目可关闭全局偏好读写。
9. **注入有固定预算。** 全局偏好完整注入 ≤512 token；项目记忆只注入 ≤1,024 字符索引；正文通过 `read_memory` 按需读取（5 条 × 1,000 字符）；记忆相关总量 ≤2,000 token。排序固定，避免无意义 prompt cache 失效。
10. **记忆是不可信数据。** 不参与授权、不绕过审批/锁、不覆盖安全策略；写入与注入双向秘密扫描；`remember` 工具事件只保存元数据，不复制正文。同一 Turn 隔离与证据校验共同降低持久化注入风险。
11. **忘记后不重学。** 用户忘记或拒绝时写抑制项（key 或正文哈希，90 天）；抑制期内 `remember` 返回 `MEMORY_SUPPRESSED`。
12. **存储只在 Larness 数据库。** 不在项目目录创建记忆文件；`AGENTS.md` 与 `.larness/instructions.md` 只读，缺失不报错；文件导出明确为非目标。用户通过设置页查看、编辑、固定、恢复、忘记。
13. **先测量再自动化。** v1 不增加每 Turn 的额外 LLM 整理调用，依赖 Agent 主动 `remember`；用命中率、纠正率、淘汰量和重复纠正次数评估，覆盖率不足再加批处理 curator。

## 备选方案

- **逐条确认后生效**：最可控，但打断工作，用户会忽略或关闭，不做。
- **全自动、无证据**：最无感，但噪声、错误归纳与注入风险不可控，不做。
- **只按条数限制**：实现简单，但单条正文与 revision 仍可膨胀，不做。
- **文件式记忆（`.larness/memory.md`）**：可版本化，但污染 git、需要项目锁、并发/审计弱、秘密易进仓库，不作为主存储。
- **向量检索 / embedding**：语义命中好，但引入原生依赖、成本与不可解释性，v1 不做。
- **全量对话记忆**：噪声大、预算不可控，与会话摘要重复，不做。

## 影响

- **产品 / UI**：设置页新增“Larness 记住了什么”（全局偏好 + 项目记忆）、预算条、活动记录、review、编辑/固定/忘记/恢复；默认不弹确认。
- **API / 契约**：新增项目/全局记忆 CRUD、预算、`memory.changed` 事件；新增 `MEMORY_*` 错误码；同步 `docs/contracts/*`。
- **数据 / 迁移**：新增 `memories`、`memory_revisions`、`memory_suppressions`（预计迁移 `0034`）；`scope` 从一开始存在，避免后续迁移；active key 使用 partial unique index。
- **Agent 能力**：新增 `memory` tool pack（`remember`、`read_memory`），加入 `coding` / `plan`；`PROMPT_VERSION` bump；按 051 契约同步描述、schema、提示与正反例。
- **安全 / 权限**：记忆不参与授权；秘密扫描；项目隔离；全局只允许 preference；同一 Turn 隔离；审计不含正文。
- **成本**：每 Turn 增加最多 3+1 次记忆写入；注入固定 2,000 token 上限；不增加额外 LLM 调用。
- **风险**：自动学习噪声、全局偏好误判、淘汰误删、SQLite 物理高水位；由证据、置信度、固定/恢复、保留期与指标缓解。

## 验证与回滚

- 验证：A1–A16；指令解析、自动学习、同 Turn 隔离、证据/冲突/review、全局隐私、预算淘汰、保留期、注入预算、秘密与越权反例；30 天模拟/加速测试证明字节与注入 token 稳定；`pnpm check`、`pnpm build`、工具契约矩阵与相关 E2E 通过。
- 回滚：关闭 `agent.memory.enabled` 或项目 `memory.enabled` 即停止注入与工具；把 `remember` 自动 active 规则改为全部 `review` 可保留数据但停止自动学习；彻底回滚时删除三张新表，不影响现有 project/session/turn/summary 数据。
- 已写记忆不自动迁移到文件；回滚前提示用户备份数据库。

## 后续

- Q-068：若 `remember` 覆盖率不足，增加每 N 个 Turn 一次的批处理 curator，而不是每 Turn 额外调用。
- 全局偏好的跨项目重复推断、文件导出、跨设备同步另开切片；本 ADR 不预留未确认的产品行为。
