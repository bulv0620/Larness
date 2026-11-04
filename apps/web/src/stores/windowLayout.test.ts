import { expect, it } from "vitest";
import type { ManagedWindow, WindowTab } from "@/lib/windowTypes";
import { migrateWindowLayout, useWindowStore } from "./windowStore";

function tab(
  partial: Partial<WindowTab> & Pick<WindowTab, "id" | "kind" | "resourceId">,
): WindowTab {
  return {
    title: partial.resourceId,
    projectId: "project-a",
    sourceSessionId: null,
    originType: "project",
    ...partial,
  };
}
function win(tabs: WindowTab[]): ManagedWindow {
  return {
    id: "win_1",
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    filter: { mode: "all" },
    x: 0,
    y: 0,
    width: 800,
    height: 500,
    z: 10,
    minimized: false,
    maximized: false,
    pinned: false,
    restore: null,
  };
}

it("migrates layout identity and drops demo/service/browser tabs in real mode", () => {
  const migrated = migrateWindowLayout(
    {
      windows: [
        win([
          tab({
            id: "demo",
            kind: "files",
            resourceId: "apps/web/App.tsx",
            projectId: "prj_larness",
          }),
          tab({ id: "service", kind: "services", resourceId: "svc_web_dev" }),
          tab({ id: "browser", kind: "browser", resourceId: "browser_preview" }),
          tab({
            id: "terminal",
            kind: "terminal",
            resourceId: "term_00000000-0000-0000-0000-000000000001",
          }),
          tab({
            id: "file",
            kind: "files",
            resourceId: "/project/a.txt",
            file: { scope: { projectId: "project-a" }, path: "a.txt" },
          }),
        ]),
        win([tab({ id: "empty", kind: "services", resourceId: "svc_gone" })]),
      ],
      focusedId: "win_1",
      zCounter: 12,
      lastFilters: {},
    },
    2,
  ) as { windows: ManagedWindow[]; focusedId: string | null };
  expect(migrated.windows).toHaveLength(2);
  const tabs = migrated.windows.flatMap((item) => item.tabs);
  expect(tabs.map((item) => item.id)).toEqual(["terminal", "file"]);
  expect(tabs[0]?.viewKey).toBe("terminal:term_00000000-0000-0000-0000-000000000001");
  expect(tabs[1]?.viewKey).toBe("file:/project/a.txt");
  expect(tabs.every((item) => typeof item.createdAt === "number")).toBe(true);
  expect(migrated.windows[0]?.activeTabId).toBe("terminal");
  expect(migrated.focusedId).toBe("win_1");
});

it("deduplicates Git diffs by project and path and updates staged metadata in place", () => {
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  const base = {
    kind: "git-diff" as const,
    resourceId: "diff:project-a:a.txt",
    title: "a.txt",
    projectId: "project-a",
    source: "project" as const,
    git: { path: "a.txt", staged: false },
  };
  useWindowStore.getState().open(base);
  useWindowStore.getState().open({ ...base, git: { path: "a.txt", staged: true } });
  let windows = useWindowStore.getState().windows;
  expect(windows[0]?.tabs).toHaveLength(1);
  expect(windows[0]?.tabs[0]?.git?.staged).toBe(true);
  useWindowStore.getState().open({
    ...base,
    resourceId: "diff:project-b:a.txt",
    projectId: "project-b",
  });
  windows = useWindowStore.getState().windows;
  expect(windows).toHaveLength(2);
  expect(windows.map((item) => item.tabs[0]?.projectId)).toEqual(["project-a", "project-b"]);
});

it("closing every window kind preserves its tabs and restores the same view", () => {
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  for (const kind of ["files", "terminal", "browser", "git-diff"] as const) {
    useWindowStore
      .getState()
      .open({ kind, resourceId: kind, title: kind, projectId: "a", source: "project" });
  }
  const previous = useWindowStore.getState().windows;
  for (const item of previous) useWindowStore.getState().close(item.id);
  expect(useWindowStore.getState().windows).toHaveLength(previous.length);
  expect(useWindowStore.getState().windows.every((item) => item.minimized)).toBe(true);
  for (const item of previous) {
    useWindowStore.getState().restore(item.id);
    expect(useWindowStore.getState().windows.find((win) => win.id === item.id)?.tabs).toEqual(
      item.tabs,
    );
  }
});

it("splits persisted mixed-project windows without losing tabs or their layout", () => {
  const migrated = migrateWindowLayout(
    {
      windows: [
        win([
          tab({ id: "a", kind: "terminal", resourceId: "term_a", projectId: "a" }),
          tab({ id: "b", kind: "terminal", resourceId: "term_b", projectId: "b" }),
        ]),
      ],
    },
    3,
  ) as { windows: ManagedWindow[] };
  expect(migrated.windows).toHaveLength(2);
  expect(new Set(migrated.windows.map((item) => item.id)).size).toBe(2);
  expect(migrated.windows.map((item) => item.tabs.map((t) => t.id))).toEqual([["a"], ["b"]]);
  expect(migrated.windows.every((item) => item.width === 800)).toBe(true);
});
