import type { TerminalInfo } from "@harness/shared";
import { useState } from "react";
import { TerminalView } from "@/features/windows/TerminalView";
import { useSnapshot } from "@/lib/queries";
import type { WindowTab } from "@/lib/windowTypes";

export function TerminalWindow({ tab }: { tab: WindowTab }) {
  const { data } = useSnapshot();
  const [filter, setFilter] = useState("all");
  const terminal: TerminalInfo =
    data.terminals.find((item) => item.id === tab.resourceId) ?? data.terminals[0];

  return (
    <div className="flex h-full flex-col bg-[#0f1115]">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/[.06] px-3 font-mono text-[9.5px] text-white/45">
        <span className="truncate">{terminal?.cwd ?? "~"}</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="终端项目筛选"
          className="ml-auto h-5 rounded border border-white/[.08] bg-white/[.04] px-1 text-[9px] text-white/60 outline-none"
        >
          <option value="all">全部项目</option>
          <option value="prj_harness">harness-web</option>
          <option value="global">全局终端</option>
        </select>
        <span className="flex items-center gap-1.5 text-success/80">
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
