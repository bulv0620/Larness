import type { MessageAttachmentRef } from "@larness/shared";
import { useState } from "react";
import { AttachmentCard } from "./AttachmentCard";
import { AttachmentPreview, type PreviewTarget } from "./AttachmentPreview";

/** Attachments render below the user bubble as equal-width tags, never inside it. */
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
    <div className="flex flex-wrap justify-end gap-1.5" data-testid="attachment-strip">
      {attachments.map((item) => (
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
      ))}
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
