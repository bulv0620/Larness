# M4-R3 系统服务生命周期契约

> 2026-11-07 用户确认 M4 与后续修改全部验收通过，见 [G4 收尾](closure.md)。下文保留当时的验证记录。

2026-11-07，task/m4-r3-service-lifecycle-contract，必要校验、G4 保持 review。

## 实施

每次实际模型请求固定注入 development_preview/persistent_pm2 的用途、真实 owner、资源 ID、工具路径、展示与退出行为，无需用户重复填写特殊提示词。登记只建立开发预览身份，不启动/守护/转为 PM2；PM2 服务不登记成临时预览。开发资源按项目/终端归属，聊天仅来源追溯，窗口关闭不停止进程。

系统额外查询当前项目已登记的 temporary 资源，提供 svc_、终端执行/端点 generation、观察状态/时间，最多 50 项；无项目不注入他项目临时资源。PM2 继续由原动态摘要提供实际实例与项目关系。工具说明/schema 和登记结果明确 temporary，修正终端描述中容易与 PM2 混淆的“persistent project terminal”。不新增工具/外部 API/参数枚举/依赖/迁移或权限。

已有后端监听归属、项目与 svc_ 预览身份、PM2 身份校验保持；通用命令继续主机账户执行。语义规则不会变成 Shell 黑名单，也不保证模型绝不会发错命令。生命周期真正不明确时澄清，不从脚本名/端口/展示名猜测，不把预览擅自变为持久部署。资源边界沿用现有已批准 ADR，无新冻结决策变更。

## 验证

- 先写实际 assembleContext 回归，捕获缺失统一生命周期契约的失败，再实现。
- Server contextAssembler、service-ops-agent、serviceTarget、resources/services 四文件 12 项通过。四审批策略/项目与默认工作区都收到固定规则；实际提供给模型的工具描述/schema 标明 temporary；真实终端登记生成的服务/执行身份进入本项目上下文、不出现在无项目上下文；合法监听可登记、外部监听拒绝，服务退出/重新登记、状态/事件和临时资源行为保持。新增 PM2 tgt_ 不生成预览目标反例。最后上下文/目标两文件 4 项再跑通过。
- LARNESS_POC_PM2=1 下 pm2-cli：1 项通过，实际普通会话 PM2 系统上下文与部署/项目关联、人工启停/幂等、日志和退出后持久运行保持。
- Server/shared typecheck、8 个改动 TS 文件 Biome、git diff --check 通过。

未运行全量 pnpm check/build、浏览器 E2E、真实模型行为评估或跨平台。真实模型遵循率留人类验收，不将文本/schema 通过等同于模型必然正确选路。保留先前改动与本轮未提交工作区，无用户运行资源变更。
