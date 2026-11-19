import { create } from "zustand";
import { useNavigationStore } from "@/stores/navigationStore";

interface ComposerState {
  /** Draft text of the session currently being viewed. */
  draft: string;
  /** Drafts saved per session id; the "" bucket holds text typed with no session. */
  drafts: Record<string, string>;
  setDraft: (draft: string) => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  drafts: {},
  setDraft: (draft) =>
    set((state) => {
      const sessionId = useNavigationStore.getState().sessionId;
      const drafts = { ...state.drafts, [sessionId]: draft };
      if (draft === "") delete drafts[sessionId];
      return { draft, drafts };
    }),
}));

// Switching sessions swaps the visible draft for the one saved with it, so an
// unfinished prompt stays with the conversation it was typed in.
useNavigationStore.subscribe((state, previous) => {
  if (state.sessionId === previous.sessionId) return;
  useComposerStore.setState({
    draft: useComposerStore.getState().drafts[state.sessionId] ?? "",
  });
});
