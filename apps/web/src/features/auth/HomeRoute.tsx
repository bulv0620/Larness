import { WorkspaceHome } from "@/features/workspace/WorkspaceHome";
import { AuthErrorState, AuthLoading } from "./AuthFrame";
import { RequireAuth } from "./RequireAuth";
import { useBootstrap } from "./useAuth";

export function HomeRoute({ view = "workspace" }: { view?: "workspace" | "service-ops" }) {
  const bootstrap = useBootstrap();

  if (bootstrap.isPending) {
    return <AuthLoading label="正在检查工作空间…" />;
  }

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
      <WorkspaceHome view={view} />
    </RequireAuth>
  );
}
