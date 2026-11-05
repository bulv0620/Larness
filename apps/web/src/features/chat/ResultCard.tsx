import { cn } from "@larness/ui";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

interface ResultCardProps {
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  titleAttr?: string;
}

export function ResultCard({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
  disabled,
  titleAttr,
}: ResultCardProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={titleAttr ?? ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line/80 bg-surface-2/55 px-2 text-[11px] text-ink-2",
        "transition-colors hover:border-accent/35 hover:bg-accent-soft/30 hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:pointer-events-none disabled:opacity-55",
      )}
    >
      <Icon size={11} className="shrink-0 text-accent" />
      <span className="truncate">{label}</span>
      <ArrowUpRight size={10} className="shrink-0 text-ink-3 group-hover:text-accent" />
    </button>
  );
}
