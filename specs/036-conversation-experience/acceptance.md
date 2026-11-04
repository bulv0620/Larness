# 验收
## M2-14（2026-11-04）
- 先红测试：planTool尚未存在，Runner集成导入失败；实现后3项通过，含SQLite先持久化后发布、稳定ID更新/重放、非法计划、凭据拒绝、取消后无计划事件。
- 前端重放测试覆盖有效更新与畸形事件忽略。
- pnpm check：server403 / agent32（既有live1项无凭据跳过）/ web50；pnpm build通过。首次类型检查指出测试createTurn多余dataDir参数，修正后通过。
- 无新依赖/迁移/权限变更；真实Provider接线已注册，行为集成使用FakeProvider与真实SQLite，未消耗在线模型凭据。
