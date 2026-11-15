# 任务

- [x] GX-1 人工一键拉取与推送（`done`，依赖 M2-5b、ADR-066）
- [ ] GX-2 目录行批量暂存和取消暂存（`todo`，依赖 GX-1）

## GX-1 验收记录

- Windows 11 原生、Node 24.9.0、Git for Windows 2.54.0。认证 Chromium 使用真实临时仓库、本地 bare remote 和另一个 clone，验证 Diff、暂存、提交、切分支、一键推送与一键拉取。复查 1440 × 900 截图中的 Git 工具栏与上游展示。
- Web Git 组件 10 项通过。服务端 Git、Agent Git、锁顺序和通用恢复专项 20 项通过，2 项跳过。服务端类型检查与改动文件 Biome 通过。
- 整仓检查原先被 Composer 测试的 `getByRole` 类型错误阻塞。修正查询选项并保持名称匹配后，整仓构建通过。整仓测试首次跑出 1 项 Windows 终端超时，以 `VITEST_MAX_WORKERS=3` 复跑 `pnpm check` 通过（Web 233、Agent 59、Server 672 项通过，共 32 项跳过）。macOS、Ubuntu 与真实外部凭据联调待验收。
