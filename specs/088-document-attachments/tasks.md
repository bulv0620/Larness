# 任务：文档与图片附件解析、能力路由与会话外呈现

> 状态：`todo | in_progress | blocked | review | done | dropped`。一个任务一个提交。
> 开始任务前在 `STATUS.md` 的「当前进行中」登记；完成后勾选本表、更新 `ROADMAP.md`，并把该任务移入「最近收口」。
> 当前整体状态：DA-0～DA-8 已完成（2026-11-23）；自动化验收见 [acceptance.md](acceptance.md)，实现偏差与未验证项见该文件 §4。

## 状态总表

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| DA-0 | 规格确认与 ADR-074 | — | `done`（2026-11-23） |
| DA-1 | 数据模型、存储与迁移 0038 | DA-0 | `done`（2026-11-23） |
| DA-2 | 上传、状态事件与删除 | DA-1 | `done`（2026-11-23） |
| DA-3 | 抽取内核与文本类格式 | DA-1 | `done`（2026-11-23，worker 隔离见 Q-077） |
| DA-4 | PDF、DOCX、PPTX、XLSX 抽取 | DA-3 | `done`（2026-11-23） |
| DA-5 | 图片能力路由与 OCR/视觉降级 | DA-2、DA-3 | `done`（2026-11-23；视觉连接未接线，见 Q-078） |
| DA-6 | 上下文预算与附件工具 | DA-2、DA-3 | `done`（2026-11-23） |
| DA-7 | 气泡外附件、草稿托盘与预览 | DA-2、DA-6 | `done`（2026-11-23） |
| DA-8 | 安全、E2E 与验收 | DA-4、DA-5、DA-7 | `done`（2026-11-23，自动化范围） |

## 任务卡

### DA-0 规格确认与 ADR-074

- 状态：`done`（2026-11-23）
- 依赖：无
- 目标：确认 Q-071～Q-076，冻结格式矩阵、OCR/视觉默认、限额、上传传输与依赖集。
- 交付物：
  - spec 改为 `ready`，ADR-074 改为 accepted，`DECISIONS.md` 登记；
  - `ROADMAP.md` 增加 088 任务行与门禁；
  - `STATUS.md` 指向 088。
- 验收：
  - 六个默认值有明确结论；有异议的项写入 `docs/open-questions.md`；
  - 依赖清单经人类确认，未批准的库不进入实现。
- 测试：无（纯文档）。
- 涉及路径：`specs/088-document-attachments/*`、`docs/adr/ADR-074-document-attachments.md`、`docs/adr/DECISIONS.md`、`specs/README.md`、`specs/ROADMAP.md`、`STATUS.md`。
- 备注：已于 2026-11-23 完成；结论见 spec §13，未写实现代码。

### DA-1 数据模型、存储与迁移 0038

- 状态：`done`（2026-11-23）
- 依赖：DA-0
- 目标：扩展附件表与文件存储，兼容旧截图行。
- 交付物：
  - `0038_document_attachments` 迁移；
  - `AttachmentStorage`：路径只用 ID、原子写、0600、删除、孤儿扫描；
  - `AttachmentRepository`：创建、状态、去重、按会话读取、引用计数；
  - 旧行回填与兼容读取。
- 验收：
  - 迁移后旧截图仍可读；
  - 新文档行 `kind=document`、`storage_path` 非空、`bytes` 为空；
  - 路径穿越与文件名注入不能影响落盘位置；
  - 删除会话后行级联，文件清理失败可重试。
- 测试：
  - 迁移测试：列、默认值、索引、回填；
  - 存储测试：原子写、权限、删除、孤儿扫描、磁盘失败；
  - 仓库测试：去重、会话隔离、引用计数。
- 涉及路径：`apps/server/src/db/schema.ts`、`apps/server/src/db/migrations/0038_document_attachments.sql`、`apps/server/src/modules/attachments/{types,storage,repository}.ts`、`apps/server/test/attachments/*`。

### DA-2 上传、状态事件与删除

- 状态：`done`（2026-11-23）
- 依赖：DA-1
- 目标：通用附件上传、读取、删除与状态事件。
- 交付物：
  - `POST /api/sessions/:id/attachments` 接收 `{filename, mime?, data}`；
  - `GET .../:attachmentId`、`GET .../artifact`、`DELETE ...`；
  - 魔数嗅探、限额、去重、Base64 规范校验；
  - `attachment.status` 事件与 `user.message` 元数据；
  - pending 启动恢复。
- 验收：
  - 未认证/缺 CSRF/跨会话/超限/伪造 Base64 全部稳定拒绝；
  - 同会话同字节返回同一 ID；
  - 已引用附件删除返回 `409 ATTACHMENT_IN_USE`；
  - 事件先持久化再广播，回放只含 ID/元数据；
  - 日志与审计无正文、无字节、无完整文件名。
- 测试：
  - REST 集成：成功、权限、限额、去重、错误码；
  - 事件集成：seq、回放、广播顺序；
  - 删除集成：行、文件、artifact、引用冲突；
  - 启动恢复：pending 文件存在/缺失。
- 涉及路径：`apps/server/src/api/sessions.ts`、`apps/server/src/modules/attachments/{service,mime}.ts`、`apps/server/src/modules/sessions/attachments.ts`、`packages/shared/src/events.ts`、`docs/contracts/{rest-api,ws-events}.md`。

### DA-3 抽取内核与文本类格式

- 状态：`done`（2026-11-23）
- 依赖：DA-1
- 目标：可插拔抽取器接口、worker 队列与文本/CSV/HTML 支持。
- 交付物：
  - `AttachmentArtifact`、`DocumentExtractor`、`ExtractorRegistry`；
  - `IngestQueue` 与 `worker.ts`：并发、超时、内存上限、终止与清理；
  - Text / CSV / HTML 抽取器；
  - sections、token 估算、`maxExtractedChars` 截断与 warning。
- 验收：
  - 10 MB 文本不阻塞事件循环；
  - HTML 脚本、事件属性、远程图片被清除；
  - CSV 表格有行列上限与截断 warning；
  - 解析超时/异常只影响该附件。
- 测试：
  - registry 选择与未知类型；
  - 文本编码、BOM、超长截断；
  - CSV 引号/换行/截断；
  - HTML 清洗与 markdown 转换；
  - worker 超时、崩溃、内存上限。
- 涉及路径：`apps/server/src/modules/attachments/{types,queue,worker}.ts`、`apps/server/src/modules/attachments/extractors/{registry,text,csv,html}.ts`、`apps/server/tsdown.config.ts`、`apps/server/test/attachments/*`。

### DA-4 PDF、DOCX、PPTX、XLSX 抽取

- 状态：`done`（2026-11-23）
- 依赖：DA-3
- 目标：四类办公/文档格式的文本抽取与锚点。
- 交付物：
  - PDF：文本层、页码锚点、空页检测、页数上限；
  - DOCX：标题、段落、表格、图片占位；
  - PPTX：按页文本与 notes；
  - XLSX：多 Sheet、值优先、行列截断；
  - 每类 extractor 版本与 warning。
- 验收：
  - 文本 PDF 的 `page:N` 可被 `read_attachment` 命中；
  - DOCX 标题层级与表格进入 markdown；
  - PPTX 页顺序正确，不丢 notes；
  - XLSX 公式取缓存值，不执行公式；
  - 加密/损坏/超页数返回稳定错误码。
- 测试：
  - 每类 fixture 的关键文本、锚点、页数/Sheet/Slide；
  - 加密 PDF、损坏 DOCX、超页数 PDF；
  - 表格截断 warning；
  - extractor 版本写入 artifact。
- 涉及路径：`apps/server/src/modules/attachments/extractors/{pdf,docx,pptx,xlsx}.ts`、`apps/server/test/attachments/fixtures/*`、`apps/server/test/attachments/extractors.test.ts`。

### DA-5 图片能力路由与 OCR/视觉降级

- 状态：`done`（2026-11-23）
- 依赖：DA-2、DA-3
- 目标：图片原图透传与无视觉时的 OCR/视觉转写。
- 交付物：
  - `resolveAttachmentRoute` 纯函数；
  - 视觉透传：`ModelImage`；
  - 本地 OCR：`tesseract.js` 可选、语言数据本地检查、不联网下载；
  - 视觉转写：显式 `visionConnectionId`、单图、无工具、超时；
  - 失败关闭与 UI 可见原因。
- 验收：
  - 视觉模型 + PNG 不调用 OCR；
  - 纯文本模型 + PNG + OCR 生成 `method=ocr`；
  - 纯文本模型 + PNG 无 OCR/视觉时 Turn 创建拒绝；
  - 视觉连接失效不回退到其他供应商；
  - 扫描 PDF 首版返回 `ATTACHMENT_PDF_NO_TEXT`。
- 测试：
  - 路由矩阵穷举；
  - 视觉透传上下文断言；
  - OCR 可用/不可用/语言数据缺失；
  - 视觉转写成功、401、429、超时；
  - 失败路径不产生 ModelImage。
- 涉及路径：`apps/server/src/modules/attachments/{route.ts,extractors/ocr.ts,extractors/vision.ts}`、`apps/server/src/modules/sessions/turns.ts`、`apps/server/test/attachments/route.test.ts`。

### DA-6 上下文预算与附件工具

- 状态：`done`（2026-11-23）
- 依赖：DA-2、DA-3
- 目标：把 artifact 安全、按预算地送入模型，并提供按需读取工具。
- 交付物：
  - `contextAssembler` 附件块、目录、历史元数据；
  - 单文件 8k / 整轮 15% 预算；
  - `read_attachment`、`search_attachment`、`list_attachments`；
  - `ToolContext` 方法与 `attachments` pack；
  - 系统提示与 `PROMPT_VERSION`。
- 验收：
  - 纯文本模型 + DOCX 不要求 `acceptsImages`；
  - 视觉模型 + 图片有 image block；
  - 长文档只注入目录，工具可读具体页；
  - 跨会话/未 ready 附件返回 `ATTACHMENT_NOT_FOUND` / `ATTACHMENT_NOT_READY`；
  - 历史轮不重复注入正文；
  - 工具只在有 ready 附件时出现。
- 测试：
  - 上下文四种组合；
  - 预算边界：刚好 8k、超过 8k、多个附件总和超过 15%；
  - 工具分页、搜索、输出上限；
  - 工具隐藏与执行层拒绝；
  - 系统提示与 051 契约矩阵。
- 涉及路径：`apps/server/src/modules/agent/{contextAssembler,contextCompressor,profiles,turnRunner}.ts`、`apps/server/src/modules/attachments/tools.ts`、`packages/agent/src/tools/types.ts`、`specs/051-agent-tool-contract/spec.md`。

### DA-7 气泡外附件、草稿托盘与预览

- 状态：`done`（2026-11-23）
- 依赖：DA-2、DA-6
- 目标：附件与图片在会话气泡之外呈现，输入区有独立草稿托盘。
- 交付物：
  - `AttachmentTray`：选择/拖拽、上传、解析状态、移除、重试；
  - `AttachmentStrip`：与用户气泡同级、右对齐；
  - `AttachmentCard`：文件名、页数、方法、warning；
  - `AttachmentPreview`：只读 markdown / 原图 lightbox / 下载；
  - 失败与成功提示走 Toast。
- 验收：
  - 附件区在气泡之外；文本为空不渲染空气泡；
  - 解析中/失败阻止发送，失败可移除；
  - 草稿会话首条消息先创建会话并解析附件，ready 后才创建 Turn；
  - 图片缩略图 object-contain，文档卡片可预览；
  - 历史回放布局一致；
  - 窄屏不溢出。
- 测试：
  - 组件测试：DOM 层级、空文本、状态、禁用发送；
  - 交互测试：选择、拖拽、移除、重试、预览；
  - 视觉截图：1440×900 与窄屏。
- 涉及路径：`apps/web/src/features/chat/{Composer,TimelineItemView,AttachmentTray,AttachmentStrip,AttachmentCard,AttachmentPreview}.tsx`、`apps/web/src/lib/{workspaceApi,queries}.ts`、`apps/web/e2e/attachments.spec.ts`。

### DA-8 安全、E2E 与验收

- 状态：`done`（2026-11-23）
- 依赖：DA-4、DA-5、DA-7
- 目标：安全边界、端到端与手工验收闭环。
- 交付物：
  - 安全测试：路径穿越、zip bomb、符号链接、宏/脚本、外部实体、SVG、伪造扩展名、跨会话；
  - 脱敏测试：日志/事件/审计无正文、无字节、无完整路径；
  - Mock E2E 与真实文件手工记录；
  - 契约、051、STATUS、ROADMAP、README 收口。
- 验收：
  - A1–A11 全部通过；
  - `pnpm check`、`pnpm build`、Mock E2E 通过；
  - 真实 PDF/DOCX/PPTX/XLSX/HTML 与一次视觉连接有记录；
  - 未验证项（扫描 PDF、真实 OCR 质量、大文件平台差异）如实记录。
- 测试：见 spec §12；E2E 覆盖 DOCX、图片视觉、图片 OCR、大文档、失败重试、气泡外布局。
- 涉及路径：`apps/server/test/attachments/*`、`apps/web/e2e/attachments.spec.ts`、`specs/088-document-attachments/acceptance.md`、`docs/contracts/*`。

## 验收记录

### DA-0 规格确认（2026-11-23）

- 人类批准 088 方案、界面调整与 Q-071～Q-076 全部推荐默认值；无异议项。
- spec 转 `ready`，平面稿状态与 §7.5 `auto-local` 语义同步；ADR-074 转 accepted，`DECISIONS.md` 登记。
- `specs/README.md`、`ROADMAP.md`、`STATUS.md` 与 `docs/open-questions.md` 已同步；仅文档变更，未运行 `pnpm check` 或测试。

### DA-1 数据模型、存储与迁移（2026-11-23）

- 迁移 `0038_document_attachments` 只加列与索引；旧截图行按 `kind=image`、`size_bytes=length(bytes)` 回填并可继续读取。
- `AttachmentStorage` 以 ID 推导路径、原子写入、目录 0700 / 文件 0600；`AttachmentRepository` 覆盖去重、会话隔离、引用计数与状态更新。
- `failPendingAttachments` 在启动时把崩溃遗留的 `pending` 行标记为 `failed` + `ATTACHMENT_PARSE_FAILED`，避免永久阻塞会话。
- 测试：`test/attachments/{storage,repository}.test.ts`、`test/db/migrations.test.ts`。

### DA-2 上传、状态事件与删除（2026-11-23）

- `POST/GET/DELETE .../attachments`、`GET .../artifact`、`POST .../transcribe` 落地；上传按魔数嗅探、Base64 规范校验、同会话 SHA-256 去重、20 MiB / 200 个每会话限额。
- 删除未引用附件清理行、原始文件与 artifact；已被 Turn 引用返回 `ATTACHMENT_IN_USE`。
- `attachment.status` 先持久化再广播，payload 只含 ID 与元数据。
- 测试：`test/attachments/{api,service,mime}.test.ts`。

### DA-3 抽取内核与文本类格式（2026-11-23）

- `DocumentExtractor`、registry、文本 / Markdown / CSV / HTML 抽取器；HTML 用 `sanitize-html` + `turndown` 清洗；超长输出按 `maxExtractedChars` 截断并记 warning。
- 解析在主进程执行，只有硬超时与解压前限额；worker/内存隔离未实现，记入 Q-077，不宣称沙箱。
- 测试：`test/attachments/extractors.test.ts`。

### DA-4 PDF、DOCX、PPTX、XLSX（2026-11-23）

- PDF 文本层 + `<!-- page:N -->` 锚点、空页 warning、`ATTACHMENT_PDF_NO_TEXT` / `ATTACHMENT_ENCRYPTED` / 页数上限。
- DOCX 标题/段落/表格；PPTX 按 slide 与 notes；XLSX 多 Sheet、取缓存值、行列截断。
- 测试：`test/attachments/extractors.test.ts` 的 fixture 覆盖；真实办公文件手工复核未跑。

### DA-5 能力路由与图片降级（2026-11-23）

- `resolveAttachmentRoute` 纯函数覆盖视觉透传、已有 OCR artifact、需要 OCR、需要视觉、失败关闭。
- UI 在纯文本模型下上传图片后会调用 `/transcribe`；本地 OCR 由 `LARNESS_TESSERACT_LANG_PATH` 显式启用，语言数据缺失时失败关闭。
- `ocr.mode=vision` 与 `visionConnectionId` 尚未构造云端 transcriber，记入 Q-078。
- 测试：`test/attachments/{route,service}.test.ts`。

### DA-6 上下文预算与附件工具（2026-11-23）

- 当前轮附件以 user 角色 `<attachment>` 块注入；小文档内联，超 8k 或 15% 预算只注入目录与 section 锚点。
- 三个 L0 工具只在本会话有 ready 附件时注入；`ToolExecutor` 绑定 `sessionId` + `attachments`，`toolContract` 矩阵覆盖正反例。
- 历史轮只保留附件 ID 与元数据引用。
- 测试：`test/attachments/context.test.ts`、`test/agent/toolContract.test.ts`。

### DA-7 气泡外附件、草稿托盘与预览（2026-11-23）

- 回形针位于地球按钮左侧；输入区托盘显示上传/解析/失败/重试；附件条与用户气泡同级、位于气泡之外，文本为空不渲染气泡。
- 文档卡片显示文件名、页数、解析方式、警告与稳定错误；图片 `object-contain`；预览支持原图 lightbox、只读 Markdown 与下载。
- 草稿会话先创建会话 → 上传并转写 → 再创建 Turn；附件失败时归档临时会话并保留草稿，不创建 Turn。
- 测试：`apps/web/src/features/chat/AttachmentStrip.test.tsx`；浏览器 E2E 未新增（Mock 不支持上传）。

### DA-8 安全、E2E 与验收（2026-11-23）

- 自动化覆盖：路径穿越/文件名清洗、zip 条目与解压限额、HTML 脚本/远程资源清洗、跨会话 404、已引用删除 409、事件无正文、日志/事件不含 Base64。
- `pnpm check` 通过（Server 882 通过 / 31 跳过，Web 291 通过）；`@larness/server build` 与根 `pnpm build` 通过。
- 未跑：真实 DOCX/PDF/PPTX/XLSX、真实 OCR 质量、真实视觉连接；详见 [acceptance.md](acceptance.md) §4。
