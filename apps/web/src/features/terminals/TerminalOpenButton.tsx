import { cn, ErrorMessage } from "@larness/ui";
import { SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ResultCard } from "@/features/chat/ResultCard";
import { ApiError } from "@/lib/api";
import { openTerminal, readTerminal, stopConfirmed } from "./api";

interface TerminalOpenButtonProps {
  terminalId: string;
  projectId: string | null;
  label: string;
  ariaLabel?: string;
  className?: string;
  variant?: "link" | "card";
}

export function TerminalOpenButton(props: TerminalOpenButtonProps) {
  return (
    <CheckedTerminalButton key={JSON.stringify([props.projectId, props.terminalId])} {...props} />
  );
}

function CheckedTerminalButton({
  terminalId,
  projectId,
  label,
  ariaLabel,
  className,
  variant = "link",
}: TerminalOpenButtonProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    return () => {
      generation.current += 1;
      pending.current = false;
    };
  }, []);
  const open = async () => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setBusy(true);
    setNotice(null);
    try {
      const row = await readTerminal(terminalId);
      if (request !== generation.current) return;
      if (row.id !== terminalId || row.projectId !== projectId) {
        setNotice({ text: "终端归属已变化，无法打开。", error: true });
      } else if (stopConfirmed(row)) {
        setNotice({ text: "终端已关闭" });
      } else if (row.status === "RUNNING") {
        openTerminal(row);
      } else {
        setNotice({
          text:
            row.status === "STOPPING"
              ? "终端正在关闭，请稍后重试。"
              : row.status === "CREATED"
                ? "终端正在创建，请稍后重试。"
                : "终端状态异常，请核对状态后重试。",
        });
      }
    } catch (error) {
      if (request !== generation.current) return;
      setNotice(
        error instanceof ApiError && error.status === 404
          ? { text: "终端已关闭或已被清理" }
          : { text: "无法读取终端状态，请重试。", error: true },
      );
    } finally {
      if (request === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="min-w-0">
      {variant === "card" ? (
        <ResultCard
          icon={SquareTerminal}
          label={`终端 · ${label.replace(/^打开终端 · /, "")}`}
          ariaLabel={ariaLabel ?? label}
          disabled={busy}
          onClick={() => void open()}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          aria-label={ariaLabel}
          aria-busy={busy}
          onClick={() => void open()}
          className={cn(
            "flex max-w-full items-center gap-2 py-1 text-left text-[12px] text-ink-2 hover:text-ink disabled:opacity-50",
            className,
          )}
        >
          <SquareTerminal size={13} className="shrink-0 text-accent" />
          <span className="break-all">{label}</span>
        </button>
      )}
      {notice?.error ? (
        <ErrorMessage message={notice.text} onDismiss={() => setNotice(null)} />
      ) : notice ? (
        <p role="status" className="mt-1 text-[11px] text-ink-3">
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
