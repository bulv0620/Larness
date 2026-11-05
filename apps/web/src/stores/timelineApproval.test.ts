import type { ApprovalItem } from "@larness/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { useTimelineStore } from "./timelineStore";

const api = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  decideApproval: api.decide,
}));
const approval: ApprovalItem = {
  id: "a",
  kind: "approval",
  status: "pending",
  createdAt: 1,
  toolName: "run_command",
};
const resolve = useTimelineStore.getState().resolveApproval;
beforeEach(() => {
  api.decide.mockReset();
  useTimelineStore.setState({
    sessionId: "s1",
    items: [approval],
    resolveApproval: resolve,
    syncEvents: vi.fn().mockResolvedValue(undefined),
  });
});
it("keeps approval pending until the server confirms; failure leaves it retryable", async () => {
  let confirm: (() => void) | undefined;
  api.decide.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        confirm = done;
      }),
  );
  const pending = resolve("a", "approve");
  expect(useTimelineStore.getState().items[0]).toMatchObject({ status: "pending" });
  confirm?.();
  await pending;
  expect(useTimelineStore.getState().items[0]).toMatchObject({ status: "approved" });
  useTimelineStore.setState({ items: [approval] });
  api.decide.mockRejectedValueOnce(new Error("offline"));
  await expect(resolve("a", "reject")).rejects.toThrow("offline");
  expect(useTimelineStore.getState().items[0]).toMatchObject({ status: "pending" });
});
it("does not apply a delayed decision to the newly selected conversation", async () => {
  let confirm: (() => void) | undefined;
  api.decide.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        confirm = done;
      }),
  );
  const pending = resolve("a", "approve");
  useTimelineStore.setState({ sessionId: "s2", items: [{ ...approval }] });
  confirm?.();
  await pending;
  expect(useTimelineStore.getState().items[0]).toMatchObject({ status: "pending" });
  expect(useTimelineStore.getState().syncEvents).not.toHaveBeenCalled();
});
