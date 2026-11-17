import { beforeEach, expect, it, vi } from "vitest";
import { useNavigationStore } from "./navigationStore";
import { useTimelineStore } from "./timelineStore";

const api = vi.hoisted(() => ({
  createTurn: vi.fn(async () => ({
    turnId: "turn-1",
    status: "QUEUED",
    sessionId: "s1",
  })),
}));

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  createTurn: api.createTurn,
}));

beforeEach(() => {
  api.createTurn.mockClear();
  useNavigationStore.setState({ sessionId: "s1", draftSession: null });
  useTimelineStore.setState({
    sessionId: "s1",
    items: [],
    isStreaming: false,
    activeTurnId: null,
    scrollToLatestNonce: 0,
    syncEvents: vi.fn().mockResolvedValue(undefined),
  });
});

it("asks the transcript to follow the latest output when the operator sends", async () => {
  await useTimelineStore.getState().send("继续");

  expect(api.createTurn).toHaveBeenCalledOnce();
  expect(useTimelineStore.getState().scrollToLatestNonce).toBe(1);
});
