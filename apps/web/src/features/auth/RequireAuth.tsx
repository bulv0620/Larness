import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "./useAuth";

export function RequireAuth({
  children,
  redirectTo = "/login",
}: {
  children: ReactNode;
  redirectTo?: string;
}) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return null;

  if (!session.data) {
    const target =
      redirectTo === "/login"
        ? `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`
        : redirectTo;

    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
