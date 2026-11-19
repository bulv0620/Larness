import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";

describe("composer drafts follow sessions", () => {
  beforeEach(() => {
    useNavigationStore.setState({ sessionId: "ses_a", draftSession: null });
    useComposerStore.setState({ draft: "", drafts: {} });
  });

  it("swaps the visible draft for the one saved with each session", () => {
    useComposerStore.getState().setDraft("任务 A");
    useNavigationStore.getState().selectSession("ses_b", null);

    expect(useComposerStore.getState().draft).toBe("");

    useComposerStore.getState().setDraft("任务 B");
    useNavigationStore.getState().selectSession("ses_a", null);

    expect(useComposerStore.getState().draft).toBe("任务 A");
    expect(useComposerStore.getState().drafts).toEqual({ ses_a: "任务 A", ses_b: "任务 B" });
  });

  it("keeps text typed without a session in its own bucket", () => {
    useNavigationStore.setState({ sessionId: "" });
    useComposerStore.getState().setDraft("未归属的输入");

    useNavigationStore.getState().selectSession("ses_a", null);

    expect(useComposerStore.getState().draft).toBe("");
    expect(useComposerStore.getState().drafts[""]).toBe("未归属的输入");
  });

  it("drops a session's bucket once its draft is cleared", () => {
    useComposerStore.getState().setDraft("任务 A");
    useComposerStore.getState().setDraft("");

    expect(useComposerStore.getState().draft).toBe("");
    expect(useComposerStore.getState().drafts).toEqual({});
  });
});
