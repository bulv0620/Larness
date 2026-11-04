import type { ServerEvent } from "@larness/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyAgentTerminalClosedEvent, applyAgentTerminalEvent } from "@/features/terminals/api";
import { queryClient } from "@/lib/queries";
import { fetchAllEvents, getSession } from "@/lib/workspaceApi";
import { useTimelineStore } from "./timelineStore";

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/features/terminals/api", () => ({
  applyAgentTerminalClosedEvent: vi.fn().mockResolvedValue(true),
  applyAgentTerminalEvent: vi.fn(),
}));
vi.mock("@/lib/workspaceApi", async (original) => ({
  ...(await original<typeof import("@/lib/workspaceApi")>()),
  fetchAllEvents: vi.fn(),
  getSession: vi.fn(),
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
const event: ServerEvent = {
  kind: "event",
  protocolVersion: 1,
  topic: "agent",
  streamId: "s",
  sessionId: "s",
  eventId: "e",
  sequence: 1,
  timestamp: 1,
  type: "tool.completed",
  payload: {
    turnId: "t",
    toolCallId: "stop",
    originClientSessionId: "client",
    closedTerminalTarget: {
      kind: "terminal",
      projectId: "p",
      terminalId: "term_00000000-0000-0000-0000-000000000001",
      role: "frontend",
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  queryClient.setQueryData(["session"], { clientSessionId: "client" });
  vi.mocked(getSession).mockResolvedValue({ activeTurn: null } as Awaited<
    ReturnType<typeof getSession>
  >);
  useTimelineStore.setState({ sessionId: "s", items: [], lastSeq: 0 });
});
afterEach(() => {
  useTimelineStore.getState().disconnect();
  queryClient.clear();
  vi.unstubAllGlobals();
});
it("applies closed targets on initial history load without recreating start tabs", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([event]);
  await useTimelineStore.getState().load("s");
  expect(applyAgentTerminalClosedEvent).toHaveBeenCalledWith(event.payload, "client");
  expect(applyAgentTerminalEvent).not.toHaveBeenCalled();
});
it("applies closed targets on reconnect replay", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([event]);
  await useTimelineStore.getState().syncEvents();
  expect(applyAgentTerminalClosedEvent).toHaveBeenCalledWith(event.payload, "client");
  expect(applyAgentTerminalEvent).not.toHaveBeenCalled();
});
it("applies live close events once and ignores duplicate sequence", async () => {
  vi.mocked(fetchAllEvents).mockResolvedValue([]);
  await useTimelineStore.getState().load("s");
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  expect(applyAgentTerminalClosedEvent).toHaveBeenCalledExactlyOnceWith(event.payload, "client");
});
