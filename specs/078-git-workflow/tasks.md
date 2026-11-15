# 任务

- [x] GX-1 人工一键拉取与推送（`done`，依赖 M2-5b、ADR-066）
- [x] GX-2 目录行批量暂存和取消暂存（`done`，依赖 GX-1）
- [x] GX-3 差异树缩进对齐（`done`，依赖 GX-2）

## GX-1 验收记录

- Windows 11 原生、Node 24.9.0、Git for Windows 2.54.0。认证 Chromium 使用真实临时仓库、本地 bare remote 和另一个 clone，验证 Diff、暂存、提交、切分支、一键推送与一键拉取。复查 1440 × 900 截图中的 Git 工具栏与上游展示。
- Web Git 组件 10 项通过。服务端 Git、Agent Git、锁顺序和通用恢复专项 20 项通过，2 项跳过。服务端类型检查与改动文件 Biome 通过。
- 整仓检查原先被 Composer 测试的 `getByRole` 类型错误阻塞。修正查询选项并保持名称匹配后，整仓构建通过。整仓测试首次跑出 1 项 Windows 终端超时，以 `VITEST_MAX_WORKERS=3` 复跑 `pnpm check` 通过（Web 233、Agent 59、Server 672 项通过，共 32 项跳过）。macOS、Ubuntu 与真实外部凭据联调待验收。

## GX-2 验收记录

- Windows 11 原生、Node 24.9.0、Git for Windows 2.54.0。Git 树组件覆盖精确子路径、跳过冲突和折叠状态，真实仓库覆盖中文空格、删除、部分暂存及准备前／准备后快照失效。认证 Chromium 通过折叠目录后键盘暂存、鼠标取消暂存、单文件提交后的一键推拉，并核对工作区内容和 1440 × 900 界面截图。
- `VITEST_MAX_WORKERS=3 pnpm check` 通过（Web 234、Agent 59、Server 673 项通过，共 32 项跳过）。整仓构建通过，Vite 报出大包体积警告。macOS、Ubuntu 未做本次实机验证。

## GX-3 验收记录

- Windows 11 认证 Chromium 复现同层名称错位 17px；修复后验证同层对齐和子级 12px 缩进，复查 1440 × 900 真实仓库截图。原 Git 浏览器链路通过。
- `pnpm build` 通过。首轮 `pnpm check` 有 1 项 Windows 终端测试超时，以 `VITEST_MAX_WORKERS=2` 复跑通过（966 项通过、32 项跳过）。
