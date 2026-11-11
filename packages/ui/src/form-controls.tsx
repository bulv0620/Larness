import type { ComponentPropsWithRef } from "react";
import { useId } from "react";
import { cn } from "./cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const controlStyle =
  "w-full rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] font-normal text-ink transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-45";
const textStyle = "min-w-0 placeholder:text-ink-3";

export function Input({
  className,
  variant = "field",
  ...props
}: ComponentPropsWithRef<"input"> & { variant?: "field" | "bare" }) {
  return (
    <input
      className={cn(textStyle, variant === "field" && [controlStyle, "h-8"], className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  variant = "field",
  ...props
}: ComponentPropsWithRef<"textarea"> & { variant?: "field" | "bare" }) {
  return (
    <textarea
      className={cn(textStyle, variant === "field" && [controlStyle, "py-1.5"], className)}
      {...props}
    />
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentPropsWithRef<"input">, "type">) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn(
        "size-4 shrink-0 appearance-none rounded border border-line bg-surface outline-none checked:border-accent checked:bg-accent checked:after:mx-auto checked:after:block checked:after:h-2.5 checked:after:w-1.5 checked:after:rotate-45 checked:after:border-b-2 checked:after:border-r-2 checked:after:border-white focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45",
        className,
      )}
    />
  );
}

interface SelectOption<Value extends string> {
  value: Value;
  label: string;
}

interface FormSelectProps<Value extends string> {
  label: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  onValueChange: (value: Value) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function FormSelect<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  placeholder = "请选择",
  disabled,
  className,
}: FormSelectProps<Value>) {
  const valueId = useId();
  const selection = options.find((option) => option.value === value);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={label}
        aria-describedby={valueId}
        disabled={disabled || options.length === 0}
        className={cn(
          controlStyle,
          "flex h-8 items-center justify-between gap-2 text-left enabled:hover:border-accent/50",
          className,
        )}
      >
        <span id={valueId} className={cn("truncate", !selection && "text-ink-3")}>
          {selection?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="-mt-1 size-1.5 shrink-0 rotate-45 border-b border-r" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="z-[350] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-auto"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next);
            if (option) onValueChange(option.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="min-w-0 break-all">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
