import type { TerminalInfo } from "@larness/shared";
import { LiveTerminalView } from "@/features/terminals/LiveTerminalView";
import { TerminalPicker } from "@/features/terminals/TerminalPicker";
import { TerminalView } from "@/features/windows/TerminalView";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import type { WindowTab } from "@/lib/windowTypes";

export function TerminalWindow({ tab }: { tab: WindowTab }) {
  if (!USE_MOCKS)
    return tab.resourceId === "terminal:empty" ? (
      <TerminalPicker projectId={tab.projectId} sessionId={tab.sourceSessionId ?? undefined} />
    ) : (
      <LiveTerminalView key={tab.resourceId} id={tab.resourceId} />
    );
  return <DemoTerminalWindow tab={tab} />;
}
function DemoTerminalWindow({ tab }: { tab: WindowTab }) {
  const { data } = useSnapshot();
  const terminal: TerminalInfo =
    data.terminals.find((item) => item.id === tab.resourceId) ?? data.terminals[0];

  return (
    <div className="flex h-full flex-col bg-[#0f1115]">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/[.06] px-3 font-mono text-[9.5px] text-white/45">
        <span className="truncate">{terminal?.cwd ?? "~"}</span>
        <span className="ml-auto flex items-center gap-1.5 text-success/80">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          running
        </span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <TerminalView terminal={terminal} />
      </div>
    </div>
  );
}
