import { cn } from "@harness/ui";
import { Check, GitCompare, Plus, Trash2 } from "lucide-react";
import type { WindowTab } from "@/lib/windowTypes";
import { diffLines, gitChanges } from "@/mocks/fixtures";

export function DiffView({ tab }: { tab: WindowTab }) {
  const change = gitChanges.find((item) => item.path === tab.resourceId);
  const path = change?.path ?? tab.resourceId;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <GitCompare size={14} className="text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">{path}</span>
        <span className="font-mono text-[9.5px] text-success">+{change?.additions ?? 0}</span>
        <span className="font-mono text-[9.5px] text-danger">-{change?.deletions ?? 0}</span>
        <span className="ml-1 rounded-full border border-line bg-surface-2 px-1.5 py-[1px] text-[9px] text-ink-3">
          working tree
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[10.5px] leading-[19px]">
        {diffLines.map((line, index) => {
          const lineNumber = index + 1;
          return (
            <div
              key={`${line.type}_${index}`}
              className={cn(
                "flex min-w-max",
                line.type === "add" && "bg-success/[.08]",
                line.type === "remove" && "bg-danger/[.07]",
              )}
            >
              <span className="w-10 shrink-0 select-none border-r border-line/70 px-2 text-right text-ink-3/50">
                {lineNumber}
              </span>
              <span
                className={cn(
                  "w-5 shrink-0 select-none text-center",
                  line.type === "add"
                    ? "text-success"
                    : line.type === "remove"
                      ? "text-danger"
                      : "text-transparent",
                )}
              >
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span
                className={cn(
                  "whitespace-pre pr-6",
                  line.type === "add"
                    ? "text-ink"
                    : line.type === "remove"
                      ? "text-ink-2"
                      : "text-ink-2",
                )}
              >
                {line.text || " "}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-surface-2/40 px-3 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <Check size={11} className="text-success" />
          版本校验通过
        </span>
        <span className="flex items-center gap-1">
          <Plus size={11} className="text-success" />
          新增
        </span>
        <span className="flex items-center gap-1">
          <Trash2 size={11} className="text-danger" />
          删除
        </span>
        <span className="ml-auto font-mono">expectedVersion · 7f3a…</span>
      </div>
    </div>
  );
}
