import { AppShell } from "@/app/AppShell";
import { useSessionMonitor } from "@/features/auth/useSessionMonitor";

export function WorkspaceHome({ view = "workspace" }: { view?: "workspace" | "service-ops" }) {
  useSessionMonitor();
  return <AppShell view={view} />;
}
