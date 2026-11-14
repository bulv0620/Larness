import {
  Button,
  ConfirmDialog,
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
  type ApiModelPreset,
  createCredential,
  deleteCredential,
  listCredentials,
  listModelCatalog,
  listModelPresets,
  type ModelCapabilityOverride,
  refreshModelCatalog,
  setCapabilityOverride,
  setModelDefault,
  setModelVisibility,
  testModelConnection,
  updateCredentialSettings,
} from "@/lib/workspaceApi";

type View = { kind: "list" } | { kind: "key"; credentialId: string } | { kind: "add" };

import { billingLabel, modelRows, providerLabel } from "./catalogView";

function windowLabel(model: ApiCatalogModel): string {
  return model.contextWindow === null
    ? model.capabilities?.maxInputTokens === undefined
      ? "窗口未知"
      : `${Math.round(model.capabilities.maxInputTokens / 1024)}K 最大输入`
    : `${Math.round(model.contextWindow / 1024)}K 上下文`;
}

function thinkingLabel(model: ApiCatalogModel): string {
  if (!model.thinking.supported) return "不支持思考档位";
  const mode = model.thinking.mode ?? "levels";
  if (mode === "toggle") return "思考 开 / 关";
  const levels = model.thinking.levels.map((level) => level.label).join(" / ");
  return mode === "mandatory-levels" ? `思考 ${levels}（强制）` : `思考 ${levels}`;
}

function syncLabel(group: ApiCatalogGroup): string {
  if (group.candidatesOnly && group.syncedAt !== null) return "候选目录 · 调用待验证";
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
  const [presets, setPresets] = useState<ApiModelPreset[]>([]);
  const [platform, setPlatform] = useState("deepseek");
  const [presetId, setPresetId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [tab, setTab] = useState<"connections" | "models">("connections");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    connection: string;
    modelId: string;
    window: string;
    tools: string;
    thinking?: ModelCapabilityOverride["thinking"];
    pictures?: string;
    original?: ModelCapabilityOverride;
    existing?: boolean;
  }>();
  const [verified, setVerified] = useState<string>();
  const platformPresets = presets.filter((preset) => preset.provider === platform);
  const selectedPreset =
    platformPresets.find((preset) => preset.id === presetId) ??
    (platformPresets.length === 1 ? platformPresets[0] : undefined);
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
    ? activeGroup.models.filter(
        (model) => showUnavailable || (model.agentSelectable ?? model.contextWindow !== null),
      )
    : [];
  const unavailableCount = activeGroup
    ? activeGroup.models.filter((model) => !(model.agentSelectable ?? model.contextWindow !== null))
        .length
    : 0;
  const credentialMask = (credentialId: string) =>
    credentials.find((credential) => credential.id === credentialId)?.masked ?? "";
  const activeCredential =
    view.kind === "key"
      ? credentials.find((credential) => credential.id === view.credentialId)
      : undefined;

  const reload = async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextCredentials, nextCatalog, nextPresets] = await Promise.all([
        listCredentials(),
        listModelCatalog().catch(() => null),
        listModelPresets(),
      ]);
      setCredentials(nextCredentials);
      setCatalog(nextCatalog);
      setPresets(nextPresets);
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
      setTab("connections");
      setEditing(undefined);
      setVerified(undefined);
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

  const refresh = async (
    credentialProfileId?: string,
    saved = false,
    includePublicDirectory = false,
  ) => {
    setBusy(true);
    setError(null);

    try {
      const nextCatalog = await refreshModelCatalog({
        credentialProfileId,
        ...(includePublicDirectory ? { includePublicDirectory } : {}),
      });
      setCatalog(nextCatalog);
      const savedGroup = nextCatalog.groups.find(
        (group) => group.credentialProfileId === credentialProfileId,
      );
      if (credentialProfileId && (!savedGroup || savedGroup.lastRefreshError)) {
        setError(
          saved
            ? "Key 已保存，目录同步失败。请打开该 Key 后重试刷新。"
            : "目录同步失败，请检查连接。",
        );
      } else if (nextCatalog.directoryStatus === "unavailable") {
        setError("公共能力目录暂不可用，已保留缓存。");
      }
    } catch (refreshError) {
      setError(
        saved
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
    if (model.visible === false) return;
    if (!(model.agentSelectable ?? model.contextWindow !== null)) {
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
    if (!apiKey.trim() || !selectedPreset) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await createCredential({
        presetId: selectedPreset.id,
        label: label.trim() || selectedPreset.label,
        apiKey: apiKey.trim(),
        ...(platform === "openai-compatible" || selectedPreset.fields?.includes("endpoint")
          ? { endpoint: compatEndpoint.trim() }
          : {}),
        ...(platform === "openai-compatible"
          ? { contextWindow: Math.max(1, Number(compatWindowK) || 128) * 1024 }
          : {}),
        ...(selectedPreset.fields?.includes("workspaceId")
          ? { workspaceId: workspaceId.trim() }
          : {}),
      });
      setApiKey("");
      await reload();
      await refresh(
        saved.id,
        true,
        selectedPreset.provider === "opencode-go" ||
          selectedPreset.provider === "kimi" ||
          selectedPreset.provider === "bailian",
      );
      setView({ kind: "list" });
    } catch (saveError) {
      setError(operationError(saveError, "保存 Key 失败"));
    } finally {
      setBusy(false);
    }
  };

  const editConnection = async (credential: ApiCredential) => {
    setBusy(true);
    setError(null);
    try {
      await updateCredentialSettings(credential.id, {
        label: label.trim(),
        revision: credential.revision,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const rotated = apiKey.trim().length > 0;
      setApiKey("");
      setVerified(undefined);
      await reload();
      if (rotated) await refresh(credential.id, true);
    } catch (saveError) {
      setError(operationError(saveError, "更新连接失败"));
    } finally {
      setBusy(false);
    }
  };

  const editModel = (connection: string, model: ApiCatalogModel) => {
    const original: ModelCapabilityOverride = {};
    if (model.sources?.maxInputTokens === "user")
      original.maxInputTokens = model.capabilities?.maxInputTokens;
    if (model.sources?.maxOutputTokens === "user")
      original.maxOutputTokens = model.capabilities?.maxOutputTokens;

    if (model.sources?.outputModalities === "user")
      original.outputModalities = model.capabilities?.outputModalities;
    if (model.sources?.streaming === "user") original.streaming = model.capabilities?.streaming;
    setEditing({
      connection,
      modelId: model.id,
      existing: true,
      original,
      thinking:
        model.sources?.thinking === "user"
          ? model.thinking.supported
            ? (model.thinking.mode ?? "levels")
            : "off"
          : undefined,
      pictures:
        model.sources?.inputModalities === "user"
          ? model.capabilities?.inputModalities?.includes("image")
            ? "yes"
            : "no"
          : "",
      window: model.sources?.contextWindow === "user" ? String(model.contextWindow) : "",
      tools: model.sources?.tools === "user" ? (model.capabilities?.tools ? "yes" : "no") : "",
    });
  };

  const saveOverride = async (remove = false) => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await setCapabilityOverride(
        editing.connection,
        editing.modelId.trim(),
        remove
          ? null
          : {
              ...editing.original,
              ...(editing.thinking ? { thinking: editing.thinking } : {}),
              ...(editing.pictures
                ? { inputModalities: editing.pictures === "yes" ? ["text", "image"] : ["text"] }
                : {}),
              ...(editing.window ? { contextWindow: Number(editing.window) } : {}),
              ...(editing.tools ? { tools: editing.tools === "yes" } : {}),
            },
      );
      setEditing(undefined);
      await reload();
      await queryClient.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (saveError) {
      setError(operationError(saveError, "保存模型能力失败"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (group: ApiCatalogGroup, model: ApiCatalogModel) => {
    setBusy(true);
    setVerified(undefined);
    setError(null);
    try {
      await testModelConnection(group.credentialProfileId, model.id);
      setVerified(JSON.stringify([group.credentialProfileId, model.id]));
    } catch (testError) {
      setError(operationError(testError, "测试调用失败"));
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
      await refresh(credentialId);
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
          <nav aria-label="模型设置" className="flex gap-1 border-b border-line px-4 py-2">
            <Button
              size="sm"
              variant={tab === "connections" ? "secondary" : "ghost"}
              aria-pressed={tab === "connections"}
              onClick={() => setTab("connections")}
            >
              连接
            </Button>
            <Button
              size="sm"
              variant={tab === "models" ? "secondary" : "ghost"}
              aria-pressed={tab === "models"}
              onClick={() => setTab("models")}
            >
              模型
            </Button>
          </nav>
        ) : null}

        {view.kind === "list" && tab === "models" ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-xs">
              新会话默认 ·{" "}
              {defaultSelection
                ? `${defaultSelection.model} · ${groups.find((group) => group.credentialProfileId === defaultSelection.credentialProfileId)?.credentialLabel ?? ""}`
                : "未设置"}
            </p>
            <Input
              aria-label="搜索模型"
              placeholder="搜索模型或平台"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {modelRows(groups)
              .filter(([, entries]) =>
                entries.some(({ group, model }) =>
                  `${model.label} ${model.id} ${providerLabel(group.provider)}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                ),
              )
              .map(([key, entries]) => (
                <details key={key} className="rounded-lg border border-line px-3 py-2">
                  <summary className="cursor-pointer text-xs">
                    {entries[0]?.model.label} · {entries.length} 个连接
                  </summary>
                  {entries.map(({ group, model }) => (
                    <div
                      key={group.credentialProfileId}
                      className="flex flex-wrap items-center gap-2 py-2 text-xs"
                    >
                      <span className="min-w-0 grow">
                        {group.credentialLabel} · {billingLabel(group.billing)} ·{" "}
                        {windowLabel(model)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          busy ||
                          model.visible === false ||
                          !(model.agentSelectable ?? model.contextWindow !== null)
                        }
                        onClick={() => void makeDefault(group, model)}
                      >
                        设为默认
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => editModel(group.credentialProfileId, model)}
                      >
                        能力
                      </Button>
                    </div>
                  ))}
                </details>
              ))}
          </div>
        ) : null}

        {view.kind === "list" && tab === "connections" ? (
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
                  onClick={() => {
                    setLabel(group.credentialLabel);
                    setApiKey("");
                    setView({ kind: "key", credentialId: group.credentialProfileId });
                  }}
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
                      {group.billing ? <span>{billingLabel(group.billing)}</span> : null}
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
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void refresh(view.credentialId, false, true)}
              >
                <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
                刷新目录
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setEditing({ connection: view.credentialId, modelId: "", window: "", tools: "" })
                }
              >
                登记模型
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
            {activeCredential ? (
              <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-line px-4 py-2">
                <p className="w-full break-all text-[11px] text-ink-3">
                  {activeCredential.endpoint ?? "官方端点"} ·{" "}
                  {billingLabel(activeCredential.billing)}
                </p>
                <label htmlFor={`${fieldId}-connection-label`} className="min-w-0 grow text-xs">
                  连接名称
                  <Input
                    id={`${fieldId}-connection-label`}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                <label htmlFor={`${fieldId}-replacement-key`} className="min-w-0 grow text-xs">
                  替换 API Key
                  <Input
                    id={`${fieldId}-replacement-key`}
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !label.trim()}
                  onClick={() => void editConnection(activeCredential)}
                >
                  保存连接
                </Button>
              </div>
            ) : null}
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
                    model.visible !== false &&
                    model.id === defaultSelection?.model &&
                    activeGroup.credentialProfileId === defaultSelection.credentialProfileId;
                  const disabled =
                    !(model.agentSelectable ?? model.contextWindow !== null) ||
                    model.visible === false;
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
                          {model.visible === false ? " · 已隐藏" : disabled ? " · 不可选" : ""}
                        </span>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => editModel(activeGroup.credentialProfileId, model)}
                      >
                        能力
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !(model.agentSelectable ?? model.contextWindow !== null)}
                        onClick={() => void verify(activeGroup, model)}
                      >
                        {verified === JSON.stringify([activeGroup.credentialProfileId, model.id])
                          ? "已验证"
                          : "测试调用"}
                      </Button>
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
              点可见模型的名称可设为新会话默认。隐藏默认模型会取消默认设置。
            </footer>
            <ConfirmDialog
              open={confirmRemove}
              overlayClassName="z-[310]"
              className="z-[311]"
              title="删除 Key？"
              description={`${
                activeGroup
                  ? `${providerLabel(activeGroup.provider)} · ${activeGroup.credentialLabel}`
                  : "该 Key"
              } 会从本机移除，对应模型也会从选择器中消失；此操作不可撤销。`}
              confirmLabel="删除"
              danger
              pending={busy}
              onCancel={() => setConfirmRemove(false)}
              onConfirm={() => void removeKey(view.credentialId)}
            />
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
              <div className="flex flex-wrap gap-1">
                {[...new Set(presets.map((preset) => preset.provider))].map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={platform === option ? "secondary" : "ghost"}
                    aria-pressed={platform === option}
                    onClick={() => {
                      setPlatform(option);
                      setPresetId("");
                      setLabel(providerLabel(option) + " Key");
                    }}
                  >
                    {providerLabel(option)}
                  </Button>
                ))}
              </div>
              {platformPresets.length > 1 ? (
                <FormSelect
                  label="Key 来源"
                  value={presetId}
                  onValueChange={setPresetId}
                  options={platformPresets.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  }))}
                />
              ) : null}
              {selectedPreset?.fields?.includes("workspaceId") ? (
                <label htmlFor={`${fieldId}-workspace`} className="block text-xs">
                  工作空间 ID
                  <Input
                    id={`${fieldId}-workspace`}
                    value={workspaceId}
                    onChange={(event) => setWorkspaceId(event.target.value)}
                  />
                </label>
              ) : null}
              {platform === "openai-compatible" || selectedPreset?.fields?.includes("endpoint") ? (
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
                  !selectedPreset ||
                  ((platform === "openai-compatible" ||
                    selectedPreset.fields?.includes("endpoint")) &&
                    !compatEndpoint.trim()) ||
                  (selectedPreset.fields?.includes("workspaceId") && !workspaceId.trim())
                }
                onClick={() => void addKey()}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                添加
              </Button>
            </div>
          </>
        ) : null}

        {editing ? (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next && !busy) setEditing(undefined);
            }}
          >
            <DialogContent className="z-[311] w-[min(400px,calc(100vw-28px))] space-y-3">
              <DialogTitle>模型能力</DialogTitle>
              <DialogDescription>保存到当前连接。留空的字段由目录提供。</DialogDescription>
              <label htmlFor={`${fieldId}-override-model`} className="block text-xs">
                模型 ID
                <Input
                  id={`${fieldId}-override-model`}
                  readOnly={editing.existing}
                  value={editing.modelId}
                  onChange={(event) => setEditing({ ...editing, modelId: event.target.value })}
                />
              </label>
              <label htmlFor={`${fieldId}-override-context`} className="block text-xs">
                上下文窗口（Token）
                <Input
                  id={`${fieldId}-override-context`}
                  type="number"
                  min={1}
                  value={editing.window}
                  onChange={(event) => setEditing({ ...editing, window: event.target.value })}
                />
              </label>
              <FormSelect
                label="工具调用"
                value={editing.tools}
                onValueChange={(tools) => setEditing({ ...editing, tools })}
                options={[
                  { value: "", label: "按目录" },
                  { value: "yes", label: "支持" },
                  { value: "no", label: "不支持" },
                ]}
              />
              <FormSelect
                label="截图输入"
                value={editing.pictures ?? ""}
                onValueChange={(pictures) => setEditing({ ...editing, pictures })}
                options={[
                  { value: "", label: "按目录" },
                  { value: "yes", label: "支持截图" },
                  { value: "no", label: "仅文本输入" },
                ]}
              />
              <FormSelect
                label="思考模式"
                value={editing.thinking ?? ""}
                onValueChange={(thinking) =>
                  setEditing({ ...editing, thinking: thinking || undefined })
                }
                options={
                  [
                    { value: "", label: "按目录" },
                    { value: "off", label: "无档位" },
                    { value: "toggle", label: "开 / 关" },
                    { value: "levels", label: "可关闭的档位" },
                    { value: "mandatory-levels", label: "必选档位" },
                  ] as const
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    busy ||
                    !editing.modelId.trim() ||
                    (!editing.window &&
                      !editing.tools &&
                      !editing.thinking &&
                      !editing.pictures &&
                      Object.keys(editing.original ?? {}).length === 0)
                  }
                  onClick={() => void saveOverride()}
                >
                  保存能力
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !editing.modelId.trim()}
                  onClick={() => void saveOverride(true)}
                >
                  移除覆盖
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
