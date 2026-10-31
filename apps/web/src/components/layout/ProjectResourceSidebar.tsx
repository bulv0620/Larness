import { IconButton } from "@harness/ui";
import { Files, GitBranch, MoreHorizontal, Plus, Server, SquareTerminal } from "lucide-react";
import { Fragment } from "react";
import { FileTreePanel } from "@/components/sections/FileTreePanel";
import { GitPanel } from "@/components/sections/GitPanel";
import { ResizableSection } from "@/components/sections/ResizableSection";
import { SectionSplitter } from "@/components/sections/SectionSplitter";
import { ServicesPanel } from "@/components/sections/ServicesPanel";
import { TerminalsPanel } from "@/components/sections/TerminalsPanel";
import { useSectionResizer } from "@/components/sections/useSectionResizer";
import { useSnapshot } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";

const initialSections = [
  { id: "files", title: "文件", size: 0.34, expanded: true },
  { id: "services", title: "服务", size: 0.22, expanded: true },
  { id: "terminals", title: "终端", size: 0.22, expanded: true },
  { id: "git", title: "Git", size: 0.22, expanded: true },
];

export function ProjectResourceSidebar() {
  const { data } = useSnapshot();
  const projectId = useNavigationStore((state) => state.projectId);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const projectServices = data.services.filter((service) => service.projectId === projectId);
  const projectTerminals = data.terminals.filter((terminal) => terminal.projectId === projectId);
  const projectChanges = projectId === "prj_harness" ? data.gitChanges : [];
  const { sections, containerRef, toggle, onPointerDown, equalize, nudge } =
    useSectionResizer(initialSections);

  return (
    <aside
      aria-label="项目资源"
      className="hidden w-[340px] shrink-0 border-l border-line bg-surface/40 xl:flex xl:flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
          项目资源
        </span>
        <span className="rounded-full bg-black/[.045] px-1.5 py-[1px] text-[9.5px] font-medium text-ink-3 dark:bg-white/[.06]">
          {project?.name ?? "未选择项目"}
        </span>
        <div className="ml-auto flex items-center">
          <IconButton label="新建资源" className="h-6 w-6">
            <Plus size={13} />
          </IconButton>
          <IconButton label="资源操作" className="h-6 w-6">
            <MoreHorizontal size={14} />
          </IconButton>
        </div>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        {sections.map((section, index) => {
          const next = sections[index + 1];
          return (
            <Fragment key={section.id}>
              <ResizableSection
                title={section.title}
                icon={
                  section.id === "files"
                    ? Files
                    : section.id === "services"
                      ? Server
                      : section.id === "terminals"
                        ? SquareTerminal
                        : GitBranch
                }
                count={
                  section.id === "files"
                    ? projectId === "prj_harness"
                      ? 22
                      : 0
                    : section.id === "services"
                      ? projectServices.length
                      : section.id === "terminals"
                        ? projectTerminals.length
                        : projectChanges.length
                }
                expanded={section.expanded}
                size={section.size}
                onToggle={() => toggle(section.id)}
              >
                {section.id === "files" ? <FileTreePanel projectId={projectId} /> : null}
                {section.id === "services" ? <ServicesPanel projectId={projectId} /> : null}
                {section.id === "terminals" ? <TerminalsPanel projectId={projectId} /> : null}
                {section.id === "git" ? <GitPanel projectId={projectId} /> : null}
              </ResizableSection>

              {next?.expanded && section.expanded ? (
                <SectionSplitter
                  value={section.size}
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
