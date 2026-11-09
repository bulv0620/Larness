# ADR-056：依赖主版本与工具链分批升级

- 状态：accepted
- 日期：2026-11-09
- 审批：人类负责人于 2026-11-09 明确批准
- 关联：[冻结技术栈](../architecture/stack.md)、[发布范围](../known-limitations.md)、[Agent 工具执行契约](../../specs/051-agent-tool-contract/spec.md)

## 背景

DEPS-1 在现有 semver 范围内升级依赖。以下候选跨主版本或跨 0.x 的次版本，可能改变运行、构建或发布行为。候选版本取自 npm registry，实际引入前复核版本及 peer 依赖。

## 决策

每批单列任务和提交。保留 Node 22 / 24+ 支持、现有数据与接口；按下表验证后才采用。各批锁文件和包声明须独立可回退。

| 批次 | 候选 | 验收重点 |
|---|---|---|
| DEPS-2 | `ai@7.0.166`、`@ai-sdk/deepseek@3.0.81`、`@ai-sdk/openai-compatible@3.0.87` | 一起验证 Provider 协议、流式工具续跑、结构化参数、上下文用量、取消与错误；实际模型上下文和执行契约 |
| DEPS-3 | `better-sqlite3@13.0.3` | macOS arm64 的 Node 22 / 24 安装及原生 ABI；旧库读写、迁移、备份、锁、回滚和发布包安装 |
| DEPS-4 | `vite@8.3.6`、`@vitejs/plugin-react@6.3.0` | dev 受管入口、CSP、React HMR、Monaco worker、代理、静态构建与浏览器回归 |
| DEPS-5 | `react-router@8.5.1` | 配对路由、鉴权重定向、SPA 回退；该版本声明 Node ≥22.22.0，安装指引需反映最低补丁要求 |
| DEPS-6 | `typescript@7.0.2`、`vitest@5.1.0`、`tsdown@0.23.7` | 分开验证编译器、测试工具和打包器兼容性；四个 Server 入口、原生依赖和发布文件布局 |
| DEPS-7 | 评估 pnpm 10 的最新补丁/次版本与 `pnpm@12.18.0` | 包管理器声明、冻结锁安装、构建脚本允许列表、原生模块补丁及可重复安装 |

`@types/node` 继续跟随最低支持主版本 22，避免编译时使用仅在较新运行时存在的 API。固定的 `node-pty`、`cron-parser` 和两个终端宽度工具的当前版本均与 npm latest 一致。

## 替代方案与回退

可以保留 DEPS-1 的版本范围，独立评估各批兼容性后再升级。一次替换所有候选会混合 Provider、原生模块和构建链的回归。每批先在 Node 22 / 24 运行冻结锁安装、check、build、平台及安装冒烟，按影响跑相应真实浏览器或 Provider 检查。新原生依赖、运行时支持范围变更或数据迁移需另行评审。失败时回退该批提交和锁文件，重新按冻结锁安装。Windows 和 Ubuntu 的验证范围以实机证据为准。
