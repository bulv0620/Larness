# 实施计划：文档与图片附件解析、能力路由与会话外呈现

> 对应 spec：`spec.md`。本文件只讲“怎么做”，不改变需求。状态：`review`（Q-071～Q-076 于 2026-11-23 冻结；DA-1～DA-9 已完成；DA-10/DA-11/DA-13 于 2026-11-24 完成，Q-079 关闭）。

## 1. 技术方案

整体分为四层，层与层之间只通过类型契约通信：

```text
Composer / REST
  → AttachmentService        认证、会话归属、限额、魔数嗅探、去重、落盘、状态事件
  → IngestQueue              worker 池、超时、重试、pending 恢复
  → ExtractorRegistry        Text / CSV / HTML / PDF / DOCX / PPTX / XLSX / OCR / Vision
  → AttachmentArtifact       markdown + sections + warnings + method + extractor/version
  → ContextBuilder           内联预算、目录注入、历史引用、附件工具
  → ProviderAdapter          ModelImage 透传或纯文本消息
```

关键点：

1. **先落盘再解析**。上传先写临时文件，校验通过后原子 rename 到 `dataDir/attachments/...`，再写 DB 记录；解析 worker 只读该文件。DB 失败时删除文件，文件失败时不写 DB。
2. **解析器接口不是黑盒**。`DocumentExtractor` 只接收 `{bytes | filePath, mime, filename, limits, signal}`，返回 `AttachmentArtifact`；不接触数据库、不读会话、不调模型。MarkItDown/Docling 以后只能作为该接口的一个实现。
3. **路由是纯函数**。`resolveAttachmentRoute` 接收附件类型、模型 `inputModalities`、OCR 配置与 artifact 状态，输出 `image-passthrough | image-ocr | image-vision | document-text | document-ocr-pages | unsupported`，便于穷举测试。
4. **上下文只注入视图**。当前轮附件生成 `<attachment>` 块；小文档内联，大文档只注入元数据、目录与读取提示；历史轮只保留 ID 与一行元数据。
5. **UI 附件区与气泡分离**。`TimelineItemView` 把用户消息拆成 attachment strip 与 text bubble 两个同级节点；`Composer` 使用独立草稿托盘。
6. **解析结果文件化**。markdown 与 sections 存 `dataDir/artifacts/attachments`，DB 只存元数据、锚点摘要与相对路径，避免大文本撑大 SQLite 与备份。
7. **原文件是唯一真源，视图是可重算的投影**（DA-10 起）。`text` 与 `source` 从同一份原文件派生：`text` 供二进制文档与结构化阅读，`source` 供代码/HTML/CSS/配置按行读取；`views` 只由 MIME 推导，不落库。

## 2. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 单一 `doc-extract` 黑盒（MarkItDown/Docling sidecar） | 格式覆盖快、维护集中 | 需要 Python/Java 运行时；失败不可观测；打包与跨平台成本高；无法按格式降级 | 只作为可选适配器，不作为首版唯一实现 |
| 纯 JS 适配器（pdfjs/mammoth/exceljs/JSZip/turndown） | 无原生运行时、可单测、可观测、跨平台 | 每种格式要自己接线；复杂版面还原有限 | 首版采用 |
| 所有附件都交给视觉模型 | 实现最短、版面理解最好 | 纯文本模型不可用；成本高；文档内容外发；不可缓存 | 不采用 |
| 所有附件都本地 OCR | 不依赖模型能力 | 文档表格/标题丢失；OCR 慢且中文质量不稳；图片原图质量更好 | 不采用 |
| 附件字节继续存 SQLite | 事务简单、备份一致 | 20 MiB 文件撑大 DB、备份与 WAL 压力大；无法流式读取 | 新上传落盘，旧行保留兼容 |
| 整篇 markdown 注入 | 模型一次看全 | 长文档直接爆预算；缓存前缀频繁变化；历史无法复用 | 内联预算 + 目录 + 工具读取 |
| 所有文本类文件都只转 markdown | 实现统一 | CSS/反射/缩进/属性全丢，coding 场景无法据此改代码 | 增加 `source` 视图，文本类默认原文注入与检索 |
| JSON Base64 上传 | 复用现有路由与测试；无新解析依赖 | 体积膨胀约 33%，大文件内存峰值高 | v1 采用，20 MiB 上限；后续评估 multipart |

## 3. 目录与文件变更

```text
新增：
packages/shared/src/attachments.ts   附件类型白名单、凭据拒绝、ATTACHMENT_ACCEPT（前后端共用）
apps/server/src/modules/attachments/
  types.ts                  AttachmentKind/Status/Method/Artifact/Section
  mime.ts                   魔数嗅探与类型判定
  service.ts                上传、去重、限额、落盘、删除、读取
  storage.ts                路径推导、原子写、权限、孤儿扫描
  source.ts                 source 视图解码、按行切片、结构大纲
  repository.ts             session_attachments 读写与状态更新
  queue.ts                  IngestQueue、worker 生命周期、pending 恢复
  worker.ts                 worker_threads 入口
  artifacts.ts              markdown/sections 文件读写与孤儿清理
  route.ts                  resolveAttachmentRoute 纯函数
  extractors/
    registry.ts
    text.ts
    csv.ts
    html.ts
    pdf.ts
    docx.ts
    pptx.ts
    xlsx.ts
    ocr.ts
    vision.ts
  tools.ts                  read_attachment/search_attachment/list_attachments
apps/server/test/attachments/
  fixtures/                 pdf/docx/pptx/xlsx/html/csv/png/jpeg/webp
  mime.test.ts
  extractors.test.ts
  route.test.ts
  service.test.ts
  queue.test.ts
  tools.test.ts
  context.test.ts
apps/web/src/features/chat/
  AttachmentTray.tsx        输入区草稿附件
  AttachmentStrip.tsx       时间线气泡下方附件区
  AttachmentCard.tsx        自适应宽度附件标签（文件类型图标 + 文件名，详情进 tooltip）
  chip.ts                   附件与产物共用的 chip token（chipClass / chipInteractiveClass）
  AttachmentPreview.tsx     只读 markdown 预览/原图 lightbox
apps/web/src/features/chat/*.test.tsx
apps/web/e2e/attachments.spec.ts

修改：
apps/server/src/db/schema.ts
apps/server/src/db/migrations/0038_document_attachments.sql
apps/server/src/api/sessions.ts
apps/server/src/modules/sessions/attachments.ts
apps/server/src/modules/sessions/turns.ts
apps/server/src/modules/agent/contextAssembler.ts
apps/server/src/modules/agent/contextCompressor.ts
apps/server/src/modules/agent/profiles.ts
apps/server/src/modules/agent/turnRunner.ts
apps/server/src/app.ts
apps/server/tsdown.config.ts
packages/agent/src/tools/types.ts
packages/shared/src/config.ts
packages/shared/src/events.ts
apps/web/src/features/chat/Composer.tsx
apps/web/src/features/chat/TimelineItemView.tsx
apps/web/src/lib/workspaceApi.ts
apps/web/src/lib/queries.ts
docs/contracts/rest-api.md
docs/contracts/data-model.md
docs/contracts/ws-events.md
specs/051-agent-tool-contract/spec.md
```

删除：

- `apps/web/src/features/chat/DraftScreenshot.tsx`（由 `AttachmentTray` 取代）。
- `apps/server/src/modules/sessions/attachments.ts` 中的截图专用校验与 `readScreenshots`（保留兼容导出直到 DA-8）。

## 4. 实施步骤

### DA-1 数据模型、存储与迁移

1. 先写迁移测试：0038 后旧行回填、新列默认值、索引存在、旧代码可读。
2. 扩展 `session_attachments` schema 与 Drizzle 迁移；保留 `width/height/bytes`，非图片写 0 / 空 blob。
3. 实现 `storage.ts`：路径推导（只用 ID）、原子写、0600、删除、孤儿扫描。
4. 实现 `repository.ts`：创建、更新状态、按会话读取、去重、引用计数。
5. 跑迁移测试与 typecheck。

### DA-2 上传、状态事件与删除

1. 先写失败测试：未认证、缺 CSRF、跨会话、超限、Base64 非规范、重复上传、已引用删除。
2. 扩展 `POST /api/sessions/:id/attachments`：`{filename, mime?, data}`，魔数嗅探，落盘，创建 pending/ready 记录。
3. 新增 `GET .../attachments/:id`、`GET .../artifact`、`DELETE ...`。
4. 新增 `attachment.status` 事件；先写 `agent_events` 再广播；`user.message` 增加 metadata。
5. 启动时扫描 pending 记录：文件存在则重排，否则标记 failed。
6. 权限、body limit、错误映射与审计。

### DA-3 抽取内核与文本类格式

1. 先写 `resolveAttachmentRoute` 与 registry 的失败测试。
2. 定义 `AttachmentArtifact`、`DocumentExtractor`、`ExtractContext`。
3. 实现 `worker.ts` + `queue.ts`：并发 1～2、60s 超时、`resourceLimits`、终止与清理。
4. 实现 Text / CSV / HTML 抽取器；HTML 用 `sanitize-html` + `turndown`。
5. 实现 sections 生成、token 估算与 `maxExtractedChars` 截断。
6. 补 fixture 与单测；确认 worker 打包入口。

### DA-4 PDF、DOCX、PPTX、XLSX

1. 先写每个 fixture 的期望锚点与关键文本断言。
2. 进入 DOCX/PPTX/XLSX 解析器前，先用 JSZip 读取 central directory，检查条目数、单条目解压大小、总解压量与路径穿越；超限直接失败。
3. PDF：`pdfjs-dist` 文本层、页码锚点、空页检测、`isEvalSupported:false`、页数上限。
4. DOCX：`mammoth` → HTML → turndown；图片替换为 `[image: alt]`；保留标题层级。
5. PPTX：`jszip` + `fast-xml-parser` 读取 `ppt/slides/slideN.xml` 与 notes，按页排序。
6. XLSX：`exceljs` 读取工作表，值优先、公式取缓存结果，行列上限与表格截断 warning。
7. 统一 warning 文案与 extractor 版本。

### DA-5 图片能力路由与 OCR/视觉降级

1. 先写路由矩阵测试：模型视觉 × 图片类型 × OCR 配置 × 连接状态。
2. 视觉路径：`ModelImage` 透传；不调用 OCR，不生成 markdown。
3. 本地 OCR：动态加载 `tesseract.js`；检查语言数据是否本地可用；不可用则 `ocrAvailable=false`，不联网下载。
4. 视觉转写：用显式 `visionConnectionId` 的 ProviderAdapter，无工具、单图、60s 超时、固定转写 prompt；标记 `method=vision`。
5. 失败关闭：无视觉/OCR 时上传可保存但 Turn 创建拒绝；视觉连接失效标记 failed。
6. 扫描 PDF：首版检测无文本层 → `ATTACHMENT_PDF_NO_TEXT`；DA-5b 仅在 Q-076 批准后扩展页面渲染。

### DA-6 上下文、预算与附件工具

1. 先写上下文断言：纯文本 + DOCX 无 image block；视觉 + 图片有 image block；长文档只有目录；历史只留元数据。
2. `contextAssembler` 读取当前轮附件，按 `resolveAttachmentRoute` 生成文本块或 image block。
3. 实现内联预算：单文件 8k token、整轮 15% 上下文；超限生成 sections 目录与读取提示。
4. 历史消息只追加 `[attachments: att_… "file.pdf" document 42 pages]`，不注入正文；`contextCompressor` 与 Turn 检查点保留同样的 ID/元数据引用。
5. 新增三个工具与 `ToolContext` 方法；`profileHasPack` 增加 `attachments` pack；只在有 ready 附件时注入。
6. 系统提示增加不可信附件条款；`PROMPT_VERSION` bump；按 051 更新描述、schema 与正反例。
7. 审计与事件不记录正文。

### DA-7 UI：气泡外附件、草稿托盘与预览

1. 先写组件测试：附件区在气泡下方、文本为空不渲染气泡、状态与失败提示。
2. `Composer`：加号/回形针选择文件；拖拽；已存在会话上传即解析；草稿会话在首条消息创建会话后上传；草稿托盘显示标签/状态/移除/重试。
3. 解析中或 failed 阻止发送；草稿会话解析 ready 前不创建 Turn；图片在无视觉/OCR 时显示“不可用”原因。
4. `TimelineItemView`：用户消息渲染为 text bubble + attachment strip（标签在气泡下方）；`attachmentIds` 只在没有附件引用的旧事件上按截图渲染。
5. `AttachmentPreview`：文档只读 markdown、原图 lightbox、下载原文件；使用认证 URL。
6. 成功/失败操作提示走 `@larness/ui` Toast；逐文件状态留在托盘内。
7. 窄屏与 1440×900 截图基线。
8. DA-9 收口：图片与文档统一为“图标 + 文件名”标签（宽度随文件名自适应，图标复用文件目录的 Material 图标），页数/方法/警告进 tooltip；修复 `attachmentIds` 被同时当作旧截图渲染造成的重复与破图。

### DA-8 安全、E2E 与验收

1. 安全测试：路径穿越、zip bomb、符号链接、宏/脚本、外部实体、SVG、伪造扩展名、跨会话读取。
2. 日志/事件/审计脱敏测试：无正文、无字节、无完整文件名与绝对路径。
3. Mock E2E：DOCX、图片视觉、图片 OCR、大文档读取、失败重试、气泡外布局。
4. 手动验证：真实 PDF/DOCX/PPTX/XLSX/HTML、中文扫描 PDF、20 MiB 边界、8 附件一轮、真实视觉连接。
5. 更新契约、051、STATUS、ROADMAP 与 README；记录未验证项。

### DA-10 多视图：source 视图、文本矩阵与跨附件检索（2026-11-24）

1. `@larness/shared/src/attachments.ts` 成为唯一白名单（扩展名 + 无扩展名 basename）；Composer 的 `accept` 与客户端校验、服务端嗅探共用；凭据文件在两端拒绝。
2. `source.ts`：BOM/CRLF 归一、按行切片、超长单行退化为字符窗口、结构大纲（imports / 顶层符号 / CSS selector / Markdown 标题）。
3. `AttachmentService.readSource(Sync)` 与 `GET /api/sessions/:id/attachments/:attachmentId/source`。
4. `read_attachment` 增加 `view`、`line`、`nextAnchor`；二进制文档返回 `ATTACHMENT_VIEW_UNSUPPORTED`，不静默降级。
5. `search_attachment` 支持 `attachmentIds` 省略时跨本会话检索，新增 `scope`；`list_attachments` 返回 `views`。
6. `contextAssembler` 对文本类附件注入原文（含 `view="source"` 与行数）；超预算只注入大纲。

### DA-11 HTML 结构化（2026-11-24）

1. `<style>` 保留为 fenced CSS，上限 4,000 字符并记 warning。
2. 输出 id/class 结构大纲（最多 60 条，跳过 script/style 正文）。
3. 表格转 pipe table（turndown 自定义规则）；脚本仍移除，warning 指向 `source` 视图。
4. HTML extractor 版本 1 → 2。

### DA-13 预览视图切换（2026-11-24）

1. 文本类文档在预览面板提供“解析视图 / 原文”切换；二进制文档与图片不显示切换。
2. 原文复用现有 Monaco 只读编辑器（懒加载，`SOURCE_PREVIEW_CHARS=60000`），底部显示行范围与截断提示。
3. 切换以附件 ID 标记状态，切换附件自动回到解析视图。

## 5. 数据与迁移

- 迁移文件 `0038_document_attachments.sql`，只加列与索引，不重建表、不删数据。
- 旧行回填见 spec §8；`storage_path` 为 null 时仍从 `bytes` 读取。
- 新上传：`bytes=x''`、`width=0`、`height=0`（非图片），文件在 `dataDir`。
- 删除会话：DB 级联；文件清理由 `AttachmentStorage` 在事务提交后执行；失败进入孤儿扫描。
- 回滚：旧程序忽略新列；先停用解析队列与清理任务，再回退二进制；已落盘文件保留，旧程序不可见。

## 6. 回滚策略

- 功能开关：`attachments.enabled=false` 时上传接口返回 `ATTACHMENT_UNSUPPORTED`，旧截图路径保留到 DA-8。
- 解析器异常：单附件 failed，不影响 Turn 的其他附件；可关闭对应 extractor。
- 云端视觉：删除 `visionConnectionId` 后立即停止外发；已生成的转写文本保留。
- 数据：不删除旧截图行；新列可忽略；迁移不可逆但无数据丢失。

## 7. 验证命令

```bash
pnpm --filter @larness/server test -- attachments
pnpm --filter @larness/web test:file src/features/chat/AttachmentTray.test.tsx
pnpm --filter @larness/web test:file src/features/chat/TimelineItemView.test.tsx
pnpm --filter @larness/server typecheck
pnpm --filter @larness/web typecheck
pnpm exec biome check apps/server/src/modules/attachments apps/web/src/features/chat
pnpm build
pnpm check
pnpm test:e2e
```

真实文件与视觉连接验证不进 CI，记录到 `acceptance.md`。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 解析器处理恶意文件崩溃或耗尽内存 | Server 不稳定 | worker + 超时 + `resourceLimits` + 解压上限；崩溃只标记该附件 failed |
| PDF/DOCX 版面还原差 | 模型误读表格/标题 | 保留页/标题锚点与 warning；表格截断显式提示 |
| 中文 OCR 质量不稳 | 转写错字 | 仅在无视觉模型时使用；标记 method=ocr；允许用户移除 |
| 长文档仍超预算 | 请求被拒或压缩 | 目录 + 工具读取；15% 总预算；单文件 8k 上限 |
| 提示注入 | 模型执行文档内指令 | user 边界 + system 声明 + 权限不变；安全测试 |
| 云端视觉静默外发 | 隐私事故 | 默认本地；显式连接；发送前提示；审计只记 provider |
| 依赖体积/许可证 | 安装与分发 | 只用纯 JS/WASM；记录许可证；不引入 AGPL/原生 canvas |
| 文件名/路径泄露 | 隐私与注入 | 路径只用 ID；日志只记扩展名与大小 |
| SQLite 体积 | 备份变慢 | 新文件落盘；旧截图行保留但不再新增 |
| worker 打包遗漏 | 生产解析失败 | 增加 tsdown entry；`pnpm build` 后跑 built 冒烟 |

## 9. 未决事项

- Q-071～Q-076 已于 2026-11-23 关闭，结论见 spec §13。
- Q-077（解析 worker 隔离）与 Q-078（云端视觉转写接线）仍未闭合，见 `docs/open-questions.md`。
- Q-079（多视图）已于 2026-11-24 关闭；结论见 spec §7.7 与 §13。
- Q-080（附件导入项目目录、写盘与审批）未排期。

确认后更新 [ADR-074](../../docs/adr/ADR-074-document-attachments.md) 为 accepted，并把 spec 改为 `ready`。
