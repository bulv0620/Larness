# M2 / G2 人类整体验收通过

- 日期：2026-11-05（Asia/Shanghai）。
- 人类确认原文：“好了，所有修改内容验收通过，M2阶段也整体通过，把相关文档全部更新好，然后合并分支并push”。
- 结论：M2 / G2 `done`；M2-0～M2-8 及 M2-9～M2-28（含 M2-24b）全部通过人类统一验收。M2-29 为本次文档收尾 / 合并发布任务。
- 范围：当前本机 macOS arm64 / Node 20.19.3 / Chromium；不外推 Linux / Windows / CI。

## 最终交付

| 范围 | 验收后的行为 | 记录 |
|---|---|---|
| 文件与命令 | 真实文件树/编辑/草稿/版本冲突/监听补拉，受管命令与输出、项目写锁/fencing | [030验收历史](acceptance.md) |
| 终端 | 人工/AI控制租约；新Agent终端Ctrl+C后回到Shell；显式关闭确认退出再移除Tab；历史打开核对真实状态 | [043](../043-agent-terminal-close/acceptance.md)、[044](../044-agent-shell/acceptance.md) |
| 项目和窗口 | 固定默认项目/共享默认目录；项目归属窗口；文档窗口关闭全部Tab及草稿保护，终端/服务关闭只隐藏；共用最小化动画 | [031](../031-project-windows/acceptance.md)、[032](../032-default-workspace/acceptance.md)、[035](../035-default-project/acceptance.md)、[045](../045-workspace-polish/acceptance.md) |
| 对话 | 回复消息框/时间、真实任务计划/折叠过程、紧凑待处理审批、边缘过渡、欢迎建议、策略盾牌和上下文圆环 | [036](../036-conversation-experience/acceptance.md)、[038](../038-message-bubbles/acceptance.md)、[041](../041-composer-controls/acceptance.md) |
| 策略 | 风险确认后完全自主策略真实接入新Turn快照；基础鉴权/范围/锁/租约/预算/审计仍保留 | [ADR-040](../../docs/adr/ADR-040-autonomous-policy.md)、[045](../045-workspace-polish/acceptance.md) |
| Git | 文件/Git互斥；提交区/目录树/底部操作；行暂存、确认放弃、取消暂存；刷新无多余busy行，失败/审批保留 | [046](../046-git-file-actions/acceptance.md)、[047](../047-git-feedback/acceptance.md) |

后续纠错spec/契约和ADR-031～041对应条款取代030早期的跨项目筛选、所有窗口关闭保留Tab、仅三种策略、直接服务PTY等旧呈现规则。分任务文档中的“待人类/尚未进入下一任务”是当时记录，本页为最终状态依据。

## 验证证据与限制

沿用逐任务真实资源/自动化证据与用户自行界面验收。本次仅文档收尾，不把此前测试结果冒充当前重新运行，不新增无关产品改动。M2-8历史全量check/build/Demo/init/unified/TUI记录见030；后续按用户明确要求只做必要校验，详各切片acceptance。近期跨UI必要验证61项、策略Agent7/Server15项，Git后续Server12/Web7项、反馈Web8项及相关包类型/格式检查均已有记录。

以下边界继续保留，不因人类通过就写成已修复：
- 认证生产E2E批量运行曾有撤销跳转/pair抖动，不能宣称全套稳定。
- Monaco TS worker的生产CSP允许unsafe-eval；无远程脚本，但防护弱化仍是已知安全边界。
- Git状态依赖3秒查询，尚无Git WS失效接线。
- 主机Shell/项目脚本非OS沙箱，进程身份/脱组和外部编辑竞态的限制不变。
- 服务登记/隔离预览/PM2属于M3，尚未交付；M3保持draft，须先G-Spec-M3及PoC。

## M2-29 收尾

- [x] 按人类验收更新README、AGENTS、STATUS、ROADMAP、030及后续切片状态/验收记录与相关契约入口。
- [x] 保留已知边界和历史测试事实，文档链接/格式/类型进行必要检查。
- 合并发布由用户本次明确授权；最终以Git main和origin/main同步结果为准，不删除历史任务分支，不force push。

### 本次必要检查
- `pnpm exec biome ci .`：通过（458文件，4 warning / 1 info，未修改无关代码）。
- `pnpm typecheck`：所有6个工作区子包通过。
- 新增/修改文档链接110处存在性检查、17个M2切片done一致性、M3仍draft及git diff --check通过。
- 本次只有文档变更；未重跑全量单元/构建/E2E，不将历史检查计为本次重新运行。
