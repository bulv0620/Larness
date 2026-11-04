import { ChevronDown, Files, GitBranch } from "lucide-react";
import { useState } from "react";
import { FileTreePanel } from "@/components/sections/FileTreePanel";
import { GitPanel } from "@/components/sections/GitPanel";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { unassignedWorkspaceLabel } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";

const icons = {
  files: Files,
  git: GitBranch,
} as const;

export function ProjectResourceSidebar() {
  const { data } = useSnapshot();
  const projectId = useNavigationStore((state) => state.projectId);
  const sessionId = useNavigationStore((state) => state.sessionId);
  const resourceWidth = useNavigationStore((state) => state.resourceWidth);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const projectChanges = projectId === "prj_larness" ? data.gitChanges : [];
  const [expanded, setExpanded] = useState<string | null>("files");
  const counts = {
    files: USE_MOCKS ? (projectId === "prj_larness" ? 22 : 0) : undefined,
    git: USE_MOCKS ? projectChanges.length : undefined,
  };

  const renderPanel = (id: string) => {
    if (id === "files") return <FileTreePanel projectId={projectId} />;
    return <GitPanel projectId={projectId} />;
  };

  return (
    <aside
      aria-label="项目资源"
      className="hidden shrink-0 bg-surface/40 xl:flex xl:flex-col"
      style={{ width: resourceWidth }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
          项目资源
        </span>
        <span className="ml-auto max-w-[140px] truncate rounded-full bg-black/[.045] px-1.5 py-[1px] text-[9.5px] font-medium text-ink-3 dark:bg-white/[.06]">
          {project?.name ?? unassignedWorkspaceLabel(sessionId, data.sessions)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        {(["files", "git"] as const).map((id) => {
          const Icon = icons[id];
          const active = expanded === id;
          return (
            <section
              key={id}
              className="flex min-h-0 flex-col overflow-hidden transition-[flex-grow] duration-200 motion-reduce:transition-none"
              style={{ flexGrow: active ? 1 : 0, flexBasis: 36, flexShrink: 0 }}
            >
              <button
                type="button"
                aria-expanded={active}
                aria-controls={`resource-${id}`}
                onClick={() => setExpanded(active ? null : id)}
                className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] font-medium text-ink-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon size={14} className="text-ink-3" />
                <span>{id === "files" ? "文件" : "Git"}</span>
                {typeof counts[id] === "number" ? (
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px]">{counts[id]}</span>
                ) : null}
                <ChevronDown
                  size={13}
                  className={`ml-auto text-ink-3 transition-transform duration-200 motion-reduce:transition-none ${active ? "" : "-rotate-90"}`}
                />
              </button>
              <div
                id={`resource-${id}`}
                inert={!active}
                aria-hidden={!active}
                className={`min-h-0 flex-1 overflow-auto transition-opacity duration-200 motion-reduce:transition-none ${active ? "opacity-100" : "opacity-0"}`}
              >
                {renderPanel(id)}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
