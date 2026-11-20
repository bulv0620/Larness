import { Toast } from "./toast";

interface ErrorMessageProps {
  message?: string | null;
  onDismiss?: () => void;
  retry?: { label: string; run: () => void };
}

/**
 * Error-tone alias of `Toast`, kept for existing call sites. New code should
 * render `Toast` directly and choose the tone.
 */
export function ErrorMessage({ message, onDismiss, retry }: ErrorMessageProps) {
  return <Toast message={message ?? null} tone="error" retry={retry} onDismiss={onDismiss} />;
}
