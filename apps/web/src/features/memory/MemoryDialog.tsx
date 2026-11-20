import type { MemoryBudget, MemoryDto } from "@larness/shared";
import {
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  ErrorMessage,
  FormSelect,
  Input,
  Textarea,
} from "@larness/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Pin, PinOff, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AdminDialogShell, AdminEmptyState } from "@/components/common/AdminDialogShell";
import { operationError } from "@/lib/api";
import { getProject, updateProject } from "@/lib/workspaceApi";
import {
  createGlobalMemory,
  createProjectMemory,
  forgetGlobalMemory,
  forgetProjectMemory,
  listGlobalMemories,
  listProjectMemories,
  memoryKeys,
  restoreGlobalMemory,
  restoreProjectMemory,
  updateGlobalMemory,
  updateProjectMemory,
} from "./api";

type Scope = "project" | "global";

export interface MemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  initialScope?: Scope;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function budgetPercent(budget: MemoryBudget): number {
  return Math.min(
    100,
    Math.round((budget.activeBytes / Math.max(1, budget.limits.activeBytes)) * 100),
  );
}

function StatusPill({ status }: { status: MemoryDto["status"] }) {
  const tone =
    status === "active"
      ? "text-success border-success/30 bg-success/10"
      : status === "review"
        ? "text-warning border-warning/30 bg-warning/10"
        : status === "evicted"
          ? "text-ink-3 border-line bg-surface-2"
          : "text-ink-3 border-line bg-surface-2";
  return (
    <span className={cn("rounded-full border px-1.5 py-[1px] text-[9px]", tone)}>{status}</span>
  );
}

export function MemoryDialog({
  open,
  onOpenChange,
  projectId,
  initialScope = "project",
}: MemoryDialogProps) {
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId ?? ""),
    enabled: open && projectId !== null,
  });
  const memoryEnabled = projectQuery.data?.settings.memory?.enabled ?? true;
  const globalEnabled = projectQuery.data?.settings.memory?.globalEnabled ?? true;
  const [scope, setScope] = useState<Scope>(projectId === null ? "global" : initialScope);
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState("fact");
  const [newKey, setNewKey] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState<MemoryDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(projectId === null ? "global" : initialScope);
    setSelectedId(null);
    setCreating(false);
    setError(null);
  }, [open, projectId, initialScope]);

  const list = useQuery({
    queryKey:
      scope === "project" && projectId !== null
        ? memoryKeys.projectList(projectId, { status })
        : memoryKeys.globalList({ status }),
    queryFn: () =>
      scope === "project" && projectId !== null
        ? listProjectMemories(projectId, { status, limit: 200 })
        : listGlobalMemories({ status, limit: 200 }),
    enabled: open && (scope === "global" || projectId !== null),
  });

  const items = list.data?.items ?? [];
  const budget = list.data?.budget;
  const selected = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selected === null) {
      setTitle("");
      setBody("");
      return;
    }
    setTitle(selected.title);
    setBody(selected.body);
  }, [selected]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: memoryKeys.all });
  };

  const mutation = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    retry: false,
    onMutate: () => setError(null),
    onError: (cause) => setError(operationError(cause, "记忆操作失败")),
    onSettled: refresh,
  });

  const run = (task: () => Promise<unknown>): void => {
    mutation.mutate(task);
  };

  const toggleSetting = (key: "enabled" | "globalEnabled"): void => {
    if (projectId === null) return;
    const next =
      key === "enabled"
        ? { enabled: !memoryEnabled, globalEnabled }
        : { enabled: memoryEnabled, globalEnabled: !globalEnabled };
    run(async () => {
      await updateProject(projectId, { settings: { memory: next } });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    });
  };

  const saveSelected = (): void => {
    if (selected === null) return;
    const patch = {
      title: title.trim(),
      body: body.trim(),
      expectedUpdatedAt: selected.updatedAt,
    };
    run(() =>
      selected.scope === "global"
        ? updateGlobalMemory(selected.id, patch)
        : updateProjectMemory(projectId ?? "", selected.id, patch),
    );
  };

  const togglePin = (item: MemoryDto): void => {
    run(() =>
      item.scope === "global"
        ? updateGlobalMemory(item.id, { pinned: !item.pinned, expectedUpdatedAt: item.updatedAt })
        : updateProjectMemory(projectId ?? "", item.id, {
            pinned: !item.pinned,
            expectedUpdatedAt: item.updatedAt,
          }),
    );
  };

  const setReview = (item: MemoryDto, next: "active" | "rejected"): void => {
    run(() =>
      item.scope === "global"
        ? updateGlobalMemory(item.id, { status: next, expectedUpdatedAt: item.updatedAt })
        : updateProjectMemory(projectId ?? "", item.id, {
            status: next,
            expectedUpdatedAt: item.updatedAt,
          }),
    );
  };

  const create = (): void => {
    const input = {
      kind: scope === "global" ? "preference" : newKind,
      key: newKey.trim(),
      title: newTitle.trim(),
      body: newBody.trim(),
    };
    run(async () => {
      if (scope === "global") await createGlobalMemory(input);
      else await createProjectMemory(projectId ?? "", input);
      setCreating(false);
      setNewKey("");
      setNewTitle("");
      setNewBody("");
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <AdminDialogShell
          icon={Brain}
          title="记忆与偏好"
          description="管理项目记忆与跨项目用户偏好"
          closeLabel="关闭记忆与偏好"
          count={budget?.activeCount}
          actions={
            <div className="flex shrink-0 items-center gap-1 rounded-lg bg-surface-2 p-0.5">
              {(["project", "global"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  disabled={entry === "project" && projectId === null}
                  onClick={() => {
                    setScope(entry);
                    setSelectedId(null);
                    setCreating(false);
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[10.5px] disabled:opacity-40",
                    scope === entry ? "bg-surface text-ink shadow-sm" : "text-ink-3",
                  )}
                >
                  {entry === "project" ? "项目记忆" : "跨项目偏好"}
                </button>
              ))}
            </div>
          }
        >
          {error ? (
            <div className="shrink-0 px-5 pt-3">
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
            </div>
          ) : null}

          {budget ? (
            <div className="shrink-0 border-b border-line px-5 py-2.5">
              {projectId !== null ? (
                <div className="mb-2 flex flex-wrap items-center gap-4 text-[10px] text-ink-3">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={memoryEnabled}
                      onChange={() => toggleSetting("enabled")}
                    />
                    启用项目记忆
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={globalEnabled}
                      onChange={() => toggleSetting("globalEnabled")}
                    />
                    允许跨项目偏好
                  </label>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-[10px] text-ink-3">
                <span>
                  active {budget.activeCount} 条 · {formatBytes(budget.activeBytes)} /{" "}
                  {formatBytes(budget.limits.activeBytes)}
                </span>
                <span>
                  总占用 {formatBytes(budget.totalBytes)} / {formatBytes(budget.limits.totalBytes)}{" "}
                  · review {budget.reviewCount}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full",
                    budgetPercent(budget) >= 90 ? "bg-danger" : "bg-accent",
                  )}
                  style={{ width: `${budgetPercent(budget)}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 w-[46%] min-w-0 flex-col border-r border-line">
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
                <FormSelect
                  label="状态"
                  value={status}
                  options={[
                    { value: "active", label: "active" },
                    { value: "review", label: "review" },
                    { value: "evicted", label: "evicted" },
                  ]}
                  onValueChange={setStatus}
                />
                <Button
                  size="sm"
                  variant="soft"
                  leading={<Plus size={12} />}
                  disabled={scope === "project" && projectId === null}
                  onClick={() => {
                    setCreating(true);
                    setSelectedId(null);
                  }}
                >
                  手动添加
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
                {list.isLoading ? (
                  <div role="status" className="px-2 py-6 text-center text-[11px] text-ink-3">
                    正在读取记忆…
                  </div>
                ) : items.length === 0 ? (
                  <AdminEmptyState
                    icon={Brain}
                    title="还没有记忆"
                    hint="Agent 会在发现稳定事实时自动学习。"
                    compact
                  />
                ) : (
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setCreating(false);
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left",
                        item.id === selectedId
                          ? "border-accent/40 bg-accent-soft/60"
                          : "border-transparent hover:border-line hover:bg-surface-2",
                      )}
                    >
                      <div className="flex w-full items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-ink">
                          {item.title}
                        </span>
                        {item.pinned ? <Pin size={10} className="shrink-0 text-accent" /> : null}
                        <span className="ml-auto shrink-0">
                          <StatusPill status={item.status} />
                        </span>
                      </div>
                      <div className="flex w-full items-center gap-1.5 text-[9.5px] text-ink-3">
                        <span className="rounded bg-surface-2 px-1">{item.kind}</span>
                        <span className="truncate font-mono">{item.key}</span>
                        {item.stale ? <span className="text-warning">stale</span> : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-5">
              {creating ? (
                <div className="space-y-3">
                  <div className="text-[12px] font-medium text-ink">手动添加记忆</div>
                  {scope === "project" ? (
                    <Field label="类型">
                      <FormSelect
                        label="类型"
                        value={newKind}
                        options={[
                          { value: "fact", label: "fact" },
                          { value: "command", label: "command" },
                          { value: "gotcha", label: "gotcha" },
                          { value: "decision", label: "decision" },
                        ]}
                        onValueChange={setNewKind}
                      />
                    </Field>
                  ) : null}
                  <Field label="key">
                    <Input
                      value={newKey}
                      onChange={(event) => setNewKey(event.target.value)}
                      placeholder="build.test.command"
                    />
                  </Field>
                  <Field label="标题">
                    <Input
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      placeholder="测试命令"
                    />
                  </Field>
                  <Field label="内容">
                    <Textarea
                      value={newBody}
                      onChange={(event) => setNewBody(event.target.value)}
                      className="h-32 resize-y font-mono"
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setCreating(false)}>
                      取消
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={
                        mutation.isPending ||
                        newKey.trim().length === 0 ||
                        newTitle.trim().length === 0 ||
                        newBody.trim().length === 0
                      }
                      onClick={create}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : selected === null ? (
                <div className="flex h-full items-center justify-center text-center text-[11px] text-ink-3">
                  选择一条记忆查看来源、使用情况与修订。
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusPill status={selected.status} />
                        <span className="text-[10px] text-ink-3">{selected.kind}</span>
                        <span className="truncate font-mono text-[10px] text-ink-3">
                          {selected.key}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-ink-3">
                        来源 {selected.sourceTurnId ?? "用户创建"} · 使用 {selected.useCount} 次 ·
                        修订 {selected.revisionCount} · 置信度 {selected.confidence.toFixed(2)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        leading={selected.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                        onClick={() => togglePin(selected)}
                      >
                        {selected.pinned ? "取消固定" : "固定"}
                      </Button>
                      {selected.status === "evicted" ? (
                        <Button
                          size="sm"
                          variant="soft"
                          leading={<RotateCcw size={12} />}
                          onClick={() =>
                            run(() =>
                              selected.scope === "global"
                                ? restoreGlobalMemory(selected.id)
                                : restoreProjectMemory(projectId ?? "", selected.id),
                            )
                          }
                        >
                          恢复
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          leading={<Trash2 size={12} />}
                          onClick={() => setConfirmForget(selected)}
                        >
                          忘记
                        </Button>
                      )}
                    </div>
                  </div>

                  {selected.status === "review" ? (
                    <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2">
                      <span className="text-[10.5px] text-ink-2">这条记忆需要确认。</span>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setReview(selected, "active")}
                      >
                        接受
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setReview(selected, "rejected")}
                      >
                        拒绝
                      </Button>
                    </div>
                  ) : null}

                  <Field label="标题">
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                  </Field>
                  <Field label="内容">
                    <Textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      className="h-40 resize-y font-mono"
                    />
                  </Field>
                  <div className="flex items-center justify-between text-[10px] text-ink-3">
                    <span>
                      更新 {new Date(selected.updatedAt).toLocaleString()}
                      {selected.expiresAt
                        ? ` · 过期 ${new Date(selected.expiresAt).toLocaleDateString()}`
                        : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="primary"
                      leading={<Save size={12} />}
                      disabled={mutation.isPending}
                      onClick={saveSelected}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </AdminDialogShell>
      </Dialog>

      <ConfirmDialog
        open={confirmForget !== null}
        title="忘记这条记忆"
        description={`“${confirmForget?.title ?? ""}”将不再注入上下文，并在 90 天内不会被重新学习。`}
        confirmLabel="忘记"
        danger
        pending={mutation.isPending}
        onCancel={() => setConfirmForget(null)}
        onConfirm={() => {
          const target = confirmForget;
          if (target === null) return;
          setConfirmForget(null);
          run(() =>
            target.scope === "global"
              ? forgetGlobalMemory(target.id, target.updatedAt)
              : forgetProjectMemory(projectId ?? "", target.id, target.updatedAt),
          );
        }}
        overlayClassName="z-[310]"
        className="z-[311]"
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 block space-y-1 border-0 p-0">
      <legend className="p-0 text-[10px] text-ink-3">{label}</legend>
      {children}
    </fieldset>
  );
}
