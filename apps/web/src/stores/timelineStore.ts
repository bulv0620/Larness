import type {
  ApprovalItem,
  AssistantDeltaEvent,
  AssistantReasoningDeltaEvent,
  ErrorItem,
  ServerEvent,
  TimelineItem,
} from "@larness/shared";
import { create } from "zustand";
import { applyAgentTerminalClosedEvent, applyAgentTerminalEvent } from "@/features/terminals/api";
import { USE_MOCKS } from "@/lib/env";
import {
  applyAssistantDelta,
  applyServerEvent,
  eventsToTimeline,
  eventTurnId,
  isTerminalTurnEvent,
  type ModelUsageEntry,
  modelUsageFromEvents,
} from "@/lib/eventReducer";
import {
  projectApprovalPolicyKeyPrefix,
  queryClient,
  saveSessionSettingsKey,
  sessionDetailKey,
  sessionUsageKey,
} from "@/lib/queries";
import { appendAssistantMessage, applyReasoningDelta, applyTurnEvent } from "@/lib/timeline";
import {
  type ApiSession,
  archiveSession,
  cancelTurn,
  createSession,
  createTurn,
  decideApproval,
  fetchAllEvents,
  getSession,
  type ModelSelection,
  resumeTurn as requestResumeTurn,
  transcribeAttachment,
  updateSession,
  uploadAttachments,
} from "@/lib/workspaceApi";
import { gateway } from "@/mocks/gateway";
import { useNavigationStore } from "@/stores/navigationStore";

let mockController: AbortController | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let socketSessionId: string | null = null;
let loadToken = 0;
let syncing = false;
let syncQueued = false;
let syncRetryAttempts = 0;
let syncRetryTimer: number | null = null;
let terminalTurnIds = new Set<string>();

function clearSyncRetry(): void {
  if (syncRetryTimer === null) return;
  window.clearTimeout(syncRetryTimer);
  syncRetryTimer = null;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function errorItem(message: string): ErrorItem {
  return {
    id: `error_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: "error",
    message,
    createdAt: Date.now(),
  };
}

/**
 * Uploads the draft files and guarantees the Turn only sees ready artifacts.
 * Raw images are transcribed when the selected model cannot consume them, so
 * the server capability check and the UI agree before a Turn is created.
 */
async function prepareAttachments(
  sessionId: string,
  files: File[],
  acceptsImages: boolean,
): Promise<string[] | undefined> {
  if (files.length === 0) return undefined;
  const uploaded = await uploadAttachments(sessionId, files);
  const failed = uploaded.find(({ attachment }) => attachment.status === "failed");
  if (failed) {
    throw new Error(`${failed.attachment.filename} 解析失败，请移除或重试。`);
  }
  if (!acceptsImages) {
    for (const { attachment } of uploaded) {
      if (attachment.kind !== "image" || attachment.method !== "none") continue;
      try {
        await transcribeAttachment(sessionId, attachment.id);
      } catch {
        throw new Error(`${attachment.filename} 需要视觉模型或本地 OCR 才能发送。`);
      }
    }
  }
  return uploaded.map(({ attachment }) => attachment.id);
}

function closeSocket(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearSyncRetry();
  syncRetryAttempts = 0;
  socketSessionId = null;
  socket?.close();
  socket = null;
}

/**
 * 1008 is used for authentication/session failures, but older servers also
 * used it for transport-level closes. Only stop reconnecting when the reason
 * really points at auth; backpressure and transport failures must replay.
 */
function isAuthCloseReason(reason: string): boolean {
  if (reason.length === 0) return true;
  return /unauthenticated|authorization|session|revoked|expired|device/i.test(reason);
}

export type TurnPhase = "idle" | "pending" | "running" | "waiting_approval" | "cancelling";

export interface TurnState {
  id: string | null;
  phase: TurnPhase;
  startedAt: number | null;
}

export const IDLE_TURN: TurnState = Object.freeze({
  id: null,
  phase: "idle",
  startedAt: null,
});

/** Test/helper constructor; production transitions go through turnFromEvent/snapshot. */
export function turnState(
  phase: TurnPhase = "idle",
  id: string | null = null,
  startedAt: number | null = null,
): TurnState {
  return { id, phase, startedAt };
}

export const selectIsStreaming = (state: { turn: TurnState }): boolean =>
  state.turn.phase !== "idle";
export const selectActiveTurnId = (state: { turn: TurnState }): string | null => state.turn.id;
export const selectTurnStartedAt = (state: { turn: TurnState }): number | null =>
  state.turn.startedAt;

function phaseFromStatus(status: string | null): TurnPhase {
  switch (status) {
    case "QUEUED":
      return "pending";
    case "PREPARING":
    case "RUNNING":
      return "running";
    case "WAITING_APPROVAL":
      return "waiting_approval";
    case "CANCELLING":
      return "cancelling";
    default:
      return "running";
  }
}

/**
 * The only place that decides whether a session is streaming. Durable turn
 * lifecycle events move the phase; deltas only append text.
 */
function turnFromEvent(current: TurnState, event: ServerEvent): TurnState {
  const turnId = eventTurnId(event);
  const terminal = isTerminalTurnEvent(event);

  if (terminal) {
    if (current.id === null || turnId === null || current.id === turnId) {
      return IDLE_TURN;
    }
    return current;
  }

  if (event.type !== "turn.created" && event.type !== "turn.status") {
    return current;
  }
  if (turnId === null) return current;

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const status = typeof payload.status === "string" ? payload.status : null;
  const sameTurn = current.id === turnId;

  return {
    id: turnId,
    phase: event.type === "turn.created" ? "pending" : phaseFromStatus(status),
    startedAt: sameTurn ? (current.startedAt ?? event.timestamp) : event.timestamp,
  };
}

function turnFromSnapshot(
  activeTurn: { id: string; status: string; createdAt: number } | null,
): TurnState {
  return activeTurn === null
    ? IDLE_TURN
    : {
        id: activeTurn.id,
        phase: phaseFromStatus(activeTurn.status),
        startedAt: activeTurn.createdAt,
      };
}

interface TimelineState {
  sessionId: string;
  items: TimelineItem[];
  loading: boolean;
  turn: TurnState;
  contextTokens: number;
  contextNotice: { degraded: boolean; createdAt: number } | null;
  modelUsage: Record<string, ModelUsageEntry>;
  lastSeq: number;
  /** Increments when the operator sends; Timeline jumps to the latest message. */
  scrollToLatestNonce: number;
  load: (sessionId: string) => Promise<void>;
  disconnect: () => void;
  syncEvents: () => Promise<void>;
  send: (
    text: string,
    selection?: ModelSelection,
    draftPolicy?: ApiSession["approvalPolicyId"],
    draftProfile?: ApiSession["agentProfile"],
    draftWebSearch?: boolean,
    screenshots?: File[],
    onAccepted?: () => void,
    acceptsImages?: boolean,
  ) => Promise<void>;
  stop: () => void;
  resumeTurn: (turnId: string) => Promise<void>;
  resolveApproval: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
}

function contextNoticeFromEvents(
  events: ServerEvent[],
): { degraded: boolean; createdAt: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event?.type !== "context.compressed") continue;

    const payload =
      typeof event.payload === "object" && event.payload !== null
        ? (event.payload as Record<string, unknown>)
        : {};

    return { degraded: payload.degraded === true, createdAt: event.timestamp };
  }

  return null;
}

function contextTokensFromEvents(events: ServerEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "turn.completed") continue;
    const usage =
      typeof event.payload === "object" && event.payload !== null
        ? (event.payload as Record<string, unknown>).usage
        : null;

    if (typeof usage === "object" && usage !== null) {
      const record = usage as Record<string, unknown>;
      if (typeof record.inputTokens === "number") return record.inputTokens;
      if (typeof record.totalTokens === "number") return record.totalTokens;
    }
  }

  return 0;
}

function turnAlreadyTerminal(events: ServerEvent[], turnId: string): boolean {
  return events.some((event) => isTerminalTurnEvent(event) && eventTurnId(event) === turnId);
}

function applyDeltaToState(event: AssistantDeltaEvent): void {
  const state = useTimelineStore.getState();

  if (event.sessionId !== state.sessionId) {
    return;
  }

  // Deltas are ephemeral text hints, never lifecycle. They may append to the
  // active turn's text, but they cannot start or finish a turn.
  if (state.turn.phase === "idle") return;
  if (state.turn.id !== null && event.turnId !== state.turn.id) return;
  if (terminalTurnIds.has(event.turnId)) return;

  useTimelineStore.setState({
    items: applyAssistantDelta(state.items, {
      messageId: event.messageId,
      text: event.text,
      createdAt: event.timestamp,
      turnId: event.turnId,
    }),
  });
}

function applyReasoningDeltaToState(event: AssistantReasoningDeltaEvent): void {
  const state = useTimelineStore.getState();

  if (event.sessionId !== state.sessionId) {
    return;
  }

  if (state.turn.phase === "idle") return;
  if (state.turn.id !== null && event.turnId !== state.turn.id) return;
  if (terminalTurnIds.has(event.turnId)) return;

  useTimelineStore.setState({
    items: applyReasoningDelta(state.items, {
      id: `reasoning_${event.turnId}`,
      turnId: event.turnId,
      text: event.text,
      createdAt: event.timestamp,
    }),
  });
}

function applyEventToState(event: ServerEvent, live = false, acceptSequenceGap = false): void {
  const state = useTimelineStore.getState();

  if (event.sessionId !== undefined && event.sessionId !== state.sessionId) {
    return;
  }

  if (event.sequence <= state.lastSeq) {
    return;
  }

  // Hidden rows such as tool.replay consume durable sequence numbers without
  // being served to clients, so a gap alone does not mean events were missed.
  // A sync that fetches every visible event after lastSeq can safely advance
  // across those gaps; live pushes keep the strict check to trigger a sync.
  if (!acceptSequenceGap && event.sequence !== state.lastSeq + 1) {
    void state.syncEvents();
    return;
  }

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const turnId = eventTurnId(event);
  const terminal = isTerminalTurnEvent(event);
  if (terminal && turnId !== null) {
    terminalTurnIds.add(turnId);
  }
  const turn = turnFromEvent(state.turn, event);
  const nextItems = applyServerEvent(state.items, event).map((item) =>
    terminal && item.kind === "reasoning" ? { ...item, streaming: false } : item,
  );
  const usage =
    event.type === "turn.completed" && typeof payload.usage === "object" && payload.usage !== null
      ? (payload.usage as Record<string, unknown>)
      : null;
  const contextTokens =
    typeof usage?.inputTokens === "number"
      ? usage.inputTokens
      : typeof usage?.totalTokens === "number"
        ? usage.totalTokens
        : state.contextTokens;
  const modelUsage =
    event.type === "model.usage"
      ? { ...state.modelUsage, ...modelUsageFromEvents([event]) }
      : state.modelUsage;

  useTimelineStore.setState({
    items: terminal
      ? nextItems.map((item) => (item.kind === "message" ? { ...item, streaming: false } : item))
      : nextItems,
    lastSeq: event.sequence,
    turn,
    contextTokens,
    contextNotice:
      event.type === "context.compressed"
        ? { degraded: payload.degraded === true, createdAt: event.timestamp }
        : state.contextNotice,
    modelUsage,
  });

  if (event.type === "tool.completed") {
    const session = queryClient.getQueryData<{ clientSessionId?: string }>(["session"]);
    void applyAgentTerminalClosedEvent(payload, session?.clientSessionId);
  }

  if (terminal) {
    void queryClient.invalidateQueries({
      queryKey: sessionUsageKey(event.sessionId ?? state.sessionId),
    });
  }

  if (
    live &&
    event.type === "tool.completed" &&
    typeof payload.originClientSessionId === "string"
  ) {
    void queryClient.invalidateQueries({ queryKey: ["terminals"] });
    const session = queryClient.getQueryData<{ clientSessionId?: string }>(["session"]);
    applyAgentTerminalEvent(payload, session?.clientSessionId);
  }
}

function connectSocket(sessionId: string): void {
  if (USE_MOCKS || typeof window === "undefined") {
    return;
  }

  closeSocket();
  socketSessionId = sessionId;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const current = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket = current;

  current.addEventListener("open", () => {
    if (socketSessionId !== sessionId) return;
    current.send(
      JSON.stringify({
        type: "subscribe",
        subscriptions: [{ topic: "agent", resourceId: sessionId }],
      }),
    );
  });

  current.addEventListener("message", (raw) => {
    if (socket !== current || socketSessionId !== sessionId) return;

    let message: unknown;

    try {
      message = JSON.parse(String(raw.data));
    } catch {
      return;
    }

    if (typeof message !== "object" || message === null) return;
    const value = message as Record<string, unknown>;

    if (value.kind === "subscribed") {
      const sequence = typeof value.currentSequence === "number" ? value.currentSequence : 0;
      if (sequence > useTimelineStore.getState().lastSeq) {
        void useTimelineStore.getState().syncEvents();
      }
      return;
    }

    if (value.kind === "assistant.delta" && value.topic === "agent") {
      applyDeltaToState(value as unknown as AssistantDeltaEvent);
      return;
    }

    if (value.kind === "assistant.reasoning.delta" && value.topic === "agent") {
      applyReasoningDeltaToState(value as unknown as AssistantReasoningDeltaEvent);
      return;
    }

    if (value.kind === "event" && value.topic === "agent") {
      applyEventToState(value as unknown as ServerEvent, true);
    }
  });

  current.addEventListener("close", (event) => {
    if (socket !== current || socketSessionId !== sessionId) return;
    socket = null;

    if (event.code === 1008 && isAuthCloseReason(event.reason)) {
      window.dispatchEvent(new Event("larness:unauthenticated"));
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      if (socketSessionId === sessionId) connectSocket(sessionId);
    }, 1_000);
  });

  current.addEventListener("error", () => current.close());
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  sessionId: "",
  items: [],
  loading: false,
  turn: IDLE_TURN,
  contextTokens: 0,
  contextNotice: null,
  modelUsage: {},
  lastSeq: 0,
  scrollToLatestNonce: 0,

  load: async (sessionId) => {
    const token = ++loadToken;
    closeSocket();
    terminalTurnIds = new Set();
    mockController?.abort();
    mockController = null;
    set({
      sessionId,
      items: [],
      loading: Boolean(sessionId),
      turn: IDLE_TURN,
      contextTokens: 0,
      contextNotice: null,
      modelUsage: {},
      lastSeq: 0,
    });

    if (!sessionId) {
      set({ loading: false });
      return;
    }

    if (sessionId.startsWith("draft_")) {
      set({ loading: false });
      return;
    }

    if (USE_MOCKS) {
      try {
        const items = await gateway.timeline(sessionId);
        if (token === loadToken && get().sessionId === sessionId) {
          set({ items });
        }
      } finally {
        if (token === loadToken) set({ loading: false });
      }
      return;
    }

    try {
      const [detail, events] = await Promise.all([
        getSession(sessionId),
        fetchAllEvents(sessionId, 0),
      ]);

      if (token !== loadToken || get().sessionId !== sessionId) return;

      // `getSession` and the event page are fetched independently. A turn can
      // finish between them: the detail still names it as active while the
      // history already contains its terminal event. Reconcile the two so a
      // finished turn cannot lock the UI on "generating" until a reload.
      const activeTurn =
        detail.activeTurn !== null && !turnAlreadyTerminal(events, detail.activeTurn.id)
          ? detail.activeTurn
          : null;
      terminalTurnIds = new Set(
        events
          .filter((event) => isTerminalTurnEvent(event))
          .map((event) => eventTurnId(event))
          .filter((turnId): turnId is string => turnId !== null),
      );

      set({
        items: eventsToTimeline(events),
        lastSeq: events.at(-1)?.sequence ?? 0,
        loading: false,
        turn: turnFromSnapshot(activeTurn),
        contextTokens: contextTokensFromEvents(events),
        contextNotice: contextNoticeFromEvents(events),
        modelUsage: modelUsageFromEvents(events),
      });
      const client = queryClient.getQueryData<{ clientSessionId?: string }>(["session"]);
      for (const event of events) {
        if (
          event.type === "tool.completed" &&
          typeof event.payload === "object" &&
          event.payload !== null
        )
          void applyAgentTerminalClosedEvent(
            event.payload as Record<string, unknown>,
            client?.clientSessionId,
          );
      }
      connectSocket(sessionId);
    } catch (error) {
      if (token !== loadToken) return;
      const message = error instanceof Error ? error.message : "加载会话失败";
      set({ loading: false, items: [errorItem(message)] });
    }
  },

  disconnect: () => {
    closeSocket();
  },

  syncEvents: async () => {
    const sessionId = get().sessionId;
    if (!sessionId || USE_MOCKS) return;
    if (syncing) {
      // A gap can arrive while a fetch is already in flight; run another pass
      // once it finishes so a terminal event is never dropped for good.
      syncQueued = true;
      return;
    }
    syncing = true;
    clearSyncRetry();

    try {
      do {
        syncQueued = false;
        const events = await fetchAllEvents(sessionId, get().lastSeq);
        if (get().sessionId !== sessionId) return;

        for (const event of events) {
          applyEventToState(event, false, true);
        }
      } while (syncQueued && get().sessionId === sessionId);
      syncRetryAttempts = 0;
    } catch (error) {
      if (get().sessionId !== sessionId) return;

      // A live gap event is dropped when this fetch fails. Give transient
      // network/proxy failures two bounded retries before surfacing an error;
      // otherwise a lost terminal event can leave the session generating.
      if (syncRetryAttempts < 2) {
        syncRetryAttempts += 1;
        const delayMs = 500 * syncRetryAttempts;
        syncRetryTimer = window.setTimeout(() => {
          syncRetryTimer = null;
          if (get().sessionId === sessionId) void get().syncEvents();
        }, delayMs);
        return;
      }

      syncRetryAttempts = 0;
      const message = error instanceof Error ? error.message : "事件补拉失败";
      set((state) => ({
        items: [...state.items, errorItem(`事件补拉失败：${message}`)],
      }));
    } finally {
      syncing = false;
      if (syncQueued) {
        // The queued call may target a session that replaced the one this pass
        // was reading; start a fresh pass for the current session.
        syncQueued = false;
        void get().syncEvents();
      }
    }
  },

  send: async (
    text,
    selection,
    draftPolicy,
    draftProfile,
    draftWebSearch,
    screenshots = [],
    onAccepted,
    acceptsImages = false,
  ) => {
    const trimmed = text.trim();
    if ((!trimmed && screenshots.length === 0) || get().turn.phase !== "idle") return;
    const sessionId = get().sessionId;

    if (!sessionId) return;

    set((state) => ({ scrollToLatestNonce: state.scrollToLatestNonce + 1 }));

    if (USE_MOCKS) {
      const userItem: TimelineItem = {
        id: uid("msg"),
        kind: "message",
        role: "user",
        text: trimmed,
        createdAt: Date.now(),
      };
      set((state) => ({
        items: [...state.items, userItem],
        turn: turnState("pending", null, Date.now()),
      }));
      mockController = new AbortController();
      const active = mockController;

      try {
        for await (const event of gateway.sendTurn({
          sessionId,
          text: trimmed,
          signal: active.signal,
        })) {
          set((state) => ({ items: applyTurnEvent(state.items, event) }));
        }
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        set((state) => ({
          items: appendAssistantMessage(
            state.items,
            uid("msg"),
            aborted ? "已停止当前执行。" : "执行失败：Mock Provider 连接被中断。",
          ),
        }));
      } finally {
        set((state) => ({
          turn: IDLE_TURN,
          items: state.items.map((item) =>
            item.kind === "message" ? { ...item, streaming: false } : item,
          ),
        }));
        if (mockController === active) mockController = null;
      }
      return;
    }

    const navigation = useNavigationStore.getState();
    if (navigation.sessionId !== sessionId) return;
    if (queryClient.isMutating({ mutationKey: saveSessionSettingsKey(sessionId) })) return;

    const draft = navigation.draftSession;

    if (draft !== null && draft.id === sessionId) {
      set({ turn: turnState("pending", null, Date.now()) });

      let real: Awaited<ReturnType<typeof createSession>> | null = null;
      let turnCreated = false;
      try {
        real = await createSession({
          ...(draft.projectId === null ? {} : { projectId: draft.projectId }),
          ...(draftProfile === undefined ? {} : { agentProfile: draftProfile }),
        });
        await updateSession(real.id, {
          ...selection,
          approvalPolicyId: draftPolicy,
          ...(draftWebSearch === undefined ? {} : { webSearchEnabled: draftWebSearch }),
        });
        if (draftPolicy !== undefined) {
          void queryClient.invalidateQueries({ queryKey: projectApprovalPolicyKeyPrefix });
        }
        const attachmentIds = await prepareAttachments(real.id, screenshots, acceptsImages);
        await createTurn(
          real.id,
          { input: trimmed, ...selection, ...(attachmentIds ? { attachmentIds } : {}) },
          crypto.randomUUID(),
        );
        turnCreated = true;
        onAccepted?.();
        await queryClient.invalidateQueries({ queryKey: ["workspace"] });
        useNavigationStore.getState().commitDraft(draft.id, real.id, real.projectId);
      } catch (error) {
        // A scaffold session created only for uploads must not linger hidden
        // behind the still-open draft; archive it so the operator can retry.
        if (real !== null && !turnCreated) {
          await archiveSession(real.id).catch(() => undefined);
        }
        if (get().sessionId !== sessionId) return;
        const message = error instanceof Error ? error.message : "发送失败";
        set((state) => ({
          turn: IDLE_TURN,
          items: [...state.items, errorItem(`发送失败：${message}`)],
        }));
      }

      return;
    }

    const optimistic: TimelineItem = {
      id: `optimistic_user_${Date.now()}`,
      kind: "message",
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    };
    set((state) => ({
      items: [...state.items, optimistic],
      turn: turnState("pending", null, Date.now()),
    }));

    try {
      const attachmentIds = await prepareAttachments(sessionId, screenshots, acceptsImages);
      const created = await createTurn(
        sessionId,
        { input: trimmed, ...selection, ...(attachmentIds ? { attachmentIds } : {}) },
        crypto.randomUUID(),
      );
      onAccepted?.();
      void queryClient.invalidateQueries({ queryKey: sessionDetailKey(sessionId) });
      if (get().sessionId !== sessionId) return;
      const currentTurn = get().turn;
      if (currentTurn.id === null) {
        set({ turn: { ...currentTurn, id: created.turnId } });
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      if (get().sessionId === sessionId) await get().syncEvents();
    } catch (error) {
      if (get().sessionId !== sessionId) return;
      const message = error instanceof Error ? error.message : "发送失败";
      set((state) => ({
        turn: IDLE_TURN,
        items: [
          ...state.items.filter((item) => item.id !== optimistic.id),
          errorItem(`发送失败：${message}`),
        ],
      }));
      await get().syncEvents();
    }
  },

  stop: () => {
    const sessionId = get().sessionId;

    if (USE_MOCKS) {
      mockController?.abort();
      mockController = null;
      void gateway.cancelTurn(get().sessionId);
      set({ turn: IDLE_TURN });
      return;
    }

    const activeTurnId = get().turn.id;

    if (activeTurnId === null) {
      return;
    }

    void cancelTurn(activeTurnId).catch((error: unknown) => {
      if (get().sessionId !== sessionId) return;
      const message = error instanceof Error ? error.message : "停止失败";
      useTimelineStore.setState((state) => ({
        items: [...state.items, errorItem(`停止失败：${message}`)],
      }));
    });
  },

  resumeTurn: async (turnId) => {
    const sessionId = get().sessionId;

    if (USE_MOCKS) {
      set({ turn: turnState("pending", turnId, Date.now()) });
      return;
    }

    try {
      const resumed = await requestResumeTurn(turnId);
      if (get().sessionId !== sessionId) return;
      set({ turn: turnState("pending", resumed.turnId, Date.now()) });
      await get().syncEvents();
    } catch (error) {
      if (get().sessionId !== sessionId) return;
      const message = error instanceof Error ? error.message : "无法继续该任务";
      useTimelineStore.setState((state) => ({
        items: [...state.items, errorItem(`继续失败：${message}`)],
      }));
    }
  },

  resolveApproval: async (approvalId, decision) => {
    const status = decision === "approve" ? "approved" : "rejected";
    const update = (next: "pending" | "approved" | "rejected") =>
      set((state) => ({
        items: state.items.map((item) =>
          item.kind === "approval" && item.id === approvalId ? { ...item, status: next } : item,
        ),
      }));

    const approval = get().items.find(
      (item): item is ApprovalItem => item.kind === "approval" && item.id === approvalId,
    );
    if (approval?.status !== "pending") return;

    const sessionId = get().sessionId;
    if (USE_MOCKS) {
      await gateway.resolveApproval(approvalId, decision);
      if (get().sessionId !== sessionId) return;
      update(status);
      set((state) => {
        const message =
          decision === "approve"
            ? "已批准部署。PM2 正在替换 web-prod，健康检查通过后会写入部署记录。"
            : "已暂不部署。web-prod 保持停止状态，构建产物会保留 24 小时。";
        const items = appendAssistantMessage(state.items, uid("msg"), message);

        if (decision === "approve") {
          items.push({
            id: uid("art"),
            kind: "artifact",
            title: "部署成功",
            description: "web-prod 已在 8080 端口启动，健康检查通过。",
            meta: "PM2 · 2026-10-31 20:45",
            createdAt: Date.now(),
          });
        }

        return { items };
      });
      return;
    }

    await decideApproval(approvalId, decision);
    if (get().sessionId !== sessionId) return;
    update(status);
    await get().syncEvents();
  },
}));
