import { cn } from "@harness/ui";
import type { ReactNode } from "react";

export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "rounded-[5px] border border-line bg-surface-2 px-1 py-[1px] font-mono text-[11px] text-ink-2",
        className,
      )}
    >
      {children}
    </code>
  );
}
