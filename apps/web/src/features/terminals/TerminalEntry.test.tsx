import type { LiveTerminal } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowTabs } from "@/components/windows/WindowTabs";
import { ApiError } from "@/lib/api";
import { useWindowStore } from "@/stores/windowStore";
import { listTerminals, openAgentTerminal, openTerminal, readTerminal } from "./api";
import { TerminalPicker } from "./TerminalPicker";
import { TerminalResultCard } from "./TerminalResultCard";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  listTerminals: vi.fn(),
  readTerminal: vi.fn(),
  openTerminal: vi.fn(),
  openAgentTerminal: vi.fn(),
}));
vi.mock("@/lib/queries", async (original) => ({
  ...(await original<typeof import("@/lib/queries")>()),
  useSnapshot: () => ({ data: { projects: [] } }),
}));
const id = "term_00000000-0000-0000-0000-000000000001";
function row(status: LiveTerminal["status"] = "RUNNING"): LiveTerminal {
  return {
    id,
    projectId: "p",
    workspaceSessionId: null,
    sourceSessionId: "s",
    cwd: "/project",
    shell: "/bin/sh",
    mode: "dev",
    role: "frontend",
    title: "开发",
    status,
    exitCode: null,
    reasonCode: null,
    currentSequence: 1,
    lease: null,
    writeBlocked: false,
  };
}
const target = { kind: "terminal" as const, projectId: "p", terminalId: id, role: "frontend" };
const clients: QueryClient[] = [];
function picker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <TerminalPicker projectId="p" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  useWindowStore.setState({ windows: [], focusedId: null });
});
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
});
it.each(["EXITED", "TERMINATED"] as const)(
  "reports %s as closed without restoring a tab",
  async (status) => {
    vi.mocked(readTerminal).mockResolvedValue(row(status));
    render(<TerminalResultCard target={target} />);
    fireEvent.click(screen.getByRole("button", { name: "打开终端 · frontend" }));
    expect(await screen.findByRole("status")).toHaveTextContent("终端已关闭");
    expect(openTerminal).not.toHaveBeenCalled();
    expect(openAgentTerminal).not.toHaveBeenCalled();
  },
);
it("checks fresh state before restoring a live terminal", async () => {
  const live = row();
  vi.mocked(readTerminal).mockResolvedValue(live);
  render(<TerminalResultCard target={target} />);
  fireEvent.click(screen.getByRole("button", { name: "打开终端 · frontend" }));
  await waitFor(() => expect(openTerminal).toHaveBeenCalledWith(live));
  expect(readTerminal).toHaveBeenCalledWith(id);
});
it("distinguishes removed terminals from a failed lookup and allows retry", async () => {
  vi.mocked(readTerminal)
    .mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "gone"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(row());
  render(<TerminalResultCard target={target} />);
  const button = screen.getByRole("button", { name: "打开终端 · frontend" });
  fireEvent.click(button);
  expect(await screen.findByRole("status")).toHaveTextContent("终端已关闭或已被清理");
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取终端状态");
  expect(openTerminal).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(openTerminal).toHaveBeenCalledTimes(1));
});
it.each(["STOPPING", "CREATED", "INTERRUPTED"] as const)(
  "does not reopen or claim an uncertain %s terminal has closed",
  async (status) => {
    vi.mocked(readTerminal).mockResolvedValue({ ...row(status), reasonCode: "STOP_UNCONFIRMED" });
    render(<TerminalResultCard target={target} />);
    fireEvent.click(screen.getByRole("button", { name: "打开终端 · frontend" }));
    expect(await screen.findByRole("status")).not.toHaveTextContent("终端已关闭");
    expect(openTerminal).not.toHaveBeenCalled();
  },
);
it("does not open a terminal after the message unmounts or issue duplicate lookups", async () => {
  let resolve: ((value: LiveTerminal) => void) | undefined;
  vi.mocked(readTerminal).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<TerminalResultCard target={target} />);
  const button = screen.getByRole("button", { name: "打开终端 · frontend" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(readTerminal).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => resolve?.(row()));
  expect(openTerminal).not.toHaveBeenCalled();
});
it("shows a simple empty state instead of ended-terminal history or a refresh toolbar", async () => {
  vi.mocked(listTerminals).mockResolvedValue({
    items: [row("TERMINATED"), { ...row("EXITED"), id: "old" }],
    nextCursor: null,
  });
  picker();
  expect(await screen.findByText("暂无运行中的终端")).toBeVisible();
  expect(screen.getByRole("button", { name: "新建终端" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^打开终端/ })).toBeNull();
  expect(screen.queryByText("刷新列表")).toBeNull();
});
it("finds running terminals after a page of history and revalidates restoration", async () => {
  vi.mocked(listTerminals).mockImplementation(async (cursor) =>
    cursor ? { items: [row()], nextCursor: null } : { items: [row("TERMINATED")], nextCursor: id },
  );
  vi.mocked(readTerminal).mockResolvedValue(row());
  picker();
  await waitFor(() => expect(openTerminal).toHaveBeenCalledWith(row()));
  expect(readTerminal).toHaveBeenCalledWith(id);
  expect(screen.queryByRole("button", { name: /^打开终端/ })).toBeNull();
  expect(listTerminals).toHaveBeenCalledWith(id, { projectId: "p" });
});
it("shows query failure with retry instead of a false empty state", async () => {
  vi.mocked(listTerminals)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ items: [], nextCursor: null });
  picker();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("暂无运行中的终端")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("暂无运行中的终端")).toBeVisible();
});
it("does not expose the internal terminal placeholder as a real tab", () => {
  useWindowStore
    .getState()
    .open({ kind: "terminal", resourceId: "terminal:empty", title: "终端", projectId: "p" });
  const win = useWindowStore.getState().windows[0];
  if (!win) throw Error("Missing window");
  render(<WindowTabs window={win} />);
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.getByRole("button", { name: "新建终端 Tab" })).toBeVisible();
});

it.each([
  { ...row(), projectId: "other" },
  { ...row(), id: "term_00000000-0000-0000-0000-000000000002" },
])("refuses a lookup result that does not match the original target", async (result) => {
  vi.mocked(readTerminal).mockResolvedValue(result);
  render(<TerminalResultCard target={target} />);
  fireEvent.click(screen.getByRole("button", { name: "打开终端 · frontend" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("终端归属已变化");
  expect(openTerminal).not.toHaveBeenCalled();
});

it("retains a retry when looking beyond ended-history pages fails", async () => {
  const readNext = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [row()], nextCursor: null });
  vi.mocked(listTerminals).mockImplementation(async (cursor) =>
    cursor ? readNext() : { items: [row("TERMINATED")], nextCursor: id },
  );
  vi.mocked(readTerminal).mockResolvedValue(row());
  picker();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("暂无运行中的终端")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(openTerminal).toHaveBeenCalledWith(row()));
  expect(listTerminals).toHaveBeenCalledWith(id, { projectId: "p" });
});

it("restores the newest running terminal and skips a candidate that exited during lookup", async () => {
  const older = { ...row(), id: "older" };
  const newest = { ...row(), id: "newest" };
  vi.mocked(listTerminals).mockImplementation(async (cursor) =>
    cursor ? { items: [newest], nextCursor: null } : { items: [older], nextCursor: older.id },
  );
  vi.mocked(readTerminal)
    .mockResolvedValueOnce({ ...newest, status: "EXITED" })
    .mockResolvedValueOnce(older);
  picker();
  await waitFor(() => expect(openTerminal).toHaveBeenCalledExactlyOnceWith(older));
  expect(vi.mocked(readTerminal).mock.calls).toEqual([[newest.id], [older.id]]);
});

it("selects the rightmost real terminal tab when the placeholder was previously selected", () => {
  const { open } = useWindowStore.getState();
  open({ kind: "terminal", resourceId: "terminal:empty", title: "终端", projectId: "p" });
  open({
    kind: "terminal",
    resourceId: "term_first",
    title: "前端",
    projectId: "p",
    activate: false,
  });
  open({
    kind: "terminal",
    resourceId: "term_last",
    title: "后端",
    projectId: "p",
    activate: false,
  });
  const win = useWindowStore.getState().windows[0];
  if (!win) throw Error("Missing window");
  const view = render(<WindowTabs window={win} />);
  expect(screen.getByRole("tab", { name: "后端" })).toHaveAttribute("aria-selected", "true");
  view.rerender(
    <WindowTabs
      window={{
        ...win,
        activeTabId: win.tabs.find((tab) => tab.resourceId === "term_first")?.id ?? null,
      }}
    />,
  );
  expect(screen.getByRole("tab", { name: "前端" })).toHaveAttribute("aria-selected", "true");
});

it("first opens the last background terminal and remembers that choice on restore", () => {
  const { open, restore } = useWindowStore.getState();
  open({
    kind: "terminal",
    resourceId: "term_first",
    title: "前端",
    projectId: "p",
    activate: false,
  });
  open({
    kind: "terminal",
    resourceId: "term_last",
    title: "后端",
    projectId: "p",
    activate: false,
  });
  const win = useWindowStore.getState().windows[0];
  if (!win) throw Error("Missing window");
  restore(win.id);
  open({
    kind: "terminal",
    resourceId: "term_new",
    title: "测试",
    projectId: "p",
    activate: false,
  });
  const restored = useWindowStore.getState().windows[0];
  if (!restored) throw Error("Missing restored window");
  render(<WindowTabs window={restored} />);
  expect(screen.getByRole("tab", { name: "后端" })).toHaveAttribute("aria-selected", "true");
});
