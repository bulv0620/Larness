import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ artifact: vi.fn(), source: vi.fn() }));

vi.mock("@/lib/workspaceApi", () => ({
  attachmentUrl: (sessionId: string, id: string) => `/api/sessions/${sessionId}/attachments/${id}`,
  fetchAttachmentArtifact: mocks.artifact,
  fetchAttachmentSource: mocks.source,
}));

vi.mock("@/features/files/FileEditor", () => ({
  default: ({ text }: { text: string }) => <pre data-testid="source-editor">{text}</pre>,
}));

import { AttachmentPreview } from "./AttachmentPreview";

const sessionId = "ses_11111111-1111-4111-8111-111111111111";
const attachmentId = "att_11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.artifact.mockReset();
  mocks.source.mockReset();
  mocks.artifact.mockResolvedValue({ markdown: "# Parsed body", truncated: false, warnings: [] });
  mocks.source.mockResolvedValue({
    view: "source",
    content: "<style>.card { color: #c00; }</style>",
    lineStart: 1,
    lineEnd: 1,
    totalLines: 12,
    nextLine: 2,
    truncated: true,
    warnings: [],
  });
});

it("switches a text-like document to its original source", async () => {
  render(
    <AttachmentPreview
      sessionId={sessionId}
      target={{ id: attachmentId, filename: "page.html", kind: "document", mime: "text/html" }}
      onClose={() => {}}
    />,
  );

  expect(await screen.findByRole("heading", { name: "Parsed body" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "原文" }));

  expect(mocks.source).toHaveBeenCalledWith(sessionId, attachmentId, { maxChars: 60_000 });
  const editor = await screen.findByTestId("source-editor");
  // CSS survives the source view; the parsed view would have dropped it.
  expect(editor.textContent).toContain(".card { color: #c00; }");
  expect(screen.getByText(/第 1–1 行 · 共 12 行/)).toBeInTheDocument();
  expect(screen.getByText(/预览已截断/)).toBeInTheDocument();
});

it("offers only the parsed view for binary documents", async () => {
  render(
    <AttachmentPreview
      sessionId={sessionId}
      target={{ id: attachmentId, filename: "spec.pdf", kind: "document", mime: "application/pdf" }}
      onClose={() => {}}
    />,
  );

  expect(await screen.findByRole("heading", { name: "Parsed body" })).toBeInTheDocument();
  expect(screen.queryByRole("tablist", { name: "预览视图" })).toBeNull();
  expect(mocks.source).not.toHaveBeenCalled();
});

it("shows no view switch for images", async () => {
  render(
    <AttachmentPreview
      sessionId={sessionId}
      target={{ id: attachmentId, filename: "shot.png", kind: "image", mime: "image/png" }}
      onClose={() => {}}
    />,
  );

  expect(screen.getByAltText("shot.png")).toBeInTheDocument();
  expect(screen.queryByRole("tablist", { name: "预览视图" })).toBeNull();
});
