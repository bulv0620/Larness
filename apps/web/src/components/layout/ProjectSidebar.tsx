import { DEFAULT_PROJECT_ID } from "@larness/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  FolderPlus,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { useLogout } from "@/features/auth/useAuth";
import { RenameSessionDialog } from "@/features/chat/RenameSessionDialog";
import { ModelSettingsDialog } from "@/features/models/ModelSettingsDialog";
import { ProjectDialog } from "@/features/projects/ProjectDialog";
import { RenameProjectDialog } from "@/features/projects/RenameProjectDialog";
import { USE_MOCKS } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { useSnapshot } from "@/lib/queries";
import { useNewSession } from "@/lib/useNewSession";
import { archiveSession, deleteProject } from "@/lib/workspaceApi";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

type ContextTarget =
  | { kind: "project"; id: string; title: string; x: number; y: number }
  | { kind: "session"; id: string; title: string; x: number; y: number };

type SidebarDialog =
  | { kind: "rename-session"; id: string; title: string }
  | { kind: "rename-project"; id: string; title: string }
  | { kind: "archive-session"; id: string; title: string }
  | { kind: "remove-project"; id: string; title: string }
  | null;

export function ProjectSidebar({ mobile = false }: { mobile?: boolean }) {
  const { data } = useSnapshot();
  const {
    projectId,
    sessionId,
    draftSession,
    sidebarWidth,
    expandedProjects,
    toggleProject,
    selectSession,
    startDraft,
  } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const newSession = useNewSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const focusComposer = useNavigationStore((state) => state.focusComposer);
  const [query, setQuery] = useState("");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [context, setContext] = useState<ContextTarget | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog>(null);

  useEffect(() => {
    if (context === null) return;

    const close = () => setContext(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContext(null);
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [context]);

  const openContext = (
    event: React.MouseEvent,
    kind: "project" | "session",
    id: string,
    title: string,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "project" && id === DEFAULT_PROJECT_ID) {
      setContext(null);
      return;
    }
    setContext({ kind, id, title, x: event.clientX, y: event.clientY });
  };

  const sessions = useMemo(
    () => [...(USE_MOCKS ? extra : []), ...data.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [extra, data.sessions],
  );

  const newProjectSession = (projectId: string): void => {
    startDraft(projectId === DEFAULT_PROJECT_ID ? null : projectId);
    focusComposer();
  };

  const activeSession = sessions.find((item) => item.id === sessionId);
  const defaultSelected =
    projectId === null && (!activeSession || activeSession.workspaceKind === "default");
  const normalized = query.trim().toLowerCase();
  const projects = data.projects.map((project) => ({
    ...project,
    sessions: sessions.filter((session) =>
      project.kind === "default"
        ? session.workspaceKind === "default"
        : session.projectId === project.id,
    ),
  }));
  const visibleProjects = normalized
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(normalized) ||
          project.sessions.some((session) => session.title.toLowerCase().includes(normalized)),
      )
    : projects;
  const recent = sessions
    .filter(
      (session) =>
        !normalized ||
        session.title.toLowerCase().includes(normalized) ||
        (session.projectId &&
          data.projects
            .find((project) => project.id === session.projectId)
            ?.name.toLowerCase()
            .includes(normalized)),
    )
    .slice(0, 6);

  return (
    <aside
      className={cn(
        "shrink-0 flex-col bg-surface/45",
        mobile ? "flex h-full bg-surface" : "hidden md:flex",
      )}
      style={{ width: mobile ? 268 : sidebarWidth }}
      aria-label="项目与会话导航"
    >
      <div className="px-2.5 pt-3">
        <button
          type="button"
          onClick={newSession}
          className="group flex h-8 w-full items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:border-accent/30 hover:bg-accent-soft"
        >
          <Plus size={14} className="text-accent" />
          <span>新建会话</span>
          <Kbd className="ml-auto group-hover:border-accent/20">⌘K</Kbd>
        </button>
      </div>

      <div className="px-2.5 pt-2.5">
        <label className="flex h-7 items-center gap-1.5 rounded-lg bg-black/[.035] px-2 text-ink-3 transition-colors focus-within:bg-surface focus-within:ring-1 focus-within:ring-accent/30 dark:bg-white/[.05]">
          <Search size={12.5} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目或会话"
            className="h-full w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-3"
            aria-label="搜索项目或会话"
          />
        </label>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        <div className="flex items-center px-2 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
          项目
          {!USE_MOCKS ? (
            <button
              type="button"
              onClick={() => setProjectDialogOpen(true)}
              aria-label="添加项目"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
            >
              <FolderPlus size={12} />
            </button>
          ) : null}
        </div>

        {visibleProjects.map((project) => {
          const expanded = expandedProjects[project.id] ?? true;
          const isDefault = project.kind === "default";
          const navigationProjectId = isDefault ? null : project.id;
          const hasDraft = draftSession?.projectId === navigationProjectId;
          return (
            <div key={project.id} data-project-id={project.id} className="mb-0.5">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={isDefault ? "默认工作区" : undefined}
                  aria-pressed={isDefault ? defaultSelected : undefined}
                  onClick={() => {
                    if (isDefault && !defaultSelected) {
                      startDraft(null);
                      focusComposer();
                    } else toggleProject(project.id);
                  }}
                  onContextMenu={(event) => openContext(event, "project", project.id, project.name)}
                  aria-expanded={expanded}
                  className="flex h-[27px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]"
                >
                  {expanded ? (
                    <ChevronDown size={11} className="text-ink-3" />
                  ) : (
                    <ChevronRight size={11} className="text-ink-3" />
                  )}
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-[4px]"
                    style={{ backgroundColor: `${project.accent}18`, color: project.accent }}
                  >
                    <Folder size={10} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  {isDefault ? (
                    <span className="text-[9px] text-ink-3">内置</span>
                  ) : project.git ? (
                    <span className="font-mono text-[9px] text-ink-3">
                      {project.branch ?? "git"}
                    </span>
                  ) : (
                    <span className="text-[9px] text-ink-3">no git</span>
                  )}
                </button>
                {!USE_MOCKS ? (
                  <button
                    type="button"
                    aria-label={`在 ${project.name} 中新建会话`}
                    onClick={() => newProjectSession(project.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink dark:hover:bg-white/[.08]"
                  >
                    <Plus size={11} />
                  </button>
                ) : null}
              </div>

              {expanded ? (
                <div className="ml-[13px] border-l border-line/70 pl-1">
                  {hasDraft ? (
                    <SessionRow
                      title="新会话"
                      draft
                      active={draftSession?.id === sessionId}
                      running={false}
                      onClick={() => startDraft(navigationProjectId)}
                    />
                  ) : null}
                  {project.sessions.length ? (
                    project.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        title={session.title}
                        active={session.id === sessionId}
                        running={session.id === sessionId && isStreaming}
                        onClick={() => selectSession(session.id, navigationProjectId)}
                        onContextMenu={(event) =>
                          openContext(event, "session", session.id, session.title)
                        }
                      />
                    ))
                  ) : hasDraft ? null : (
                    <div className="px-2 py-1 text-[10.5px] text-ink-3">暂无会话</div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {visibleProjects.length === 0 ? (
          <div className="mx-1 rounded-lg border border-dashed border-line px-2.5 py-3 text-[10.5px] text-ink-3">
            {normalized
              ? "没有匹配的项目或会话"
              : "还没有登记项目。点击项目标题旁的 + 添加本机目录。"}
          </div>
        ) : null}

        <div className="mt-3 flex items-center px-2 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
          最近
          <span className="ml-auto font-normal normal-case tracking-normal text-ink-3/70">
            {recent.length}
          </span>
        </div>
        {recent.map((session) => {
          const project = data.projects.find((item) => item.id === session.projectId);
          return (
            <button
              key={`recent_${session.id}`}
              type="button"
              onClick={() => selectSession(session.id, session.projectId)}
              onContextMenu={(event) => openContext(event, "session", session.id, session.title)}
              className={cn(
                "group flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                session.id === sessionId
                  ? "bg-accent-soft/70 text-ink"
                  : "text-ink-2 hover:bg-black/[.035] dark:hover:bg-white/[.05]",
              )}
            >
              <span className="flex items-center gap-1.5">
                {session.id === sessionId && isStreaming ? (
                  <StatusDot tone="running" pulse />
                ) : (
                  <Clock3 size={11} className="shrink-0 text-ink-3" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                  {session.title}
                </span>
              </span>
              <span className="flex items-center gap-1.5 pl-[17px] text-[9.5px] text-ink-3">
                <span className="truncate">
                  {project?.name ??
                    (session.workspaceKind === "default" ? "默认工作区" : "独立会话")}
                </span>
                <span>·</span>
                <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line px-2 py-2">
        <BottomItem icon={Zap} label="自动化任务" />
        <BottomItem
          icon={Settings}
          label="设置与模型"
          onClick={USE_MOCKS ? undefined : () => setSettingsOpen(true)}
        />
        <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.035] dark:hover:bg-white/[.05]">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd60a] to-[#ff9f0a] text-[10px] font-semibold text-[#1d1d1f]">
            B
            <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-success ring-2 ring-surface" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-medium text-ink">bulv</div>
            <div className="truncate text-[9.5px] text-ink-3">本机操作者</div>
          </div>
          {USE_MOCKS ? (
            <UserRound size={13} className="text-ink-3" />
          ) : (
            <button
              type="button"
              aria-label="退出登录"
              title="退出登录"
              data-testid="logout-button"
              onClick={() => void logout()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.06] hover:text-danger dark:hover:bg-white/[.08]"
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>

      {context ? (
        <div
          role="menu"
          aria-label="会话或项目操作"
          onPointerDown={(event) => event.stopPropagation()}
          className="fixed z-[220] w-[184px] rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          style={{
            left: Math.min(context.x, window.innerWidth - 196),
            top: Math.min(context.y, window.innerHeight - 112),
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog({
                kind: context.kind === "project" ? "rename-project" : "rename-session",
                id: context.id,
                title: context.title,
              });
              setContext(null);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] text-ink-2 hover:bg-black/[.045] hover:text-ink dark:hover:bg-white/[.07]"
          >
            <Pencil size={13} className="text-ink-3" />
            {context.kind === "project" ? "重命名项目" : "重命名会话"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog({
                kind: context.kind === "project" ? "remove-project" : "archive-session",
                id: context.id,
                title: context.title,
              });
              setContext(null);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] text-danger hover:bg-danger/10"
          >
            {context.kind === "project" ? <Trash2 size={13} /> : <Archive size={13} />}
            {context.kind === "project" ? "移除项目" : "归档会话"}
          </button>
        </div>
      ) : null}

      <RenameSessionDialog
        session={dialog?.kind === "rename-session" ? { id: dialog.id, title: dialog.title } : null}
        open={dialog?.kind === "rename-session"}
        onClose={() => setDialog(null)}
      />
      <RenameProjectDialog
        project={dialog?.kind === "rename-project" ? { id: dialog.id, name: dialog.title } : null}
        open={dialog?.kind === "rename-project"}
        onClose={() => setDialog(null)}
      />
      <ConfirmActionDialog
        open={dialog?.kind === "archive-session"}
        title="归档会话"
        description={`“${dialog?.title ?? ""}”将从列表中隐藏，工作目录与源码不会被删除。`}
        confirmLabel="归档"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== "archive-session") return;
          await archiveSession(dialog.id);
          await queryClient.invalidateQueries({ queryKey: ["workspace"] });
          if (dialog.id === sessionId) selectSession("", null);
          setDialog(null);
        }}
      />
      <ConfirmActionDialog
        open={dialog?.kind === "remove-project"}
        title="移除项目"
        description={`仅移除“${dialog?.title ?? ""}”的登记，不会删除本地源码；项目内会话会变成独立会话。`}
        confirmLabel="移除项目"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== "remove-project") return;
          await deleteProject(dialog.id);
          await queryClient.invalidateQueries({ queryKey: ["workspace"] });
          if (dialog.id === projectId) selectSession("", null);
          setDialog(null);
        }}
      />

      <ProjectDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} />
      {!USE_MOCKS ? (
        <ModelSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </aside>
  );
}

function SessionRow({
  title,
  active,
  running,
  draft = false,
  onClick,
  onContextMenu,
}: {
  title: string;
  active: boolean;
  running: boolean;
  draft?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex h-[26px] w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] transition-colors",
        active
          ? "bg-accent-soft font-medium text-ink"
          : "text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]",
      )}
    >
      <StatusDot tone={running ? "running" : active ? "info" : "idle"} pulse={running} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {draft ? (
        <span className="shrink-0 rounded bg-black/[.045] px-1 py-[1px] text-[8.5px] text-ink-3 dark:bg-white/[.07]">
          草稿
        </span>
      ) : null}
    </button>
  );
}

function BottomItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Zap;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={onClick === undefined}
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-black/[.035] hover:text-ink disabled:cursor-default disabled:opacity-60 dark:hover:bg-white/[.05]"
    >
      <Icon size={13.5} strokeWidth={1.75} className="text-ink-3" />
      <span>{label}</span>
    </button>
  );
}

function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await onConfirm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
