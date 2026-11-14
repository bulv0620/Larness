import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,.12)] hover:brightness-110 active:brightness-95",
  secondary:
    "border border-line bg-surface text-ink shadow-[0_1px_1px_rgba(0,0,0,.03)] hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-black/[.045] hover:text-ink dark:hover:bg-white/[.06]",
  soft: "bg-accent-soft text-accent hover:bg-accent/20",
  danger:
    "bg-danger text-white shadow-[0_1px_2px_rgba(0,0,0,.12)] hover:brightness-110 active:brightness-95",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-lg px-2.5 text-[12px]",
  md: "h-8 gap-2 rounded-[9px] px-3 text-[12.5px]",
};

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leading?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  leading,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {leading}
      {children}
    </button>
  );
}
