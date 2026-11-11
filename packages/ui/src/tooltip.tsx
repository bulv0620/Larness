import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export const TooltipProvider = TooltipPrimitive.Provider;

export interface HintProps {
  label: string;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function Hint({ label, children, side = "bottom", className }: HintProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[200] select-none rounded-md bg-[#1d1d1f] px-2 py-1 text-[11px] font-medium text-white shadow-lg",
            "data-[state=delayed-open]:animate-in dark:bg-[#f5f5f7] dark:text-[#1d1d1f]",
            className,
          )}
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-[#1d1d1f] dark:fill-[#f5f5f7]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Tooltip({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}
