import type { ProjectFilter, WindowTab } from "./windowTypes";

export function isTabVisible(tab: WindowTab, filter: ProjectFilter): boolean {
  if (filter.mode === "all") return true;
  if (filter.mode === "global") return tab.projectId === null;
  return tab.projectId === filter.projectId;
}

export function filterTabs(tabs: WindowTab[], filter: ProjectFilter): WindowTab[] {
  return tabs.filter((tab) => isTabVisible(tab, filter));
}

export function activeWindowTab(tabs: WindowTab[], activeTabId: string | null) {
  if (tabs[0]?.kind === "terminal") {
    const terminals = tabs.filter((tab) => tab.resourceId !== "terminal:empty");
    return terminals.find((tab) => tab.id === activeTabId) ?? terminals.at(-1) ?? tabs[0];
  }
  return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
}

export function filterValue(filter: ProjectFilter): string {
  if (filter.mode === "all") return "all";
  if (filter.mode === "global") return "global";
  return `project:${filter.projectId}`;
}

export function filterFromValue(value: string): ProjectFilter {
  if (value === "global") return { mode: "global" };
  if (value.startsWith("project:")) {
    return { mode: "project", projectId: value.slice("project:".length) };
  }
  return { mode: "all" };
}

export function insertIntoTabGroup(tabs: WindowTab[], tab: WindowTab): WindowTab[] {
  let insertAt = tabs.length;
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    if (tabs[index]?.projectId === tab.projectId) {
      insertAt = index + 1;
      break;
    }
  }
  const next = [...tabs];
  next.splice(insertAt, 0, tab);
  return next;
}
