import { cn } from "@larness/ui";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { chipClass, chipInteractiveClass } from "./chip";

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
      className={cn("group", chipClass, chipInteractiveClass)}
    >
      <Icon size={11} className="shrink-0 text-accent" />
      <span className="truncate">{label}</span>
      <ArrowUpRight size={10} className="shrink-0 text-ink-3 group-hover:text-accent" />
    </button>
  );
}
