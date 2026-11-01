import { cn } from "@larness/ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <p className="text-[12.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[280px] text-[11.5px] leading-5 text-ink-3">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
