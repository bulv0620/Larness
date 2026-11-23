import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DiffView } from "@/features/windows/DiffView";
import type { WindowTab } from "@/lib/windowTypes";

function renderDiff(staged: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tab: WindowTab = {
    id: "tab",
    kind: "git-diff",
    resourceId: "new file.txt",
    title: "new file.txt",
    projectId: "prj_1",
    sourceSessionId: null,
    originType: "project",
    git: { path: "new file.txt", staged },
  };
  return render(
    <QueryClientProvider client={client}>
      <DiffView tab={tab} />
    </QueryClientProvider>,
  );
}

it("explains an empty diff instead of rendering a blank panel", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          path: "new file.txt",
          staged: false,
          diff: "",
          binary: false,
          truncated: false,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  renderDiff(false);
  expect(await screen.findByText("工作区没有未暂存的文本差异。")).toBeVisible();
  expect(screen.getByText(/未跟踪文件、仅权限或行尾变化/)).toBeVisible();
  expect(screen.queryByText("Diff 超过 1 MiB，已截断；不自动写入或覆盖文件。")).toBeNull();
});
