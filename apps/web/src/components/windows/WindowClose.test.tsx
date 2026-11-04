import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFileDraftStore } from "@/features/files/drafts";
import { useWindowStore } from "@/stores/windowStore";
import { WindowCloseDialog } from "./WindowCloseDialog";

vi.mock("@/features/files/actions", () => ({
  saveDraft: vi.fn().mockRejectedValue(new Error("conflict")),
}));
beforeEach(() => {
  useWindowStore.setState({ windows: [], focusedId: null });
  useFileDraftStore.setState({ drafts: {}, saving: {} });
});
function open(id: string, kind: "files" | "terminal" = "files") {
  useWindowStore.getState().open({
    kind,
    resourceId: id,
    title: id,
    projectId: "p",
    file: kind === "files" ? { scope: { projectId: "p" }, path: id } : undefined,
  });
}
it("confirms closing all document tabs, cancellation preserves them", () => {
  open("a");
  open("b");
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("missing");
  render(<WindowCloseDialog />);
  useWindowStore.getState().close(win.id);
  return waitFor(() => {
    expect(screen.getByText(/关闭 2 个 Tab/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(2);
  });
});
it("preserves dirty files on save failure or cancellation and discards only explicitly", async () => {
  open("a");
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("missing");
  useFileDraftStore.getState().edit("a", "changed", "v1");
  render(<WindowCloseDialog />);
  useWindowStore.getState().close(win.id);
  await screen.findByText("未保存的文件");
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  await screen.findByRole("alert");
  expect(useFileDraftStore.getState().drafts.a?.text).toBe("changed");
  expect(useWindowStore.getState().windows).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "放弃改动并继续" }));
  await waitFor(() => expect(useWindowStore.getState().windows).toHaveLength(0));
});
it("terminal close and minimize keep resource tabs", () => {
  open("term_x", "terminal");
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("missing");
  useWindowStore.getState().close(win.id);
  expect(useWindowStore.getState().windows[0]).toMatchObject({ minimized: true });
  expect(useWindowStore.getState().windows[0]?.tabs).toHaveLength(1);
});

it("closes all confirmed clean tabs without leaving a minimized document window", async () => {
  open("a");
  open("b");
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("missing");
  render(<WindowCloseDialog />);
  useWindowStore.getState().close(win.id);
  fireEvent.click(await screen.findByRole("button", { name: "关闭全部 Tab" }));
  await waitFor(() => expect(useWindowStore.getState().windows).toHaveLength(0));
});
