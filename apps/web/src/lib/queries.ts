import { QueryClient, useQuery } from "@tanstack/react-query";
import { snapshot } from "@/mocks/fixtures";
import { gateway } from "@/mocks/gateway";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export function useSnapshot() {
  return useQuery({
    queryKey: ["snapshot"],
    queryFn: () => gateway.snapshot(),
    initialData: snapshot,
  });
}
