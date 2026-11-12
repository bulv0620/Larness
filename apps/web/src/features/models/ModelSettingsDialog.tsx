import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
  FormSelect,
  Input,
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
import { useEffect, useId, useState } from "react";
import { operationError } from "@/lib/api";
import {
  type ApiCatalogGroup,
  type ApiCatalogModel,
  type ApiCredential,
  type ApiModelCatalog,
  createCredential,
  deleteCredential,
  listCredentials,
  listModelCatalog,
  refreshModelCatalog,
  setModelDefault,
  setModelVisibility,
  updateCredentialEndpoint,
  updateCredentialSettings,
} from "@/lib/workspaceApi";

type View = { kind: "list" } | { kind: "key"; credentialId: string } | { kind: "add" };

const GLM_ENDPOINT_OPTIONS = [
  { value: "https://open.bigmodel.cn/api/paas/v4", label: "标准 · 国内" },
  { value: "https://open.bigmodel.cn/api/coding/paas/v4", label: "Coding Plan · 国内" },
  { value: "https://api.z.ai/api/paas/v4", label: "标准 · 国际" },
  { value: "https://api.z.ai/api/coding/paas/v4", label: "Coding Plan · 国际" },
] as const;

const DEFAULT_GLM_ENDPOINT = GLM_ENDPOINT_OPTIONS[0].value;

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
  if (!model.thinking.supported) return "不支持思考档位";
  const mode = model.thinking.mode ?? "levels";
  if (mode === "toggle") return "思考 开 / 关";
  if (mode === "mandatory-levels") return "思考 低 / 中 / 高（强制）";
  return "思考 低 / 中 / 高";
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
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: "list" });
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [catalog, setCatalog] = useState<ApiModelCatalog | null>(null);
  const [provider, setProvider] = useState<"deepseek" | "glm" | "openai-compatible">("deepseek");
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_GLM_ENDPOINT);
  const [compatEndpoint, setCompatEndpoint] = useState("");
  const [compatWindowK, setCompatWindowK] = useState("128");
  const [endpointDraft, setEndpointDraft] = useState("");
  const [windowDraft, setWindowDraft] = useState("128");
  const [label, setLabel] = useState("DeepSeek Key");
  const [apiKey, setApiKey] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = catalog?.groups ?? (catalog === null ? [] : [catalog]);
  const defaultSelection = catalog?.defaultSelection ?? null;
  const activeGroup =
    view.kind === "key"
      ? groups.find((group) => group.credentialProfileId === view.credentialId)
      : undefined;
  const models = activeGroup
    ? activeGroup.models.filter((model) => showUnavailable || model.contextWindow !== null)
    : [];
  const unavailableCount = activeGroup
    ? activeGroup.models.filter((model) => model.contextWindow === null).length
    : 0;
  const credentialMask = (credentialId: string) =>
    credentials.find((credential) => credential.id === credentialId)?.masked ?? "";
  const credentialEndpoint = (credentialId: string) =>
    credentials.find((credential) => credential.id === credentialId)?.endpoint ?? null;
  const activeCredential =
    view.kind === "key"
      ? credentials.find((credential) => credential.id === view.credentialId)
      : undefined;

  const reload = async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextCredentials, nextCatalog] = await Promise.all([
        listCredentials(),
        listModelCatalog().catch(() => null),
      ]);
      setCredentials(nextCredentials);
      setCatalog(nextCatalog);
    } catch (loadError) {
      setError(operationError(loadError, "加载模型设置失败"));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on open
  useEffect(() => {
    if (!open) {
      setApiKey("");
      setShowUnavailable(false);
      setConfirmRemove(false);
      setView({ kind: "list" });
      return;
    }

    void reload();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync drafts when the key changes
  useEffect(() => {
    if (activeCredential?.provider !== "openai-compatible") return;
    setEndpointDraft(activeCredential.endpoint ?? "");
    setWindowDraft(
      String(Math.max(1, Math.round((activeCredential.contextWindow ?? 128_000) / 1024))),
    );
  }, [activeCredential?.id, activeCredential?.endpoint, activeCredential?.contextWindow]);

  const refresh = async (savedCredentialId?: string) => {
    setBusy(true);
    setError(null);

    try {
      const nextCatalog = await refreshModelCatalog();
      setCatalog(nextCatalog);
      const savedGroup = nextCatalog.groups.find(
        (group) => group.credentialProfileId === savedCredentialId,
      );
      if (savedCredentialId && (!savedGroup || savedGroup.lastRefreshError)) {
        setError("Key 已保存，目录同步失败。请打开该 Key 后重试刷新。");
      }
    } catch (refreshError) {
      setError(
        savedCredentialId
          ? "Key 已保存，目录同步失败。请打开该 Key 后重试刷新。"
          : operationError(refreshError, "刷新目录失败"),
      );
      const cachedCatalog = await listModelCatalog().catch(() => null);
      if (cachedCatalog) setCatalog(cachedCatalog);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
      setBusy(false);
    }
  };

  const makeDefault = async (group: ApiCatalogGroup, model: ApiCatalogModel) => {
    if (model.contextWindow === null) {
      setError("该模型未声明上下文窗口，暂时不能设为默认。");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await setModelDefault({
        model: model.id,
        credentialProfileId: group.credentialProfileId,
      });
      setCatalog(await listModelCatalog());
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (modelError) {
      setError(operationError(modelError, "设置默认模型失败"));
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
      setError(operationError(visibilityError, "更新显示状态失败"));
    } finally {
      setBusy(false);
    }
  };

  const addKey = async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const saved = await createCredential({
        provider,
        label: label.trim() || (provider === "glm" ? "GLM Key" : "DeepSeek Key"),
        apiKey,
        ...(provider === "glm" ? { endpoint } : {}),
        ...(provider === "openai-compatible"
          ? {
              endpoint: compatEndpoint.trim(),
              contextWindow: Math.max(1, Number(compatWindowK) || 128) * 1024,
            }
          : {}),
      });
      setApiKey("");
      await reload();
      await refresh(saved.id);
      setView({ kind: "list" });
    } catch (saveError) {
      setError(operationError(saveError, "保存 Key 失败"));
    } finally {
      setBusy(false);
    }
  };

  const changeEndpoint = async (credentialId: string, next: string) => {
    setBusy(true);
    setError(null);

    try {
      await updateCredentialEndpoint(credentialId, next);
      await reload();
      await refresh();
    } catch (endpointError) {
      setError(operationError(endpointError, "更新端点失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveCompatible = async (credentialId: string) => {
    setBusy(true);
    setError(null);

    try {
      await updateCredentialSettings(credentialId, {
        endpoint: endpointDraft.trim(),
        contextWindow: Math.max(1, Number(windowDraft) || 128) * 1024,
      });
      await reload();
      await refresh();
    } catch (saveError) {
      setError(operationError(saveError, "保存兼容端点失败"));
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (credentialId: string) => {
    setBusy(true);
    setError(null);

    try {
      await deleteCredential(credentialId);
      setConfirmRemove(false);
      setView({ kind: "list" });
      await reload();
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (removeError) {
      setError(operationError(removeError, "删除 Key 失败"));
    } finally {
      setConfirmRemove(false);
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

        <ErrorMessage message={error} onDismiss={() => setError(null)} />

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
                      {group.provider === "glm" ? (
                        <span className="rounded bg-surface-2 px-1 py-[1px]">
                          {(
                            credentialEndpoint(group.credentialProfileId) ?? DEFAULT_GLM_ENDPOINT
                          ).includes("/coding/")
                            ? "Coding"
                            : "标准"}
                        </span>
                      ) : null}
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
              默认模型用于新会话；会话内可在输入框切换到其他可见模型。
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
              {activeGroup?.provider === "glm" ? (
                <FormSelect
                  label="GLM 端点"
                  value={activeCredential?.endpoint ?? DEFAULT_GLM_ENDPOINT}
                  disabled={busy}
                  onValueChange={(value) => void changeEndpoint(view.credentialId, value)}
                  options={GLM_ENDPOINT_OPTIONS}
                  className="h-7 w-auto text-[10.5px]"
                />
              ) : null}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
                刷新目录
              </Button>
              {unavailableCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={showUnavailable}
                  aria-label={showUnavailable ? "隐藏不可用模型" : "显示不可用模型"}
                  onClick={() => setShowUnavailable((value) => !value)}
                >
                  {showUnavailable ? "隐藏不可用" : `显示不可用 (${unavailableCount})`}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label="删除 Key"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            {activeGroup?.provider === "openai-compatible" ? (
              <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-line px-4 py-2">
                <label
                  htmlFor={`${fieldId}-endpoint-edit`}
                  className="block min-w-0 flex-1 text-[10px] font-semibold text-ink-3"
                >
                  端点 URL
                  <Input
                    id={`${fieldId}-endpoint-edit`}
                    value={endpointDraft}
                    onChange={(event) => setEndpointDraft(event.target.value)}
                    aria-label="兼容端点 URL"
                    className="mt-1 h-7 font-mono text-[10.5px]"
                  />
                </label>
                <label
                  htmlFor={`${fieldId}-window-edit`}
                  className="block w-24 text-[10px] font-semibold text-ink-3"
                >
                  窗口（K）
                  <Input
                    id={`${fieldId}-window-edit`}
                    value={windowDraft}
                    onChange={(event) => setWindowDraft(event.target.value)}
                    aria-label="兼容上下文窗口（K）"
                    inputMode="numeric"
                    className="mt-1 h-7 font-mono text-[10.5px]"
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !endpointDraft.trim()}
                  onClick={() => void saveCompatible(view.credentialId)}
                >
                  保存
                </Button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {activeGroup === undefined ? (
                <p className="px-4 py-3 text-[11px] text-ink-3">目录不可用，请刷新。</p>
              ) : models.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-ink-3">
                  {activeGroup.models.length === 0
                    ? "该 Key 还没有可用模型，点“刷新目录”同步。"
                    : "暂无可选模型；可显示不可用项查看原因。"}
                </p>
              ) : (
                models.map((model) => {
                  const selected =
                    model.id === defaultSelection?.model &&
                    activeGroup.credentialProfileId === defaultSelection.credentialProfileId;
                  const disabled = model.contextWindow === null;
                  return (
                    <div
                      key={model.id}
                      className="flex items-center gap-2 border-b border-line/60 px-4 py-2 last:border-b-0"
                    >
                      <button
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => void makeDefault(activeGroup, model)}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
                          {model.label}
                          {selected ? (
                            <span className="rounded-full bg-accent-soft px-1.5 py-[1px] text-[9px] text-accent">
                              默认
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
              点模型名设为新会话默认；眼睛图标控制是否出现在输入框选择器。
            </footer>
            <Dialog
              open={confirmRemove}
              onOpenChange={(value) => (!value && !busy ? setConfirmRemove(false) : undefined)}
            >
              <DialogContent className="w-[min(400px,calc(100vw-40px))] space-y-3 text-sm">
                <DialogTitle>删除 Key？</DialogTitle>
                <DialogDescription>
                  {activeGroup
                    ? `${providerLabel(activeGroup.provider)} · ${activeGroup.credentialLabel}`
                    : "该 Key"}{" "}
                  会从本机移除，对应模型也会从选择器中消失；此操作不可撤销。
                </DialogDescription>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirmRemove(false)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void removeKey(view.credentialId)}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                    删除
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
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
                {(["deepseek", "glm", "openai-compatible"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={provider === option}
                    onClick={() => {
                      setProvider(option);
                      setLabel(
                        option === "glm"
                          ? "GLM Key"
                          : option === "openai-compatible"
                            ? "兼容 Key"
                            : "DeepSeek Key",
                      );
                    }}
                    className={`h-7 rounded-lg px-2.5 text-[10.5px] transition-colors ${
                      provider === option
                        ? "bg-accent-soft text-accent"
                        : "bg-surface-2 text-ink-3 hover:text-ink"
                    }`}
                  >
                    {option === "glm"
                      ? "GLM"
                      : option === "openai-compatible"
                        ? "兼容"
                        : "DeepSeek"}
                  </button>
                ))}
              </div>
              {provider === "glm" ? (
                <div className="block text-[10.5px] font-semibold text-ink-3">
                  端点
                  <FormSelect
                    label="GLM 端点"
                    value={endpoint}
                    onValueChange={setEndpoint}
                    options={GLM_ENDPOINT_OPTIONS}
                    className="mt-1"
                  />
                </div>
              ) : null}
              {provider === "openai-compatible" ? (
                <>
                  <label
                    htmlFor={`${fieldId}-endpoint`}
                    className="block text-[10.5px] font-semibold text-ink-3"
                  >
                    端点 URL
                    <Input
                      id={`${fieldId}-endpoint`}
                      value={compatEndpoint}
                      onChange={(event) => setCompatEndpoint(event.target.value)}
                      aria-label="兼容端点 URL"
                      placeholder="https://api.example.com/v1"
                      className="mt-1 font-mono text-[11px]"
                    />
                  </label>
                  <label
                    htmlFor={`${fieldId}-window`}
                    className="block text-[10.5px] font-semibold text-ink-3"
                  >
                    上下文窗口（K）
                    <Input
                      id={`${fieldId}-window`}
                      value={compatWindowK}
                      onChange={(event) => setCompatWindowK(event.target.value)}
                      aria-label="兼容上下文窗口（K）"
                      inputMode="numeric"
                      className="mt-1 font-mono text-[11px]"
                    />
                  </label>
                </>
              ) : null}
              <label
                htmlFor={`${fieldId}-credential-name`}
                className="block text-[10.5px] font-semibold text-ink-3"
              >
                名称
                <Input
                  id={`${fieldId}-credential-name`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  aria-label="凭据名称"
                  className="mt-1 text-[11px]"
                />
              </label>
              <label
                htmlFor={`${fieldId}-api-key`}
                className="block text-[10.5px] font-semibold text-ink-3"
              >
                API Key
                <Input
                  id={`${fieldId}-api-key`}
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  aria-label="API Key"
                  placeholder="sk-…"
                  autoComplete="off"
                  className="mt-1 font-mono text-[11px]"
                />
              </label>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  busy ||
                  !apiKey.trim() ||
                  (provider === "openai-compatible" && !compatEndpoint.trim())
                }
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
