import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";
import { openFile, saveDraft } from "./actions";
import * as api from "./api";
import { useFileDraftStore } from "./drafts";

const version = "a".repeat(64);
const nextVersion = "b".repeat(64);
const document = {
  path: "note.txt",
  realPath: "/project/note.txt",
  content: "seed\r\n",
  version,
  size: 6,
  encoding: "utf-8" as const,
};
beforeEach(() => {
  queryClient.clear();
  useWindowStore.setState({ windows: [], focusedId: null });
  useFileDraftStore.setState({ drafts: {}, saving: {} });
});
it("authorizes each source before deduplicating a real file and never persists its draft", async () => {
  const read = vi.spyOn(api, "readFile").mockResolvedValue(document);
  await openFile({ projectId: "project-a" }, "note.txt", "project");
  await openFile({ projectId: "project-b" }, "note.txt", "agent");
  expect(read).toHaveBeenCalledTimes(2);
  expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(1);
  expect(useWindowStore.getState().windows).toHaveLength(2);
  expect(useWindowStore.getState().windows[1]?.tabs[0]?.projectId).toBe("project-b");
  useFileDraftStore.getState().edit(document.realPath, "private draft", version);
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("Missing file window");
  useWindowStore.getState().close(win.id);
  // Document windows request confirmation instead of minimizing; no draft is persisted meanwhile.
  expect(useWindowStore.getState().closeRequest?.windowId).toBe(win.id);
  expect(useWindowStore.getState().windows).toHaveLength(2);
  expect(useFileDraftStore.getState().drafts[document.realPath]?.text).toBe("private draft");
  expect(localStorage.getItem("larness.windows.v2")).not.toContain("private draft");
});
it("preserves a draft on VERSION_CONFLICT, and only a deliberate merge adopts the new version", async () => {
  vi.spyOn(api, "readFile").mockResolvedValue(document);
  await openFile({ projectId: "project-a" }, "note.txt", "project");
  const tab = useWindowStore.getState().windows[0]?.tabs[0];
  if (!tab) throw new Error("Missing tab");
  useFileDraftStore.getState().edit(document.realPath, "mine", version);
  const save = vi
    .spyOn(api, "writeFile")
    .mockRejectedValueOnce(new ApiError(409, "VERSION_CONFLICT", "conflict"));
  await expect(saveDraft(tab)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(useFileDraftStore.getState().drafts[document.realPath]).toEqual({
    text: "mine",
    baseVersion: version,
  });
  useFileDraftStore.getState().edit(document.realPath, "merged", nextVersion);
  save.mockResolvedValueOnce({ ...document, version: nextVersion, previousVersion: version });
  await saveDraft(tab);
  expect(save.mock.calls[1]?.[3]).toBe(nextVersion);
  expect(useFileDraftStore.getState().drafts[document.realPath]).toBeUndefined();
});

it("replaces only the clean preview and keeps one tab for explicit opens of the same file", async () => {
  const scope = { projectId: "project-a" };
  vi.spyOn(api, "readFile").mockImplementation(async (_scope, path) => ({
    ...document,
    path,
    realPath: `/project/${path}`,
  }));
  await openFile(scope, "note.txt", "project", { preview: true });
  expect(useWindowStore.getState().windows[0]?.tabs[0]).toMatchObject({
    title: "note.txt",
    preview: true,
  });
  await openFile(scope, "another.txt", "project", { preview: true });
  const preview = useWindowStore.getState().windows[0]?.tabs[0];
  expect(useWindowStore.getState().windows[0]?.tabs.map((tab) => tab.title)).toEqual([
    "another.txt",
  ]);
  await openFile(scope, "another.txt", "agent");
  expect(useWindowStore.getState().windows[0]?.tabs[0]).toMatchObject({
    id: preview?.id,
    preview: false,
  });
  await openFile(scope, "note.txt", "project", { preview: true });
  useFileDraftStore.getState().edit(document.realPath, "keep this", version);
  await openFile(scope, "third.txt", "project", { preview: true });
  expect(
    useWindowStore.getState().windows[0]?.tabs.map(({ title, preview }) => [title, preview]),
  ).toEqual([
    ["another.txt", false],
    ["note.txt", false],
    ["third.txt", true],
  ]);
  expect(useFileDraftStore.getState().drafts[document.realPath]?.text).toBe("keep this");
});

it("leaves the current preview in place when another file fails authorization", async () => {
  const scope = { projectId: "project-a" };
  vi.spyOn(api, "readFile")
    .mockResolvedValueOnce(document)
    .mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "forbidden"));
  await openFile(scope, document.path, "project", { preview: true });
  await expect(
    openFile(scope, "forbidden.txt", "project", { preview: true }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(useWindowStore.getState().windows[0]?.tabs[0]).toMatchObject({
    title: document.path,
    preview: true,
  });
});
