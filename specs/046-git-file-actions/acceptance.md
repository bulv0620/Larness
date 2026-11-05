# M2-27 必要验证（2026-11-05 +08:00）
- 前端新动作定位先红后绿。真实仓库新增用例最初被测试清理函数名拼写错误遮蔽，修正为stopAuthorizedServer；同步抛错的无确认校验改用正确Promise断言，保留FORBIDDEN断言。没有删除/跳过或放宽行为测试。
- Server GitManager / 原AgentGit工具：12/12，包含分层stage/worktree、untracked、新增stage、unborn、rename、恢复删除、特殊通配符精确路径、未确认/未认证、symlink/目录/越界拒绝、内容变化冲突、重复执行幂等以及既有锁/审批/快照回归。
- Web GitChangeTree/GitPanel：7/7，包含原暂存/提交/分支/推送审批、Diff、灰占位，新取消暂存精确路径、放弃弹窗警示/取消不写/确认执行/刷新消失。
- Server/Web/Shared typecheck、改动文件Biome、git diff --check通过。只做必要校验，未跑全量check/build/E2E。未操作用户仓库工作区，真实Git删除/恢复仅发生在隔离临时测试仓库。
- 现有API枚举/契约、ADR-041、STATUS/ROADMAP同步，无依赖/DB迁移；用户自行界面验收，G2/README统一验收不变，未合并/推送。

人工：未暂存行＋保持暂存，撤销图标弹出放弃提示；已暂存行－取消暂存后磁盘修改保留。未跟踪文件明确警示删除；同时有暂存和未暂存的文件放弃后仍保留暂存版本。失败保留提示，不声称成功。
