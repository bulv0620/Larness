import type { TerminalResultTarget } from "@larness/shared";
import { TerminalOpenButton } from "./TerminalOpenButton";

export function TerminalResultCard({ target }: { target: TerminalResultTarget }) {
  return (
    <TerminalOpenButton
      terminalId={target.terminalId}
      projectId={target.projectId}
      label={`打开终端 · ${target.role ?? target.terminalId}`}
    />
  );
}
