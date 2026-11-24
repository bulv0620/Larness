# 088 验收记录

> 日期：2026-11-23（初验）、2026-11-24（DA-10/DA-11/DA-13 增补）
> 范围：macOS / Windows 开发机本地运行；未做真实第三方视觉连接与外发验收。
> 结论：自动化验收通过；仍有一项实现偏差（解析未放入 worker）与多项未验证项，见 §4。

## 1. 交付范围

| 任务 | 状态 | 交付 |
|---|---|---|
| DA-1 数据模型、存储与迁移 0038 | done | `session_attachments` 新列、`idx_session_attachments_session_created`、旧截图行兼容、`AttachmentStorage`、`AttachmentRepository`、`pending` 启动恢复 |
| DA-2 上传、状态事件与删除 | done | `POST/GET/DELETE .../attachments`、`GET .../artifact`、魔数嗅探、去重、限额、`attachment.status`、删除引用保护 |
| DA-3 抽取内核与文本类格式 | done（偏差） | `DocumentExtractor`、registry、文本/Markdown/CSV/HTML 抽取、HTML 清洗、截断与警告；见 Q-077 |
| DA-4 PDF、DOCX、PPTX、XLSX | done | `pdfjs-dist` 文本层与页码锚点、`mammoth` DOCX、PPTX/XLSX 的 zip/XML 抽取、加密/损坏/页数上限 |
| DA-5 图片能力路由与 OCR/视觉降级 | done（部分） | `resolveAttachmentRoute`、原图透传、本地 OCR、`POST .../transcribe`；视觉连接未接线，见 Q-078 |
| DA-6 上下文预算与附件工具 | done | `<attachment>` 块、目录注入、8k/15% 预算、`read_attachment` / `search_attachment` / `list_attachments`、执行层绑定 |
| DA-7 气泡外附件、草稿托盘与预览 | done | 回形针与拖拽、草稿托盘、附件条与气泡同级、文档卡片、图片 lightbox、Markdown 预览、草稿会话先建会话后建 Turn |
| DA-8 安全、E2E 与验收 | done（自动化） | 路径/文件名/zip/HTML/跨会话/删除冲突测试；真实文件与视觉连接手工项未跑 |
| DA-9 附件标签化与重复渲染修复 | done | 统一标签（图标 + 文件名，宽度自适应、图标复用文件目录 Material 图标）；时间线标签移到气泡下方；修复附件被当作旧截图重复渲染成破图；删除 `DraftScreenshot` 死代码 |
| DA-10 多视图与文本矩阵 | done | `@larness/shared/attachments.ts` 唯一白名单 + 凭据拒绝；`source` 视图（按行分页、`line:N`/`offset:N`、超长单行字符窗口）；跨附件检索；文本类附件默认注入原文/大纲；`GET .../source` |
| DA-11 HTML 结构化 | done | `<style>` → fenced CSS、id/class 结构大纲、表格 → pipe table、脚本移除并提示 source 视图；extractor v2 |
| DA-13 预览视图切换 | done | 文本类文档在预览内切换“解析视图 / 原文”，原文懒加载 Monaco 只读并显示行范围 |

## 2. 自动化证据

| 检查 | 结果 |
|---|---|
| `pnpm --filter @larness/server test test/attachments` | 10 文件 / 62 项通过（新增 source 视图、HTML 保真、跨附件检索、凭据拒绝） |
| `pnpm --filter @larness/server test test/agent/toolContract.test.ts` | 3 项通过；矩阵含 `read_attachment` / `search_attachment` / `list_attachments` 正反例 |
| `pnpm --filter @larness/server typecheck` | 通过 |
| `pnpm --filter @larness/web typecheck` | 通过 |
| `pnpm --filter @larness/web test` | 54 文件 / 306 项通过（新增 `AttachmentPreview.test.tsx` 3 项） |
| `pnpm --filter @larness/server test`（全量） | 172 文件通过 / 8 跳过；899 项通过、31 项跳过（2026-11-24） |
| `VITEST_MAX_WORKERS=3 pnpm check` | 通过（2026-11-23：Server 170 文件 / 882 项、Web 291 项；2026-11-24 复跑：Server 172 文件 / 899 项通过、31 跳过，Web 306 项通过，biome 与全包 typecheck 通过） |
| `pnpm --filter @larness/server build` | 通过 |
| `pnpm build` | 通过（2026-11-23 复跑；仅既有 chunk 体积警告） |

关键覆盖：

- 迁移后旧截图行仍按 `storagePath=null` 从 `bytes` 读取，新文档行不写 blob。
- 同会话同 SHA-256 去重；失败行重复上传会重新解析并替换，不再永久返回缓存失败。
- 纯文本模型 + DOCX 不要求 `acceptsImages`；上下文正文位于 user 角色 `<attachment>` 内。
- 长文档只注入目录；`read_attachment` 按 `page:N` / `offset:N` 分页并返回 `nextOffset`。
- 视觉模型 + PNG/WebP 原图透传；纯文本模型 + 图片在 UI 发送前调用本地 OCR，失败关闭并阻止 Turn。
- 附件标签位于文本气泡下方，文本为空不渲染气泡；标签形状与「本次成果」的产物标签共用 `chip.ts` 的 chip token（`h-7` / `rounded-full` / `border-line/80` / `bg-surface-2/55` / `text-[11px]`），宽度随文件名自适应（上限 180px），附件侧只额外带移除按钮与失败态。
- 标签两端图标内边距对称：左侧 `pl-2`（8px），右侧 `pr-1.5` + 尾部控件 `p-0.5` 合成 8px，尾部控件不带负外边距。
- 一条消息只渲染一次附件：有引用时不再生成旧 `screenshots`，文档不会被塞进 `<img alt="用户截图">`；pre-088 事件仍按截图渲染，加载失败降级为“截图不可用”。
- 上传/删除/读取要求认证与会话归属；跨会话返回 404；已引用附件删除返回 409。
- `attachment.status` 先持久化再广播；事件只含 ID 与元数据。

## 3. 验收场景

| 场景 | 结果 | 证据 / 说明 |
|---|---|---|
| A1 纯文本模型读取 DOCX | 通过（自动化） | `context.test.ts` 文本类路径；DOCX extractor 单测；未用真实 12 页 DOCX 手工复核 |
| A2 视觉模型原图透传 | 通过（自动化） | `api/attachments.test.ts`、`context.test.ts` PNG/WebP |
| A3 纯文本模型的图片降级 | 通过（本地 OCR） | `service.test.ts` 注入 OCR transcriber；UI 在发送前调用 `/transcribe`；真实 tesseract 语言包与识别质量未验证 |
| A4 无图片能力且无降级 | 通过 | `route.test.ts`、`api/attachments.test.ts` 返回 `ATTACHMENT_VISION_UNAVAILABLE`；UI 失败卡片阻止发送 |
| A5 扫描 PDF 与损坏文件 | 部分 | 扫描 PDF 返回 `ATTACHMENT_PDF_NO_TEXT`；加密/损坏/伪造扩展名有单测；真实扫描件与加密样本未手工复核 |
| A6 长文档按需读取 | 通过（自动化） | `context.test.ts` 目录注入；`read_attachment` 分页/搜索/上限测试；300 页真实 PDF 未跑 |
| A7 附件位于气泡之外 | 通过 | `AttachmentStrip.test.tsx` 断言气泡在前、标签在后、标签宽度固定、图片不内联、旧 `screenshots` 不重复渲染；`eventReducer.test.ts` 覆盖有引用/pre-088 两种事件；视觉截图未留档 |
| A8 提示注入边界 | 通过（结构） | 附件只在 user 角色；system 声明不可信；工具权限不随正文变化；未做专门红队样本 |
| A9 归属、去重与删除 | 通过 | `repository.test.ts`、`api/attachments.test.ts`、`api.test.ts` |
| A10 解析失败可恢复 | 通过 | 失败状态、稳定错误码、UI 重试；重试会重新解析 |
| A11 草稿会话的附件 | 通过（结构） | 先 `createSession` → 上传/转写 → `createTurn`；附件失败时归档临时会话、保留草稿与托盘，不创建 Turn；未有浏览器 E2E |
| A12 HTML/CSS 保真与跨附件检索 | 通过（自动化） | `context.test.ts` 断言注入 `view="source"` 且含 `<style>` 与 `class` 原文；`tools.test.ts` 覆盖 `view=source` 按行读取、二进制返回 `ATTACHMENT_VIEW_UNSUPPORTED`、跨附件检索返回 `attachmentId` + `line:N`；`source.test.ts` 覆盖 CSS 保留、结构大纲、表格转 pipe table |
| A13 文本矩阵与凭据拒绝 | 通过（自动化） | `mime.test.ts` 覆盖 `.ts/.json/.css/Dockerfile/.svg` 接受、未知文本扩展名拒绝、`.env`/`.env.local`/`*.pem` 拒绝、`.env.example` 接受；`Composer` 与 `ATTACHMENT_ACCEPT` 共用白名单；`tools.test.ts` 覆盖上传侧 `ATTACHMENT_SECRET_FILE` |

## 4. 偏差与未验证项

1. **解析未隔离到 worker（Q-077）**：`extractAttachment` 在主进程执行，只有 `extractionTimeoutMs` 硬超时与解压前限额，没有内存上限或可终止 worker。大 PDF 可能阻塞事件循环。spec 的 R-14 / DA-3 验收中“worker 隔离”未满足，因此不宣称沙箱或恶意文件安全。
2. **视觉连接未接线（Q-078）**：`ocr.mode=vision` 与 `visionConnectionId` 已进入配置与路由，但 bootstrap 没有构造云端 transcriber；该模式当前失败关闭。默认 `auto-local` 只使用本机 OCR，不产生静默外发。
3. **页面渲染/扫描件 OCR 未做**：按 Q-076 冻结，扫描 PDF 返回 `ATTACHMENT_PDF_NO_TEXT`。
4. **真实文件与真实视觉连接未逐项验证**：2026-11-24 用户已实机走通常见上传与解析路径（结论无问题），但未逐项跑 12 页 DOCX、300 页 PDF、PPTX/XLSX 样本、加密 PDF、中文扫描件，也未用合法 Key 验证云端视觉外发提示与脱敏。
5. **Mock E2E 未新增**：Mock 模式不支持文件上传，本轮以 server 集成 + web 组件测试覆盖；`pnpm test:e2e` 未包含附件场景。
6. **UI 不订阅 `attachment.status` 推进托盘**：当前上传在请求内完成，返回即 ready/failed，托盘无需流式更新；若未来改为异步 `pending`，需要补 WS 订阅/轮询，否则托盘会停在 pending。
7. **平台**：仅在当前 Windows 开发机执行自动化；macOS / Linux 未复跑，不据此声称跨平台已验证。

8. **DA-9 根因记录**：`user.message` 的 `attachmentIds` 在 088 之后也可能是 PDF/DOCX，但 reducer 仍用它构造旧 `screenshots`。于是同一附件既渲染为附件区卡片，又被当成截图塞进 `<img>`；浏览器无法把文档当图片显示，出现 `alt="用户截图"` 的破图。已在 reducer 与渲染两层修正，并保留 pre-088 兼容。

9. **DA-9 提示遮挡修复**：附件超限报错（`每轮最多添加 8 个附件。`）被顶栏遮住，根因是 `Toast` 就地渲染在输入区的 `z-10` 堆叠上下文内。已改为 portal 到 body 级提示层（`top-14` + `z-[360]`），弹窗内提示由 `DialogContent` 的 `ToastHost` 承载；`Toast.test.tsx` 的 `stacking` 用例锁定该契约。

10. **DA-9 提示层复用自愈**：上一条修复后提示仍被顶栏压住，用 Playwright 在 Chromium 里量真实布局确认新代码本身正确（body 子节点、`fixed`、`top: 56px`、`z-index: 360`、命中测试在最上层），根因是 `toastLayer()` 复用了页面上残留的旧层节点、而类名只在创建时写一次。现在每次挂载都重写 `TOAST_LAYER_CLASS`；`Toast.test.tsx` 新增「repairs the classes of a reused layer from an older build」锁定。浏览器证据来自临时探针页（已删除），未入库。

11. **文本白名单改为服务端强制（行为变化）**：此前服务端对任何能按 UTF-8 解码的内容都接受为 `text/plain`，只有前端按扩展名拦截。DA-10 起两端共用 `@larness/shared` 白名单，服务端会拒绝未列出的文本扩展名（`ATTACHMENT_UNSUPPORTED`）。副作用：`notes.weirdtext` 这类文件需要改名为 `.txt`；`Dockerfile`、`.gitignore`、`.env.example` 等无扩展名/点文件按 basename 放行。

12. **HTML 解析视图仍是派生视图**：DA-11 只保证不丢弃 `<style>`、id/class 与表格结构，不做 DOM 层级还原、不执行 JavaScript、不解析外部样式表；需要精确结构时必须用 `source` 视图。真实页面（含嵌套布局、媒体查询、CSS 变量）的“理解质量”未用真实模型验证。

13. **Monaco 原文预览已人类验收**：`AttachmentPreview` 的原文视图懒加载 `FileEditor`（Monaco 只读）。组件测试用 mock 替身断言切换与数据流；2026-11-24 用户在真实浏览器验证加载、切换、滚动与主题观感，确认无问题。`vite build` 在本机仍受内存限制未复跑（不影响该视图的实机结论）。

## 5. 人类验收（2026-11-24）

- 用户实机验证原文预览与端到端附件链路（上传、解析、读取、标签展示、提示），结论为“目前感觉没问题”；spec 与 tasks 由 `review` 转 `done`。
- 验收范围即用户实际走到的路径；本节 §4 列出的其他项（300 页 PDF、加密 PDF、中文扫描件、云端视觉外发、worker 隔离、Mock E2E、跨平台）仍为未验证，不因本次验收视为通过。

## 6. 复跑命令

```bash
pnpm --filter @larness/server test test/attachments
pnpm --filter @larness/server test test/attachments/source.test.ts
pnpm --filter @larness/web test:file src/features/chat/AttachmentPreview.test.tsx
pnpm --filter @larness/server test test/agent/toolContract.test.ts
pnpm --filter @larness/server typecheck
pnpm --filter @larness/web typecheck
pnpm --filter @larness/web test
VITEST_MAX_WORKERS=3 pnpm check   # Windows PowerShell: $env:VITEST_MAX_WORKERS="3"; pnpm check
pnpm --filter @larness/server build
pnpm build
```
