import { expect, it } from "vitest";
import { useWindowStore } from "@/stores/windowStore";

it("closing a real terminal window preserves its tabs for restoration", () => {
  useWindowStore.setState({ windows: [], focusedId: null });
  useWindowStore.getState().open({
    kind: "terminal",
    resourceId: "term_00000000-0000-0000-0000-000000000000",
    title: "Shell",
  });
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("Missing window");
  useWindowStore.getState().close(win.id);
  expect(useWindowStore.getState().windows[0]?.minimized).toBe(true);
  expect(useWindowStore.getState().windows[0]?.tabs[0]?.resourceId).toBe(win.tabs[0]?.resourceId);
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
