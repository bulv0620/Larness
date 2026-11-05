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

it("shows real Git status, stages explicit row paths and commits staged content", async () => {
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
  expect(screen.getByRole("button", { name: /提交已暂存/ })).toBeDisabled();
  expect(screen.queryByLabelText("新分支名")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "管理分支" }));
  expect(screen.getByLabelText("切换分支")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭分支管理" }));
  fireEvent.click(screen.getByRole("button", { name: "查看差异 a.txt" }));
  expect(useWindowStore.getState().windows[0]?.tabs[0]).toMatchObject({
    projectId,
    git: { path: "a.txt", staged: false },
  });
  fireEvent.click(screen.getByRole("button", { name: "暂存 a.txt" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/git/actions"),
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.getByText("已暂存")).toBeVisible());
  const stagedRequest = fetchMock.mock.calls.find(
    ([url, options]) =>
      url.includes("/git/actions") && JSON.parse(String(options?.body)).action === "add",
  );
  expect(JSON.parse(String(stagedRequest?.[1]?.body))).toEqual({ action: "add", paths: ["a.txt"] });
  fireEvent.change(screen.getByLabelText("提交信息"), { target: { value: "commit from ui" } });
  fireEvent.click(screen.getByRole("button", { name: /提交已暂存/ }));
  await waitFor(() => expect(screen.getByLabelText("提交信息")).toHaveValue(""));
  const commitRequest = fetchMock.mock.calls.find(
    ([url, options]) =>
      url.includes("/git/actions") && JSON.parse(String(options?.body)).action === "commit",
  );
  expect(JSON.parse(String(commitRequest?.[1]?.body))).toEqual({
    action: "commit",
    message: "commit from ui",
  });
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

it("shows unavailable Git as a muted empty state without repository actions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "GIT_UNAVAILABLE", message: "unavailable" } }),
          { status: 503 },
        ),
    ),
  );
  renderPanel();
  const empty = await screen.findByText("Git 暂不可用");
  expect(empty).toHaveClass("text-ink-3");
  expect(empty).not.toHaveClass("text-danger");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "推送" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
});

it("keeps refresh feedback on the button without inserting a processing row", async () => {
  let reads = 0;
  let finish: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/git/status")) {
        if (++reads > 1) await gate;
        return new Response(JSON.stringify(statusView()), { status: 200 });
      }
      if (url.includes("/git/branches"))
        return new Response(
          JSON.stringify({ items: [{ name: "main", current: true, head: "a".repeat(40) }] }),
          { status: 200 },
        );
      return new Response("{}", { status: 404 });
    }),
  );
  renderPanel();
  const refresh = await screen.findByRole("button", { name: "刷新 Git" });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeDisabled());
  expect(refresh).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("正在处理…")).not.toBeInTheDocument();
  expect(screen.getByText("a.txt")).toBeVisible();
  finish?.();
  await waitFor(() => expect(refresh).toBeEnabled());
  expect(refresh).toHaveAttribute("aria-busy", "false");
});

it("unstages exact paths and only discards an untracked file after confirmation", async () => {
  let staged = true,
    removed = false,
    kind: GitActionView["kind"] = "unstage";
  const mutations: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/git/status"))
        return new Response(
          JSON.stringify({ ...statusView(staged), untracked: removed ? [] : ["new.txt"] }),
          { status: 200 },
        );
      if (url.includes("/git/branches"))
        return new Response(
          JSON.stringify({ items: [{ name: "main", current: true, head: "a".repeat(40) }] }),
          { status: 200 },
        );
      if (url.includes("/git/actions")) {
        const body = JSON.parse(String(options?.body));
        mutations.push(body);
        kind = body.action;
        return new Response(JSON.stringify(action("PREPARED", kind)), { status: 201 });
      }
      if (url.includes("/execute")) {
        if (kind === "unstage") staged = false;
        if (kind === "discard") removed = true;
        return new Response(JSON.stringify(action("COMPLETED", kind)), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "取消暂存 a.txt" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "暂存 a.txt" })).toBeEnabled());
  expect(mutations).toEqual([{ action: "unstage", paths: ["a.txt"] }]);
  fireEvent.click(screen.getByRole("button", { name: "放弃更改 new.txt" }));
  const dialog = await screen.findByRole("dialog", { name: "放弃更改？" });
  expect(dialog).toHaveTextContent("无法通过 Git 恢复");
  expect(mutations).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(mutations).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "放弃更改 new.txt" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认放弃" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "放弃更改 new.txt" })).toBeNull(),
  );
  expect(mutations).toEqual([
    { action: "unstage", paths: ["a.txt"] },
    { action: "discard", path: "new.txt", confirmed: true },
  ]);
});
