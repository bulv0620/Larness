import type { GitActionView, GitStatusView } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitPanel } from "@/components/sections/GitPanel";
import { useWindowStore } from "@/stores/windowStore";

const projectId = "prj_git";
function statusView(staged = false): GitStatusView {
  return {
    branch: "main",
    head: "a".repeat(40),
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: staged ? [{ path: "a.txt", origPath: null, status: "modified" }] : [],
    unstaged: staged ? [] : [{ path: "a.txt", origPath: null, status: "modified" }],
    untracked: ["new.txt"],
    conflicts: [],
    snapshotVersion: "snap-1",
  };
}
function action(
  status: GitActionView["status"],
  kind: GitActionView["kind"] = "push",
): GitActionView {
  return {
    id: "act_1",
    projectId,
    kind,
    risk: "L2",
    status,
    params: { action: "push" },
    paramsHash: "hash",
    snapshotVersion: "snap-1",
    requestedBy: "client",
    decidedBy: null,
    expiresAt: Date.now() + 60_000,
    decidedAt: null,
    startedAt: null,
    endedAt: null,
    result: null,
    createdAt: Date.now(),
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GitPanel projectId={projectId} />
    </QueryClientProvider>,
  );
}

it("shows real Git status, stages selected paths and commits staged content", async () => {
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  let staged = false;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/git/status"))
      return new Response(JSON.stringify(statusView(staged)), { status: 200 });
    if (url.includes("/git/branches"))
      return new Response(
        JSON.stringify({
          items: [{ name: "main", current: true, head: "a".repeat(40) }],
        }),
        { status: 200 },
      );
    if (url.includes("/git/actions")) {
      const body = JSON.parse(String(options?.body)) as { action: string };
      if (body.action === "add") staged = true;
      return new Response(
        JSON.stringify(action("PREPARED", body.action as GitActionView["kind"])),
        {
          status: 201,
        },
      );
    }
    if (url.includes("/execute"))
      return new Response(JSON.stringify(action("COMPLETED", "add")), { status: 200 });
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPanel();
  await waitFor(() => expect(screen.getAllByText("main").length).toBeGreaterThan(0));
  expect(screen.getByText("a.txt")).toBeVisible();
  fireEvent.click(screen.getByLabelText("选择 a.txt"));
  fireEvent.click(screen.getByRole("button", { name: /暂存选中/ }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/git/actions"),
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.getByText("staged")).toBeVisible());
  fireEvent.change(screen.getByLabelText("提交信息"), { target: { value: "commit from ui" } });
  fireEvent.click(screen.getByRole("button", { name: /提交已暂存/ }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/execute"))).toBe(true),
  );
});

it("creates a pull/push plan, approves it once and executes the approved action", async () => {
  useWindowStore.setState({ windows: [], focusedId: null, lastFilters: {} });
  let decision = false;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/git/status"))
      return new Response(JSON.stringify(statusView(false)), { status: 200 });
    if (url.includes("/git/branches"))
      return new Response(
        JSON.stringify({ items: [{ name: "main", current: true, head: "a".repeat(40) }] }),
        {
          status: 200,
        },
      );
    if (url.includes("/decision")) {
      decision = true;
      return new Response(JSON.stringify(action("APPROVED")), { status: 200 });
    }
    if (url.includes("/execute"))
      return new Response(JSON.stringify(action("COMPLETED")), { status: 200 });
    if (url.includes("/git/actions"))
      return new Response(JSON.stringify(action("WAITING_APPROVAL")), { status: 201 });
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPanel();
  await waitFor(() => expect(screen.getAllByText("main").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "推送" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Git 操作审批" })).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "批准" }));
  await waitFor(() => expect(decision).toBe(true));
  const executeButton = await screen.findByRole("button", { name: "执行一次" });
  await waitFor(() => expect(executeButton).toBeEnabled());
  fireEvent.click(executeButton);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/execute"))).toBe(true),
  );
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Git 操作审批" })).not.toBeInTheDocument(),
  );
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/execute"))).toHaveLength(1);
});
