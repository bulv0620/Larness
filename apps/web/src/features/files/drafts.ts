import { create } from "zustand";

interface Draft {
  text: string;
  baseVersion: string;
}
interface DraftState {
  drafts: Record<string, Draft>;
  saving: Record<string, boolean>;
  monitoring: Record<string, string>;
  closeRequest: { windowId: string; tabId: string } | null;
  edit: (key: string, text: string, baseVersion: string) => void;
  discard: (key: string) => void;
}
// Deliberately memory-only: source text never enters persisted layout preferences.
export const useFileDraftStore = create<DraftState>((set) => ({
  drafts: {},
  saving: {},
  monitoring: {},
  closeRequest: null,
  edit: (key, text, baseVersion) =>
    set((state) => ({ drafts: { ...state.drafts, [key]: { text, baseVersion } } })),
  discard: (key) =>
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    }),
}));
