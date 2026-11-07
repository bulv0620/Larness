import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ApiCatalogGroup,
  type ApiCatalogModel,
  type ApiCredential,
  type ApiModelCatalog,
  createCredential,
  deleteCredential,
  getSession,
  listCredentials,
  listModelCatalog,
  refreshModelCatalog,
  setModelVisibility,
  updateSession,
} from "@/lib/workspaceApi";
import { useNavigationStore } from "@/stores/navigationStore";

type View = { kind: "list" } | { kind: "key"; credentialId: string } | { kind: "add" };

function providerLabel(provider: ApiCatalogGroup["provider"]): string {
  if (provider === "glm") return "GLM";
  if (provider === "openai-compatible") return "兼容";
  return "DeepSeek";
}

function windowLabel(model: ApiCatalogModel): string {
  return model.contextWindow === null
    ? "窗口未知"
    : `${Math.round(model.contextWindow / 1024)}K 上下文`;
}

function thinkingLabel(model: ApiCatalogModel): string {
  return model.thinking.supported
    ? `思考 ${model.thinking.levels.map((level) => level.label).join(" / ")}`
    : "不支持思考档位";
}

function syncLabel(group: ApiCatalogGroup): string {
  return group.syncedAt === null
    ? "尚未同步"
    : `同步于 ${new Date(group.syncedAt).toLocaleString("zh-CN", { hour12: false })}`;
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
  const [view, setView] = useState<View>({ kind: "list" });
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [catalog, setCatalog] = useState<ApiModelCatalog | null>(null);
  const [sessionModelId, setSessionModelId] = useState<string | null>(null);
  const [sessionCredentialId, setSessionCredentialId] = useState<string | null>(null);
  const [provider, setProvider] = useState<"deepseek" | "glm">("deepseek");
  const [label, setLabel] = useState("DeepSeek Key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = catalog?.groups ?? (catalog === null ? [] : [catalog]);
  const activeGroup =
    view.kind === "key"
      ? groups.find((group) => group.credentialProfileId === view.credentialId)
      : undefined;
  const credentialMask = (credentialId: string) =>
    credentials.find((credential) => credential.id === credentialId)?.masked ?? "";

  const reload = async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextCredentials, nextCatalog, session] = await Promise.all([
        listCredentials(),
        listModelCatalog().catch(() => null),
        sessionId ? getSession(sessionId) : Promise.resolve(null),
      ]);
      setCredentials(nextCredentials);
      setCatalog(nextCatalog);
      setSessionModelId(session?.model ?? null);
      setSessionCredentialId(session?.credentialProfileId ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载模型设置失败");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on open or session change
  useEffect(() => {
    if (!open) {
      setApiKey("");
      setView({ kind: "list" });
      return;
    }

    void reload();
  }, [open, sessionId]);

  const refresh = async () => {
    setBusy(true);
    setError(null);

    try {
      setCatalog(await refreshModelCatalog());
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新目录失败");
      setCatalog(await listModelCatalog().catch(() => null));
    } finally {
      setBusy(false);
    }
  };

  const selectModel = async (group: ApiCatalogGroup, model: ApiCatalogModel) => {
    if (!sessionId) {
      setError("先在左侧选择一个会话，再设置模型。");
      return;
    }

    if (model.contextWindow === null) {
      setError("该模型未声明上下文窗口，暂时不能选择。");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await updateSession(sessionId, {
        model: model.id,
        credentialProfileId: group.credentialProfileId,
      });
      setSessionModelId(model.id);
      setSessionCredentialId(group.credentialProfileId);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : "切换模型失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = async (group: ApiCatalogGroup, model: ApiCatalogModel) => {
    setBusy(true);
    setError(null);

    try {
      await setModelVisibility({
        credentialProfileId: group.credentialProfileId,
        modelId: model.id,
        visible: model.visible === false,
      });
      setCatalog(await listModelCatalog());
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (visibilityError) {
      setError(visibilityError instanceof Error ? visibilityError.message : "更新显示状态失败");
    } finally {
      setBusy(false);
    }
  };

  const addKey = async () => {
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
      await reload();
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
      setView({ kind: "list" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 Key 失败");
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (credentialId: string) => {
    setBusy(true);
    setError(null);

    try {
      await deleteCredential(credentialId);
      setView({ kind: "list" });
      await reload();
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "删除 Key 失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(660px,calc(100dvh-32px))] w-[min(820px,calc(100vw-32px))] flex-col overflow-hidden p-0">
        <header className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle>模型与凭据</DialogTitle>
            <DialogDescription>
              Key 只保存在本机；隐藏的模型不会出现在会话选择器里。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" aria-label="关闭模型设置">
              <X size={14} />
            </Button>
          </DialogClose>
        </header>

        {error ? (
          <p
            role="alert"
            className="shrink-0 border-b border-line px-4 py-2 text-[11px] text-danger"
          >
            {error}
          </p>
        ) : null}

        {view.kind === "list" ? (
          <>
            <div className="flex shrink-0 items-center justify-between px-4 py-2">
              <span className="text-[10.5px] font-semibold text-ink-3">提供方与 Key</span>
              <Button size="sm" variant="secondary" onClick={() => setView({ kind: "add" })}>
                <Plus size={12} />
                添加 Key
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
              {groups.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-3">
                  {credentials.length === 0
                    ? "还没有 Key。添加后即可同步官方模型目录。"
                    : "目录为空，先刷新一次。"}
                </p>
              ) : null}
              {groups.map((group) => (
                <button
                  key={group.credentialProfileId}
                  type="button"
                  onClick={() => setView({ kind: "key", credentialId: group.credentialProfileId })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
                    <KeyRound size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                      {providerLabel(group.provider)} · {group.credentialLabel}
                      <span className="font-mono text-[10px] text-ink-3">
                        {credentialMask(group.credentialProfileId)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-ink-3">
                      <span>{group.models.length} 个模型</span>
                      <span>·</span>
                      <span>{syncLabel(group)}</span>
                      {group.stale ? <span className="text-warning">· 待刷新</span> : null}
                    </span>
                  </span>
                  <ChevronRight size={13} className="shrink-0 text-ink-3" />
                </button>
              ))}
            </div>
            <footer className="shrink-0 border-t border-line px-4 py-2 text-[10.5px] text-ink-3">
              选择模型会保存到当前会话；隐藏状态只影响会话选择器。
            </footer>
          </>
        ) : null}

        {view.kind === "key" ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label="返回凭据列表"
                onClick={() => setView({ kind: "list" })}
              >
                <ArrowLeft size={13} />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">
                  {activeGroup
                    ? `${providerLabel(activeGroup.provider)} · ${activeGroup.credentialLabel}`
                    : "Key"}
                </p>
                <p className="text-[10px] text-ink-3">
                  {activeGroup ? syncLabel(activeGroup) : ""}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
                刷新目录
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="删除 Key"
                disabled={busy}
                onClick={() => void removeKey(view.credentialId)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {activeGroup === undefined ? (
                <p className="px-4 py-3 text-[11px] text-ink-3">目录不可用，请刷新。</p>
              ) : activeGroup.models.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-ink-3">
                  该 Key 还没有可用模型，点“刷新目录”同步。
                </p>
              ) : (
                activeGroup.models.map((model) => {
                  const selected =
                    model.id === sessionModelId &&
                    activeGroup.credentialProfileId === sessionCredentialId;
                  const disabled = model.contextWindow === null;
                  return (
                    <div
                      key={model.id}
                      className="flex items-center gap-2 border-b border-line/60 px-4 py-2 last:border-b-0"
                    >
                      <button
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => void selectModel(activeGroup, model)}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
                          {model.label}
                          {selected ? (
                            <span className="rounded-full bg-accent-soft px-1.5 py-[1px] text-[9px] text-accent">
                              当前会话
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-ink-3">
                          {windowLabel(model)} · {thinkingLabel(model)}
                          {disabled ? " · 不可选" : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={model.visible !== false}
                        aria-label={`${model.label} 在会话中显示`}
                        disabled={busy}
                        onClick={() => void toggleVisibility(activeGroup, model)}
                        className="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[10.5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                      >
                        {model.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                        {model.visible === false ? "隐藏" : "显示"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <footer className="shrink-0 border-t border-line px-4 py-2 text-[10.5px] text-ink-3">
              点模型名设为当前会话；眼睛图标控制是否出现在输入框选择器。
            </footer>
          </>
        ) : null}

        {view.kind === "add" ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label="返回凭据列表"
                onClick={() => setView({ kind: "list" })}
              >
                <ArrowLeft size={13} />
              </Button>
              <span className="text-[12.5px] font-semibold">添加 Key</span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex gap-1">
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
              <label className="block text-[10.5px] font-semibold text-ink-3">
                名称
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  aria-label="凭据名称"
                  className="mt-1 h-8 w-full rounded-lg border border-line bg-surface-2 px-2 text-[11px] font-normal text-ink outline-none focus:border-accent/40"
                />
              </label>
              <label className="block text-[10.5px] font-semibold text-ink-3">
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  aria-label="API Key"
                  placeholder="sk-…"
                  autoComplete="off"
                  className="mt-1 h-8 w-full rounded-lg border border-line bg-surface-2 px-2 font-mono text-[11px] font-normal text-ink outline-none focus:border-accent/40"
                />
              </label>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !apiKey.trim()}
                onClick={() => void addKey()}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                添加
              </Button>
            </div>
          </>
        ) : null}

        {loading ? (
          <p className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-[10.5px] text-ink-3">
            <Loader2 size={11} className="animate-spin" /> 正在读取…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
