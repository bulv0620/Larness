import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "@/features/files/api";
import { queryClient } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore } from "@/stores/windowStore";
import { FileTreePanel } from "./FileTreePanel";

vi.mock("@/features/files/useFileWatch", () => ({ useFileWatch: vi.fn() }));
vi.mock("@/lib/queries", async (original) => ({
  ...(await original<typeof import("@/lib/queries")>()),
  useSnapshot: () => ({ data: { sessions: [] } }),
}));
vi.mock("@/features/files/api", { spy: true });

const revision = "a".repeat(64);
const file = { path: "folder/note.txt", name: "note.txt", type: "file" } as const;

beforeEach(() => {
  queryClient.clear();
  useWindowStore.setState({ windows: [], focusedId: null });
  useNavigationStore.setState({ expandedFileDirectories: {}, fileReveal: null });
  vi.mocked(api.listDirectory).mockReset();
});

function tree(projectId: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <FileTreePanel projectId={projectId} />
    </QueryClientProvider>
  );
}

it("reveals a file beyond the first page and keeps expansion scoped to the project", async () => {
  vi.mocked(api.listDirectory).mockImplementation(async (_scope, path, cursor) => ({
    revision,
    items:
      path === "."
        ? [{ path: "folder", name: "folder", type: "directory" }]
        : cursor
          ? [file]
          : [{ path: "folder/first.txt", name: "first.txt", type: "file" }],
    nextCursor: path === "folder" && !cursor ? "next" : null,
  }));
  const view = render(tree("p1"));
  await screen.findByRole("button", { name: "目录 folder" });
  act(() => useNavigationStore.getState().revealFile("project:p1", file.path));
  const row = await screen.findByRole("button", { name: "打开文件 note.txt" });
  expect(row).toHaveFocus();
  expect(row).toHaveAttribute("aria-current", "true");
  expect(vi.mocked(api.listDirectory)).toHaveBeenCalledWith({ projectId: "p1" }, "folder", "next");

  fireEvent.keyDown(row, { key: "ArrowLeft" });
  expect(screen.getByRole("button", { name: "目录 folder" })).toHaveFocus();

  view.rerender(tree("p2"));
  expect(await screen.findByRole("button", { name: "目录 folder" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  view.rerender(tree("p1"));
  expect(await screen.findByRole("button", { name: "目录 folder" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

it("ignores a slower open when the user clicks a different file", async () => {
  vi.mocked(api.listDirectory).mockResolvedValue({
    revision,
    items: [
      { path: "slow.txt", name: "slow.txt", type: "file" },
      { path: "fast.txt", name: "fast.txt", type: "file" },
    ],
    nextCursor: null,
  });
  type Document = Awaited<ReturnType<typeof api.readFile>>;
  let resolveSlow: (doc: Document) => void = () => {};
  const slow = new Promise<Document>((resolve) => {
    resolveSlow = resolve;
  });
  const document = {
    path: "fast.txt",
    realPath: "/p/fast.txt",
    version: revision,
    content: "",
    size: 0,
    encoding: "utf-8" as const,
  };
  vi.spyOn(api, "readFile").mockImplementation(async (_scope, path) =>
    path === "slow.txt" ? slow : document,
  );
  render(tree("p"));
  fireEvent.click(await screen.findByRole("button", { name: "打开文件 slow.txt" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "打开文件 fast.txt" })));
  await act(async () => resolveSlow({ ...document, path: "slow.txt", realPath: "/p/slow.txt" }));
  expect(useWindowStore.getState().windows[0]?.tabs.map((tab) => tab.title)).toEqual(["fast.txt"]);
});
