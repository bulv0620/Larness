import {
  Button,
  cn,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@larness/ui";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export const ADMIN_DIALOG_HEIGHT = "h-[min(680px,calc(100dvh-24px))]";
export const ADMIN_DIALOG_WIDTH = "w-[min(920px,calc(100vw-24px))]";

export interface AdminDialogShellProps {
  icon: LucideIcon;
  title: string;
  /** Screen-reader description; keep the visible header free of long prose. */
  description: string;
  closeLabel: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  bodyClassName?: string;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}

/**
 * Shared visual shell for the four workspace-management dialogs. It keeps the
 * header, close action, fixed height and flex body identical so list/detail
 * panes only decide their own internal layout.
 */
export function AdminDialogShell({
  icon: Icon,
  title,
  description,
  closeLabel,
  count,
  actions,
  children,
  testId,
  bodyClassName,
  onEscapeKeyDown,
}: AdminDialogShellProps) {
  return (
    <DialogContent
      className={cn("flex flex-col overflow-hidden p-0", ADMIN_DIALOG_HEIGHT, ADMIN_DIALOG_WIDTH)}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      {...(onEscapeKeyDown === undefined ? {} : { onEscapeKeyDown })}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Icon size={14} aria-hidden="true" />
        </span>
        <DialogTitle className="text-[12.5px] font-semibold">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {count === undefined ? null : (
          <span className="rounded-full bg-surface-2 px-1.5 py-[1px] text-[9.5px] text-ink-3">
            {count}
          </span>
        )}
        <div className="flex-1" />
        {actions}
        <DialogClose asChild>
          <Button size="sm" variant="ghost" aria-label={closeLabel}>
            <X size={14} />
          </Button>
        </DialogClose>
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </DialogContent>
  );
}

export interface AdminEmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** Shared empty/zero-state so every management dialog feels the same. */
export function AdminEmptyState({
  icon: Icon,
  title,
  hint,
  action,
  compact = false,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center",
        compact && "min-h-[140px] gap-1.5 p-4",
        className,
      )}
    >
      <span
        className={cn(
          "grid place-items-center rounded-xl bg-surface-2 text-ink-3",
          compact ? "size-8" : "size-10",
        )}
      >
        <Icon size={compact ? 15 : 18} aria-hidden="true" />
      </span>
      <p className={cn("font-medium text-ink", compact ? "text-[11.5px]" : "text-[12px]")}>
        {title}
      </p>
      {hint === undefined ? null : (
        <p className="max-w-[280px] text-[10.5px] leading-relaxed text-ink-3">{hint}</p>
      )}
      {action}
    </div>
  );
}
