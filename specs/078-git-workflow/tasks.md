# 任务

- [x] GX-1 人工一键拉取与推送（`done`，依赖 M2-5b、ADR-066）
- [x] GX-2 目录行批量暂存和取消暂存（`done`，依赖 GX-1）
- [x] GX-3 差异树缩进对齐（`done`，依赖 GX-2）
- [x] GX-4 提交输入框图标按钮（`done`，用户验收通过，依赖 GX-3）
- [x] GX-5 子目录项目 Git 路径基准（`done`，用户反馈，依赖 GX-2）
- [x] GX-6 未跟踪差异与 Git 失败原因（`done`，用户反馈，依赖 GX-5）

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

## GX-4 验收记录

- Windows 11 认证 Chromium 校验输入框内右下角的方形按钮边界、实际提交及原 Git 链路，复查圆形按钮截图。Git 组件 11 项、Web 类型与改动文件 Biome 通过。快速验收范围为专项检查，整仓检查未跑，尚未提交。
- 视觉复验增加浅色模式独立表面色和描边。认证 Chromium 实测白色输入框底色、复查失焦截图，Git 组件 11 项复跑通过。
- 用户确认 GX-1～GX-4 验收通过并授权合并推送。合并前整仓检查首次有既有 Windows 终端用例超时，以 `VITEST_MAX_WORKERS=1` 复跑通过（966 项通过、32 项跳过）。

## GX-5 修复记录

- 现象：项目根是仓库子目录时（如 `E:\sunny-vision\sunny-vision-web` 属于 `E:\sunny-vision`），Git 面板暂存 / 取消暂存稳定失败并提示「Git 操作失败，请核对状态后重试」，查看差异白屏；仓库根即项目根的项目不受影响。实机核对：三个 `*-web` 项目共 11 次 `add`/`stageFiles` 失败，审计 `GIT_CONFLICT`。
- 根因：`git status --porcelain=v2` 始终输出仓库根相对路径（`sunny-vision-web/vite.config.js`），而 `GitManager` 以项目目录为 cwd 执行 `git add -- <path>`，同一路径被拼两次；`git diff -- <path>` 匹配不到文件返回空串，`discard` 的 `lstat` ENOENT，兄弟目录条目还会触发「Git path escapes root」。
- 修复：新增 `gitPrefix`（`git rev-parse --show-prefix`）与 `scopeStatusToPrefix`，读状态时把记录折回项目相对路径并丢弃项目外条目，快照哈希基于折回后的原始流；写入、diff、discard 全部沿用项目相对路径。`DiffView` 增加空差异说明，不再渲染白屏。
- 验证：`apps/server/test/git/manager.test.ts` 新增子目录用例（状态过滤、批量暂存 / 取消暂存、单文件 add、discard、commit），Git 与锁顺序套件 17 项通过、2 项平台跳过；`packages/resources`、`apps/server`、`apps/web` 类型检查与改动文件 Biome 通过；Web `DiffView` 空差异用例通过。整仓 `pnpm check` 与 E2E 未跑；macOS / Ubuntu 未复验。

## GX-6 修复记录

- 现象：点击未跟踪文件查看差异恒为空；本地 Git 动作失败只显示「Git 操作失败，请核对状态后重试」，分不清是写锁被占还是快照变化。
- 根因一：`git diff` 只比较 index 与 worktree，未跟踪文件没有基准版本，退出码 0 且输出为空。根因二：`POST /api/resource-actions/:id/execute` 只映射 `HttpError` 与 `FileManagerError`，`GitError`（含写锁冲突、执行期快照变化）落到 500 `INTERNAL`，前端只能显示通用兜底文案。
- 修复：`runGit` 支持 `allowedExitCodes`；`GitManager.diff` 先用 `git ls-files --others --exclude-standard` 识别未跟踪路径，再用 `git diff --no-index -- /dev/null <path>` 生成与空基准的差异（忽略文件仍返回空）。新增 `api/failures.ts` 的 `mapResourceFailure`，Git 路由与 resource-actions 共用，execute 失败保留 `GIT_CONFLICT` / `GIT_UNAVAILABLE` / `RESOURCE_LOCKED` 等稳定码并审计；前端 `operationError` 增加 Git 码文案，Git 面板对写锁占用、执行前快照变化、超时给出专门提示。
- 验证：Git 套件新增未跟踪 / 二进制 / 忽略文件差异与 execute 错误码两项用例，整文件 18 项通过、2 项平台跳过；Web `gitPanel` 8 项、`DiffView` 1 项通过；`VITEST_MAX_WORKERS=3 pnpm check` 整仓通过（Server 836 项通过、31 项跳过）。E2E 与 macOS / Ubuntu 未跑。
