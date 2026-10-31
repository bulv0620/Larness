import { create } from "zustand";

interface ComposerState {
  draft: string;
  modelId: string;
  policy: "standard" | "strict" | "readonly";
  setDraft: (draft: string) => void;
  setModelId: (modelId: string) => void;
  setPolicy: (policy: "standard" | "strict" | "readonly") => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  modelId: "mdl_deepseek_chat",
  policy: "standard",
  setDraft: (draft) => set({ draft }),
  setModelId: (modelId) => set({ modelId }),
  setPolicy: (policy) => set({ policy }),
}));
