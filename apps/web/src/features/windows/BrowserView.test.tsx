import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { BrowserView } from "./BrowserView";

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/features/services/api", async (original) => ({
  ...(await original<typeof import("@/features/services/api")>()),
  resolvePreview: vi.fn(),
}));

const { resolvePreview } = await import("@/features/services/api");

const tab = {
  id: "tab-preview",
  kind: "browser" as const,
  resourceId: "browser:svc_00000000-0000-0000-0000-000000000001:/",
  title: "预览 web",
  projectId: "prj_1",
  sourceSessionId: null,
  originType: "artifact" as const,
  browser: {
    serviceId: "svc_00000000-0000-0000-0000-000000000001",
    path: "/",
  },
};

it("resolves a one-time ticket and submits it through a POST bootstrap form, never the URL", async () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
  vi.mocked(resolvePreview).mockResolvedValue({
    origin: "http://abc123.preview.localhost:3211",
    bootstrapUrl: "http://abc123.preview.localhost:3211/__bootstrap",
    ticket: "ticket-1",
    expiresAt: Date.now() + 30_000,
    mode: "embedded",
  });
  const { container } = render(<BrowserView tab={tab} />);
  expect(screen.getByRole("button", { name: "在独立来源打开" })).toBeTruthy();
  await waitFor(() => expect(resolvePreview).toHaveBeenCalledWith(tab.browser.serviceId, "/"));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const form = container.querySelector("form");
  expect(form?.getAttribute("action")).toBe("http://abc123.preview.localhost:3211/__bootstrap");
  expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
  expect((form?.querySelector('input[name="ticket"]') as HTMLInputElement | null)?.value).toBe(
    "ticket-1",
  );
  const iframe = container.querySelector("iframe");
  expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin");
  expect(container.textContent).not.toContain("ticket-1");
  expect(screen.getByText("独立来源", { exact: true })).toHaveClass("whitespace-nowrap");
  expect(screen.queryByText(/不共享管理 Cookie/)).not.toBeInTheDocument();
  submit.mockRestore();
});

it("shows a generic unreachable state with refresh when the service is gone", async () => {
  vi.mocked(resolvePreview).mockRejectedValue(
    new ApiError(401, "PREVIEW_UNAVAILABLE", "Service is not available for preview"),
  );
  const { findByText, queryByText } = render(<BrowserView tab={tab} />);
  expect(await findByText("无法访问")).toBeTruthy();
  expect(await findByText("刷新")).toBeTruthy();
  expect(queryByText(/preview\.enabled/)).toBeNull();
});

it("keeps the same unreachable state when the gateway is disabled", async () => {
  vi.mocked(resolvePreview).mockRejectedValue(
    new ApiError(503, "PREVIEW_DISABLED", "Preview is not enabled"),
  );
  const { findByText } = render(<BrowserView tab={tab} />);
  expect(await findByText("无法访问")).toBeTruthy();
  expect(await findByText("刷新")).toBeTruthy();
});
