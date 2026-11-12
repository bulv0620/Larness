import type { FileResultTarget, TurnFileResult } from "@larness/shared";
import { cn } from "@larness/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";

interface ProcessFilesRowProps {
  files: TurnFileResult[];
  targets: Map<string, FileResultTarget>;
}

/**
 * Files that were touched while working but are not deliverables: deleted
 * scratch files, ignored project paths and generated output. Collapsed by
 * default; still openable when the file exists and was authorized in the Turn.
 */
export function ProcessFilesRow({ files, targets }: ProcessFilesRowProps) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) {
    return null;
  }

  const deleted = files.filter((file) => !file.existed).length;
  const summary = `过程文件 ${files.length} 个${deleted > 0 ? ` · 已清理 ${deleted} 个` : ""}`;

  return (
    <div className="text-[11px] text-ink-3">
      <button
        type="button"
        aria-label={summary}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1 rounded-md py-0.5 text-left transition-colors hover:text-accent"
      >
        <ChevronRight size={12} className={cn("shrink-0", expanded && "rotate-90")} />
        <span>{summary}</span>
      </button>
      {expanded ? (
        <ul className="mt-1 ml-1.5 space-y-1 border-l border-line pl-3">
          {files.map((file) => {
            const target = targets.get(file.path);
            return (
              <li key={file.path} className="flex min-w-0 flex-wrap items-center gap-1.5">
                {file.existed && target !== undefined ? (
                  <FileResultCard target={target} />
                ) : (
                  <span className="break-all">{file.path}</span>
                )}
                <span className="shrink-0">
                  {file.changeType === "created" ? "已创建" : "已修改"}
                  {file.existed ? "" : " · 已删除"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
