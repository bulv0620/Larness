import type { GatewaySnapshot } from "@larness/shared";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { USE_MOCKS } from "@/lib/env";
import {
  type ApiModelCatalog,
  getSession,
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
  host: { cpuPercent: 0, memoryUsedGb: 0, memoryTotalGb: 0 },
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

  return { ...group, groups: [group] };
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

export function useSessionModel(sessionId: string | null) {
  const query = useQuery({
    queryKey: ["session-model", sessionId],
    queryFn: () => getSession(sessionId ?? ""),
    enabled: !USE_MOCKS && sessionId !== null,
    staleTime: 0,
    retry: false,
  });

  return query.data ?? null;
}
