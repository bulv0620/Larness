import { create } from "zustand";

interface ComposerState {
  draft: string;
  setDraft: (draft: string) => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
}));
