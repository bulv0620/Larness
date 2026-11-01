# ADR-022: 产品名与命名空间统一为 Larness

- 状态：accepted
- 日期：2026-11-01
- 决策者：用户（会话确认）
- 关联：`larness.md`、`README.md`、`CONSTITUTION.md`、`docs/contracts/*`、[010-foundation spec](../../specs/010-foundation/spec.md)

## 背景

仓库目录与源设计文件名为 `Larness` / `larness.md`，但正文、UI、包名、Cookie、环境变量、数据目录、Socket、localStorage 和示例数据长期使用 `Harness`。这会让 M0 的认证、数据目录与契约出现双重命名，后续迁移成本高。

当前 M0 尚未开始，没有已发布版本、真实用户数据或稳定 Cookie；这是统一命名的最低成本时点。

## 决策

1. **产品显示名**统一为 **Larness**；不再使用 `Harness` 作为产品名。
2. 根包名为 `larness`；workspace 包名统一为 `@larness/web`、`@larness/ui`、`@larness/shared`，后续为 `@larness/server`、`@larness/agent`、`@larness/resources`。
3. 环境变量统一前缀 `LARNESS_*`，例如 `LARNESS_DATA_DIR`、`LARNESS_HOST`、`LARNESS_PUBLIC_URL`。
4. Cookie 统一为 `larness_session`、`larness_enrollment`；不引入 `harness_*` 兼容别名，也不恢复长期设备 Token。
5. 数据目录统一为 `Larness`（macOS `~/Library/Application Support/Larness`，Linux `$XDG_DATA_HOME/larness`，Windows `%LOCALAPPDATA%\Larness`）。
6. IPC / 运行时文件统一为 `larness.sock`、`larness-<hash>`、`larness.db`、`larness.lock`。
7. 浏览器本地状态统一为 `larness.theme`、`larness.nav.v1`、`larness.windows.v2`、`larness.composer.v1`、`larness.window-layout.v1`。
8. 示例项目统一为 `larness-web` / `prj_larness`；示例域名统一为 `larness.example.com`。
9. `larness.md` 仅做产品名 editorial correction；架构、边界与验收语义不变。
10. 不提供 `harness` → `larness` 的运行时兼容层；这是 pre-M0 的破坏性重命名，旧 Demo 本地状态可丢弃。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 全量统一为 Larness | 无双重命名；M0 前成本最低 | 需要一次性改文档、包名、契约、测试与截图 | 采用 |
| 只改展示名 | 改动小 | 包名 / Cookie / 环境变量继续制造歧义，M0 后迁移成本高 | 不采用 |
| 保留 `harness` 作为内部命名空间 | 不改 lockfile / Cookie | 文档与代码长期不一致，用户和 Agent 都容易混淆 | 不采用 |
| 增加兼容别名 | 旧数据可读 | 新项目尚无用户数据，双轨增加长期维护负担 | 不采用 |

## 影响

- 包名变更需要重新生成 `pnpm-lock.yaml`；所有 `pnpm --filter @larness/*` 命令与 CI 同步。
- Cookie / 环境变量 / 数据目录 / Socket / DB / localStorage 尚未实现或仅有 Demo 状态，因此无迁移脚本；M0 直接按新名称实现。
- `larness.md` 的标题与正文产品名更新；架构条款不变。
- E2E 选择器、fixtures、截图品牌与 Mock README 同步更新。
- 旧 Demo 的 localStorage 键不再读取；刷新后恢复默认主题 / 布局。

## 验证

- `pnpm install` 重新生成 lockfile；
- `pnpm check`、`pnpm build`、`pnpm test:e2e` 全绿；
- 除本 ADR 的历史说明外，仓库文本中不再存在 `Harness` / `@harness` / `harness_*` / `HARNESS_*`；
- UI 截图中品牌为 Larness，示例项目为 larness-web。

## 回滚

若命名决定撤回，在 M0 实现前统一回退本次提交即可；无数据库或已发布契约需要迁移。
