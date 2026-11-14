import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function DraftScreenshot({
  file,
  onRemove,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <figure className="relative flex size-16 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
      {src ? <img src={src} alt={file.name || "截图"} className="size-full object-cover" /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-label="移除截图"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 rounded bg-surface p-0.5 text-ink"
      >
        <X size={12} />
      </button>
    </figure>
  );
}
