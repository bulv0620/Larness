import { create } from "zustand";

interface SettingsState {
  webSearchOpen: boolean;
  setWebSearchOpen: (open: boolean) => void;
  openWebSearch: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  webSearchOpen: false,
  setWebSearchOpen: (webSearchOpen) => set({ webSearchOpen }),
  openWebSearch: () => set({ webSearchOpen: true }),
}));
