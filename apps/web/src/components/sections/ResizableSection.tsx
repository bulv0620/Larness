import { IconButton } from "@harness/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export function ResizableSection({
  title,
  icon: Icon,
  count,
  expanded,
  size,
  onToggle,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  count?: number;
  expanded: boolean;
  size: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden"
      style={{
        flexGrow: expanded ? size : 0,
        flexBasis: expanded ? 0 : 36,
        flexShrink: 0,
        minHeight: expanded ? 96 : 36,
      }}
    >
      <div className="group flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[11.5px] font-medium text-ink-2 hover:text-ink">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Icon size={14} strokeWidth={1.8} className="shrink-0 text-ink-3" />
          <span className="truncate">{title}</span>
          {typeof count === "number" ? (
            <span className="rounded-full bg-black/[.045] px-1.5 py-[1px] text-[10px] font-medium text-ink-3 dark:bg-white/[.07]">
              {count}
            </span>
          ) : null}
          <span className="ml-auto text-ink-3">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton label={`${title} 操作`} className="h-6 w-6" onClick={onToggle}>
            <span className="text-[15px] leading-none">·</span>
          </IconButton>
        </div>
      </div>
      {expanded ? <div className="min-h-0 flex-1 overflow-auto pb-1">{children}</div> : null}
    </section>
  );
}
