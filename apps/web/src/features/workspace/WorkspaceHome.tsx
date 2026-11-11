import { AppShell } from "@/app/AppShell";
import { useSessionMonitor } from "@/features/auth/useSessionMonitor";

export function WorkspaceHome({ version }: { version?: string }) {
  useSessionMonitor();
  return <AppShell version={version} />;
}
