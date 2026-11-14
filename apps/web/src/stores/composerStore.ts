import { create } from "zustand";

interface ComposerState {
  draft: string;
  policy: "standard" | "strict" | "readonly" | "autonomous";
  setDraft: (draft: string) => void;
  setPolicy: (policy: "standard" | "strict" | "readonly" | "autonomous") => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  policy: "standard",
  setDraft: (draft) => set({ draft }),
  setPolicy: (policy) => set({ policy }),
}));
