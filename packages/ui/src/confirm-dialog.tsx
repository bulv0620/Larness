import { type ReactNode, useRef } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { ErrorMessage } from "./error-message";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  danger?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
  className?: string;
  overlayClassName?: string;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = "处理中…",
  danger = false,
  pending = false,
  confirmDisabled = false,
  error,
  onDismissError,
  onCancel,
  onConfirm,
  children,
  className,
  overlayClassName,
}: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent
        className={cn("w-[min(420px,calc(100vw-40px))] space-y-3 pointer-events-auto", className)}
        overlayClassName={overlayClassName}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButton.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        {children}
        <ErrorMessage message={error} onDismiss={onDismissError} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button ref={cancelButton} variant="secondary" disabled={pending} onClick={onCancel}>
            取消
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
