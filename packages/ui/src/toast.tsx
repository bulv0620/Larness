import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export type ToastTone = "success" | "info" | "error";

export interface ToastProps {
  /** `null` hides the toast. A changed message resets dismissal and restarts the timer. */
  message: string | null;
  tone?: ToastTone;
  /**
   * Auto-dismiss delay in ms. Defaults to 3200 for success/info and 0 for
   * errors, so failures stay visible until the user closes them.
   */
  durationMs?: number;
  retry?: { label: string; run: () => void };
  onDismiss?: () => void;
}

const ICONS = {
  success: CircleCheck,
  info: Info,
  error: CircleAlert,
} as const;

const ICON_TONES = {
  success: "text-success",
  info: "text-accent",
  error: "text-danger",
} as const;

/**
 * Single transient-feedback surface for the whole app: a top-center floating
 * message that never takes layout space. Use the `error` tone (or the
 * `ErrorMessage` alias) for failures, `success` for completed actions and
 * `info` for neutral status. Field-level validation and panel state belong
 * inline; see `docs/architecture/ui-feedback.md`.
 */
export function Toast(props: ToastProps) {
  if (!props.message) return null;
  return <ToastBody key={props.message} {...props} message={props.message} />;
}

function ToastBody({
  message,
  tone = "success",
  durationMs,
  retry,
  onDismiss,
}: ToastProps & { message: string }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [dismissed, setDismissed] = useState(false);
  const delay = durationMs ?? (tone === "error" ? 0 : 3200);

  useEffect(() => {
    if (delay <= 0) return;
    const timer = window.setTimeout(() => {
      setDismissed(true);
      dismissRef.current?.();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  if (dismissed) return null;

  const Icon = ICONS[tone];
  const persistent = delay <= 0;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "toast-slide-in pointer-events-none fixed inset-x-0 top-4 z-[360] mx-auto flex w-max max-w-[min(28rem,calc(100%_-_2rem))]",
        "items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-[12px] leading-5 text-ink shadow-[var(--shadow-pop)]",
        tone === "error" ? "border-danger/30" : "border-line",
      )}
    >
      <Icon size={13} aria-hidden="true" className={cn("shrink-0", ICON_TONES[tone])} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      {retry ? (
        <Button
          size="sm"
          variant="secondary"
          className="pointer-events-auto shrink-0"
          onClick={retry.run}
        >
          {retry.label}
        </Button>
      ) : null}
      {persistent ? (
        <Button
          size="sm"
          variant="ghost"
          className="pointer-events-auto shrink-0"
          aria-label={tone === "error" ? "关闭错误消息" : "关闭提示"}
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          关闭
        </Button>
      ) : null}
    </div>
  );
}
