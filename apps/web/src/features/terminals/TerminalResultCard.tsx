import type { TerminalResultTarget } from "@larness/shared";
import { Button } from "@larness/ui";
import { SquareTerminal } from "lucide-react";
import { openAgentTerminal } from "./api";

export function TerminalResultCard({ target }: { target: TerminalResultTarget }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 shadow-[var(--shadow-card)]">
      <div className="flex h-11 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-[#30d158]/15 to-[#0a84ff]/5 text-success">
        <SquareTerminal size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-semibold text-ink">
          已启动 {target.role ?? "开发终端"}
        </div>
        <div className="truncate text-[10.5px] text-ink-2">项目终端</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-ink-3">{target.terminalId}</div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leading={<SquareTerminal size={11} />}
        onClick={() => openAgentTerminal(target, true)}
      >
        打开
      </Button>
    </div>
  );
}
