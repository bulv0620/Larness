# 发布后纠错任务

范围已确认。每项交付包括失败回归、实现、验收记录及独立提交。

| ID | 用户项 | 分类与交付 | 依赖 | 状态 |
|---|---|---|---|---|
| UI-F1 | 1 | 数据刷新，添加 Key 后刷新列表与模型目录 | 068 ready | done |
| UI-F2 | 2 | 样式，完全自主确认按钮各交互状态可读 | UI-F1 | todo |
| UI-F3 | 3 | 输出链路，修复服务关联终端乱码 | UI-F2 | todo |
| UI-F4 | 5 | 版本信息，Header 显示运行版本 | UI-F3 | todo |
| UI-F5 | 6 | 布局，自动化任务空态双向居中 | UI-F4 | todo |
| UI-F6 | 4 | 组件统一，下拉框及业务表单优化 | UI-F5 | todo |
| UI-F7 | 7 | 错误反馈，操作失败统一浮动 message | UI-F6 | todo |

## 验收记录

### UI-F1（2026-11-11，Windows）

- 回归先行。保存失败的对照用例通过，自动同步及两种同步失败路径先复现失败。实现后四项全部通过。
- 复用现有全目录同步入口，随后使会话模型目录查询失效。上游错误和刷新请求错误均保留已保存 Key，并提示从 Key 详情重试。
- 首轮 `pnpm check` 类型检查、Web 145 项和 Agent 42 项通过，服务端 15 失败、534 通过、31 跳过。失败含缺少 Playwright Chromium、多项超时及部署构建产物缺失。
- 安装 Playwright Chromium Headless Shell 并用 `VITEST_MAX_WORKERS=3` 复跑，类型检查、Web 145 项和 Agent 42 项通过，服务端 4 失败、545 通过、31 跳过。部署授权的 scope/domain/actor/identity 不匹配用例从首轮 `missing artifact` 变为 20 秒超时。其余失败同样位于部署授权或部署计划测试。
- 用户授权后排查并以 M5-F1-R1 修复 Windows 产物重命名 EPERM。恢复 UI-F1 后 `VITEST_MAX_WORKERS=3 pnpm check` 通过，Web 145、Agent 42、Server 552 项通过，32 项沿用既有跳过。
- 新增 Key 的认证浏览器定向用例通过，使用测试目录响应。既有 M1 综合用例在项目右键菜单步骤失败，未到达新增 Key 步骤。未运行构建及整套 E2E。
