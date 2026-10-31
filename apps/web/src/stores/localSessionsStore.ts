import type { SessionSummary } from "@harness/shared";
import { create } from "zustand";

interface LocalSessionsState {
  extra: SessionSummary[];
  create: (projectId: string | null) => SessionSummary;
  rename: (sessionId: string, title: string) => void;
}

export const useLocalSessionsStore = create<LocalSessionsState>((set) => ({
  extra: [],
  create: (projectId) => {
    const session: SessionSummary = {
      id: `ses_local_${Math.random().toString(36).slice(2, 9)}`,
      projectId,
      title: "新会话",
      status: "idle",
      updatedAt: Date.now(),
    };
    set((state) => ({ extra: [session, ...state.extra] }));
    return session;
  },
  rename: (sessionId, title) =>
    set((state) => ({
      extra: state.extra.map((session) =>
        session.id === sessionId ? { ...session, title } : session,
      ),
    })),
}));
