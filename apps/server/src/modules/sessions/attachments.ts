import { createHash } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { sessionAttachments } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { SessionError } from "./errors.js";
import { getSessionById } from "./repository.js";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TURN_IMAGES = 8;
const MAX_SESSION_IMAGES = 64;
export const MAX_IMAGE_REQUEST = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128;
const mimeSchema = z.enum(["image/png", "image/jpeg"]);
export const imageUploadSchema = z
  .object({
    mime: mimeSchema,
    data: z
      .string()
      .min(1)
      .max(MAX_IMAGE_REQUEST - 128),
  })
  .strict();
export const attachmentIdsSchema = z
  .array(z.string().regex(/^att_[a-f0-9-]{36}$/))
  .max(MAX_TURN_IMAGES);

type ImageMime = z.infer<typeof mimeSchema>;

function dimensions(bytes: Buffer, mime: ImageMime): [number, number] | null {
  if (mime === "image/png") {
    if (
      bytes.length < 45 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
    )
      return null;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (
    bytes.length < 12 ||
    bytes.readUInt16BE(0) !== 0xffd8 ||
    bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
  )
    return null;
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
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

export function storeScreenshot(
  db: Database,
  sessionId: string,
  input: z.infer<typeof imageUploadSchema>,
) {
  if (input.data.length > MAX_IMAGE_REQUEST - 128)
    throw new SessionError("VALIDATION_ERROR", "image is too large");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== input.data) {
    throw new SessionError("VALIDATION_ERROR", "invalid image encoding or size");
  }
  const size = dimensions(bytes, input.mime);
  if (!size || size.some((value) => value < 1 || value > 8192) || size[0] * size[1] > 20_000_000) {
    throw new SessionError("VALIDATION_ERROR", "invalid screenshot format or dimensions");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  return immediateTransaction(db, (tx) => {
    const session = getSessionById(tx, sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "session not found");
    if (session.status !== "active" || session.origin !== "user")
      throw new SessionError("CONFLICT", "session does not accept screenshots");
    const existing = tx
      .select({ id: sessionAttachments.id })
      .from(sessionAttachments)
      .where(
        and(eq(sessionAttachments.sessionId, sessionId), eq(sessionAttachments.digest, digest)),
      )
      .get();
    const total = tx
      .select({ count: count() })
      .from(sessionAttachments)
      .where(eq(sessionAttachments.sessionId, sessionId))
      .get();
    if (existing) return existing;
    if ((total?.count ?? 0) >= MAX_SESSION_IMAGES)
      throw new SessionError("CONFLICT", "session screenshot limit reached");
    const id = newId("att");
    tx.insert(sessionAttachments)
      .values({
        id,
        sessionId,
        mime: input.mime,
        digest,
        bytes,
        width: size[0],
        height: size[1],
        createdAt: Date.now(),
      })
      .run();
    return { id };
  });
}

export function readScreenshots(db: DbExecutor, sessionId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = db
    .select()
    .from(sessionAttachments)
    .where(and(eq(sessionAttachments.sessionId, sessionId), inArray(sessionAttachments.id, ids)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new SessionError("NOT_FOUND", "screenshot not found in this session");
    return row;
  });
}

export function screenshotIds(json: string): string[] {
  try {
    return (
      z.object({ attachmentIds: attachmentIdsSchema.optional() }).parse(JSON.parse(json))
        .attachmentIds ?? []
    );
  } catch {
    return [];
  }
}
