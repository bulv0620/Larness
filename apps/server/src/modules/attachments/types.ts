import path from "node:path";
import type { AttachmentKind, AttachmentStatus } from "../../db/schema.js";

export type { AttachmentKind, AttachmentStatus };

export const ATTACHMENT_ERROR_CODES = [
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_UNSUPPORTED",
  "ATTACHMENT_LIMIT",
  "ATTACHMENT_SECRET_FILE",
  "ATTACHMENT_VIEW_UNSUPPORTED",
  "ATTACHMENT_PARSE_FAILED",
  "ATTACHMENT_PARSE_TIMEOUT",
  "ATTACHMENT_ENCRYPTED",
  "ATTACHMENT_PDF_NO_TEXT",
  "ATTACHMENT_VISION_UNAVAILABLE",
  "ATTACHMENT_NOT_READY",
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_IN_USE",
  "ATTACHMENT_STORAGE_FAILED",
] as const;

export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number];

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
  }
}

export interface AttachmentSection {
  anchor: string;
  title: string;
  page?: number;
  tokens: number;
}

export interface AttachmentExtractorRef {
  id: string;
  version: string;
}

export type AttachmentMethod = "none" | "native" | "text-layer" | "ocr" | "vision";

export interface ExtractLimits {
  maxBytes: number;
  maxPdfPages: number;
  maxExtractedChars: number;
  timeoutMs: number;
  maxZipEntries: number;
  maxZipEntryBytes: number;
  maxZipTotalBytes: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxPdfPages: 400,
  maxExtractedChars: 200_000,
  timeoutMs: 60_000,
  maxZipEntries: 2_000,
  maxZipEntryBytes: 64 * 1024 * 1024,
  maxZipTotalBytes: 128 * 1024 * 1024,
};

export interface ExtractInput {
  bytes: Buffer;
  mime: string;
  filename: string;
  limits: ExtractLimits;
  signal?: AbortSignal;
}

export interface ExtractedAttachment {
  markdown: string;
  method: AttachmentMethod;
  pageCount: number | null;
  sections: AttachmentSection[];
  warnings: string[];
  extractor: AttachmentExtractorRef;
}

export interface DocumentExtractor {
  readonly id: string;
  readonly version: string;
  supports(mime: string): boolean;
  extract(input: ExtractInput): Promise<ExtractedAttachment>;
}

/** Which projection of an attachment a caller asks for. */
export const ATTACHMENT_VIEWS = ["text", "source"] as const;
export type AttachmentView = (typeof ATTACHMENT_VIEWS)[number];

/** Largest single `source` slice returned by a tool or the preview API. */
export const MAX_SOURCE_SLICE_CHARS = 12_000;
export const MAX_SOURCE_PREVIEW_CHARS = 60_000;

/** Bounds persisted parse output so a huge document cannot bloat SQLite. */
export const MAX_ATTACHMENT_SECTIONS = 500;
export const MAX_ATTACHMENT_SECTION_TITLE = 200;
export const MAX_ATTACHMENT_WARNINGS = 50;
export const MAX_FILENAME_LENGTH = 200;

/** Original file extensions keyed by the MIME types approved in Q-071. */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function attachmentExtension(mime: string): string | null {
  return MIME_EXTENSIONS[mime] ?? null;
}

export function isSupportedAttachmentMime(mime: string): boolean {
  return attachmentExtension(mime) !== null;
}

/**
 * Keeps only a basename with printable characters. The result is for display
 * and metadata only; storage paths are derived from IDs and MIME type.
 */
export function sanitizeFilename(input: string): string {
  const basename = input.split(/[\\/]/).at(-1) ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
  const printable = basename.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  const trimmed = printable.trim();
  if (trimmed.length === 0) return "file";
  return path.basename(trimmed).slice(0, MAX_FILENAME_LENGTH);
}
