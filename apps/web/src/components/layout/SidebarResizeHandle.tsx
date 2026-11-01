import type { KeyboardEvent, PointerEvent } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function SidebarResizeHandle({
  side,
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  className,
}: {
  side: "left" | "right";
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (width: number) => void;
  className?: string;
}) {
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      onChange(clamp(startWidth + delta, min, max));
    };

    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 16;
    const pointerDelta = event.key === "ArrowRight" ? step : -step;
    const widthDelta = side === "left" ? pointerDelta : -pointerDelta;
    onChange(clamp(value + widthDelta, min, max));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive splitter, not a static <hr>
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      className={`group relative z-30 w-1.5 shrink-0 cursor-col-resize focus-visible:outline-none ${className ?? ""}`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-line-strong group-focus-visible:bg-ink-3/50" />
    </div>
  );
}
