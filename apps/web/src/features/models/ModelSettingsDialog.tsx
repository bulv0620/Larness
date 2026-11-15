import {
  Button,
  ConfirmDialog,
  cn,
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
import { KeyRound, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
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

import { billingLabel, providerLabel } from "./catalogView";
import { modelCapabilityDetails } from "./ModelCapabilities";
import { ModelSettingsRow } from "./ModelSettingsRow";

const settingsSubdialog =
  "z-[311] max-h-[calc(100dvh-32px)] w-[min(400px,calc(100vw-28px))] space-y-3 overflow-y-auto";

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
  const [selectedKeyId, setSelectedKeyId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [catalog, setCatalog] = useState<ApiModelCatalog | null>(null);
  const [presets, setPresets] = useState<ApiModelPreset[]>([]);
  const [platform, setPlatform] = useState("deepseek");
  const [presetId, setPresetId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
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
  const [verification, setVerification] = useState<{
    credentialId: string;
    modelId: string;
    status: "testing" | "passed";
  }>();
  const platforms = [...new Set(presets.map((preset) => preset.provider))].sort(
    (first, second) =>
      Number(first === "openai-compatible") - Number(second === "openai-compatible"),
  );
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = catalog?.groups ?? (catalog === null ? [] : [catalog]);
  const defaultSelection = catalog?.defaultSelection ?? null;
  const activeCredential =
    credentials.find(({ id }) => id === selectedKeyId) ??
    credentials.find(({ id }) => id === defaultSelection?.credentialProfileId) ??
    credentials[0];
  const activeGroup = groups.find((group) => group.credentialProfileId === activeCredential?.id);
  const query = search.trim().toLowerCase();
  const models =
    activeGroup?.models.filter((model) =>
      `${model.label} ${model.id}`.toLowerCase().includes(query),
    ) ?? [];
  const editingModel = editing?.existing
    ? activeGroup?.models.find((model) => model.id === editing.modelId)
    : undefined;
  const subdialogOpen = adding || connectionOpen || editing !== undefined || confirmRemove;
  const closeSubdialog = () => {
    if (busy) return;
    setAdding(false);
    setConnectionOpen(false);
    setEditing(undefined);
    setConfirmRemove(false);
    setApiKey("");
    setError(null);
  };

  const selectKey = (id: string) => {
    setAdding(false);
    setSelectedKeyId(id);
    setConnectionOpen(false);
    setApiKey("");
    setSearch("");
    setError(null);
  };

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
      setConnectionOpen(false);
      setConfirmRemove(false);
      setSelectedKeyId(undefined);
      setAdding(false);
      setSearch("");
      setEditing(undefined);
      setVerification(undefined);
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
      selectKey(saved.id);
      setCredentials((previous) => [...previous.filter(({ id }) => id !== saved.id), saved]);
      await reload();
      await refresh(
        saved.id,
        true,
        selectedPreset.provider === "opencode-go" ||
          selectedPreset.provider === "kimi" ||
          selectedPreset.provider === "bailian",
      );
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
      setVerification(undefined);
      setConnectionOpen(false);
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
    const target = { credentialId: group.credentialProfileId, modelId: model.id };
    setBusy(true);
    setVerification({ ...target, status: "testing" });
    setError(null);
    try {
      await testModelConnection(target.credentialId, target.modelId);
      setVerification({ ...target, status: "passed" });
    } catch (testError) {
      setVerification(undefined);
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
      setApiKey("");
      setConnectionOpen(false);
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
      setSelectedKeyId(undefined);
      setConnectionOpen(false);
      setApiKey("");
      setSearch("");
      setVerification(undefined);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !subdialogOpen) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex h-[min(690px,calc(100dvh-24px))] w-[min(880px,calc(100vw-24px))] flex-col overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (subdialogOpen) {
            event.preventDefault();
            closeSubdialog();
          }
        }}
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle>模型与凭据</DialogTitle>
            <DialogDescription className="sr-only">按 Key 管理模型和连接。</DialogDescription>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={adding || busy || loading}
            onClick={() => {
              setAdding(true);
              setConnectionOpen(false);
              setLabel(`${providerLabel(platform)} Key`);
              setApiKey("");
              setError(null);
            }}
          >
            <Plus size={13} aria-hidden="true" />
            添加 Key
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" aria-label="关闭模型设置">
              <X size={14} />
            </Button>
          </DialogClose>
        </header>

        {!adding && !connectionOpen && !editing ? (
          <ErrorMessage message={error} onDismiss={() => setError(null)} />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Key 列表"
            className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-surface-2/30 p-2 sm:w-[204px] sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
          >
            {credentials.map((credential) => {
              const group = groups.find(
                ({ credentialProfileId }) => credentialProfileId === credential.id,
              );
              const selected = credential.id === activeCredential?.id;
              return (
                <button
                  key={credential.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectKey(credential.id)}
                  disabled={busy}
                  className={cn(
                    "flex min-w-[140px] max-w-[204px] shrink-0 items-center gap-2 rounded-lg border px-2 py-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 sm:w-full sm:min-w-0",
                    selected ? "border-accent/20 bg-accent-soft" : "border-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3",
                      selected && "bg-surface/75 text-accent",
                    )}
                  >
                    <KeyRound size={13} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{credential.label}</span>
                    <span className="block truncate text-[10px] text-ink-3">
                      {providerLabel(credential.provider)} ·{" "}
                      {billingLabel(credential.billing ?? group?.billing)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-ink-3">
                      {group ? `${group.models.length} 个模型` : "目录不可用"}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeCredential ? (
              <section
                aria-label={`${activeCredential.label} 模型`}
                className="min-h-0 flex-1 overflow-y-auto"
              >
                <div className="space-y-3 border-b border-line px-3 py-3 sm:px-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{activeCredential.label}</h3>
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {activeGroup ? syncLabel(activeGroup) : "目录不可用"}
                        {activeGroup?.stale && activeGroup.syncedAt !== null ? " · 待刷新" : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void refresh(activeCredential.id, false, true)}
                    >
                      <RefreshCw size={12} aria-hidden="true" />
                      刷新目录
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-haspopup="dialog"
                      disabled={busy}
                      onClick={() => {
                        setLabel(activeCredential.label);
                        setApiKey("");
                        setError(null);
                        setConnectionOpen(true);
                      }}
                    >
                      管理 Key
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="删除 Key"
                      disabled={busy}
                      onClick={() => setConfirmRemove(true)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-accent/60">
                      <Search size={13} aria-hidden="true" className="shrink-0 text-ink-3" />
                      <input
                        type="search"
                        aria-label="搜索当前 Key 的模型"
                        placeholder="搜索当前 Key 的模型"
                        className="h-8 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-ink-3"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          connection: activeCredential.id,
                          modelId: "",
                          window: "",
                          tools: "",
                        })
                      }
                    >
                      <Plus size={12} aria-hidden="true" />
                      登记模型
                    </Button>
                  </div>
                </div>

                {!activeGroup || models.length === 0 ? (
                  <p className="px-4 py-5 text-xs text-ink-3">
                    {!activeGroup
                      ? "目录不可用，请刷新。"
                      : query
                        ? "这把 Key 下没有匹配的模型。"
                        : "此 Key 暂无模型。可刷新目录或手动登记。"}
                  </p>
                ) : (
                  <ul className="divide-y divide-line/70 px-3 sm:px-4">
                    {models.map((model) => (
                      <ModelSettingsRow
                        key={`${activeGroup.credentialProfileId}:${model.id}`}
                        model={model}
                        isDefault={
                          model.visible !== false &&
                          model.id === defaultSelection?.model &&
                          activeGroup.credentialProfileId === defaultSelection.credentialProfileId
                        }
                        busy={busy}
                        verification={
                          verification?.credentialId === activeGroup.credentialProfileId &&
                          verification.modelId === model.id
                            ? verification.status
                            : undefined
                        }
                        makeDefault={() => void makeDefault(activeGroup, model)}
                        edit={() => editModel(activeGroup.credentialProfileId, model)}
                        verify={() => void verify(activeGroup, model)}
                        toggleVisibility={() => void toggleVisibility(activeGroup, model)}
                      />
                    ))}
                  </ul>
                )}

                <ConfirmDialog
                  open={confirmRemove}
                  overlayClassName="z-[310]"
                  className="z-[311]"
                  title="删除 Key？"
                  description={`${activeCredential.label} 会从本机移除，对应模型也会从选择器中消失。此操作不可撤销。`}
                  confirmLabel="删除"
                  danger
                  pending={busy}
                  onCancel={() => setConfirmRemove(false)}
                  onConfirm={() => void removeKey(activeCredential.id)}
                />
              </section>
            ) : !loading ? (
              <p className="m-4 rounded-xl border border-dashed border-line p-6 text-center text-xs text-ink-3">
                还没有 Key。添加后即可同步官方模型目录。
              </p>
            ) : null}
          </div>
        </div>

        {adding ? (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) closeSubdialog();
            }}
          >
            <DialogContent overlayClassName="z-[310]" className={settingsSubdialog}>
              <DialogTitle>添加 Key</DialogTitle>
              <DialogDescription className="sr-only">
                选择接入平台并保存 API Key。
              </DialogDescription>
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
              <div className="flex flex-wrap gap-1">
                {platforms.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={platform === option ? "secondary" : "ghost"}
                    aria-pressed={platform === option}
                    onClick={() => {
                      setPlatform(option);
                      setPresetId("");
                      setLabel(`${providerLabel(option)} Key`);
                    }}
                  >
                    {providerLabel(option)}
                  </Button>
                ))}
              </div>
              {platformPresets.length > 1 ? (
                <FormSelect
                  label="Key 来源"
                  showLabel
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

              <DialogClose asChild>
                <Button variant="ghost" size="sm" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
        ) : null}

        {connectionOpen && activeCredential ? (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) closeSubdialog();
            }}
          >
            <DialogContent overlayClassName="z-[310]" className={settingsSubdialog}>
              <DialogTitle>管理 Key</DialogTitle>
              <DialogDescription className="break-all">
                {activeCredential.label} · {activeCredential.masked} ·{" "}
                {activeCredential.endpoint ?? "官方端点"}
              </DialogDescription>
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
              <div className="flex flex-wrap items-end gap-2">
                <label
                  htmlFor={`${fieldId}-connection-label`}
                  className="min-w-[120px] flex-1 text-xs"
                >
                  连接名称
                  <Input
                    id={`${fieldId}-connection-label`}
                    className="mt-1"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                <label
                  htmlFor={`${fieldId}-replacement-key`}
                  className="min-w-[120px] flex-1 text-xs"
                >
                  替换 API Key
                  <Input
                    id={`${fieldId}-replacement-key`}
                    className="mt-1"
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
              {activeCredential.provider === "openai-compatible" ? (
                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                  <label
                    htmlFor={`${fieldId}-endpoint-edit`}
                    className="min-w-[120px] flex-1 text-xs"
                  >
                    端点 URL
                    <Input
                      id={`${fieldId}-endpoint-edit`}
                      aria-label="兼容端点 URL"
                      value={endpointDraft}
                      onChange={(event) => setEndpointDraft(event.target.value)}
                      className="mt-1 font-mono"
                    />
                  </label>
                  <label htmlFor={`${fieldId}-window-edit`} className="w-24 text-xs">
                    窗口（K）
                    <Input
                      id={`${fieldId}-window-edit`}
                      aria-label="兼容上下文窗口（K）"
                      value={windowDraft}
                      onChange={(event) => setWindowDraft(event.target.value)}
                      inputMode="numeric"
                      className="mt-1 font-mono"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !endpointDraft.trim()}
                    onClick={() => void saveCompatible(activeCredential.id)}
                  >
                    保存端点
                  </Button>
                </div>
              ) : null}

              <DialogClose asChild>
                <Button variant="ghost" size="sm" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
        ) : null}

        {editing ? (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) closeSubdialog();
            }}
          >
            <DialogContent overlayClassName="z-[310]" className={settingsSubdialog}>
              <DialogTitle>模型能力</DialogTitle>
              <DialogDescription>
                {editingModel ? modelCapabilityDetails(editingModel) : "留空的字段由目录提供。"}
              </DialogDescription>
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
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
                showLabel
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
                showLabel
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
                showLabel
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
