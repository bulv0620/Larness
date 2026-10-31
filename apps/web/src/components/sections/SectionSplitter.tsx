import type { KeyboardEvent, PointerEvent } from "react";

export function SectionSplitter({
  value,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  value: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive splitter, not a static <hr>
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整资源分区高度"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className="group relative flex h-[7px] shrink-0 cursor-row-resize items-center justify-center focus-visible:outline-none"
    >
      <span className="absolute inset-x-2 h-px bg-line transition-colors group-hover:bg-accent/40 group-focus-visible:bg-accent/60" />
    </div>
  );
}
