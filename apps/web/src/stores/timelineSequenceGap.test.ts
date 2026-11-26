import type { ServerEvent } from "@larness/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchAllEvents, getSession, resumeTurn } from "@/lib/workspaceApi";
import { useTimelineStore } from "./timelineStore";

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  fetchAllEvents: vi.fn(),
  getSession: vi.fn(),
  resumeTurn: vi.fn(),
}));

let socket: FakeSocket;

class FakeSocket extends EventTarget {
  constructor() {
    super();
    socket = this;
  }
  send() {}
  close() {}
}

function event(sequence: number, type: string, payload: Record<string, unknown>): ServerEvent {
  return {
    kind: "event",
    protocolVersion: 1,
    topic: "agent",
    streamId: "s",
    sessionId: "s",
    eventId: `evt_${sequence}`,
    sequence,
    timestamp: sequence,
    type,
    payload,
  };
}

const running = event(1, "turn.status", { turnId: "t1", status: "RUNNING" });
const completed = event(3, "turn.completed", {
  turnId: "t1",
  status: "COMPLETED",
  durationMs: 5,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(getSession).mockResolvedValue({
    id: "s",
    projectId: null,
    workspacePath: "/tmp",
    title: "s",
    status: "active",
    modelProfileId: null,
    approvalPolicyId: "standard",
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
    activeTurn: {
      id: "t1",
      sessionId: "s",
      status: "RUNNING",
      modelProfileId: null,
      provider: null,
      model: null,
      input: { text: "go" },
      usage: null,
      error: null,
      createdAt: 1,
      startedAt: 1,
      endedAt: null,
    },
  });
  useTimelineStore.setState({
    sessionId: "s",
    items: [],
    loading: false,
    isStreaming: true,
    activeTurnId: "t1",
    turnStartedAt: 1,
    contextTokens: 0,
    contextNotice: null,
    modelUsage: {},
    lastSeq: 1,
    scrollToLatestNonce: 0,
  });
});

afterEach(() => {
  useTimelineStore.getState().disconnect();
  vi.unstubAllGlobals();
});

it("activates a session as idle when its history already contains the terminal event", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([completed]);

  await useTimelineStore.getState().load("s");

  expect(useTimelineStore.getState().lastSeq).toBe(3);
  expect(useTimelineStore.getState().isStreaming).toBe(false);
  expect(useTimelineStore.getState().activeTurnId).toBeNull();
});

it("does not apply a late resume result to another session", async () => {
  let resolveResume: ((value: Awaited<ReturnType<typeof resumeTurn>>) => void) | undefined;
  vi.mocked(resumeTurn).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
  );

  const pending = useTimelineStore.getState().resumeTurn("turn_old");
  useTimelineStore.setState({ sessionId: "s2", isStreaming: false, activeTurnId: null });
  resolveResume?.({
    turnId: "turn_new",
    status: "QUEUED",
    sessionId: "s",
    resumedFromTurnId: "turn_old",
  });
  await pending;

  expect(useTimelineStore.getState().sessionId).toBe("s2");
  expect(useTimelineStore.getState().isStreaming).toBe(false);
  expect(useTimelineStore.getState().activeTurnId).toBeNull();
});

it("retries a transient backfill failure before giving up", async () => {
  vi.mocked(fetchAllEvents)
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([completed]);

  await useTimelineStore.getState().syncEvents();
  expect(useTimelineStore.getState().isStreaming).toBe(true);

  await vi.waitFor(
    () => {
      expect(useTimelineStore.getState().lastSeq).toBe(3);
      expect(useTimelineStore.getState().isStreaming).toBe(false);
      expect(
        useTimelineStore
          .getState()
          .items.some((item) => item.kind === "error" && item.message.includes("事件补拉失败")),
      ).toBe(false);
    },
    { timeout: 3_000 },
  );
});

it("does not let a late assistant delta resurrect a finished turn", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([running]);
  await useTimelineStore.getState().load("s");
  vi.mocked(fetchAllEvents).mockResolvedValue([completed]);
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(completed) }));

  await vi.waitFor(() => {
    expect(useTimelineStore.getState().isStreaming).toBe(false);
  });

  socket.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        kind: "assistant.delta",
        protocolVersion: 1,
        topic: "agent",
        streamId: "s",
        sessionId: "s",
        turnId: "t1",
        messageId: "msg_late",
        text: "late",
        timestamp: 10,
      }),
    }),
  );

  expect(useTimelineStore.getState().isStreaming).toBe(false);
  expect(useTimelineStore.getState().activeTurnId).toBeNull();
  expect(
    useTimelineStore
      .getState()
      .items.some((item) => item.kind === "message" && item.role === "assistant"),
  ).toBe(false);
});

it("applies a synced terminal event when a hidden replay row left a sequence gap", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([completed]);

  await useTimelineStore.getState().syncEvents();

  expect(useTimelineStore.getState().lastSeq).toBe(3);
  expect(useTimelineStore.getState().isStreaming).toBe(false);
  expect(useTimelineStore.getState().activeTurnId).toBeNull();
});

it("recovers a live turn when a gap-triggered sync fetches the terminal event", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([running]);
  await useTimelineStore.getState().load("s");
  expect(useTimelineStore.getState().lastSeq).toBe(1);
  expect(useTimelineStore.getState().isStreaming).toBe(true);

  vi.mocked(fetchAllEvents).mockResolvedValue([completed]);
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(completed) }));

  await vi.waitFor(() => {
    expect(useTimelineStore.getState().lastSeq).toBe(3);
    expect(useTimelineStore.getState().isStreaming).toBe(false);
  });
});

it("reruns a queued sync when another gap arrives during an in-flight fetch", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([running]);
  await useTimelineStore.getState().load("s");

  let releaseFirst: ((events: ServerEvent[]) => void) | undefined;
  vi.mocked(fetchAllEvents)
    .mockImplementationOnce(
      () =>
        new Promise<ServerEvent[]>((resolve) => {
          releaseFirst = resolve;
        }),
    )
    .mockResolvedValueOnce([completed]);

  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(completed) }));
  // The second push is dropped by the gap check while the first fetch is still
  // pending; it must queue another pass instead of being forgotten.
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(completed) }));

  releaseFirst?.([]);

  await vi.waitFor(() => {
    expect(useTimelineStore.getState().lastSeq).toBe(3);
    expect(useTimelineStore.getState().isStreaming).toBe(false);
  });
});
