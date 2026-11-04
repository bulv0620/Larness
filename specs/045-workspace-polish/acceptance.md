# 必要校验记录
- M2-23：欢迎建议测试先红（组件不存在）后通过；Welcome/Conversation 8/8、Web typecheck、改动 Biome/diff 通过。视觉待用户。
- M2-24：关闭组件缺失先红；关闭确认/取消/保存失败与放弃、最小化取消动画/reduced-motion、布局/文件/终端 16/16，Web 类型/Biome/diff 通过。原“所有窗口 close 都隐藏”的测试按新规则改为验证所有窗口 minimize 保留，新增文档 close 的独立测试。无后端资源操作变化，动画视觉待用户。
