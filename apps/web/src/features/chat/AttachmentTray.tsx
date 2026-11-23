import { X } from "lucide-react";
import type { ApiAttachment } from "@/lib/workspaceApi";
import { AttachmentCard } from "./AttachmentCard";

export interface DraftAttachmentItem {
  key: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "pending" | "ready" | "failed";
  attachment?: ApiAttachment;
  errorCode?: string | null;
}

export function AttachmentTray({
  items,
  disabled = false,
  onRemove,
  onRetry,
  onPreview,
}: {
  items: DraftAttachmentItem[];
  disabled?: boolean;
  onRemove: (key: string) => void;
  onRetry?: (key: string) => void;
  onPreview?: (item: DraftAttachmentItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3" data-testid="attachment-tray">
      {items.map((item) => {
        const isImage = item.file.type.startsWith("image/");
        if (isImage) {
          return (
            <div
              key={item.key}
              className="group relative overflow-hidden rounded-lg border border-line bg-surface-2"
            >
              <button
                type="button"
                onClick={() => onPreview?.(item)}
                disabled={item.status !== "ready"}
                className="block"
                title={item.file.name}
              >
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  className="max-h-28 max-w-[160px] object-contain"
                />
              </button>
              {item.status !== "ready" ? (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10px] text-white">
                  {item.status === "failed" ? "失败" : "解析中"}
                </span>
              ) : item.attachment?.method === "ocr" || item.attachment?.method === "vision" ? (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                  {item.attachment.method === "ocr" ? "OCR" : "视觉转写"}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(item.key)}
                disabled={disabled}
                aria-label={`移除 ${item.file.name}`}
                className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white disabled:opacity-40"
              >
                <X size={11} />
              </button>
            </div>
          );
        }
        return (
          <div key={item.key} className="flex items-center gap-1">
            <AttachmentCard
              item={{
                id: item.attachment?.id,
                filename: item.file.name,
                kind: "document",
                status: item.status,
                method: item.attachment?.method,
                pageCount: item.attachment?.pageCount,
                warningCount: item.attachment?.warnings.length,
                errorCode: item.errorCode ?? item.attachment?.errorCode,
              }}
              disabled={disabled}
              onRemove={() => onRemove(item.key)}
              onOpen={() => onPreview?.(item)}
            />
            {item.status === "failed" && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(item.key)}
                className="text-[11px] text-accent hover:underline"
              >
                重试
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
