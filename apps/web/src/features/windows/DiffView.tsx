import type { GitDiffView } from "@larness/shared";
import { cn, ErrorMessage } from "@larness/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, GitCompare, Loader2, Plus, Trash2 } from "lucide-react";
import { readGitDiff } from "@/features/git/api";
import { USE_MOCKS } from "@/lib/env";
import type { WindowTab } from "@/lib/windowTypes";
import { diffLines, gitChanges } from "@/mocks/fixtures";

export function DiffView({ tab }: { tab: WindowTab }) {
  if (!USE_MOCKS) return <RealDiffView tab={tab} />;
  return <DemoDiffView tab={tab} />;
}

function RealDiffView({ tab }: { tab: WindowTab }) {
  const projectId = tab.projectId;
  const git = tab.git;
  const query = useQuery({
    queryKey: ["git", "diff", projectId, git?.path, git?.staged],
    queryFn: () => readGitDiff(projectId ?? "", git?.path ?? "", git?.staged === true),
    enabled: projectId !== null && git !== undefined,
    retry: false,
  });
  if (projectId === null || git === undefined)
    return <p className="p-4 text-xs text-ink-3">Diff 目标缺少项目或路径，请重新打开。</p>;
  if (query.isPending)
    return (
      <p className="flex items-center gap-2 p-4 text-xs text-ink-3">
        <Loader2 size={12} className="animate-spin" /> 读取 Diff…
      </p>
    );
  if (query.isError)
    return (
      <ErrorMessage
        message="差异读取失败，请重新打开或重试。"
        retry={{ label: "重新读取", run: () => void query.refetch() }}
      />
    );
  const data: GitDiffView = query.data;
  return <DiffBody data={data} />;
}

function DiffBody({ data }: { data: GitDiffView }) {
  const lines = data.binary ? [] : data.diff.split("\n");
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <GitCompare size={14} className="text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">
          {data.path}
        </span>
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-[1px] text-[9px] text-ink-3">
          {data.staged ? "已暂存" : "工作区"}
        </span>
      </div>
      {data.binary ? (
        <p className="p-4 text-xs text-ink-3">
          二进制文件不显示文本 Diff；仍可按显式路径暂存 / 提交。
        </p>
      ) : data.truncated ? (
        <p className="p-4 text-xs text-warning">Diff 超过 1 MiB，已截断；不自动写入或覆盖文件。</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[10.5px] leading-[19px]">
          {lines.map((line, index) => (
            <div
              key={`${index}_${line.slice(0, 16)}`}
              className={cn(
                "flex min-w-max whitespace-pre",
                line.startsWith("+") && !line.startsWith("+++") && "bg-success/[.08]",
                line.startsWith("-") && !line.startsWith("---") && "bg-danger/[.07]",
              )}
            >
              <span className="w-5 shrink-0 select-none text-center text-ink-3/70">
                {line.startsWith("+") && !line.startsWith("+++")
                  ? "+"
                  : line.startsWith("-") && !line.startsWith("---")
                    ? "-"
                    : " "}
              </span>
              <span className="whitespace-pre pr-6 text-ink-2">{line || " "}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-surface-2/40 px-3 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <Check size={11} className="text-success" />
          只读 Diff
        </span>
        <span className="flex items-center gap-1">
          <Plus size={11} className="text-success" />
          新增
        </span>
        <span className="flex items-center gap-1">
          <Trash2 size={11} className="text-danger" />
          删除
        </span>
      </div>
    </div>
  );
}

function DemoDiffView({ tab }: { tab: WindowTab }) {
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
        {diffLines.map((line, index) => (
          <div
            key={`${line.type}_${index}`}
            className={cn(
              "flex min-w-max",
              line.type === "add" && "bg-success/[.08]",
              line.type === "remove" && "bg-danger/[.07]",
            )}
          >
            <span className="w-10 shrink-0 select-none border-r border-line/70 px-2 text-right text-ink-3/50">
              {index + 1}
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
            <span className="whitespace-pre pr-6 text-ink-2">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
