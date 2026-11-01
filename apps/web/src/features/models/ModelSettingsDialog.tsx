import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import {
  type ApiCredential,
  type ApiProject,
  createCredential,
  deleteCredential,
  getProject,
  getSession,
  listCredentials,
  updateProject,
  updateSession,
} from "@/lib/workspaceApi";
import { useNavigationStore } from "@/stores/navigationStore";

export function ModelSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useSnapshot();
  const queryClient = useQueryClient();
  const sessionId = useNavigationStore((state) => state.sessionId);
  const projectId = useNavigationStore((state) => state.projectId);
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [sessionModelId, setSessionModelId] = useState<string | null>(null);
  const [label, setLabel] = useState("DeepSeek Key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setApiKey("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || USE_MOCKS) return;
    let disposed = false;
    setLoading(true);
    setError(null);

    void Promise.all([
      listCredentials(),
      sessionId ? getSession(sessionId) : Promise.resolve(null),
      projectId ? getProject(projectId) : Promise.resolve(null),
    ])
      .then(([nextCredentials, session, nextProject]) => {
        if (disposed) return;
        setCredentials(nextCredentials);
        setSessionModelId(session?.modelProfileId ?? null);
        setProject(nextProject);
      })
      .catch((loadError: unknown) => {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "加载设置失败");
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [open, projectId, sessionId]);

  const selectedModelId =
    sessionModelId ?? project?.settings.defaultModelProfileId ?? data.models[0]?.id ?? null;

  const saveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);

    try {
      await createCredential({
        provider: "deepseek",
        label: label.trim() || "DeepSeek Key",
        apiKey,
      });
      setApiKey("");
      setCredentials(await listCredentials());
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await deleteCredential(id);
      setCredentials(await listCredentials());
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "删除密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const selectModel = async (modelId: string): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      if (sessionId) {
        await updateSession(sessionId, { modelProfileId: modelId });
        setSessionModelId(modelId);
      } else if (projectId) {
        await updateProject(projectId, {
          settings: { defaultModelProfileId: modelId },
        });
        setProject((current) =>
          current === null
            ? current
            : {
                ...current,
                settings: { ...current.settings, defaultModelProfileId: modelId },
              },
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : "切换模型失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,calc(100vw-40px))]">
        <DialogTitle>设置与模型</DialogTitle>
        <DialogDescription>
          密钥只保存在本机加密存储中，接口与日志不会返回明文。模型切换只影响下一轮。
        </DialogDescription>

        <section className="mt-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
            <KeyRound size={12} /> 凭据
          </div>
          <div className="mt-2 space-y-1.5">
            {credentials.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-3">
                还没有密钥。添加 DeepSeek Key 后，下一轮对话即可使用。
              </p>
            ) : (
              credentials.map((credential) => (
                <div
                  key={credential.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">
                    {credential.label}
                    <span className="ml-1.5 font-mono text-[10px] text-ink-3">
                      {credential.masked}
                    </span>
                  </span>
                  <span className="rounded-full bg-surface px-1.5 py-[1px] text-[9px] text-ink-3">
                    {credential.provider}
                  </span>
                  <button
                    type="button"
                    aria-label={`删除 ${credential.label}`}
                    disabled={busy}
                    onClick={() => void removeKey(credential.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 grid grid-cols-[110px_1fr_auto] gap-1.5">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-label="凭据名称"
              className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[11px] outline-none focus:border-accent/40"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              aria-label="API Key"
              placeholder="sk-…"
              autoComplete="off"
              className="h-8 rounded-lg border border-line bg-surface-2 px-2 font-mono text-[11px] outline-none focus:border-accent/40"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !apiKey.trim()}
              onClick={() => void saveKey()}
            >
              添加
            </Button>
          </div>
        </section>

        <section className="mt-5">
          <div className="text-[11px] font-semibold text-ink-2">模型</div>
          <div className="mt-2 space-y-1.5">
            {data.models.map((model) => {
              const selected = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void selectModel(model.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? "border-accent/30 bg-accent-soft/70"
                      : "border-line bg-surface hover:bg-surface-2/60"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">
                      {model.label}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-ink-3">
                      {model.model} · {model.detail}
                    </span>
                  </span>
                  {selected ? <Check size={13} className="text-accent" /> : null}
                </button>
              );
            })}
          </div>
          {!sessionId ? (
            <p className="mt-1.5 text-[10px] text-ink-3">
              {projectId ? "将保存为当前项目的默认模型。" : "选择项目或会话后可设置默认模型。"}
            </p>
          ) : null}
        </section>

        {loading ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
            <Loader2 size={12} className="animate-spin" /> 正在读取设置…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger"
          >
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
