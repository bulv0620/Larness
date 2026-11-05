# ADR-045 临时服务可独立停止或删除

- 状态：accepted；2026-11-05。人类要求“服务本身可以被终止删除，不是只跟随终端走”。
- 关联：ADR-030、ADR-043、[服务与预览契约](../contracts/services-preview.md)、[040 spec](../../specs/040-services-preview/spec.md)。

## 背景
M3 原契约规定临时服务只随终端/监听退出而退登，界面不提供独立停止。实际使用中：服务可能登记错、需要提前释放预览、或进程仍在但不想保留卡片；只靠 Ctrl+C 或关闭终端不够。

## 决策
临时服务增加两个独立动作：

1. **删除登记（DELETE `/api/services/:id`）**
   - 仅把服务标为 `UNREGISTERED / DELETED`，撤销 grant 与预览资格；
   - **不终止进程**，终端、Shell 与其他服务不受影响；可重新登记同一端口。

2. **停止服务（POST `/api/services/:id/stop`）**
   - 先重新核验监听 owner/birth 与终端归属；
   - 只终止该监听进程及其**后代进程**，不发送进程组信号、不关闭终端 Shell；
   - 同一 `(pid,birth)` 共享的其他 endpoint 一并退登（`STOPPED_BY_USER`），并在确认文案中提示；
   - 监听已消失时按 `SOURCE_GONE` 退登；终止未确认（进程仍活）返回 `RESOURCE_UNAVAILABLE`，不伪装成功；
   - 若监听进程就是终端 Shell 本身，拒绝停止（`VALIDATION_ERROR`），避免误杀 Shell。

两者均需管理会话 + CSRF，写入审计（通过既有 unregister 审计）；UI 必须二次确认，文案明确“删除不杀进程 / 停止会杀进程树但不关 Shell”。

## 非目标
- 不新增 Agent 工具（本轮先提供人工 API/UI；若后续给 Agent，需单独策略评审）。
- 不做持久服务/PM2 生命周期（M4）。
- 不杀整个进程组，不关闭终端，不自动重启。

## 结果
- 服务卡片/详情可独立清理或停止，不再强绑定终端生命周期；
- 停止的风险被限制在已核验监听进程树，并保留终端 Shell 供继续操作；
- 契约、验收与测试同步更新。
