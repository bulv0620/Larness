import { expect, it } from "vitest";
import { useWindowStore } from "@/stores/windowStore";

it("closing a real terminal window preserves its tabs for restoration", () => {
  useWindowStore.setState({ windows: [], focusedId: null });
  useWindowStore.getState().open({
    kind: "terminal",
    resourceId: "term_00000000-0000-0000-0000-000000000000",
    title: "Shell",
    projectId: "prj_1",
  });
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("Missing window");
  useWindowStore.getState().close(win.id);
  expect(useWindowStore.getState().windows[0]?.minimized).toBe(true);
  expect(useWindowStore.getState().windows[0]?.tabs[0]?.resourceId).toBe(win.tabs[0]?.resourceId);
});

it("inserts an agent terminal tab without taking focus or changing the active tab", async () => {
  const { openAgentTerminal } = await import("./api");
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  useWindowStore.getState().open({
    kind: "terminal",
    resourceId: "term_00000000-0000-0000-0000-000000000001",
    title: "Shell",
    projectId: "prj_1",
  });
  const before = useWindowStore.getState();
  const activeTab = before.windows[0]?.activeTabId;
  openAgentTerminal({
    kind: "terminal",
    projectId: "prj_1",
    terminalId: "term_00000000-0000-0000-0000-000000000002",
    role: "frontend",
  });
  const after = useWindowStore.getState();
  expect(after.windows).toHaveLength(1);
  expect(after.windows[0]?.tabs).toHaveLength(2);
  expect(after.windows[0]?.tabs.at(-1)).toMatchObject({
    resourceId: "term_00000000-0000-0000-0000-000000000002",
    title: "frontend",
    originType: "agent",
    projectId: "prj_1",
  });
  expect(after.windows[0]?.activeTabId).toBe(activeTab);
  expect(after.focusedId).toBe(before.focusedId);
});

it("only inserts the agent terminal tab for the initiating client", async () => {
  const { applyAgentTerminalEvent } = await import("./api");
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  const target = {
    kind: "terminal" as const,
    projectId: "prj_1",
    terminalId: "term_00000000-0000-0000-0000-000000000004",
    role: "frontend",
  };
  expect(
    applyAgentTerminalEvent({ resourceTarget: target, originClientSessionId: "bs_other" }, "bs_me"),
  ).toBe(false);
  expect(useWindowStore.getState().windows).toHaveLength(0);
  expect(
    applyAgentTerminalEvent({ resourceTarget: target, originClientSessionId: "bs_me" }, "bs_me"),
  ).toBe(true);
  expect(useWindowStore.getState().windows[0]?.tabs[0]?.resourceId).toBe(target.terminalId);
});

it("does not steal focus when the agent creates the first terminal window", async () => {
  const { openAgentTerminal } = await import("./api");
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  openAgentTerminal({
    kind: "terminal",
    projectId: "prj_1",
    terminalId: "term_00000000-0000-0000-0000-000000000003",
    role: "backend",
  });
  const state = useWindowStore.getState();
  expect(state.windows).toHaveLength(1);
  expect(state.focusedId).toBeNull();
  expect(state.windows[0]?.tabs[0]?.originType).toBe("agent");
});

it("only removes a terminal tab after a confirmed stop, preserving unknown recovery states", async () => {
  const { stopConfirmed } = await import("./api");
  expect(stopConfirmed({ status: "TERMINATED", reasonCode: "TERMINATE_REQUESTED" })).toBe(true);
  expect(stopConfirmed({ status: "EXITED", reasonCode: null })).toBe(true);
  expect(stopConfirmed({ status: "INTERRUPTED", reasonCode: "NOT_STARTED" })).toBe(true);
  for (const reasonCode of [
    "STOP_UNCONFIRMED",
    "SPAWN_UNCONFIRMED",
    "RECOVERY_UNCONFIRMED",
    "RESULT_RECORD_FAILED",
    "OUTPUT_FAILED",
  ]) {
    expect(stopConfirmed({ status: "INTERRUPTED", reasonCode })).toBe(false);
  }
});
