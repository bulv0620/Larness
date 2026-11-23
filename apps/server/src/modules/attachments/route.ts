import type { AttachmentKind, AttachmentMethod, AttachmentStatus } from "./types.js";

export type AttachmentRoute =
  | "document-text"
  | "document-failed"
  | "image-passthrough"
  | "image-text"
  | "image-needs-ocr"
  | "image-needs-vision"
  | "image-unavailable"
  | "not-ready";

export interface RouteInput {
  kind: AttachmentKind;
  status: AttachmentStatus;
  method: AttachmentMethod;
  modelAcceptsImages: boolean;
  ocrMode: "off" | "auto-local" | "vision";
  ocrAvailable: boolean;
  visionConnectionConfigured: boolean;
}

export interface RouteDecision {
  route: AttachmentRoute;
  /** Stable error code when the attachment cannot be sent with this model. */
  errorCode:
    | "ATTACHMENT_NOT_READY"
    | "ATTACHMENT_PARSE_FAILED"
    | "ATTACHMENT_VISION_UNAVAILABLE"
    | null;
  reason?: string;
}

/**
 * Pure capability routing. Documents never depend on model vision; images use
 * the original bytes whenever the model accepts them and only then consider a
 * configured local OCR or explicitly enabled vision connection.
 */
export function resolveAttachmentRoute(input: RouteInput): RouteDecision {
  if (input.kind === "document") {
    if (input.status === "ready") return { route: "document-text", errorCode: null };
    if (input.status === "failed") {
      return { route: "document-failed", errorCode: "ATTACHMENT_PARSE_FAILED" };
    }
    return { route: "not-ready", errorCode: "ATTACHMENT_NOT_READY" };
  }

  if (input.modelAcceptsImages) {
    return { route: "image-passthrough", errorCode: null };
  }
  if (input.status === "ready" && (input.method === "ocr" || input.method === "vision")) {
    return { route: "image-text", errorCode: null };
  }
  if (input.status === "failed") {
    return { route: "image-unavailable", errorCode: "ATTACHMENT_VISION_UNAVAILABLE" };
  }
  if (input.status === "pending") {
    return { route: "not-ready", errorCode: "ATTACHMENT_NOT_READY" };
  }
  if (input.ocrMode !== "off" && input.ocrAvailable) {
    return { route: "image-needs-ocr", errorCode: null };
  }
  if (input.ocrMode === "vision" && input.visionConnectionConfigured) {
    return { route: "image-needs-vision", errorCode: null };
  }
  return {
    route: "image-unavailable",
    errorCode: "ATTACHMENT_VISION_UNAVAILABLE",
    reason: "the selected model has no image input and no OCR/vision fallback is enabled",
  };
}
