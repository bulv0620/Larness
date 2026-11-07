import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { USE_MOCKS } from "@/lib/env";
import {
  type ApiCatalogModel,
  type ApiCredential,
  type ApiModelCatalog,
  createCredential,
  deleteCredential,
  getSession,
  listCredentials,
  listModelCatalog,
  refreshModelCatalog,
  updateSession,
} from "@/lib/workspaceApi";
import { useNavigationStore } from "@/stores/navigationStore";

function formatWindow(contextWindow: number | null): string {
  return contextWindow === null ? "上下文未知" : `${contextWindow.toLocaleString("en-US")} 上下文`;
}

function levelLabels(model: ApiCatalogModel): string {
  if (!model.thinking.supported || model.thinking.levels.length === 0) {
    return "不支持思考档位";
  }

  return `思考：${model.thinking.levels.map((level) => level.label).join(" / ")}`;
}

export function ModelSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const sessionId = useNavigationStore((state) => state.sessionId);
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [catalog, setCatalog] = useState<ApiModelCatalog | null>(null);
  const [sessionModelId, setSessionModelId] = useState<string | null>(null);
  const [sessionCredentialProfileId, setSessionCredentialProfileId] = useState<string | null>(null);
  const [provider, setProvider] = useState<"deepseek" | "glm">("deepseek");
  const [label, setLabel] = useState("DeepSeek Key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
      listModelCatalog().catch(() => null),
      sessionId ? getSession(sessionId) : Promise.resolve(null),
    ])
      .then(([nextCredentials, nextCatalog, session]) => {
        if (disposed) return;
        setCredentials(nextCredentials);
        setCatalog(nextCatalog);
        setSessionModelId(session?.model ?? null);
        setSessionCredentialProfileId(session?.credentialProfileId ?? null);
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
  }, [open, sessionId]);

  const groups = catalog?.groups ?? (catalog === null ? [] : [catalog]);
  const selectedGroup =
    groups.find(
      (group) =>
        sessionCredentialProfileId !== null &&
        group.credentialProfileId === sessionCredentialProfileId,
    ) ?? groups[0];
  const selectedModelId = sessionModelId ?? selectedGroup?.models[0]?.id ?? null;

  const saveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);

    try {
      await createCredential({
        provider,
        label: label.trim() || (provider === "glm" ? "GLM Key" : "DeepSeek Key"),
        apiKey,
      });
      setApiKey("");
      setCredentials(await listCredentials());
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
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
      setCatalog(await listModelCatalog().catch(() => null));
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "删除密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError(null);

    try {
      setCatalog(await refreshModelCatalog());
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新目录失败");
      setCatalog(await listModelCatalog().catch(() => null));
    } finally {
      setRefreshing(false);
    }
  };

  const selectModel = async (modelId: string, credentialProfileId: string): Promise<void> => {
    if (!sessionId) {
      setError("先在左侧选择一个会话，再设置模型。");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await updateSession(sessionId, { model: modelId, credentialProfileId });
      setSessionModelId(modelId);
      setSessionCredentialProfileId(credentialProfileId);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : "切换模型失败");
    } finally {
      setBusy(false);
    }
  };

  const syncedLabel =
    catalog?.syncedAt == null
      ? "尚未同步"
      : `同步于 ${new Date(catalog.syncedAt).toLocaleString("zh-CN", { hour12: false })}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,calc(100vw-40px))]">
        <DialogTitle>设置与模型</DialogTitle>
        <DialogDescription>
          密钥只保存在本机加密存储中，接口与日志不会返回明文。模型与思考档位只影响下一轮。
        </DialogDescription>

        <div className="mt-4 max-h-[min(64vh,620px)] overflow-y-auto pr-1">
          <section className="mt-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
              <KeyRound size={12} /> 凭据
            </div>
            <div className="mt-2 space-y-1.5">
              {credentials.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-3">
                  还没有密钥。添加 DeepSeek Key 后即可同步官方模型目录。
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

            <div className="mt-2 flex gap-1">
              {(["deepseek", "glm"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={provider === option}
                  onClick={() => {
                    setProvider(option);
                    setLabel(option === "glm" ? "GLM Key" : "DeepSeek Key");
                  }}
                  className={`h-7 rounded-lg px-2.5 text-[10.5px] transition-colors ${
                    provider === option
                      ? "bg-accent-soft text-accent"
                      : "bg-surface-2 text-ink-3 hover:text-ink"
                  }`}
                >
                  {option === "glm" ? "GLM" : "DeepSeek"}
                </button>
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-[110px_1fr_auto] gap-1.5">
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
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-ink-2">模型目录</div>
              <button
                type="button"
                disabled={refreshing || credentials.length === 0}
                onClick={() => void refresh()}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                {refreshing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                刷新
              </button>
            </div>
            <p className="mt-1 text-[10px] text-ink-3">
              {syncedLabel}
              {catalog?.stale ? " · 当前为上次成功同步的记录" : ""}
              {catalog?.lastRefreshError ? ` · 最近失败：${catalog.lastRefreshError}` : ""}
            </p>

            <div className="mt-2 space-y-1.5">
              {groups.length > 0 ? (
                groups.map((group) => (
                  <div key={group.credentialProfileId}>
                    <div className="px-0.5 pb-1 text-[10px] text-ink-3">
                      {group.provider === "glm"
                        ? "GLM"
                        : group.provider === "openai-compatible"
                          ? "兼容"
                          : "DeepSeek"}{" "}
                      · {group.credentialLabel}
                    </div>
                    {group.models.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[10.5px] text-ink-3">
                        该 Key 还没有可用模型，请刷新目录。
                      </p>
                    ) : (
                      group.models.map((model) => {
                        const selected =
                          model.id === selectedModelId &&
                          group.credentialProfileId === sessionCredentialProfileId;
                        return (
                          <button
                            key={`${group.credentialProfileId}:${model.id}`}
                            type="button"
                            disabled={busy || model.contextWindow === null}
                            onClick={() => void selectModel(model.id, group.credentialProfileId)}
                            className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                              selected
                                ? "border-accent/30 bg-accent-soft/70"
                                : model.contextWindow === null
                                  ? "cursor-not-allowed border-line bg-surface opacity-45"
                                  : "border-line bg-surface hover:bg-surface-2/60"
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11.5px] font-medium text-ink">
                                {model.label}
                              </span>
                              <span className="block truncate text-[10px] text-ink-3">
                                {formatWindow(model.contextWindow)} · {levelLabels(model)}
                              </span>
                            </span>
                            {selected ? <Check size={13} className="text-accent" /> : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-3">
                  {credentials.length === 0
                    ? "添加凭据后可同步官方目录。"
                    : "目录为空，点击刷新从官方端点同步。"}
                </p>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-3">
              {sessionId ? "选择会保存到当前会话。" : "选择会话后可将模型保存到该会话。"}
            </p>
          </section>
        </div>

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
