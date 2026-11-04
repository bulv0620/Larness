import { Files, GitBranch } from "lucide-react";
import { Fragment } from "react";
import { FileTreePanel } from "@/components/sections/FileTreePanel";
import { GitPanel } from "@/components/sections/GitPanel";
import { ResizableSection } from "@/components/sections/ResizableSection";
import { SectionSplitter } from "@/components/sections/SectionSplitter";
import { useSectionResizer } from "@/components/sections/useSectionResizer";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { unassignedWorkspaceLabel } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";

const initialSections = [
  { id: "files", title: "文件", size: 0.65, expanded: true },
  { id: "git", title: "Git", size: 0.35, expanded: true },
];

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
  const { sections, containerRef, toggle, onPointerDown, equalize, nudge } =
    useSectionResizer(initialSections);

  const counts = {
    files: USE_MOCKS ? (projectId === "prj_larness" ? 22 : 0) : undefined,
    git: projectChanges.length,
  };

  const expandedTotal = Math.max(
    0.0001,
    sections.reduce((sum, section) => sum + (section.expanded ? section.size : 0), 0),
  );

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

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        {sections.map((section, index) => {
          const next = sections[index + 1];
          return (
            <Fragment key={section.id}>
              <ResizableSection
                title={section.title}
                icon={icons[section.id as keyof typeof icons]}
                count={counts[section.id as keyof typeof counts]}
                expanded={section.expanded}
                size={section.size / expandedTotal}
                onToggle={() => toggle(section.id)}
              >
                {renderPanel(section.id)}
              </ResizableSection>

              {next?.expanded && section.expanded ? (
                <SectionSplitter
                  value={section.size / expandedTotal}
                  onPointerDown={(event) => onPointerDown(index, event)}
                  onDoubleClick={() => equalize(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      const step = event.shiftKey ? 64 : 16;
                      nudge(index, event.key === "ArrowDown" ? step : -step);
                    }
                  }}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </aside>
  );
}
