import type { GatewaySnapshot } from "@larness/shared";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { USE_MOCKS } from "@/lib/env";
import {
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
