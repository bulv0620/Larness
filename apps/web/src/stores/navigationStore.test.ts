import { beforeEach, expect, it } from "vitest";
import { useNavigationStore } from "./navigationStore";

beforeEach(() => {
  useNavigationStore.setState({
    projectId: null,
    sessionId: "",
    pinnedSessionId: null,
    draftSession: null,
  });
});
it("retains a selected project draft across persistence and workspace reconciliation", async () => {
  useNavigationStore.getState().startDraft("project-a");
  const id = useNavigationStore.getState().sessionId;
  const persisted = localStorage.getItem("larness.nav.v1");
  expect(persisted).toContain('"draftSession"');
  useNavigationStore.setState({
    projectId: null,
    sessionId: "",
    pinnedSessionId: null,
    draftSession: null,
  });
  localStorage.setItem("larness.nav.v1", persisted ?? "");
  await useNavigationStore.persist.rehydrate();
  useNavigationStore
    .getState()
    .reconcileWorkspace(["project-a", "project-b"], [{ id: "other", projectId: "project-b" }]);
  expect(useNavigationStore.getState()).toMatchObject({
    projectId: "project-a",
    sessionId: id,
    draftSession: { id, projectId: "project-a" },
  });
});
it("keeps an explicitly pinned hidden session through workspace reconciliation", () => {
  useNavigationStore.getState().openPinnedSession("ses_job", null);
  useNavigationStore
    .getState()
    .reconcileWorkspace(["project-a"], [{ id: "other", projectId: "project-a" }]);
  expect(useNavigationStore.getState()).toMatchObject({
    projectId: null,
    sessionId: "ses_job",
    pinnedSessionId: "ses_job",
  });
  useNavigationStore.getState().selectSession("other", "project-a");
  expect(useNavigationStore.getState().pinnedSessionId).toBeNull();
});
it("recovers older persisted draft identities without choosing another project's session", () => {
  useNavigationStore.setState({
    projectId: "project-a",
    sessionId: "draft_legacy",
    draftSession: null,
  });
  useNavigationStore
    .getState()
    .reconcileWorkspace(["project-a"], [{ id: "other", projectId: null }]);
  expect(useNavigationStore.getState()).toMatchObject({
    projectId: "project-a",
    sessionId: "draft_legacy",
    draftSession: { id: "draft_legacy", projectId: "project-a" },
  });
});
it("replaces and restores the expanded project map", () => {
  useNavigationStore.setState({ expandedProjects: { "project-a": true, "project-b": false } });
  const previous = useNavigationStore.getState().expandedProjects;

  useNavigationStore.getState().setExpandedProjects({ "project-a": false, "project-b": false });
  expect(useNavigationStore.getState().expandedProjects).toEqual({
    "project-a": false,
    "project-b": false,
  });

  useNavigationStore.getState().setExpandedProjects(previous);
  expect(useNavigationStore.getState().expandedProjects).toEqual({
    "project-a": true,
    "project-b": false,
  });
});

it("starts a default draft without selecting a registered project and falls back safely after project removal", () => {
  useNavigationStore
    .getState()
    .reconcileWorkspace(["project-a"], [{ id: "other", projectId: "project-a" }]);
  expect(useNavigationStore.getState().projectId).toBeNull();
  expect(useNavigationStore.getState().draftSession?.projectId).toBeNull();
  useNavigationStore.getState().startDraft("gone");
  useNavigationStore.getState().reconcileWorkspace(["project-a"], []);
  expect(useNavigationStore.getState().projectId).toBeNull();
  expect(useNavigationStore.getState().sessionId).toMatch(/^draft_/);
});
