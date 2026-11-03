import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FileWindow } from "@/features/windows/FileWindow";
import { queryClient } from "@/lib/queries";
import type { WindowTab } from "@/lib/windowTypes";
import * as api from "./api";
import { fileKey } from "./api";
import { useFileDraftStore } from "./drafts";

vi.mock("@/features/files/FileEditor", () => ({
  default: ({ text, onChange }: { text: string; onChange: (text: string) => void }) => (
    <textarea
      aria-label="test editor"
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

it("keeps a dirty draft across a new server snapshot and unmount, and reloads only by explicit choice", async () => {
  queryClient.clear();
  useFileDraftStore.setState({ drafts: {}, saving: {} });
  const scope = { projectId: "p" };
  const doc = {
    path: "note",
    realPath: "/project/note",
    content: "initial",
    version: "a".repeat(64),
    size: 7,
    encoding: "utf-8" as const,
  };
  vi.spyOn(api, "readFile").mockResolvedValue(doc);
  const tab: WindowTab = {
    id: "tab",
    kind: "files",
    resourceId: doc.realPath,
    title: "note",
    projectId: "p",
    sourceSessionId: null,
    originType: "project",
    file: { scope, path: "note" },
  };
  const mount = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <FileWindow tab={tab} />
      </QueryClientProvider>,
    );
  const first = mount();
  const editor = await screen.findByLabelText("test editor");
  fireEvent.change(editor, { target: { value: "my draft" } });
  const changed = { ...doc, content: "external", version: "b".repeat(64) };
  vi.mocked(api.readFile).mockResolvedValue(changed);
  act(() => queryClient.setQueryData(fileKey(scope, "note"), changed));
  expect(await screen.findByText("磁盘文件已变化，草稿已保留。")).toBeVisible();
  expect(screen.getByLabelText("保存文件")).toBeDisabled();
  expect(editor).toHaveValue("my draft");
  first.unmount();
  mount();
  await waitFor(() => expect(screen.getByLabelText("test editor")).toHaveValue("my draft"));
  fireEvent.click(screen.getByText("重新加载磁盘"));
  expect(screen.getByLabelText("test editor")).toHaveValue("external");
  expect(useFileDraftStore.getState().drafts[doc.realPath]).toBeUndefined();
});
