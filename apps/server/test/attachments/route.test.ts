import { describe, expect, it } from "vitest";
import { resolveAttachmentRoute } from "../../src/modules/attachments/route.js";

const base = {
  modelAcceptsImages: false,
  ocrMode: "auto-local" as const,
  ocrAvailable: true,
  visionConnectionConfigured: false,
};

describe("attachment capability routing", () => {
  it("sends ready documents as text regardless of model vision", () => {
    expect(
      resolveAttachmentRoute({ ...base, kind: "document", status: "ready", method: "native" }),
    ).toMatchObject({ route: "document-text", errorCode: null });
  });

  it("prefers image passthrough when the model accepts images", () => {
    expect(
      resolveAttachmentRoute({
        ...base,
        kind: "image",
        status: "ready",
        method: "none",
        modelAcceptsImages: true,
      }),
    ).toMatchObject({ route: "image-passthrough" });
  });

  it("uses an existing OCR artifact for text-only models", () => {
    expect(
      resolveAttachmentRoute({ ...base, kind: "image", status: "ready", method: "ocr" }),
    ).toMatchObject({ route: "image-text" });
  });

  it("requests OCR before sending a text-only model an image", () => {
    expect(
      resolveAttachmentRoute({ ...base, kind: "image", status: "ready", method: "none" }),
    ).toMatchObject({ route: "image-needs-ocr" });
  });

  it("fails closed when neither OCR nor vision is available", () => {
    expect(
      resolveAttachmentRoute({
        ...base,
        kind: "image",
        status: "ready",
        method: "none",
        ocrAvailable: false,
      }),
    ).toMatchObject({ route: "image-unavailable", errorCode: "ATTACHMENT_VISION_UNAVAILABLE" });
  });

  it("only uses vision in explicit vision mode with a connection", () => {
    expect(
      resolveAttachmentRoute({
        ...base,
        kind: "image",
        status: "ready",
        method: "none",
        ocrAvailable: false,
        ocrMode: "vision",
        visionConnectionConfigured: true,
      }),
    ).toMatchObject({ route: "image-needs-vision" });
  });

  it("blocks pending and failed attachments", () => {
    expect(
      resolveAttachmentRoute({ ...base, kind: "document", status: "pending", method: "none" }),
    ).toMatchObject({ route: "not-ready", errorCode: "ATTACHMENT_NOT_READY" });
    expect(
      resolveAttachmentRoute({ ...base, kind: "document", status: "failed", method: "none" }),
    ).toMatchObject({ route: "document-failed", errorCode: "ATTACHMENT_PARSE_FAILED" });
  });
});
