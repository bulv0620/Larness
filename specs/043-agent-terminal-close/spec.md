---
status: accepted
milestone: M2
---
# M2-21 Agent 关闭终端同步 Tab
用户指出 Agent 已终止终端但 Tab / 浮栏仍残留，直接授权纠错。依赖 M2-20 done。

## 目标与非目标
成功 stop_project_terminal 后，发起客户端移除相同终端的本地 Tab，最后一个 Tab 移除时收起窗口并更新浮栏。隐藏、最小化、非激活 Tab 同样处理。不改变其他客户端布局，不自动关闭自然退出的输出视图，不重启或再次终止资源。

## 验收
- Given 两个终端 Tab，When Agent 确认停止其中一个，Then 仅移除对应 Tab，另一个继续存在；最后一个移除后无窗口 / 残留计数。
- Given 隐藏窗口或切到其他项目，When 收到关闭结果，Then 同样移除目标，不抢焦点。
- Given 停止失败 / 状态未知 / 其他客户端事件，Then 保留本地 Tab；读取失败不误关闭。
- Given 历史关闭结果，When 重放，Then 幂等核对已关闭资源，不新建 Tab。

## 接口与数据
成功 stop 工具的持久化 tool.completed 增可选 closedTerminalTarget（既有 TerminalResultTarget 结构）与 originClientSessionId；来源为真实执行结果和 Turn 授权快照。前端校验目标、客户端，鉴权 GET 最新状态并比对 ID / 项目，确认终态后移除本地视图。无 DB / REST / 配置变更。

## 安全与失败边界
沿用后端终止鉴权 / 审计 / 退出确认；不得仅凭工具摘要关闭，不把 INTERRUPTED 未确认状态视为停止。不改变 ADR-030 的其他客户端保留结束视图规则。不删除输出、历史事件。事件先持久化再广播。

## 测试计划
先红：事件携带关闭目标；前端核对状态并移除对应 Tab、多 Tab / 最后一个 / 最小化 / 错误 / 非发起者。必要校验：相关前端测试、终端工具服务端测试、受影响包类型、改动文件 Biome / diff。沿用用户只做必要校验、自行界面验收的要求，不跑全量构建/E2E。
