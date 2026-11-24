import { createHash } from "node:crypto";
import { isSourceViewMime } from "@larness/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { type SessionRow, sessionAttachments } from "../../db/schema.js";
import { estimateTextTokens as estimateTokens } from "../agent/tokenEstimator.js";
import { getSessionById } from "../sessions/repository.js";
import { extractAttachment, extractorRegistry } from "./extract.js";
import {
  createLocalOcrTranscriber,
  type ImageTranscriber,
  ocrAvailable,
} from "./extractors/ocr.js";
import { type VisionTranscriptionConfig, visionAvailable } from "./extractors/vision.js";
import { sniffAttachment } from "./mime.js";
import {
  type AttachmentDto,
  type AttachmentRow,
  attachmentDto,
  countAttachmentReferences,
  countAttachments,
  createAttachment,
  deleteAttachment,
  findAttachmentByDigest,
  getAttachment,
  listAllAttachments,
  listAttachmentStoragePaths,
  listAttachments,
  parseAttachmentSections,
  parseAttachmentWarnings,
  updateAttachmentStatus,
} from "./repository.js";
import { decodeSource, type SourceSlice, sourceSlice } from "./source.js";
import type { AttachmentStorage } from "./storage.js";
import {
  AttachmentError,
  type AttachmentKind,
  type AttachmentMethod,
  DEFAULT_EXTRACT_LIMITS,
  type ExtractLimits,
  MAX_ATTACHMENT_SECTIONS,
  MAX_SOURCE_PREVIEW_CHARS,
} from "./types.js";

export const MAX_ATTACHMENT_REQUEST_BYTES = Math.ceil((20 * 1024 * 1024) / 3) * 4 + 4096;

export const attachmentUploadSchema = z
  .object({
    filename: z.string().min(1).max(255).default("attachment"),
    mime: z.string().min(1).max(255).optional(),
    data: z.string().min(1).max(MAX_ATTACHMENT_REQUEST_BYTES),
  })
  .strict();

export type AttachmentUploadInput = z.infer<typeof attachmentUploadSchema>;

export interface AttachmentServiceOptions {
  db: Database;
  storage: AttachmentStorage;
  enabled?: boolean;
  now?: () => number;
  publishStatus?: (session: SessionRow, dto: AttachmentDto, status: string) => void;
  limits?: Partial<ExtractLimits> & {
    maxFilesPerSession?: number;
    inlineTokensPerFile?: number;
    inlineContextRatio?: number;
  };
  ocrMode?: "off" | "auto-local" | "vision";
  ocr?: ImageTranscriber | null;
  vision?: VisionTranscriptionConfig;
}

export interface UploadResult {
  attachment: AttachmentDto;
  deduplicated: boolean;
}

const ATTACHMENT_ID = /^att_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function decodeBase64(data: string, maxBytes: number): Buffer {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "attachment data is not valid base64");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maxBytes) {
    throw new AttachmentError("ATTACHMENT_TOO_LARGE", "attachment exceeds the size limit");
  }
  if (bytes.toString("base64") !== data) {
    throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "attachment data is not canonical base64");
  }
  return bytes;
}

function imageDimensions(bytes: Buffer, mime: string): [number, number] | null {
  if (mime === "image/png") {
    if (
      bytes.length < 45 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    ) {
      return null;
    }
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && size >= 8) {
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      }
      offset += size + 2;
    }
    return null;
  }
  if (mime === "image/webp") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30) {
      return [
        ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)) + 1,
        ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)) + 1,
      ];
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
    if (chunk === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
  }
  return null;
}

function assertSession(session: SessionRow | null): SessionRow {
  if (session === null) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "session not found");
  if (session.status !== "active" || session.origin !== "user") {
    throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "session does not accept attachments");
  }
  return session;
}

export class AttachmentService {
  readonly #db: Database;
  readonly #storage: AttachmentStorage;
  readonly #enabled: boolean;
  readonly #now: () => number;
  readonly #publishStatus?: AttachmentServiceOptions["publishStatus"];
  readonly #limits: ExtractLimits;
  readonly #maxFilesPerSession: number;
  readonly #inlineTokensPerFile: number;
  readonly #inlineContextRatio: number;
  readonly #ocrMode: "off" | "auto-local" | "vision";
  readonly #ocr: ImageTranscriber | null;
  readonly #vision: VisionTranscriptionConfig;

  constructor(options: AttachmentServiceOptions) {
    this.#db = options.db;
    this.#storage = options.storage;
    this.#enabled = options.enabled ?? true;
    this.#now = options.now ?? Date.now;
    this.#publishStatus = options.publishStatus;
    this.#limits = {
      ...DEFAULT_EXTRACT_LIMITS,
      ...Object.fromEntries(
        Object.entries(options.limits ?? {}).filter(([, value]) => typeof value === "number"),
      ),
    } as ExtractLimits;
    this.#maxFilesPerSession = options.limits?.maxFilesPerSession ?? 200;
    this.#inlineTokensPerFile = options.limits?.inlineTokensPerFile ?? 8_000;
    this.#inlineContextRatio = options.limits?.inlineContextRatio ?? 0.15;
    this.#ocrMode = options.ocrMode ?? "auto-local";
    this.#ocr =
      options.ocr === undefined
        ? ocrAvailable()
          ? createLocalOcrTranscriber()
          : null
        : options.ocr;
    this.#vision = options.vision ?? { connectionId: null, transcriber: null };
  }

  get storage(): AttachmentStorage {
    return this.#storage;
  }

  limits(): ExtractLimits {
    return this.#limits;
  }

  inlineBudget(maxContextTokens: number): { perFile: number; total: number } {
    return {
      perFile: this.#inlineTokensPerFile,
      total: Math.max(1_024, Math.floor(maxContextTokens * this.#inlineContextRatio)),
    };
  }

  async upload(sessionId: string, input: AttachmentUploadInput): Promise<UploadResult> {
    if (!this.#enabled) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "attachments are disabled");
    }
    const session = assertSession(getSessionById(this.#db, sessionId));
    const parsed = attachmentUploadSchema.parse(input);
    const bytes = decodeBase64(parsed.data, this.#limits.maxBytes);
    const sniffed = sniffAttachment(bytes, parsed.mime ?? null, parsed.filename);
    const digest = createHash("sha256").update(bytes).digest("hex");

    const existing = findAttachmentByDigest(this.#db, sessionId, digest);
    if (existing !== null) {
      if (existing.status !== "failed") {
        return { attachment: attachmentDto(existing), deduplicated: true };
      }
      // A retry uploads the same bytes again. Dropping the failed row lets the
      // extractor run fresh instead of returning the cached failure forever.
      deleteAttachment(this.#db, sessionId, existing.id);
      if (existing.storagePath !== null) {
        await this.#storage.removeOriginal(existing.storagePath).catch(() => undefined);
      }
      await this.#storage.removeArtifact(existing.id).catch(() => undefined);
    }

    if (countAttachments(this.#db, sessionId) >= this.#maxFilesPerSession) {
      throw new AttachmentError("ATTACHMENT_LIMIT", "session attachment limit reached");
    }

    const id = newId("att");
    let relative: string;
    try {
      relative = await this.#storage.writeOriginal(sessionId, id, sniffed.mime, bytes);
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      throw new AttachmentError("ATTACHMENT_STORAGE_FAILED", "attachment storage is unavailable");
    }

    let row: AttachmentRow;
    try {
      row = createAttachment(this.#db, {
        id,
        sessionId,
        filename: parsed.filename,
        mime: sniffed.mime,
        kind: sniffed.kind,
        sizeBytes: bytes.length,
        digest,
        storagePath: relative,
        status: "pending",
        method: "none",
        width: sniffed.kind === "image" ? imageDimensions(bytes, sniffed.mime)?.[0] : 0,
        height: sniffed.kind === "image" ? imageDimensions(bytes, sniffed.mime)?.[1] : 0,
        bytes: Buffer.alloc(0),
        now: this.#now(),
      });
    } catch {
      await this.#storage.removeOriginal(relative).catch(() => undefined);
      throw new AttachmentError(
        "ATTACHMENT_STORAGE_FAILED",
        "attachment record could not be stored",
      );
    }

    this.#emit(session, row, "pending");

    if (sniffed.kind === "image") {
      // Image artifacts are produced by OCR/vision fallback, not ingest.
      updateAttachmentStatus(this.#db, sessionId, id, {
        status: "ready",
        method: "none",
        pageCount: 1,
        tokenCount: 0,
        extractedAt: this.#now(),
      });
      row = getAttachment(this.#db, sessionId, id) ?? row;
      return { attachment: attachmentDto(row), deduplicated: false };
    }

    try {
      const extracted = await extractAttachment(extractorRegistry, {
        bytes,
        mime: sniffed.mime,
        filename: parsed.filename,
        limits: this.#limits,
      });
      await this.#storage.writeArtifact(id, extracted.markdown);
      updateAttachmentStatus(this.#db, sessionId, id, {
        status: "ready",
        method: extracted.method,
        pageCount: extracted.pageCount,
        tokenCount: extracted.sections.reduce((sum, section) => sum + section.tokens, 0),
        sections: extracted.sections,
        warnings: extracted.warnings,
        extractor: extracted.extractor,
        errorCode: null,
        extractedAt: this.#now(),
      });
    } catch (error) {
      const code = error instanceof AttachmentError ? error.code : "ATTACHMENT_PARSE_FAILED";
      updateAttachmentStatus(this.#db, sessionId, id, {
        status: "failed",
        errorCode: code,
        method: "none",
        extractedAt: this.#now(),
      });
      await this.#storage.removeArtifact(id).catch(() => undefined);
    }

    row = getAttachment(this.#db, sessionId, id) ?? row;
    this.#emit(session, row, row.status);
    return { attachment: attachmentDto(row), deduplicated: false };
  }

  async transcribeImage(sessionId: string, attachmentId: string): Promise<AttachmentDto> {
    if (!this.#enabled) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "attachments are disabled");
    }
    const session = assertSession(getSessionById(this.#db, sessionId));
    const row = this.#row(sessionId, attachmentId);
    if (row.kind !== "image") {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "attachment is not an image");
    }
    if (row.status === "pending") {
      throw new AttachmentError("ATTACHMENT_NOT_READY", "attachment is still being parsed");
    }

    const { bytes } = await this.readOriginal(sessionId, attachmentId);
    let transcriber: ImageTranscriber | null = null;
    let method: "ocr" | "vision" = "ocr";

    if (this.#ocrMode !== "vision" && this.#ocr !== null) {
      transcriber = this.#ocr;
    } else if (
      this.#ocrMode === "vision" &&
      visionAvailable(this.#vision) &&
      this.#vision.transcriber !== null
    ) {
      transcriber = this.#vision.transcriber;
      method = "vision";
    }
    if (transcriber === null) {
      throw new AttachmentError(
        "ATTACHMENT_VISION_UNAVAILABLE",
        "no local OCR or explicitly configured vision connection is available",
      );
    }

    const { text, warning } = await transcriber({ bytes, mime: row.mime });
    await this.#storage.writeArtifact(attachmentId, text);
    updateAttachmentStatus(this.#db, sessionId, attachmentId, {
      status: "ready",
      method,
      pageCount: 1,
      tokenCount: estimateTokens(text),
      sections: [{ anchor: "offset:0", title: row.filename, tokens: estimateTokens(text) }],
      warnings: warning === undefined ? [] : [warning],
      extractor: { id: method === "ocr" ? "tesseract" : "vision", version: "1" },
      errorCode: null,
      extractedAt: this.#now(),
    });
    const updated = this.#row(sessionId, attachmentId);
    this.#emit(session, updated, updated.status);
    return attachmentDto(updated);
  }

  get(sessionId: string, attachmentId: string): AttachmentDto {
    const row = this.#row(sessionId, attachmentId);
    return attachmentDto(row);
  }

  async readOriginal(
    sessionId: string,
    attachmentId: string,
  ): Promise<{
    row: AttachmentRow;
    bytes: Buffer;
  }> {
    const row = this.#row(sessionId, attachmentId);
    return {
      row,
      bytes:
        row.storagePath === null ? row.bytes : await this.#storage.readOriginal(row.storagePath),
    };
  }

  readOriginalSync(sessionId: string, attachmentId: string): { row: AttachmentRow; bytes: Buffer } {
    const row = this.#row(sessionId, attachmentId);
    return {
      row,
      bytes: row.storagePath === null ? row.bytes : this.#storage.readOriginalSync(row.storagePath),
    };
  }

  async readArtifact(
    sessionId: string,
    attachmentId: string,
  ): Promise<{
    attachment: AttachmentDto;
    markdown: string;
    sections: ReturnType<typeof parseAttachmentSections>;
    warnings: string[];
    truncated: boolean;
  }> {
    const row = this.#row(sessionId, attachmentId);
    const full =
      row.storagePath === null ? "" : ((await this.#storage.readArtifact(attachmentId)) ?? "");
    const limit = 200_000;
    return {
      attachment: attachmentDto(row),
      markdown: full.slice(0, limit),
      sections: parseAttachmentSections(row).slice(0, MAX_ATTACHMENT_SECTIONS),
      warnings: parseAttachmentWarnings(row),
      truncated: full.length > limit,
    };
  }

  async readMarkdown(sessionId: string, attachmentId: string): Promise<string> {
    this.#row(sessionId, attachmentId);
    return (await this.#storage.readArtifact(attachmentId)) ?? "";
  }

  readArtifactSync(
    sessionId: string,
    attachmentId: string,
  ): { row: AttachmentRow; markdown: string } {
    const row = this.#row(sessionId, attachmentId);
    return { row, markdown: this.#storage.readArtifactSync(attachmentId) ?? "" };
  }

  /**
   * Original UTF-8 text for the `source` view. Only text-like attachments have
   * one; binary documents must use the parsed text view instead.
   */
  readSourceSync(sessionId: string, attachmentId: string): { row: AttachmentRow; text: string } {
    const row = this.#row(sessionId, attachmentId);
    if (!isSourceViewMime(row.mime)) {
      throw new AttachmentError(
        "ATTACHMENT_VIEW_UNSUPPORTED",
        "this attachment has no source view",
      );
    }
    const bytes =
      row.storagePath === null ? row.bytes : this.#storage.readOriginalSync(row.storagePath);
    return { row, text: decodeSource(bytes) };
  }

  async readSource(
    sessionId: string,
    attachmentId: string,
    input: { line?: number; offset?: number; maxChars?: number } = {},
  ): Promise<{ attachment: AttachmentDto; view: "source"; warnings: string[] } & SourceSlice> {
    const row = this.#row(sessionId, attachmentId);
    if (!isSourceViewMime(row.mime)) {
      throw new AttachmentError(
        "ATTACHMENT_VIEW_UNSUPPORTED",
        "this attachment has no source view",
      );
    }
    if (row.status === "pending") {
      throw new AttachmentError("ATTACHMENT_NOT_READY", "attachment is still being parsed");
    }
    const { bytes } = await this.readOriginal(sessionId, attachmentId);
    const slice = sourceSlice(decodeSource(bytes), {
      ...(input.line === undefined ? {} : { line: input.line }),
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      maxChars: Math.min(input.maxChars ?? MAX_SOURCE_PREVIEW_CHARS, MAX_SOURCE_PREVIEW_CHARS),
    });
    return {
      attachment: attachmentDto(row),
      view: "source",
      warnings: parseAttachmentWarnings(row),
      ...slice,
    };
  }

  listForSession(sessionId: string, limit = 200): AttachmentRow[] {
    return listAttachments(this.#db, sessionId, limit);
  }

  readyAttachments(sessionId: string): AttachmentRow[] {
    return listAttachments(this.#db, sessionId).filter((row) => row.status === "ready");
  }

  getRows(sessionId: string, ids: readonly string[]): AttachmentRow[] {
    if (ids.length === 0) return [];
    const rows = this.#db
      .select()
      .from(sessionAttachments)
      .where(
        and(
          eq(sessionAttachments.sessionId, sessionId),
          inArray(
            sessionAttachments.id,
            ids.filter((id) => ATTACHMENT_ID.test(id)),
          ),
        ),
      )
      .all();
    if (rows.length !== new Set(ids).size) {
      throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment not found in this session");
    }
    return ids.map((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined)
        throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment not found");
      return row;
    });
  }

  async remove(sessionId: string, attachmentId: string): Promise<void> {
    const session = assertSession(getSessionById(this.#db, sessionId));
    const row = this.#row(sessionId, attachmentId);
    if (countAttachmentReferences(this.#db, sessionId, attachmentId) > 0) {
      throw new AttachmentError("ATTACHMENT_IN_USE", "attachment is referenced by a turn");
    }
    deleteAttachment(this.#db, sessionId, attachmentId);
    if (row.storagePath !== null) {
      await this.#storage.removeOriginal(row.storagePath).catch(() => undefined);
    }
    await this.#storage.removeArtifact(attachmentId).catch(() => undefined);
    this.#emit(session, row, "deleted");
  }

  async cleanupSessionFiles(sessionId: string): Promise<void> {
    const paths = listAttachmentStoragePaths(this.#db, sessionId);
    for (const relative of paths) {
      await this.#storage.removeOriginal(relative).catch(() => undefined);
    }
    for (const row of listAttachments(this.#db, sessionId)) {
      await this.#storage.removeArtifact(row.id).catch(() => undefined);
    }
    await this.#storage.removeSession(sessionId).catch(() => undefined);
  }

  /**
   * Removes files with no database row, e.g. a crash between the atomic write
   * and the insert, or a failed parse whose artifact stayed behind.
   */
  async cleanupOrphans(): Promise<number> {
    try {
      const known = listAllAttachments(this.#db).flatMap((row) => [
        ...(row.storagePath === null ? [] : [row.storagePath]),
        this.#storage.artifactRelativePath(row.id),
      ]);
      return await this.#storage.deleteOrphans(known);
    } catch {
      return 0;
    }
  }

  #row(sessionId: string, attachmentId: string): AttachmentRow {
    const row = getAttachment(this.#db, sessionId, attachmentId);
    if (row === null) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment not found");
    return row;
  }

  #emit(session: SessionRow, row: AttachmentRow, status: string): void {
    if (this.#publishStatus === undefined) return;
    this.#publishStatus(session, attachmentDto(row), status);
  }
}

export function attachmentKindLabel(kind: AttachmentKind): string {
  return kind === "image" ? "image" : "document";
}

export function attachmentMethodLabel(method: AttachmentMethod): string {
  switch (method) {
    case "ocr":
      return "OCR";
    case "vision":
      return "vision";
    case "text-layer":
      return "text layer";
    case "native":
      return "native";
    default:
      return "raw";
  }
}
