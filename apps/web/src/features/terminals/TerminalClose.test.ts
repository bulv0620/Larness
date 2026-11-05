import type { LiveTerminal } from "@larness/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { useWindowStore } from "@/stores/windowStore";
import * as api from "./api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const id = "term_00000000-0000-0000-0000-000000000001";
const otherId = "term_00000000-0000-0000-0000-000000000002";
const target = { kind: "terminal", projectId: "p", terminalId: id, role: "frontend" };
const payload = { closedTerminalTarget: target, originClientSessionId: "client" };
function row(status: LiveTerminal["status"] = "TERMINATED"): LiveTerminal {
  return {
    id,
    projectId: "p",
    workspaceSessionId: null,
    sourceSessionId: "s",
    cwd: "/project",
    shell: "/bin/sh",
    mode: "dev",
    role: "frontend",
    title: null,
    status,
    exitCode: 1,
    reasonCode: "TERMINATE_REQUESTED",
    currentSequence: 2,
    lease: null,
    writeBlocked: false,
  };
}
function open(resourceId = id) {
  useWindowStore
    .getState()
    .open({ kind: "terminal", resourceId, title: resourceId, projectId: "p" });
}
beforeEach(() => {
  vi.resetAllMocks();
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
});
async function apply(value = payload, client: string | undefined = "client") {
  return api.applyAgentTerminalClosedEvent(value, client);
}
it("removes only the confirmed stopped terminal, preserving the active sibling", async () => {
  open();
  open(otherId);
  const active = useWindowStore.getState().windows[0]?.activeTabId;
  vi.mocked(apiFetch).mockResolvedValue(row());
  await apply();
  const win = useWindowStore.getState().windows[0];
  expect(win?.tabs.map((tab) => tab.resourceId)).toEqual([otherId]);
  expect(win?.activeTabId).toBe(active);
  expect(apiFetch).toHaveBeenCalledExactlyOnceWith(`/api/terminals/${id}`);
});
it("removes the last tab from a minimized window and replay stays idempotent", async () => {
  open();
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("Missing window");
  useWindowStore.getState().close(win.id);
  vi.mocked(apiFetch).mockResolvedValue(row());
  await apply();
  await apply();
  expect(useWindowStore.getState().windows).toEqual([]);
});
it.each(["RUNNING", "STOPPING", "CREATED", "INTERRUPTED"] as const)(
  "keeps %s tabs",
  async (status) => {
    open();
    vi.mocked(apiFetch).mockResolvedValue(row(status));
    await apply();
    expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(1);
  },
);
it("keeps tabs on lookup errors or mismatched resource identity", async () => {
  open();
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("offline"));
  await apply();
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...row(), projectId: "other" });
  await apply();
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...row(), id: otherId });
  await apply();
  expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(1);
});
it("does not change other clients or act on malformed targets", async () => {
  open();
  await apply(payload, "other");
  await api.applyAgentTerminalClosedEvent(payload, undefined);
  await apply({ ...payload, closedTerminalTarget: { ...target, terminalId: "invalid" } });
  expect(apiFetch).not.toHaveBeenCalled();
  expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(1);
});

it("preserves focus in another project when clearing a background terminal window", async () => {
  open();
  useWindowStore
    .getState()
    .open({ kind: "terminal", resourceId: otherId, title: "other project", projectId: "other" });
  const focusedId = useWindowStore.getState().focusedId;
  vi.mocked(apiFetch).mockResolvedValue(row());
  await apply();
  expect(useWindowStore.getState().windows).toHaveLength(1);
  expect(useWindowStore.getState().focusedId).toBe(focusedId);
  expect(useWindowStore.getState().windows[0]?.tabs[0]?.resourceId).toBe(otherId);
});
