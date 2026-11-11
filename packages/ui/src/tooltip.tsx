import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export const TooltipProvider = TooltipPrimitive.Provider;

export interface HintProps {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  variant?: "default" | "card";
}

export function Hint({
  label,
  children,
  side = "bottom",
  align,
  className,
  variant = "default",
}: HintProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={variant === "card" ? 18 : 6}
          className={cn(
            "z-[200]",
            variant === "default"
              ? "select-none rounded-md bg-[#1d1d1f] px-2 py-1 text-[11px] font-medium text-white shadow-lg dark:bg-[#f5f5f7] dark:text-[#1d1d1f]"
              : "relative rounded-2xl border border-line bg-surface p-3 text-ink shadow-pop",
            "data-[state=delayed-open]:animate-in",
            className,
          )}
        >
          {label}
          {variant === "default" ? (
            <TooltipPrimitive.Arrow className="fill-[#1d1d1f] dark:fill-[#f5f5f7]" />
          ) : (
            <span className="pointer-events-none absolute -top-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-line bg-surface" />
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Tooltip({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}
