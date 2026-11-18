import type { GatewaySnapshot } from "@larness/shared";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { USE_MOCKS } from "@/lib/env";
import {
  type ApiModelCatalog,
  type ApiSessionUsage,
  getSession,
  getSessionUsage,
  listModelCatalog,
  listModels,
  listProjects,
  listSessions,
  toModelProfileView,
  toProjectView,
  toSessionView,
} from "@/lib/workspaceApi";
import { snapshot } from "@/mocks/fixtures";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const EMPTY_SNAPSHOT: GatewaySnapshot = {
  projects: [],
  sessions: [],
  models: [],
  host: {
    cpuPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    sampledAt: 0,
  },
  services: [],
  terminals: [],
  gitChanges: [],
};

async function loadWorkspace(): Promise<GatewaySnapshot> {
  const [projects, sessions, models] = await Promise.all([
    listProjects(),
    listSessions(),
    listModels(),
  ]);

  return {
    ...EMPTY_SNAPSHOT,
    projects: projects.map(toProjectView),
    sessions: sessions.map(toSessionView),
    models: models.map(toModelProfileView),
  };
}

export function useSnapshot() {
  const query = useQuery({
    queryKey: ["workspace"],
    queryFn: loadWorkspace,
    enabled: !USE_MOCKS,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const data = USE_MOCKS ? snapshot : (query.data ?? EMPTY_SNAPSHOT);

  return {
    ...query,
    data,
    isPending: USE_MOCKS ? false : query.isPending,
  };
}

const THINKING_LEVELS = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

function mockCatalog(): ApiModelCatalog {
  const models = snapshot.models.map((model, index) => ({
    id: model.model,
    label: model.label,
    contextWindow: model.maxContextTokens ?? 128_000,
    thinking: { supported: true, levels: THINKING_LEVELS },
    default: index === 0,
  }));
  const group = {
    provider: "deepseek" as const,
    credentialProfileId: "cred_mock",
    credentialLabel: "DeepSeek Key",
    syncedAt: null,
    stale: false,
    lastRefreshError: null,
    models,
  };

  return { ...group, groups: [group], defaultSelection: null };
}

export interface ModelCatalogResult {
  catalog: ApiModelCatalog | undefined;
  isPending: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export function useModelCatalog(): ModelCatalogResult {
  const query = useQuery({
    queryKey: ["model-catalog"],
    queryFn: listModelCatalog,
    enabled: !USE_MOCKS,
    staleTime: 0,
    retry: false,
  });

  if (USE_MOCKS) {
    return {
      catalog: mockCatalog(),
      isPending: false,
      error: null,
      refetch: async () => undefined,
    };
  }

  return {
    catalog: query.data,
    isPending: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

export const sessionDetailKey = (sessionId: string | null) => ["session-detail", sessionId];
export const sessionUsageKey = (sessionId: string | null) => ["session-usage", sessionId];
export const saveSessionSettingsKey = (sessionId: string) => ["save-session-settings", sessionId];

export function useSessionUsage(sessionId: string | null): ApiSessionUsage | null {
  const [data, setData] = useState<ApiSessionUsage | null>(() =>
    sessionId === null ? null : (queryClient.getQueryData(sessionUsageKey(sessionId)) ?? null),
  );

  useEffect(() => {
    if (USE_MOCKS || sessionId === null) {
      setData(null);
      return;
    }

    const key = sessionUsageKey(sessionId);
    let active = true;
    const read = () => {
      if (active) setData(queryClient.getQueryData<ApiSessionUsage>(key) ?? null);
    };
    const load = () => {
      void queryClient
        .fetchQuery({ queryKey: key, queryFn: () => getSessionUsage(sessionId), staleTime: 0 })
        .then(read)
        .catch(() => undefined);
    };

    read();
    load();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "session-usage" || event.query.queryKey[1] !== sessionId) {
        return;
      }
      read();
      if (event.type === "updated" && event.action.type === "invalidate") load();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return data;
}

export function useSessionDetail(sessionId: string | null) {
  const query = useQuery({
    queryKey: sessionDetailKey(sessionId),
    queryFn: () => getSession(sessionId ?? ""),
    enabled: !USE_MOCKS && sessionId !== null,
    staleTime: 0,
    retry: false,
  });

  return query.data ?? null;
}
