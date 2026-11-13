import { WorkspaceHome } from "@/features/workspace/WorkspaceHome";
import { AuthErrorState } from "./AuthFrame";
import { RequireAuth } from "./RequireAuth";
import { useBootstrap } from "./useAuth";

export function HomeRoute() {
  const bootstrap = useBootstrap();

  if (bootstrap.isPending) return null;

  if (bootstrap.isError || !bootstrap.data) {
    return (
      <AuthErrorState
        message={bootstrap.error instanceof Error ? bootstrap.error.message : "本机服务未启动"}
        onRetry={() => void bootstrap.refetch()}
      />
    );
  }

  const auth = bootstrap.data.auth;
  const originMatches = window.location.origin === auth.passkeyOrigin;
  const usable = auth.passkeyEnabled && originMatches;
  const unauthenticatedTo = usable && auth.passkeyRegistered ? "/login" : "/pair";

  return (
    <RequireAuth redirectTo={unauthenticatedTo}>
      <WorkspaceHome version={bootstrap.data.app?.version} />
    </RequireAuth>
  );
}
