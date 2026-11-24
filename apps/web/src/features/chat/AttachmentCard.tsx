import { cn } from "@larness/ui";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { FileTypeIcon } from "@/features/files/FileTypeIcon";
import { chipClass } from "./chip";

export interface AttachmentCardData {
  id?: string;
  filename: string;
  kind: "document" | "image";
  status: "pending" | "ready" | "failed" | "uploading";
  method?: "none" | "native" | "text-layer" | "ocr" | "vision";
  pageCount?: number | null;
  warningCount?: number;
  errorCode?: string | null;
}

const methodLabel: Record<string, string> = {
  none: "原图",
  native: "文本",
  "text-layer": "文本层",
  ocr: "OCR",
  vision: "视觉转写",
};

const errorLabel: Record<string, string> = {
  ATTACHMENT_TOO_LARGE: "文件过大",
  ATTACHMENT_UNSUPPORTED: "格式不支持",
  ATTACHMENT_LIMIT: "附件已满",
  ATTACHMENT_PARSE_FAILED: "无法解析",
  ATTACHMENT_PARSE_TIMEOUT: "解析超时",
  ATTACHMENT_ENCRYPTED: "文件已加密",
  ATTACHMENT_PDF_NO_TEXT: "PDF 无可提取文本",
  ATTACHMENT_VISION_UNAVAILABLE: "当前模型不支持图片",
  ATTACHMENT_NOT_READY: "仍在解析",
  ATTACHMENT_STORAGE_FAILED: "存储不可用",
};

/** Secondary facts live in the tooltip so a tag stays one line. */
export function attachmentDetail(item: AttachmentCardData): string {
  return [
    item.status === "uploading" || item.status === "pending" ? "解析中" : null,
    item.status === "failed"
      ? item.errorCode
        ? (errorLabel[item.errorCode] ?? "解析失败")
        : "解析失败"
      : null,
    item.pageCount ? `${item.pageCount} 页` : null,
    item.method && item.method !== "none" ? methodLabel[item.method] : null,
    item.warningCount ? `${item.warningCount} 条警告` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One tag: a status icon plus the truncated file name. Width follows the name
 *  (capped), and the icon comes from the same Material set the file tree uses,
 *  so a file looks identical wherever it is listed. */
export function AttachmentCard({
  item,
  disabled = false,
  onRemove,
  onOpen,
}: {
  item: AttachmentCardData;
  disabled?: boolean;
  onRemove?: () => void;
  onOpen?: () => void;
}) {
  const busy = item.status === "uploading" || item.status === "pending";
  const failed = item.status === "failed";
  const detail = attachmentDetail(item);

  return (
    <div
      className={cn(
        chipClass,
        "shrink-0 gap-1 pr-1 pl-2 text-left",
        failed
          ? "border-danger/35 bg-danger/5"
          : item.status === "ready" && onOpen
            ? "hover:border-accent/35 hover:bg-accent-soft/30"
            : null,
      )}
      title={detail.length > 0 ? `${item.filename} · ${detail}` : item.filename}
      data-testid="attachment-chip"
    >
      {busy ? (
        <Loader2
          size={11}
          aria-hidden="true"
          className="shrink-0 animate-spin text-ink-3 motion-reduce:animate-none"
        />
      ) : (
        <FileTypeIcon path={item.filename} size={13} />
      )}
      <button
        type="button"
        onClick={onOpen}
        disabled={item.status !== "ready" || onOpen === undefined}
        className="min-w-0 max-w-[180px] truncate text-left text-[11px] text-ink-2 enabled:hover:text-ink disabled:cursor-default"
      >
        {item.filename}
      </button>
      {failed ? (
        <AlertTriangle size={10} aria-hidden="true" className="shrink-0 text-danger" />
      ) : null}
      {detail.length > 0 ? <span className="sr-only">{detail}</span> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除 ${item.filename}`}
          className="-mr-0.5 shrink-0 rounded-full p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
        >
          <X size={10} />
        </button>
      ) : null}
    </div>
  );
}
