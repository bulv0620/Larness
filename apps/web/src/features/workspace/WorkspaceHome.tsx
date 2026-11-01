import { AppShell } from "@/app/AppShell";
import { useSessionMonitor } from "@/features/auth/useSessionMonitor";

export function WorkspaceHome() {
  useSessionMonitor();
  return <AppShell />;
}
