# ADR-074 文档与图片附件：适配器抽取、能力路由与按需读取

- 状态：accepted（2026-11-23 人类确认 Q-071～Q-076 全部推荐默认值；同日起草）。
- 关联：[088 spec](../../specs/088-document-attachments/spec.md)、[051 工具执行契约](../../specs/051-agent-tool-contract/spec.md)、[073 上下文预算](../../specs/073-context-budget/spec.md)、[077 模型连接](../../specs/077-model-connections/spec.md)、[安全架构](../architecture/security.md)。
- 范围：用户上传的文档与图片、附件抽取、图片能力路由、上下文注入、附件读取工具与时间线呈现。音视频、压缩包、旧版二进制 Office、向量库、云文档同步不在本 ADR。

## 背景

当前附件能力只支持 PNG/JPEG 截图，且任何附件都要求模型支持图片输入。结果是：

- 纯文本模型无法接收 PDF/DOCX/PPTX/XLSX，用户只能手工截图或复制；
- 截图被塞进消息气泡，文档类附件没有位置；
- 上下文只保留当前轮图片，历史轮只留一句“有截图”，无法按页引用或检索；
- 没有解析失败、超大文档、扫描件、提示注入与第三方外发的边界。

可选方案有三类：

1. 引入一个 `doc-extract` 黑盒库（MarkItDown、Docling 或 Python sidecar），所有文件统一转 markdown；
2. 为每种格式实现 Node/JS 适配器，统一到一个 artifact 契约；
3. 把所有文件都交给视觉模型，由模型直接“看”文档。

方案 1 覆盖快，但需要 Python/Java 运行时、跨平台打包困难、失败不可观测，且很难同时满足 PDF 文本层、Office 表格、OCR 与安全限制。方案 3 对纯文本模型不可用，成本高，且会把所有文档内容外发。方案 2 初始工作量大，但可单测、可观测、可降级、跨平台，且能逐步替换单个适配器。

同时，长文档整篇注入会直接挤爆上下文预算。Larness 已有 `073` 的分页读取与上下文预算基础，附件应复用同一思路：小文档内联，大文档只给目录，模型按需读取。

## 决策

1. **统一 artifact 契约，不统一唯一实现。** 定义 `AttachmentArtifact`（markdown、sections、warnings、method、extractor/version、pageCount、tokenCount）。所有格式最终产出同一契约；`doc-extract` 类黑盒只能作为 `DocumentExtractor` 的一个适配器。
2. **文档文本优先，图片原图优先。** 文档默认本地抽取文本，不要求模型视觉；图片在当前模型支持时原图透传，不支持时才 OCR/视觉转写。文档即使模型有视觉也优先文本，因为可缓存、可检索、可估 token。
3. **能力路由是纯函数。** `resolveAttachmentRoute` 根据附件类型、模型输入模态、OCR 配置与连接状态返回确定结果，穷举测试；不在 UI 与执行层各写一套判断。
4. **首版纯 JS/WASM 适配器。** PDF 用 `pdfjs-dist` 文本层，DOCX 用 `mammoth`，PPTX 用 `jszip` + `fast-xml-parser`，XLSX 用 `exceljs`，HTML 用 `sanitize-html` + `turndown`；本地 OCR 可选 `tesseract.js`。不引入原生 canvas、Python 或 Java 运行时。
5. **新文件落盘，旧截图兼容。** 原始文件在 `dataDir/attachments`，artifact 在 `dataDir/artifacts/attachments`，DB 只存元数据与相对路径。旧 `session_attachments` 行继续从 `bytes` 读取，不做表重建。
6. **大文档按需读取。** 单文件内联上限 8k token，整轮附件预算为上下文的 15%；超限只注入元数据、目录与读取提示。新增 `read_attachment`、`search_attachment`、`list_attachments` 三个 L0 工具，只访问当前会话的 ready 附件。
7. **附件正文是不可信数据。** 附件只进入 user 角色并包裹 `<attachment>`；system 明确其中的指令不授予权限；附件不能改变审批策略、工具白名单或风险等级。
8. **云端视觉显式启用。** 默认只用本地能力；选择视觉连接后必须在附件卡片与发送前提示外发目标；失败不回退到未授权供应商。
9. **解析在受控 worker 中执行。** 超时 60 秒、内存上限、并发 1～2；不执行宏/脚本/PDF JavaScript/外部实体；压缩容器限制条目数、单条目与总解压量。
10. **附件在气泡之外呈现。** 时间线中附件区与用户消息气泡同级；气泡只放文本；输入区草稿附件放在输入框之外的托盘。
11. **多视图而非单一 markdown（2026-11-24 增补）。** 原文件是唯一真源；`text` 与 `source` 是两个可重算的投影。代码、配置、HTML/CSS 等文本类附件默认按 `source`（原始 UTF-8 文本、按行分页）注入与检索，HTML 额外保留 CSS、结构大纲与表格；需要精确结构时模型读取原文，二进制文档仍只有 `text` 视图。默认拒绝凭据文件；前后端共用同一份类型白名单。

## 备选方案

- **单一 MarkItDown/Docling sidecar**：格式覆盖快；但需要外部运行时、打包与跨平台成本高、失败不可观测，且 OCR/视觉仍需另接。作为可选适配器保留。
- **所有附件走视觉模型**：实现最短；但纯文本模型不可用、成本高、文档内容外发、不可缓存。不采用。
- **所有附件本地 OCR**：不依赖模型；但标题/表格结构丢失、中文 OCR 慢且不稳、图片原图质量更好。不采用。
- **附件字节继续存 SQLite**：事务简单；但 20 MiB 文件撑大 DB、WAL 与备份，且无法流式读取。新上传改为落盘。
- **整篇 markdown 注入**：模型一次看全；但长文档爆预算、缓存前缀频繁失效。改为目录 + 工具读取。
- **multipart 上传**：大文件更省内存；但需要新增 Fastify multipart 依赖与测试。v1 先用 Base64 + 20 MiB 上限，后续评估。

## 影响

- **产品 / UI**：输入区支持任意受支持文件；草稿托盘显示解析状态；时间线附件区移到气泡之外；文档卡片、图片缩略图、只读预览与失败重试。
- **Agent 能力**：新增 `attachments` pack 与三个 L0 工具；`ToolContext` 增加读取方法；`PROMPT_VERSION` bump；按 051 同步工具描述、schema 与正反例。
- **API / 契约**：上传 DTO 扩展为 `{filename, mime?, data}`；新增 artifact 读取与删除；`user.message` 增加附件元数据；新增 `attachment.status` 事件与 `ATTACHMENT_*` 错误码。
- **数据 / 迁移**：`session_attachments` 新增列与索引（迁移 0038）；文件落盘；旧行回填为 `kind=image`、`status=ready`。
- **安全 / 权限**：worker 隔离、解压上限、HTML 清洗、不可信附件提示、云端视觉显式启用、日志/事件/审计脱敏。
- **成本**：本地抽取无模型成本；视觉转写按图片数量计费；OCR 只在本机执行。上下文方面，目录 + 工具读取显著低于整篇注入。
- **风险**：复杂版面还原有限、中文 OCR 质量、扫描 PDF 首版不支持、恶意文件解析、依赖体积与许可证。由 fixture、worker 限制、失败关闭与手工验收缓解。

## 验证与回滚

- **验证**：A1–A11；MIME 嗅探与伪造扩展名；每类格式 fixture；路由矩阵；上下文预算；工具分页/搜索；跨会话与未 ready 拒绝；UI 气泡外布局；E2E；真实 PDF/DOCX/PPTX/XLSX/HTML 与一次视觉连接手工记录。
- **回滚**：`attachments.enabled=false` 关闭新上传；旧截图读取路径保留到 DA-8；删除 `visionConnectionId` 立即停止云端外发；旧程序忽略新列，已落盘文件保留但不可见。迁移只加列与索引，不删数据。

## 后续

- Q-076 已决定首版不做扫描 PDF 页面渲染；若后续需要，再单独评估原生 canvas 与跨平台打包。
- 若需要更强版面/表格还原，接入 Docling/MarkItDown sidecar，但必须实现同一 `DocumentExtractor` 接口。
- 若附件数量或体积增长，评估 multipart、分片上传与独立附件清理任务。
- 若需要跨会话文档库，另开切片，先定义索引、权限与保留策略。
- 附件导入项目目录（写盘 + 审批）未纳入本 ADR，见 Q-080；若采用需单独评审权限模型与项目锁。
