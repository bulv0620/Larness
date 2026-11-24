import { isSourceViewMime } from "@larness/shared";
import { Loader2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { attachmentUrl, fetchAttachmentArtifact, fetchAttachmentSource } from "@/lib/workspaceApi";
import { MarkdownText } from "./MarkdownText";

const FileEditor = lazy(() => import("@/features/files/FileEditor"));
const SOURCE_PREVIEW_CHARS = 60_000;

export interface PreviewTarget {
  id: string;
  filename: string;
  kind: "document" | "image";
  mime: string;
}

export function AttachmentPreview({
  sessionId,
  target,
  onClose,
}: {
  sessionId: string;
  target: PreviewTarget;
  onClose: () => void;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failedImageId, setFailedImageId] = useState<string | null>(null);
  const imageFailed = failedImageId === target.id;
  const sourceCapable = target.kind === "document" && isSourceViewMime(target.mime);
  // Tagged with the target id so switching attachments starts on the parsed view.
  const [viewState, setViewState] = useState<{ id: string; view: "text" | "source" }>({
    id: target.id,
    view: "text",
  });
  const view = viewState.id === target.id ? viewState.view : "text";
  const setView = (next: "text" | "source") => setViewState({ id: target.id, view: next });
  const [source, setSource] = useState<{
    content: string;
    lineStart: number;
    lineEnd: number;
    totalLines: number;
    truncated: boolean;
  } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    if (target.kind !== "document" || view !== "text") return;
    let active = true;
    setMarkdown(null);
    setError(null);
    void fetchAttachmentArtifact(sessionId, target.id)
      .then((result) => {
        if (!active) return;
        setMarkdown(result.markdown);
        setTruncated(result.truncated);
      })
      .catch(() => {
        if (active) setError("无法读取解析结果。");
      });
    return () => {
      active = false;
    };
  }, [sessionId, target.id, target.kind, view]);

  useEffect(() => {
    if (!sourceCapable || view !== "source") return;
    let active = true;
    setSource(null);
    setSourceError(null);
    void fetchAttachmentSource(sessionId, target.id, { maxChars: SOURCE_PREVIEW_CHARS })
      .then((result) => {
        if (!active) return;
        setSource({
          content: result.content,
          lineStart: result.lineStart,
          lineEnd: result.lineEnd,
          totalLines: result.totalLines,
          truncated: result.truncated,
        });
      })
      .catch(() => {
        if (active) setSourceError("无法读取原始文件。");
      });
    return () => {
      active = false;
    };
  }, [sessionId, target.id, sourceCapable, view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`附件预览：${target.filename}`}
      className="fixed inset-0 z-[340] flex items-center justify-center bg-black/45 p-4"
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{target.filename}</span>
          {sourceCapable ? (
            <div
              role="tablist"
              aria-label="预览视图"
              className="flex items-center gap-0.5 rounded-full bg-surface-2/60 p-0.5"
            >
              {(
                [
                  ["text", "解析视图"],
                  ["source", "原文"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${view === value ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-ink-3 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {target.kind === "document" ? (
            <a
              href={attachmentUrl(sessionId, target.id)}
              download={target.filename}
              className="text-[11px] text-accent hover:underline"
            >
              下载
            </a>
          ) : null}
          <button
            type="button"
            aria-label="关闭预览"
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-surface-2"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {target.kind === "image" ? (
            imageFailed ? (
              <p role="status" className="text-[12px] text-danger">
                无法加载原图，文件可能已被删除。
              </p>
            ) : (
              <img
                src={attachmentUrl(sessionId, target.id)}
                alt={target.filename}
                className="mx-auto max-h-[70vh] max-w-full object-contain"
                onError={() => setFailedImageId(target.id)}
              />
            )
          ) : view === "source" ? (
            <SourceView
              identity={target.id}
              filename={target.filename}
              source={source}
              error={sourceError}
            />
          ) : error !== null ? (
            <p role="status" className="text-[12px] text-danger">
              {error}
            </p>
          ) : markdown === null ? (
            <p role="status" className="flex items-center gap-2 text-[12px] text-ink-3">
              <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />{" "}
              读取解析结果…
            </p>
          ) : markdown.length === 0 ? (
            <p role="status" className="text-[12px] text-ink-3">
              该附件没有可预览的文本。
            </p>
          ) : (
            <>
              <MarkdownText text={markdown} />
              {truncated ? (
                <p className="mt-3 text-[11px] text-ink-3">
                  预览已截断，完整内容可由 Agent 分页读取。
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceView({
  identity,
  filename,
  source,
  error,
}: {
  identity: string;
  filename: string;
  source: {
    content: string;
    lineStart: number;
    lineEnd: number;
    totalLines: number;
    truncated: boolean;
  } | null;
  error: string | null;
}) {
  if (error !== null) {
    return (
      <p role="status" className="text-[12px] text-danger">
        {error}
      </p>
    );
  }
  if (source === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-[12px] text-ink-3">
        <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> 读取原始文件…
      </p>
    );
  }
  return (
    <div className="flex h-[68vh] flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
        <Suspense fallback={<p className="p-3 text-[12px] text-ink-3">加载编辑器…</p>}>
          <FileEditor
            identity={`attachment:${identity}`}
            path={filename}
            text={source.content}
            readOnly
            onChange={() => undefined}
          />
        </Suspense>
      </div>
      <p className="text-[11px] text-ink-3">
        第 {source.lineStart}–{source.lineEnd} 行 · 共 {source.totalLines} 行
        {source.truncated ? " · 预览已截断，完整内容可由 Agent 分页读取" : ""}
      </p>
    </div>
  );
}
