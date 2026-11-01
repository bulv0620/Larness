import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, apiFetch, type BootstrapData, type SessionData, setCsrfToken } from "@/lib/api";

export function useBootstrap() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => apiFetch<BootstrapData>("/api/bootstrap"),
    staleTime: 5_000,
    retry: false,
  });
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        const session = await apiFetch<SessionData>("/api/auth/session");
        setCsrfToken(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
          setCsrfToken(null);
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useUnauthorizedRedirect(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (): void => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    };

    window.addEventListener("larness:unauthenticated", handler);
    return () => window.removeEventListener("larness:unauthenticated", handler);
  }, [queryClient]);
}
