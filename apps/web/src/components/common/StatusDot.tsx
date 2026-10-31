import { cn } from "@harness/ui";

const tones = {
  running: "bg-success",
  idle: "bg-ink-3",
  waiting: "bg-warning",
  error: "bg-danger",
  info: "bg-accent",
} as const;

export function StatusDot({
  tone = "idle",
  pulse = false,
  className,
}: {
  tone?: keyof typeof tones;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
        tones[tone],
        className,
      )}
    >
      {pulse ? (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-60", tones[tone])}
        />
      ) : null}
    </span>
  );
}
