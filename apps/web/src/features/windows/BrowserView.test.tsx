import { render, waitFor } from "@testing-library/react";
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
  submit.mockRestore();
});

it("explains how to enable preview when the gateway is disabled", async () => {
  vi.mocked(resolvePreview).mockRejectedValue(
    new ApiError(503, "PREVIEW_UNAVAILABLE", "Preview is not enabled"),
  );
  const { findByText } = render(<BrowserView tab={tab} />);
  expect(await findByText(/预览功能未开启/)).toBeTruthy();
  expect(await findByText(/preview\.enabled=true/)).toBeTruthy();
});
