import type { MessageAttachmentRef } from "@larness/shared";
import { useState } from "react";
import { attachmentUrl } from "@/lib/workspaceApi";
import { AttachmentCard } from "./AttachmentCard";
import { AttachmentPreview, type PreviewTarget } from "./AttachmentPreview";

/** Attachments render beside the user bubble, never inside it. */
export function AttachmentStrip({
  sessionId,
  attachments,
}: {
  sessionId: string;
  attachments: MessageAttachmentRef[];
}) {
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-2" data-testid="attachment-strip">
      {attachments.map((item) =>
        item.kind === "image" && item.status === "ready" ? (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              setPreview({
                id: item.id,
                filename: item.filename,
                kind: "image",
                mime: item.mime,
              })
            }
            className="relative overflow-hidden rounded-lg border border-line bg-surface-2"
            title={item.filename}
          >
            <img
              src={attachmentUrl(sessionId, item.id)}
              alt={item.filename}
              loading="lazy"
              className="max-h-40 max-w-[240px] object-contain"
            />
            {item.method === "ocr" || item.method === "vision" ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                {item.method === "ocr" ? "OCR" : "视觉转写"}
              </span>
            ) : null}
          </button>
        ) : (
          <AttachmentCard
            key={item.id}
            item={{
              id: item.id,
              filename: item.filename,
              kind: item.kind,
              status: item.status,
              method: item.method,
              pageCount: item.pageCount,
              errorCode: item.errorCode,
            }}
            onOpen={() =>
              setPreview({
                id: item.id,
                filename: item.filename,
                kind: item.kind,
                mime: item.mime,
              })
            }
          />
        ),
      )}
      {preview ? (
        <AttachmentPreview
          sessionId={sessionId}
          target={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
