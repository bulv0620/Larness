import { SquareTerminal } from "lucide-react";
import { StatusDot } from "@/components/common/StatusDot";
import { TerminalPicker } from "@/features/terminals/TerminalPicker";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore } from "@/stores/windowStore";

export function TerminalsPanel({ projectId }: { projectId: string | null }) {
  const sessionId = useNavigationStore((state) => state.sessionId);
  if (!USE_MOCKS)
    return (
      <TerminalPicker
        projectId={projectId}
        sessionId={!projectId && sessionId.startsWith("ses_") ? sessionId : undefined}
      />
    );
  return <DemoTerminalsPanel projectId={projectId} />;
}
function DemoTerminalsPanel({ projectId }: { projectId: string | null }) {
  const { data } = useSnapshot();
  const open = useWindowStore((state) => state.open);
  const terminals = data.terminals.filter((terminal) => terminal.projectId === projectId);

  if (!terminals.length) {
    return <div className="px-2 py-3 text-[10.5px] text-ink-3">当前项目暂无终端</div>;
  }

  return (
    <div className="space-y-0.5 px-1.5">
      {terminals.map((terminal) => (
        <button
          key={terminal.id}
          type="button"
          onClick={() =>
            open({
              kind: "terminal",
              resourceId: terminal.id,
              title: terminal.title,
              projectId: terminal.projectId,
              source: "project",
            })
          }
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
        >
          <SquareTerminal size={14} strokeWidth={1.8} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium text-ink">
              {terminal.title}
            </span>
            <span className="block truncate font-mono text-[10px] text-ink-3">{terminal.cwd}</span>
          </span>
          <StatusDot tone={terminal.status === "running" ? "running" : "idle"} />
        </button>
      ))}
    </div>
  );
}
