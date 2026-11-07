import { create } from "zustand";

interface ComposerState {
  draft: string;
  modelId: string;
  thinking: string;
  policy: "standard" | "strict" | "readonly" | "autonomous";
  setDraft: (draft: string) => void;
  setModelId: (modelId: string) => void;
  setThinking: (thinking: string) => void;
  setPolicy: (policy: "standard" | "strict" | "readonly" | "autonomous") => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  modelId: "deepseek-flash",
  thinking: "medium",
  policy: "standard",
  setDraft: (draft) => set({ draft }),
  setModelId: (modelId) => set({ modelId }),
  setThinking: (thinking) => set({ thinking }),
  setPolicy: (policy) => set({ policy }),
}));
