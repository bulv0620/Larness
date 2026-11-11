import { useState } from "react";
import { Button } from "./button";

interface ErrorMessageProps {
  message?: string | null;
  onDismiss?: () => void;
  retry?: { label: string; run: () => void };
}

export function ErrorMessage({ message, onDismiss, retry }: ErrorMessageProps) {
  return message ? (
    <DismissibleError key={message} message={message} onDismiss={onDismiss} retry={retry} />
  ) : null;
}

function DismissibleError({ message, onDismiss, retry }: ErrorMessageProps & { message: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="alert"
      className="pointer-events-none fixed top-4 left-1/2 z-[360] flex w-max max-w-[min(28rem,calc(100%_-_2rem))] -translate-x-1/2 items-center gap-2 rounded-xl border border-danger/30 bg-surface px-3 py-2 text-[12px] leading-5 text-ink shadow-[var(--shadow-pop)]"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
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
      <Button
        size="sm"
        variant="ghost"
        className="pointer-events-auto shrink-0"
        aria-label="关闭错误消息"
        onClick={() => {
          if (onDismiss) onDismiss();
          else setDismissed(true);
        }}
      >
        关闭
      </Button>
    </div>
  );
}
