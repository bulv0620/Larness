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
  fireEvent.click(await screen.findByRole("button", { name: `打开终端 ${id}` }));
  await waitFor(() => expect(openTerminal).toHaveBeenCalledWith(row()));
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
  vi.mocked(listTerminals)
    .mockResolvedValueOnce({ items: [row("TERMINATED")], nextCursor: id })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [row()], nextCursor: null });
  picker();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("暂无运行中的终端")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("button", { name: `打开终端 ${id}` })).toBeVisible();
  expect(vi.mocked(listTerminals).mock.calls.at(-1)).toEqual([id, { projectId: "p" }]);
});
