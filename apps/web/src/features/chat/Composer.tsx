import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, attachmentRejection } from "@larness/shared";
import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  ErrorMessage,
  IconButton,
  Textarea,
  Toast,
} from "@larness/ui";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import {
  ArrowUp,
  Code2,
  Globe,
  ListChecks,
  Paperclip,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, operationError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import { pendingApprovals } from "@/lib/pendingApprovals";
import {
  queryClient,
  saveSessionSettingsKey,
  sessionDetailKey,
  useModelCatalog,
  useSessionDetail,
  useSessionUsage,
  useWebSearchSettings,
} from "@/lib/queries";
import {
  type ApiCatalogGroup,
  type ApiSession,
  type ApiSessionDetail,
  type ModelSelection,
  transcribeAttachment,
  updateSession,
  uploadAttachment,
} from "@/lib/workspaceApi";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { AttachmentPreview, type PreviewTarget } from "./AttachmentPreview";
import { AttachmentTray, type DraftAttachmentItem } from "./AttachmentTray";
import { ModelControl } from "./ModelControl";
import { SessionUsageLine } from "./SessionUsageLine";

const standardPolicy = {
  id: "standard",
  label: "标准审批",
  detail: "L0/L1 自动，L2 询问",
  icon: ShieldCheck,
  tone: "text-accent",
} as const;

const policies = [
  { id: "readonly", label: "只读", detail: "禁止修改与执行", icon: Shield, tone: "text-success" },
  {
    id: "strict",
    label: "严格审批",
    detail: "所有写入都询问",
    icon: ShieldAlert,
    tone: "text-warning",
  },
  standardPolicy,
  {
    id: "autonomous",
    label: "完全自主",
    detail: "所有工具免人工审批",
    icon: ShieldAlert,
    tone: "text-danger",
  },
] as const;

type AgentProfileId = "coding" | "plan";
const agentProfiles = [
  { id: "coding", label: "Coding", detail: "快速完成编程任务", icon: Code2 },
  { id: "plan", label: "Plan", detail: "按需创建任务计划完成", icon: ListChecks },
] as const;

function defaultThinkingFor(model: {
  thinking: {
    supported: boolean;
    mode?: string;
    defaultLevel?: string;
    levels: { id: string; label: string }[];
  };
}): string {
  if (!model.thinking.supported) return "off";
  if (model.thinking.mode === "toggle") return "on";
  if (model.thinking.defaultLevel) return model.thinking.defaultLevel;
  const preferred = model.thinking.mode === "mandatory-levels" ? "high" : "medium";
  return (
    model.thinking.levels.find((level) => level.id === preferred)?.id ??
    model.thinking.levels[0]?.id ??
    "off"
  );
}

function thinkingAllowed(
  model: {
    thinking: {
      supported: boolean;
      mode?: string;
      defaultLevel?: string;
      levels: { id: string; label: string }[];
    };
  },
  thinking: string,
): boolean {
  if (!model.thinking.supported) return thinking === "off";
  const mode = model.thinking.mode ?? "levels";
  if (mode === "toggle") return thinking === "off" || thinking === "on";
  if (mode === "variants") return model.thinking.levels.some((level) => level.id === thinking);
  return (
    (mode !== "mandatory-levels" && thinking === "off") ||
    model.thinking.levels.some((level) => level.id === thinking)
  );
}

export function Composer({
  centered = false,
  onSubmit,
}: {
  centered?: boolean;
  onSubmit?: () => void;
}) {
  const [tray, setTray] = useState<{ sessionId: string; items: DraftAttachmentItem[] }>();
  const [attachmentError, setAttachmentError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "info" | "error";
  } | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcribing = useRef<Set<string>>(new Set());
  const [autonomousSession, setAutonomousSession] = useState<string | null>(null);
  const [draftPolicy, setDraftPolicy] = useState<{
    sessionId: string;
    value: ApiSession["approvalPolicyId"];
  }>();
  const [draftProfile, setDraftProfile] = useState<{
    sessionId: string;
    value: AgentProfileId;
  }>();
  const [switchNotice, setSwitchNotice] = useState<{ sessionId: string; message: string } | null>(
    null,
  );
  const [saveError, setSaveError] = useState<{ sessionId: string; message: string } | null>(null);
  const [mockSelection, setMockSelection] = useState<ModelSelection>();
  const { catalog, error: catalogError } = useModelCatalog();
  const draft = useComposerStore((state) => state.draft);
  const setDraft = useComposerStore((state) => state.setDraft);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const activeTurnId = useTimelineStore((state) => state.activeTurnId);
  const send = useTimelineStore((state) => state.send);
  const stop = useTimelineStore((state) => state.stop);
  const focusNonce = useNavigationStore((state) => state.focusComposerNonce);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = useNavigationStore((state) => state.sessionId);
  const hasSession = Boolean(sessionId);
  const draftSession = useNavigationStore((state) => state.draftSession);
  const isDraftSession = draftSession?.id === sessionId;
  const sessionDetail = useSessionDetail(hasSession && !isDraftSession ? sessionId : null);
  const sessionReady = USE_MOCKS || isDraftSession || sessionDetail?.id === sessionId;
  const policy =
    sessionDetail?.approvalPolicyId ??
    (draftPolicy?.sessionId === sessionId ? draftPolicy.value : standardPolicy.id);
  const profile =
    sessionDetail?.agentProfile ??
    (draftProfile?.sessionId === sessionId ? draftProfile.value : "coding");
  const savingSettings =
    useIsMutating({ mutationKey: saveSessionSettingsKey(sessionId) }, queryClient) > 0;
  const settingsDisabled =
    !hasSession || !sessionReady || savingSettings || (isStreaming && !activeTurnId);
  const confirmAutonomous = autonomousSession !== null && autonomousSession === sessionId;
  const saveSettings = useMutation(
    {
      mutationKey: saveSessionSettingsKey(sessionId),
      mutationFn: async ({
        id,
        patch,
      }: {
        id: string;
        patch:
          | ModelSelection
          | Partial<Pick<ApiSession, "approvalPolicyId" | "agentProfile" | "webSearchEnabled">>;
      }) => {
        const key = sessionDetailKey(id);
        await queryClient.cancelQueries({ queryKey: key });
        const saved = await updateSession(id, patch);
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData<ApiSessionDetail>(key, (previous) =>
          previous ? { ...previous, ...saved } : { ...saved, activeTurn: null },
        );
      },
    },
    queryClient,
  );

  const groups: ApiCatalogGroup[] = catalog?.groups ?? (catalog ? [catalog] : []);
  const visibleGroups = groups.map((group) => ({
    ...group,
    models: group.models.filter(
      (item) => item.visible !== false && (item.agentSelectable ?? item.contextWindow !== null),
    ),
  }));
  const pairs = groups.flatMap((group) => group.models.map((model) => ({ group, model })));
  const selectable = pairs.filter(
    ({ model }) =>
      model.visible !== false && (model.agentSelectable ?? model.contextWindow !== null),
  );
  const saved = USE_MOCKS ? mockSelection : isDraftSession ? draftSession.selection : sessionDetail;
  const matches = (selection: Pick<ApiSessionDetail, "model" | "credentialProfileId">) =>
    pairs.find(
      ({ group, model }) =>
        model.id === selection.model &&
        (selection.credentialProfileId == null ||
          selection.credentialProfileId === group.credentialProfileId),
    );
  const savedPair = saved ? matches(saved) : undefined;
  const configuredDefault = catalog?.defaultSelection
    ? matches(catalog.defaultSelection)
    : undefined;
  const defaultPair = configuredDefault?.model.visible === false ? undefined : configuredDefault;
  const missingBoundModel = Boolean(saved?.model && saved?.credentialProfileId && !savedPair);
  const pair = savedPair ?? (missingBoundModel ? undefined : (defaultPair ?? selectable[0]));
  const model = sessionReady ? pair?.model : undefined;
  const credentialProfileId = pair?.group.credentialProfileId ?? null;
  const configuredThinking = savedPair
    ? saved?.thinking
    : defaultPair
      ? catalog?.defaultSelection?.thinking
      : null;
  const savedThinking = configuredThinking === "default" ? "medium" : configuredThinking;
  const thinking =
    model && savedThinking && thinkingAllowed(model, savedThinking)
      ? savedThinking
      : model
        ? defaultThinkingFor(model)
        : "off";
  const webSearchSettings = useWebSearchSettings();
  const webSearchConfigured =
    webSearchSettings.data.activeConnectionId !== null &&
    webSearchSettings.data.connections.some(
      (connection) => connection.id === webSearchSettings.data.activeConnectionId,
    );
  const webSearchEnabled = isDraftSession
    ? (draftSession?.webSearchEnabled ?? false)
    : USE_MOCKS
      ? false
      : (sessionDetail?.webSearchEnabled ?? false);
  const webSearchActive = webSearchEnabled && webSearchConfigured;
  const canSend =
    hasSession &&
    model !== undefined &&
    (model.agentSelectable ?? model.contextWindow !== null) &&
    !savingSettings &&
    !isStreaming;
  const trayItems = tray?.sessionId === sessionId ? tray.items : [];
  const files = trayItems.map((item) => item.file);
  const imageAllowed = model?.capabilities?.inputModalities?.includes("image") === true;
  const attachmentBlocked =
    !isDraftSession &&
    !imageAllowed &&
    trayItems.some(
      (item) =>
        item.file.type.startsWith("image/") &&
        item.status === "ready" &&
        item.attachment?.method !== "ocr" &&
        item.attachment?.method !== "vision",
    );
  const trayBusy = trayItems.some(
    (item) => item.status === "uploading" || item.status === "pending",
  );
  const trayFailed = trayItems.some((item) => item.status === "failed");

  const transcribeItem = useCallback(
    async (key: string, attachmentId: string) => {
      if (!sessionId) return;
      if (transcribing.current.has(key)) return;
      transcribing.current.add(key);
      try {
        const updated = await transcribeAttachment(sessionId, attachmentId);
        setTray((current) =>
          current?.sessionId !== sessionId
            ? current
            : {
                ...current,
                items: current.items.map((item) =>
                  item.key === key
                    ? {
                        ...item,
                        status: updated.status,
                        attachment: updated,
                        errorCode: updated.errorCode,
                      }
                    : item,
                ),
              },
        );
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "ATTACHMENT_VISION_UNAVAILABLE";
        setTray((current) =>
          current?.sessionId !== sessionId
            ? current
            : {
                ...current,
                items: current.items.map((item) =>
                  item.key === key ? { ...item, status: "failed" as const, errorCode: code } : item,
                ),
              },
        );
        setToast({
          message: "图片需要视觉模型或本地 OCR 才能发送。",
          tone: "error",
        });
      } finally {
        transcribing.current.delete(key);
      }
    },
    [sessionId],
  );
  const uploadItem = async (key: string, file: File) => {
    if (!sessionId || isDraftSession) return;
    try {
      const result = await uploadAttachment(sessionId, file);
      setTray((current) =>
        current?.sessionId !== sessionId
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.key === key
                  ? {
                      ...item,
                      status: result.attachment.status,
                      attachment: result.attachment,
                      errorCode: result.attachment.errorCode,
                    }
                  : item,
              ),
            },
      );
      if (result.attachment.status === "failed") {
        setToast({ message: "附件解析失败，可重试或移除。", tone: "error" });
      }
      if (
        result.attachment.kind === "image" &&
        result.attachment.status === "ready" &&
        result.attachment.method === "none" &&
        !imageAllowed
      ) {
        void transcribeItem(key, result.attachment.id);
      }
    } catch (error) {
      setTray((current) =>
        current?.sessionId !== sessionId
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.key === key ? { ...item, status: "failed" as const } : item,
              ),
            },
      );
      setToast({
        message: error instanceof Error ? error.message : "附件上传失败",
        tone: "error",
      });
    }
  };
  const addFiles = (incoming: File[]) => {
    if (USE_MOCKS || !hasSession || !sessionId || isStreaming || incoming.length === 0) return;
    const current = tray?.sessionId === sessionId ? tray.items : [];
    const room = 8 - current.length;
    if (room <= 0) {
      setToast({ message: "每轮最多添加 8 个附件。", tone: "error" });
      return;
    }
    const accepted = incoming.slice(0, room);
    const rejected = accepted
      .map((file) => ({ file, reason: attachmentRejection(file.name, file.size) }))
      .find((entry) => entry.reason !== null);
    if (rejected !== undefined && rejected.reason !== null) {
      setToast({
        message:
          rejected.reason === "secret"
            ? `${rejected.file.name} 可能是凭据文件，附件不接收密钥或证书。`
            : rejected.reason === "size"
              ? `${rejected.file.name} 超过 ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MiB 上限。`
              : `不支持 ${rejected.file.name}（代码/配置/文档/图片，最大 20 MiB）。`,
        tone: "error",
      });
      return;
    }
    const items: DraftAttachmentItem[] = accepted.map((file) => ({
      key: `${file.name}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`,
      file,
      status: isDraftSession ? "ready" : "uploading",
    }));
    setTray({ sessionId, items: [...current, ...items] });
    setAttachmentError("");
    if (!isDraftSession) {
      for (const item of items) void uploadItem(item.key, item.file);
    }
  };
  const removeItem = (key: string) => {
    setTray((current) => {
      if (current?.sessionId !== sessionId) return current;
      return { ...current, items: current.items.filter((candidate) => candidate.key !== key) };
    });
  };
  const retryItem = (key: string) => {
    const item = trayItems.find((candidate) => candidate.key === key);
    if (!item) return;
    setTray((current) =>
      current?.sessionId !== sessionId
        ? current
        : {
            ...current,
            items: current.items.map((candidate) =>
              candidate.key === key ? { ...candidate, status: "uploading" as const } : candidate,
            ),
          },
    );
    void uploadItem(key, item.file);
  };
  const currentPolicy = policies.find((item) => item.id === policy) ?? standardPolicy;
  const PolicyIcon = currentPolicy.icon;
  const currentProfile = agentProfiles.find((item) => item.id === profile) ?? agentProfiles[0];
  const ProfileIcon = currentProfile.icon;
  const modelUsage = useTimelineStore((state) => state.modelUsage);
  const usage = model ? modelUsage[model.id] : undefined;
  const sessionUsage = useSessionUsage(hasSession && !isDraftSession ? sessionId : null);
  const timelineLoading = useTimelineStore((state) => state.loading);
  // A draft (or a real session whose usage query reports no completed turn)
  // has not sent a request yet: report 0 against the model window instead of
  // "暂无统计". While a real session is still loading, keep it unknown so the
  // row does not flash 0% for a session that already has history.
  const noRequestYet =
    !timelineLoading &&
    (isDraftSession || (usage === undefined && (sessionUsage?.turns ?? 0) === 0));
  const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? null;
  const lastStep =
    usage?.outputTokens !== undefined && usage.durationMs !== undefined
      ? { outputTokens: usage.outputTokens, durationMs: usage.durationMs }
      : null;
  const pendingApproval = useTimelineStore((state) => pendingApprovals(state.items).length > 0);

  useEffect(
    () =>
      useNavigationStore.subscribe((state, previous) => {
        if (state.sessionId !== previous.sessionId) setAutonomousSession(null);
      }),
    [],
  );

  useEffect(() => {
    if (focusNonce > 0) textareaRef.current?.focus();
  }, [focusNonce]);

  // Switching from a vision model to a text-only model leaves raw images
  // unsendable: transcribe them before the operator hits send.
  useEffect(() => {
    if (USE_MOCKS || isDraftSession || imageAllowed || !sessionId) return;
    for (const item of trayItems) {
      if (
        item.file.type.startsWith("image/") &&
        item.status === "ready" &&
        item.attachment?.method === "none"
      ) {
        void transcribeItem(item.key, item.attachment.id);
      }
    }
  }, [imageAllowed, isDraftSession, sessionId, trayItems, transcribeItem]);

  useEffect(() => {
    if (switchNotice === null) return;
    const timer = setTimeout(() => setSwitchNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [switchNotice]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is the resize trigger
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(180, Math.max(48, element.scrollHeight))}px`;
  }, [draft]);

  const select = async (selection: ModelSelection, label?: string) => {
    if (settingsDisabled) return;
    setSaveError(null);
    setSwitchNotice(null);

    try {
      if (USE_MOCKS) setMockSelection(selection);
      else if (isDraftSession) useNavigationStore.getState().setDraftModel(sessionId, selection);
      else await saveSettings.mutateAsync({ id: sessionId, patch: selection });

      if (label && useNavigationStore.getState().sessionId === sessionId) {
        setSwitchNotice({ sessionId, message: `已切换到 ${label}` });
      }
    } catch (error) {
      setSaveError({ sessionId, message: operationError(error, "模型选择保存失败，请重试。") });
    }
  };

  const selectModel = (nextModelId: string, nextCredentialProfileId: string) => {
    const next = selectable.find(
      ({ group, model }) =>
        model.id === nextModelId && group.credentialProfileId === nextCredentialProfileId,
    );
    if (!next) return;
    void select(
      {
        model: nextModelId,
        credentialProfileId: nextCredentialProfileId,
        thinking: thinkingAllowed(next.model, thinking) ? thinking : defaultThinkingFor(next.model),
      },
      next.model.label,
    );
  };

  const selectProfile = async (value: AgentProfileId) => {
    if (settingsDisabled || value === profile) return;
    setSaveError(null);
    if (USE_MOCKS || isDraftSession) {
      setDraftProfile({ sessionId, value });
      return;
    }
    try {
      await saveSettings.mutateAsync({ id: sessionId, patch: { agentProfile: value } });
    } catch (error) {
      setSaveError({
        sessionId,
        message: operationError(error, "Agent Profile 保存失败，请重试。"),
      });
    }
  };

  const selectPolicy = async (value: ApiSession["approvalPolicyId"]) => {
    if (settingsDisabled || value === policy) return;
    setSaveError(null);
    if (USE_MOCKS || isDraftSession) {
      setDraftPolicy({ sessionId, value });
      return;
    }

    try {
      await saveSettings.mutateAsync({ id: sessionId, patch: { approvalPolicyId: value } });
    } catch (error) {
      setSaveError({ sessionId, message: operationError(error, "审批策略保存失败，请重试。") });
    }
  };

  const toggleWebSearch = async (): Promise<void> => {
    if (!hasSession || settingsDisabled || !webSearchConfigured) return;
    setSaveError(null);
    setSwitchNotice(null);
    if (isDraftSession) {
      const next = !webSearchEnabled;
      useNavigationStore.getState().setDraftWebSearch(sessionId, next);
      setSwitchNotice({ sessionId, message: next ? "已开启联网搜索" : "已关闭联网搜索" });
      return;
    }
    try {
      await saveSettings.mutateAsync({
        id: sessionId,
        patch: { webSearchEnabled: !webSearchEnabled },
      });
      setSwitchNotice({
        sessionId,
        message: webSearchEnabled ? "已关闭联网搜索" : "已开启联网搜索，下一轮生效",
      });
    } catch (error) {
      setSaveError({ sessionId, message: operationError(error, "联网搜索开关保存失败，请重试。") });
    }
  };

  const submit = () => {
    if (
      !canSend ||
      !model ||
      !credentialProfileId ||
      pendingApproval ||
      attachmentBlocked ||
      trayBusy ||
      trayFailed
    )
      return;
    const value = draft.trim();
    if (!value && files.length === 0) return;
    onSubmit?.();
    const selection = { model: model.id, credentialProfileId, thinking };
    const initialPolicy = isDraftSession ? policy : undefined;
    const initialProfile = isDraftSession ? profile : undefined;
    const initialWebSearch =
      isDraftSession && webSearchEnabled && webSearchConfigured ? true : undefined;
    if (USE_MOCKS) void send(value);
    else if (files.length === 0)
      void send(value, selection, initialPolicy, initialProfile, initialWebSearch);
    else {
      void send(
        value,
        selection,
        initialPolicy,
        initialProfile,
        initialWebSearch,
        files,
        () => {
          setTray((current) => (current?.sessionId === sessionId ? undefined : current));
          if (
            useNavigationStore.getState().sessionId === sessionId &&
            useComposerStore.getState().draft === draft
          )
            setDraft("");
        },
        imageAllowed,
      );
    }
    if (files.length === 0) setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <>
      <div
        data-testid="composer-surface"
        className={cn(
          "relative rounded-[18px] border border-line shadow-[var(--shadow-card)] transition-[border-color,box-shadow] focus-within:border-accent/35 focus-within:ring-2 focus-within:ring-accent/10",
          centered ? "bg-surface/40 backdrop-blur-sm" : "bg-surface",
        )}
      >
        {switchNotice?.sessionId === sessionId ? (
          <p
            role="status"
            className="pointer-events-none absolute bottom-full left-2 mb-1 w-fit max-w-[calc(100%-1rem)] truncate rounded-md bg-surface/90 px-2 py-0.5 text-[10.5px] text-ink-3"
          >
            {switchNotice.message}
          </p>
        ) : null}
        <ErrorMessage
          message={saveError?.sessionId === sessionId ? saveError.message : null}
          onDismiss={() => setSaveError(null)}
        />
        {trayItems.length > 0 ? (
          <AttachmentTray
            items={trayItems}
            disabled={isStreaming}
            onRemove={removeItem}
            onRetry={retryItem}
            onPreview={(item) =>
              item.attachment
                ? setPreview({
                    id: item.attachment.id,
                    filename: item.attachment.filename,
                    kind: item.attachment.kind,
                    mime: item.attachment.mime,
                  })
                : undefined
            }
          />
        ) : null}
        {attachmentError || attachmentBlocked ? (
          <p role="status" className="px-3 pt-2 text-xs text-warning">
            {attachmentError || "当前模型连接未声明图片输入。请切换模型、启用 OCR 或移除图片。"}
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <Toast
          message={toast?.message ?? null}
          tone={toast?.tone}
          onDismiss={() => setToast(null)}
        />
        {preview ? (
          <AttachmentPreview
            sessionId={sessionId}
            target={preview}
            onClose={() => setPreview(null)}
          />
        ) : null}
        <Textarea
          variant="bare"
          ref={textareaRef}
          value={draft}
          rows={1}
          placeholder={
            hasSession
              ? centered
                ? "提问、描述要做的改动…"
                : "继续对话，或提出新的任务…"
              : "新建或选择一个会话…"
          }
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (!USE_MOCKS && files.length > 0) {
              event.preventDefault();
              addFiles(files);
            }
          }}
          onDragOver={(event) => {
            if (!USE_MOCKS && event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!USE_MOCKS && event.dataTransfer.files.length) {
              event.preventDefault();
              addFiles([...event.dataTransfer.files]);
            }
          }}
          aria-label="对话输入"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (!isStreaming) submit();
            }
          }}
          className="block max-h-[180px] min-h-[48px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-[1.65] text-ink outline-none placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
          <IconButton
            label={
              !webSearchConfigured
                ? "联网搜索：未配置"
                : webSearchActive
                  ? "联网搜索：已开启"
                  : "联网搜索：已关闭"
            }
            active={webSearchActive}
            aria-pressed={webSearchActive}
            title={
              webSearchConfigured
                ? webSearchEnabled
                  ? "关闭联网搜索"
                  : "开启联网搜索"
                : "请先在左侧「联网搜索」添加搜索 Key"
            }
            disabled={!hasSession || settingsDisabled || !webSearchConfigured}
            onClick={() => void toggleWebSearch()}
            className="h-7 w-7"
          >
            <Globe size={15} aria-hidden="true" />
          </IconButton>

          <ModelControl
            key={sessionId}
            groups={visibleGroups}
            model={model}
            credentialProfileId={credentialProfileId}
            thinking={thinking}
            catalogError={catalogError}
            disabled={settingsDisabled}
            onSelectModel={selectModel}
            onSelectThinking={(nextThinking) => {
              if (model && credentialProfileId) {
                void select({ model: model.id, credentialProfileId, thinking: nextThinking });
              }
            }}
          />

          <DropdownMenu key={`profile-${sessionId}`}>
            <DropdownMenuTrigger asChild>
              <IconButton
                disabled={settingsDisabled}
                label={`Agent Profile：${currentProfile.label}`}
                title={`${currentProfile.label} · ${currentProfile.detail}`}
                className="h-7 w-7"
              >
                <ProfileIcon size={15} className="text-accent" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[230px]">
              <DropdownMenuLabel>Agent Profile</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={profile}
                onValueChange={(value) => void selectProfile(value as AgentProfileId)}
              >
                {agentProfiles.map((item) => (
                  <DropdownMenuRadioItem key={item.id} value={item.id} className="items-start py-2">
                    <span className="flex flex-col">
                      <span className="text-[11.5px] font-medium text-ink">{item.label}</span>
                      <span className="text-[10px] text-ink-3">{item.detail}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu key={`policy-${sessionId}`}>
            <DropdownMenuTrigger asChild>
              <IconButton
                disabled={settingsDisabled}
                label={`审批策略：${currentPolicy.label}`}
                title={`${currentPolicy.label} · ${currentPolicy.detail}`}
                className="h-7 w-7"
              >
                <PolicyIcon size={15} className={currentPolicy.tone} aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[230px]">
              <DropdownMenuLabel>审批策略</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={policy}
                onValueChange={(value) => {
                  const next = policies.find((item) => item.id === value);
                  if (!next || next.id === policy) return;
                  if (next.id === "autonomous") setAutonomousSession(sessionId);
                  else void selectPolicy(next.id);
                }}
              >
                {policies.map((item) => (
                  <DropdownMenuRadioItem key={item.id} value={item.id} className="items-start py-2">
                    <span className="flex flex-col">
                      <span className="text-[11.5px] font-medium text-ink">{item.label}</span>
                      <span className="text-[10px] text-ink-3">{item.detail}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="flex-1" />
          <IconButton
            label="添加附件"
            title="添加 PDF、Office、文本或图片（最大 20 MiB）"
            disabled={!hasSession || isStreaming}
            onClick={() => fileInputRef.current?.click()}
            className="h-7 w-7"
          >
            <Paperclip size={15} aria-hidden="true" />
          </IconButton>
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="停止执行"
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-danger/10 text-danger transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={
                (!draft.trim() && files.length === 0) ||
                !canSend ||
                pendingApproval ||
                attachmentBlocked ||
                trayBusy ||
                trayFailed
              }
              aria-label="发送消息"
              className={cn(
                "ml-1 flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                (draft.trim() || files.length > 0) &&
                  canSend &&
                  !pendingApproval &&
                  !attachmentBlocked &&
                  !trayBusy &&
                  !trayFailed
                  ? "bg-accent text-white shadow-[var(--shadow-card)] hover:brightness-110 active:brightness-95"
                  : "bg-black/[.06] text-ink-3 dark:bg-white/[.08]",
              )}
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <ConfirmDialog
          open={confirmAutonomous}
          title="启用完全自主？"
          description="Agent 将不再逐次请求工具审批，可自行修改或删除文件、执行命令、进行 Git 推送等操作。程序以本机账户权限运行，可访问项目外文件和网络。请仅在信任当前任务时启用。此设置从下一轮起在当前会话持续生效，随时可以切回标准审批。"
          confirmLabel="确认启用"
          danger
          onCancel={() => setAutonomousSession(null)}
          onConfirm={() => {
            if (confirmAutonomous) void selectPolicy("autonomous");
            setAutonomousSession(null);
          }}
        />
      </div>
      {hasSession ? (
        <SessionUsageLine
          usage={isDraftSession || USE_MOCKS ? undefined : sessionUsage}
          streaming={isStreaming}
          lastStep={lastStep}
          contextUsage={{
            used: noRequestYet ? 0 : (usage?.inputTokens ?? null),
            limit: contextWindow,
            sessionTokens: sessionUsage?.inputTokens,
          }}
        />
      ) : null}
    </>
  );
}
