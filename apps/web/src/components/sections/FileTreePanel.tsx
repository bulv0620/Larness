import { cn } from "@larness/ui";
import { ChevronDown, ChevronRight, FileCode2, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { fileTree } from "@/mocks/fixtures";
import { useWindowStore } from "@/stores/windowStore";

function iconFor(path: string) {
  if (path.endsWith(".md")) return FileText;
  return FileCode2;
}

export function FileTreePanel({ projectId }: { projectId: string | null }) {
  const open = useWindowStore((state) => state.open);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleDirectory = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const visible = fileTree.filter(
    (node) => ![...collapsed].some((directory) => node.path.startsWith(`${directory}/`)),
  );

  if (projectId !== "prj_larness") {
    return (
      <EmptyState
        icon={Folder}
        title="暂无文件预览"
        description="S0 只为 larness-web 准备了文件树 Mock；连接真实项目后按项目展示。"
        className="py-6"
      />
    );
  }

  return (
    <div className="space-y-px px-1.5">
      {visible.map((node) => {
        const Icon = node.type === "directory" ? Folder : iconFor(node.path);
        return (
          <button
            key={node.path}
            type="button"
            onClick={() => {
              if (node.type === "file") {
                open({
                  kind: "files",
                  resourceId: node.path,
                  title: node.name,
                  projectId,
                  source: "project",
                });
              } else {
                toggleDirectory(node.path);
              }
            }}
            className={cn(
              "flex h-[26px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] transition-colors",
              node.type === "directory"
                ? "text-ink-2 hover:bg-black/[.035] dark:hover:bg-white/[.05]"
                : "text-ink-2 hover:bg-accent-soft hover:text-ink",
            )}
            style={{ paddingLeft: 6 + node.depth * 12 }}
          >
            {node.type === "directory" ? (
              collapsed.has(node.path) ? (
                <ChevronRight size={11} className="shrink-0 text-ink-3" />
              ) : (
                <ChevronDown size={11} className="shrink-0 text-ink-3" />
              )
            ) : (
              <span className="w-[11px] shrink-0" />
            )}
            <Icon
              size={13}
              strokeWidth={1.75}
              className={cn("shrink-0", node.type === "directory" ? "text-warning" : "text-ink-3")}
            />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
