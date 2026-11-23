import { cn } from "@larness/ui";
import { FileText, Image as ImageIcon, Loader2, X } from "lucide-react";

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
  const Icon = item.kind === "image" ? ImageIcon : FileText;
  const meta = [
    item.pageCount ? `${item.pageCount} 页` : null,
    item.method && item.method !== "none" ? methodLabel[item.method] : null,
    item.warningCount ? `${item.warningCount} 条警告` : null,
  ].filter(Boolean);
  const status =
    item.status === "uploading" || item.status === "pending"
      ? "解析中"
      : item.status === "failed"
        ? item.errorCode
          ? (errorLabel[item.errorCode] ?? "解析失败")
          : "解析失败"
        : null;

  return (
    <div
      className={cn(
        "group flex min-w-[220px] max-w-[360px] items-center gap-2 rounded-lg border px-2.5 py-2 text-left",
        item.status === "failed" ? "border-danger/35 bg-danger/5" : "border-line bg-surface-2",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={item.status !== "ready" || onOpen === undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        title={item.filename}
      >
        <Icon size={16} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-ink">{item.filename}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
            {item.status === "uploading" || item.status === "pending" ? (
              <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
            ) : null}
            <span className="truncate">{[status, ...meta].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除 ${item.filename}`}
          className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export function attachmentSummary(item: AttachmentCardData): string {
  if (item.status === "failed") return `${item.filename} 解析失败`;
  return `${item.filename}${item.pageCount ? ` · ${item.pageCount} 页` : ""}`;
}
