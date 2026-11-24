import type { ApiAttachment } from "@/lib/workspaceApi";
import { AttachmentCard } from "./AttachmentCard";

export interface DraftAttachmentItem {
  key: string;
  file: File;
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
    <div className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid="attachment-tray">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <AttachmentCard
            item={{
              id: item.attachment?.id,
              filename: item.file.name,
              kind:
                item.attachment?.kind ??
                (item.file.type.startsWith("image/") ? "image" : "document"),
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
      ))}
    </div>
  );
}
