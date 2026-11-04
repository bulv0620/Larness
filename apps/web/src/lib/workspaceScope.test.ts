import type { SessionSummary } from "@larness/shared";
import { expect, it } from "vitest";
import { activeWindowScope, activeWorkspaceScope } from "./workspaceScope";

const sessions: SessionSummary[] = [
  { id: "a", projectId: null, workspaceKind: "default", title: "A", status: "idle", updatedAt: 1 },
  { id: "b", projectId: null, workspaceKind: "default", title: "B", status: "idle", updatedAt: 2 },
  {
    id: "old",
    projectId: null,
    workspaceKind: "session",
    title: "Old",
    status: "idle",
    updatedAt: 0,
  },
];
it("keeps default drafts and shared sessions in one window group without mixing legacy or project views", () => {
  for (const id of ["", "draft_new", "a", "b"]) {
    expect(activeWindowScope(null, id, sessions)).toBe("global");
    expect(activeWorkspaceScope(null, id, sessions)).toEqual({ workspace: "default" });
  }
  expect(activeWindowScope(null, "old", sessions)).toBe("session:old");
  expect(activeWorkspaceScope(null, "old", sessions)).toEqual({ sessionId: "old" });
  expect(activeWindowScope("project-a", "a", sessions)).toBe("project:project-a");
});
