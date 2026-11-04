import type { TerminalResultTarget } from "@larness/shared";
import { SquareTerminal } from "lucide-react";
import { openAgentTerminal } from "./api";

export function TerminalResultCard({ target }: { target: TerminalResultTarget }) {
  return (
    <button
      type="button"
      onClick={() => openAgentTerminal(target, true)}
      className="flex max-w-full items-center gap-2 py-1 text-left text-[12px] text-ink-2 hover:text-ink"
    >
      <SquareTerminal size={13} className="shrink-0" />
      <span className="break-all">打开终端 · {target.role ?? target.terminalId}</span>
    </button>
  );
}
