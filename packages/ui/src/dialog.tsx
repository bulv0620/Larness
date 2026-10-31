import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { children: ReactNode }
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[300] bg-black/20 backdrop-blur-[2px]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[301] w-[min(560px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl border border-line bg-surface p-5 text-ink shadow-[var(--shadow-pop)] outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<"h2">) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[15px] font-semibold tracking-[-.01em]", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 text-[12px] leading-5 text-ink-2", className)}
      {...props}
    />
  );
}
