import type { GatewaySnapshot } from "@larness/shared";
import type { WindowTab } from "@/lib/windowTypes";

export function useWindowTitle(tab: WindowTab | undefined, data: GatewaySnapshot): string {
  if (!tab) return "窗口";
  if (tab.kind === "services") {
    return data.services.find((service) => service.id === tab.resourceId)?.name ?? tab.title;
  }
  if (tab.kind === "terminal") {
    return data.terminals.find((terminal) => terminal.id === tab.resourceId)?.title ?? tab.title;
  }
  return tab.title;
}
