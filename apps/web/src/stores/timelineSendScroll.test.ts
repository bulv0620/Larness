import { beforeEach, expect, it, vi } from "vitest";
import { useNavigationStore } from "./navigationStore";
import { useTimelineStore } from "./timelineStore";

const api = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: "ses_new", projectId: null })),
  updateSession: vi.fn(async () => ({ id: "ses_new", projectId: null })),
  createTurn: vi.fn(async () => ({
    turnId: "turn-1",
    status: "QUEUED",
    sessionId: "s1",
  })),
  uploadAttachments: vi.fn(async () => []),
  transcribeAttachment: vi.fn(async () => ({ id: "att_1", kind: "image", method: "ocr" })),
  archiveSession: vi.fn(async () => undefined),
}));

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  createSession: api.createSession,
  updateSession: api.updateSession,
  createTurn: api.createTurn,
  uploadAttachments: api.uploadAttachments,
  transcribeAttachment: api.transcribeAttachment,
  archiveSession: api.archiveSession,
}));

beforeEach(() => {
  api.createSession.mockClear();
  api.updateSession.mockClear();
  api.createTurn.mockClear();
  api.uploadAttachments.mockClear();
  api.transcribeAttachment.mockClear();
  api.archiveSession.mockClear();
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

it("carries the draft web search choice into the newly created session", async () => {
  useNavigationStore.setState({ projectId: null, draftSession: null });
  useNavigationStore.getState().startDraft(null);
  const draftId = useNavigationStore.getState().sessionId;
  useTimelineStore.setState({ sessionId: draftId, items: [], isStreaming: false });
  const selection = { model: "glm-5.3", credentialProfileId: "cred_glm", thinking: "off" };

  await useTimelineStore.getState().send("今天有什么新版本", selection, "standard", "coding", true);

  expect(api.updateSession).toHaveBeenCalledWith("ses_new", {
    ...selection,
    approvalPolicyId: "standard",
    webSearchEnabled: true,
  });
});

it("leaves web search off when the draft never enabled it", async () => {
  useNavigationStore.setState({ projectId: null, draftSession: null });
  useNavigationStore.getState().startDraft(null);
  const draftId = useNavigationStore.getState().sessionId;
  useTimelineStore.setState({ sessionId: draftId, items: [], isStreaming: false });

  await useTimelineStore.getState().send("继续");

  expect(api.updateSession).toHaveBeenCalledWith("ses_new", { approvalPolicyId: undefined });
});
