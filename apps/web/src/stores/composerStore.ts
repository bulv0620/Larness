import { create } from "zustand";

interface ComposerState {
  draft: string;
  modelId: string;
  credentialProfileId: string | null;
  thinking: string;
  policy: "standard" | "strict" | "readonly" | "autonomous";
  setDraft: (draft: string) => void;
  setModelId: (modelId: string) => void;
  setCredentialProfileId: (credentialProfileId: string | null) => void;
  setThinking: (thinking: string) => void;
  setPolicy: (policy: "standard" | "strict" | "readonly" | "autonomous") => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  modelId: "deepseek-flash",
  credentialProfileId: null,
  thinking: "medium",
  policy: "standard",
  setDraft: (draft) => set({ draft }),
  setModelId: (modelId) => set({ modelId }),
  setCredentialProfileId: (credentialProfileId) => set({ credentialProfileId }),
  setThinking: (thinking) => set({ thinking }),
  setPolicy: (policy) => set({ policy }),
}));
