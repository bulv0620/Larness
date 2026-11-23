import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  type AttachmentKind,
  type AttachmentMethod,
  type AttachmentStatus,
  sessionAttachments,
  turns,
} from "../../db/schema.js";
import type { AttachmentStorage } from "./storage.js";
import {
  AttachmentError,
  type AttachmentExtractorRef,
  type AttachmentSection,
  MAX_ATTACHMENT_SECTION_TITLE,
  MAX_ATTACHMENT_SECTIONS,
  MAX_ATTACHMENT_WARNINGS,
  sanitizeFilename,
} from "./types.js";

export type AttachmentRow = typeof sessionAttachments.$inferSelect;

export interface CreateAttachmentInput {
  id?: string;
  sessionId: string;
  filename: string;
  mime: string;
  kind: AttachmentKind;
  sizeBytes: number;
  digest: string;
  storagePath: string | null;
  status?: AttachmentStatus;
  method?: AttachmentMethod;
  pageCount?: number | null;
  tokenCount?: number;
  sections?: AttachmentSection[];
  warnings?: string[];
  extractor?: AttachmentExtractorRef | null;
  errorCode?: string | null;
  bytes?: Buffer;
  width?: number;
  height?: number;
  now?: number;
}

export interface AttachmentStatusPatch {
  status: AttachmentStatus;
  method?: AttachmentMethod;
  pageCount?: number | null;
  tokenCount?: number;
  sections?: AttachmentSection[];
  warnings?: string[];
  extractor?: AttachmentExtractorRef | null;
  errorCode?: string | null;
  extractedAt?: number | null;
}

export interface AttachmentDto {
  id: string;
  sessionId: string;
  filename: string;
  mime: string;
  kind: AttachmentKind;
  sizeBytes: number;
  status: AttachmentStatus;
  method: AttachmentMethod;
  pageCount: number | null;
  tokenCount: number;
  warnings: string[];
  extractor: AttachmentExtractorRef | null;
  width: number | null;
  height: number | null;
  errorCode: string | null;
  createdAt: number;
}

const sectionSchema = z.object({
  anchor: z.string().min(1).max(500),
  title: z.string().max(2000),
  page: z.number().int().positive().optional(),
  tokens: z.number().int().nonnegative(),
});

function serializeSections(sections: AttachmentSection[] | undefined): string | null {
  if (sections === undefined || sections.length === 0) return null;
  return JSON.stringify(
    sections.slice(0, MAX_ATTACHMENT_SECTIONS).map((section) => ({
      ...section,
      title: section.title.slice(0, MAX_ATTACHMENT_SECTION_TITLE),
    })),
  );
}

function serializeWarnings(warnings: string[] | undefined): string | null {
  if (warnings === undefined || warnings.length === 0) return null;
  return JSON.stringify(
    warnings.slice(0, MAX_ATTACHMENT_WARNINGS).map((warning) => warning.slice(0, 500)),
  );
}

export function parseAttachmentSections(row: AttachmentRow): AttachmentSection[] {
  if (row.sectionsJson === null) return [];
  try {
    const parsed = z.array(sectionSchema).safeParse(JSON.parse(row.sectionsJson));
    return parsed.success
      ? parsed.data.slice(0, MAX_ATTACHMENT_SECTIONS).map(
          (section) =>
            ({
              ...section,
              title: section.title.slice(0, MAX_ATTACHMENT_SECTION_TITLE),
            }) as AttachmentSection,
        )
      : [];
  } catch {
    return [];
  }
}

export function parseAttachmentWarnings(row: AttachmentRow): string[] {
  if (row.warningsJson === null) return [];
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(row.warningsJson));
    return parsed.success ? parsed.data.slice(0, MAX_ATTACHMENT_WARNINGS) : [];
  } catch {
    return [];
  }
}

export function attachmentDto(row: AttachmentRow): AttachmentDto {
  const extractor =
    row.extractorId !== null && row.extractorVersion !== null
      ? { id: row.extractorId, version: row.extractorVersion }
      : null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    filename: row.filename,
    mime: row.mime,
    kind: row.kind,
    sizeBytes: row.sizeBytes,
    status: row.status,
    method: row.method,
    pageCount: row.pageCount,
    tokenCount: row.tokenCount,
    warnings: parseAttachmentWarnings(row),
    extractor,
    width: row.width > 0 ? row.width : null,
    height: row.height > 0 ? row.height : null,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  };
}

export function createAttachment(db: DbExecutor, input: CreateAttachmentInput): AttachmentRow {
  const row: AttachmentRow = {
    id: input.id ?? newId("att"),
    sessionId: input.sessionId,
    filename: sanitizeFilename(input.filename),
    mime: input.mime,
    kind: input.kind,
    sizeBytes: input.sizeBytes,
    digest: input.digest,
    bytes: input.bytes ?? Buffer.alloc(0),
    storagePath: input.storagePath,
    width: input.width ?? 0,
    height: input.height ?? 0,
    status: input.status ?? "ready",
    method: input.method ?? "none",
    pageCount: input.pageCount ?? null,
    tokenCount: input.tokenCount ?? 0,
    sectionsJson: serializeSections(input.sections),
    warningsJson: serializeWarnings(input.warnings),
    extractorId: input.extractor?.id ?? null,
    extractorVersion: input.extractor?.version ?? null,
    extractedAt:
      input.extractor === undefined || input.extractor === null ? null : (input.now ?? Date.now()),
    errorCode: input.errorCode ?? null,
    createdAt: input.now ?? Date.now(),
  };
  db.insert(sessionAttachments).values(row).run();
  return row;
}

export function findAttachmentByDigest(
  db: DbExecutor,
  sessionId: string,
  digest: string,
): AttachmentRow | null {
  return (
    db
      .select()
      .from(sessionAttachments)
      .where(
        and(eq(sessionAttachments.sessionId, sessionId), eq(sessionAttachments.digest, digest)),
      )
      .get() ?? null
  );
}

export function getAttachment(
  db: DbExecutor,
  sessionId: string,
  attachmentId: string,
): AttachmentRow | null {
  return (
    db
      .select()
      .from(sessionAttachments)
      .where(
        and(eq(sessionAttachments.sessionId, sessionId), eq(sessionAttachments.id, attachmentId)),
      )
      .get() ?? null
  );
}

export function listAttachments(db: DbExecutor, sessionId: string, limit = 200): AttachmentRow[] {
  return db
    .select()
    .from(sessionAttachments)
    .where(eq(sessionAttachments.sessionId, sessionId))
    .orderBy(desc(sessionAttachments.createdAt), desc(sessionAttachments.id))
    .limit(Math.max(1, Math.min(limit, 500)))
    .all();
}

export function countAttachments(db: DbExecutor, sessionId: string): number {
  return (
    db
      .select({ value: count() })
      .from(sessionAttachments)
      .where(eq(sessionAttachments.sessionId, sessionId))
      .get()?.value ?? 0
  );
}

export function updateAttachmentStatus(
  db: DbExecutor,
  sessionId: string,
  attachmentId: string,
  patch: AttachmentStatusPatch,
): boolean {
  const update: Partial<typeof sessionAttachments.$inferInsert> = { status: patch.status };
  if (patch.method !== undefined) update.method = patch.method;
  if (patch.pageCount !== undefined) update.pageCount = patch.pageCount;
  if (patch.tokenCount !== undefined) update.tokenCount = patch.tokenCount;
  if (patch.sections !== undefined) update.sectionsJson = serializeSections(patch.sections);
  if (patch.warnings !== undefined) update.warningsJson = serializeWarnings(patch.warnings);
  if (patch.extractor !== undefined) {
    update.extractorId = patch.extractor?.id ?? null;
    update.extractorVersion = patch.extractor?.version ?? null;
  }
  if (patch.errorCode !== undefined) update.errorCode = patch.errorCode;
  if (patch.extractedAt !== undefined) update.extractedAt = patch.extractedAt;
  const result = db
    .update(sessionAttachments)
    .set(update)
    .where(
      and(eq(sessionAttachments.sessionId, sessionId), eq(sessionAttachments.id, attachmentId)),
    )
    .run();
  return result.changes > 0;
}

/**
 * In-process extraction cannot resume after a restart. Leaving rows pending
 * would block their session forever, so startup marks them failed with a
 * stable code the UI can show and the user can retry.
 */
export function failPendingAttachments(db: DbExecutor, now = Date.now()): string[] {
  const rows = db
    .select({ id: sessionAttachments.id })
    .from(sessionAttachments)
    .where(eq(sessionAttachments.status, "pending"))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  db.update(sessionAttachments)
    .set({
      status: "failed",
      errorCode: "ATTACHMENT_PARSE_FAILED",
      extractedAt: now,
    })
    .where(inArray(sessionAttachments.id, ids))
    .run();
  return ids;
}

export function listAllAttachments(db: DbExecutor): AttachmentRow[] {
  return db.select().from(sessionAttachments).all();
}

export function deleteAttachment(db: DbExecutor, sessionId: string, attachmentId: string): boolean {
  const result = db
    .delete(sessionAttachments)
    .where(
      and(eq(sessionAttachments.sessionId, sessionId), eq(sessionAttachments.id, attachmentId)),
    )
    .run();
  return result.changes > 0;
}

export function listAttachmentStoragePaths(db: DbExecutor, sessionId: string): string[] {
  return db
    .select({ storagePath: sessionAttachments.storagePath })
    .from(sessionAttachments)
    .where(eq(sessionAttachments.sessionId, sessionId))
    .all()
    .flatMap((row) => (row.storagePath === null ? [] : [row.storagePath]));
}

function referencedAttachmentIds(inputJson: string): string[] {
  try {
    const parsed = JSON.parse(inputJson) as { attachmentIds?: unknown };
    return Array.isArray(parsed.attachmentIds)
      ? parsed.attachmentIds.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** How many Turns in this session reference the attachment (deletion guard). */
export function countAttachmentReferences(
  db: DbExecutor,
  sessionId: string,
  attachmentId: string,
): number {
  return db
    .select({ inputJson: turns.inputJson })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all()
    .filter((row) => referencedAttachmentIds(row.inputJson).includes(attachmentId)).length;
}

export async function readAttachmentPayload(
  db: DbExecutor,
  storage: AttachmentStorage,
  sessionId: string,
  attachmentId: string,
): Promise<Buffer> {
  const row = getAttachment(db, sessionId, attachmentId);
  if (row === null) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment not found");
  return row.storagePath === null ? row.bytes : storage.readOriginal(row.storagePath);
}

export type AttachmentDatabase = Database;
