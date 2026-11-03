import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandCard } from "./CommandCard";

vi.mock("./useCommandWatch", () => ({ useCommandWatch: () => "已连接" }));
it("shows real command state/output, explicit cancellation and a retained-output gap", async () => {
  const id = "cmd_00000000-0000-0000-0000-000000000001";
  let cancelled = false;
  const calls: { url: string; method?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      calls.push({ url, method: options?.method });
      if (options?.method === "POST") cancelled = true;
      return new Response(
        JSON.stringify(
          url.includes("/output?")
            ? {
                chunks: [{ cursor: 1, channel: "stdout", data: "public output\n", timestamp: 0 }],
                oldestCursor: 1,
                nextCursor: 1,
                truncated: true,
                resyncRequired: true,
              }
            : {
                id,
                scope: { projectId: "p" },
                status: cancelled ? "CANCELLED" : "RUNNING",
                exitCode: null,
                reasonCode: cancelled ? "CANCELLED" : null,
                truncated: false,
                startedAt: 0,
                endedAt: null,
                currentSequence: 2,
              },
        ),
        { status: 200 },
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <CommandCard commandId={id} />
    </QueryClientProvider>,
  );
  try {
    expect(await screen.findByText("public output")).toBeVisible();
    expect(screen.getByText(/输出有缺口/)).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "取消命令" }));
    await waitFor(() => expect(screen.getByText("已取消")).toBeVisible());
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      { url: `/api/commands/${id}/cancel`, method: "POST" },
    ]);
  } finally {
    view.unmount();
    client.clear();
    vi.unstubAllGlobals();
  }
});
