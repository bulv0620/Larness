import type {
  ApprovalItem,
  AssistantDeltaEvent,
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
} from "@/lib/eventReducer";
import { queryClient } from "@/lib/queries";
import { appendAssistantMessage, applyTurnEvent } from "@/lib/timeline";
import {
  cancelTurn,
  createSession,
  createTurn,
  decideApproval,
  fetchAllEvents,
  getSession,
  updateSession,
} from "@/lib/workspaceApi";
import { gateway } from "@/mocks/gateway";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";

let mockController: AbortController | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let socketSessionId: string | null = null;
let loadToken = 0;
let syncing = false;

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

function closeSocket(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socketSessionId = null;
  socket?.close();
  socket = null;
}

interface TimelineState {
  sessionId: string;
  items: TimelineItem[];
  loading: boolean;
  isStreaming: boolean;
  activeTurnId: string | null;
  turnStartedAt: number | null;
  contextTokens: number;
  lastSeq: number;
  load: (sessionId: string) => Promise<void>;
  disconnect: () => void;
  syncEvents: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  resolveApproval: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
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

function applyDeltaToState(event: AssistantDeltaEvent): void {
  const state = useTimelineStore.getState();

  if (event.sessionId !== state.sessionId) {
    return;
  }

  useTimelineStore.setState({
    items: applyAssistantDelta(state.items, {
      messageId: event.messageId,
      text: event.text,
      createdAt: event.timestamp,
      turnId: event.turnId,
    }),
    isStreaming: true,
    activeTurnId: state.activeTurnId ?? event.turnId,
    turnStartedAt: state.turnStartedAt ?? event.timestamp,
  });
}

function applyEventToState(event: ServerEvent, live = false): void {
  const state = useTimelineStore.getState();

  if (event.sessionId !== undefined && event.sessionId !== state.sessionId) {
    return;
  }

  if (event.sequence <= state.lastSeq) {
    return;
  }

  if (event.sequence !== state.lastSeq + 1) {
    void state.syncEvents();
    return;
  }

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const turnId = eventTurnId(event);
  const status = typeof payload.status === "string" ? payload.status : null;
  const activeTurnId =
    event.type === "turn.created" || event.type === "turn.status"
      ? (turnId ?? state.activeTurnId)
      : state.activeTurnId;
  const nextStreaming = isTerminalTurnEvent(event)
    ? false
    : event.type === "turn.created" ||
        status === "QUEUED" ||
        status === "PREPARING" ||
        status === "RUNNING" ||
        status === "WAITING_APPROVAL" ||
        status === "CANCELLING"
      ? true
      : state.isStreaming;

  const terminal = isTerminalTurnEvent(event);
  const nextItems = applyServerEvent(state.items, event);
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

  useTimelineStore.setState({
    items: terminal
      ? nextItems.map((item) => (item.kind === "message" ? { ...item, streaming: false } : item))
      : nextItems,
    lastSeq: event.sequence,
    activeTurnId: terminal ? null : activeTurnId,
    isStreaming: nextStreaming,
    contextTokens,
    turnStartedAt:
      terminal || nextStreaming
        ? terminal
          ? null
          : (state.turnStartedAt ?? event.timestamp)
        : state.turnStartedAt,
  });

  if (event.type === "tool.completed") {
    const session = queryClient.getQueryData<{ clientSessionId?: string }>(["session"]);
    void applyAgentTerminalClosedEvent(payload, session?.clientSessionId);
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
    if (socketSessionId !== sessionId) return;

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

    if (value.kind === "event" && value.topic === "agent") {
      applyEventToState(value as unknown as ServerEvent, true);
    }
  });

  current.addEventListener("close", (event) => {
    if (socket !== current || socketSessionId !== sessionId) return;
    socket = null;

    if (event.code === 1008) {
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
  isStreaming: false,
  activeTurnId: null,
  turnStartedAt: null,
  contextTokens: 0,
  lastSeq: 0,

  load: async (sessionId) => {
    const token = ++loadToken;
    closeSocket();
    mockController?.abort();
    mockController = null;
    set({
      sessionId,
      items: [],
      loading: Boolean(sessionId),
      isStreaming: false,
      activeTurnId: null,
      turnStartedAt: null,
      contextTokens: 0,
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

      set({
        items: eventsToTimeline(events),
        lastSeq: events.at(-1)?.sequence ?? 0,
        loading: false,
        isStreaming: detail.activeTurn !== null,
        activeTurnId: detail.activeTurn?.id ?? null,
        turnStartedAt: detail.activeTurn?.createdAt ?? null,
        contextTokens: contextTokensFromEvents(events),
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
    if (!sessionId || USE_MOCKS || syncing) return;
    syncing = true;

    try {
      const events = await fetchAllEvents(sessionId, get().lastSeq);
      if (get().sessionId !== sessionId) return;

      for (const event of events) {
        applyEventToState(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "事件补拉失败";
      set((state) => ({
        items: [...state.items, errorItem(`事件补拉失败：${message}`)],
      }));
    } finally {
      syncing = false;
    }
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming) return;
    const sessionId = get().sessionId;

    if (!sessionId) return;

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
        isStreaming: true,
        turnStartedAt: Date.now(),
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
          isStreaming: false,
          turnStartedAt: null,
          items: state.items.map((item) =>
            item.kind === "message" ? { ...item, streaming: false } : item,
          ),
        }));
        if (mockController === active) mockController = null;
      }
      return;
    }

    const composer = useComposerStore.getState();
    const draft = useNavigationStore.getState().draftSession;

    if (draft !== null && draft.id === sessionId) {
      set({ isStreaming: true, turnStartedAt: Date.now() });

      try {
        const real = await createSession(
          draft.projectId === null ? {} : { projectId: draft.projectId },
        );
        await updateSession(real.id, {
          modelProfileId: composer.modelId,
          approvalPolicyId: composer.policy,
        });
        await createTurn(
          real.id,
          { input: trimmed, modelProfileId: composer.modelId },
          crypto.randomUUID(),
        );
        await queryClient.invalidateQueries({ queryKey: ["workspace"] });
        useNavigationStore.getState().commitDraft(real.id, real.projectId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "发送失败";
        set((state) => ({
          isStreaming: false,
          turnStartedAt: null,
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
      isStreaming: true,
      turnStartedAt: Date.now(),
    }));

    try {
      await updateSession(sessionId, {
        modelProfileId: composer.modelId,
        approvalPolicyId: composer.policy,
      });
      const created = await createTurn(
        sessionId,
        { input: trimmed, modelProfileId: composer.modelId },
        crypto.randomUUID(),
      );
      set({ activeTurnId: created.turnId });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      await get().syncEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      set((state) => ({
        isStreaming: false,
        turnStartedAt: null,
        items: [
          ...state.items.filter((item) => item.id !== optimistic.id),
          errorItem(`发送失败：${message}`),
        ],
      }));
      await get().syncEvents();
    }
  },

  stop: () => {
    if (USE_MOCKS) {
      mockController?.abort();
      mockController = null;
      void gateway.cancelTurn(get().sessionId);
      set({ isStreaming: false });
      return;
    }

    const activeTurnId = get().activeTurnId;

    if (activeTurnId === null) {
      return;
    }

    void cancelTurn(activeTurnId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "停止失败";
      useTimelineStore.setState((state) => ({
        items: [...state.items, errorItem(`停止失败：${message}`)],
      }));
    });
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
