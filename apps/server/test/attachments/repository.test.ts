import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  attachmentDto,
  countAttachmentReferences,
  countAttachments,
  createAttachment,
  deleteAttachment,
  failPendingAttachments,
  findAttachmentByDigest,
  getAttachment,
  listAttachments,
  parseAttachmentSections,
  parseAttachmentWarnings,
  readAttachmentPayload,
  updateAttachmentStatus,
} from "../../src/modules/attachments/repository.js";
import { AttachmentStorage } from "../../src/modules/attachments/storage.js";
import type { AttachmentSection } from "../../src/modules/attachments/types.js";
import { withTempDir } from "../helpers.js";

async function openMigrated(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function seedSession(opened: OpenedDatabase, id: string, origin = "user") {
  opened.sqlite
    .prepare(
      "INSERT INTO sessions (id, workspace_path, title, origin, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, "/fixture", "Fixture", origin, 1, 1, 1);
}

const sessionId = "ses_11111111-1111-4111-8111-111111111111";
const otherSessionId = "ses_22222222-2222-4222-8222-222222222222";
const documentId = "att_11111111-1111-4111-8111-111111111111";
const imageId = "att_33333333-3333-4333-8333-333333333333";

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("attachment repository", () => {
  it("creates document rows outside SQLite blobs and maps them to DTOs", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        const row = createAttachment(opened.db, {
          sessionId,
          filename: "spec.pdf",
          mime: "application/pdf",
          kind: "document",
          sizeBytes: 842,
          digest: digest("spec"),
          storagePath: `attachments/${sessionId}/${documentId}.pdf`,
          status: "ready",
          method: "text-layer",
          pageCount: 42,
          tokenCount: 18320,
          sections: [{ anchor: "page:1", title: "Intro", page: 1, tokens: 120 }],
          warnings: ["page 17 has no text layer"],
          extractor: { id: "pdfjs", version: "5.4.0" },
          now: 100,
        });

        expect(row).toMatchObject({
          id: expect.stringMatching(/^att_/),
          kind: "document",
          status: "ready",
          method: "text-layer",
          storagePath: `attachments/${sessionId}/${documentId}.pdf`,
        });
        expect(row.bytes).toHaveLength(0);
        expect(row.width).toBe(0);
        expect(row.height).toBe(0);
        expect(row.pageCount).toBe(42);
        expect(attachmentDto(row)).toMatchObject({
          filename: "spec.pdf",
          kind: "document",
          width: null,
          height: null,
          pageCount: 42,
          method: "text-layer",
          warnings: ["page 17 has no text layer"],
          extractor: { id: "pdfjs", version: "5.4.0" },
        });
        expect(attachmentDto(row)).not.toHaveProperty("bytes");
        expect(attachmentDto(row)).not.toHaveProperty("storagePath");
      } finally {
        opened.close();
      }
    });
  });

  it("deduplicates by session and keeps sessions isolated", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        seedSession(opened, otherSessionId);
        const shared = digest("same bytes");
        const first = createAttachment(opened.db, {
          sessionId,
          filename: "a.txt",
          mime: "text/plain",
          kind: "document",
          sizeBytes: 10,
          digest: shared,
          storagePath: null,
          status: "ready",
          method: "native",
        });
        const second = createAttachment(opened.db, {
          sessionId: otherSessionId,
          filename: "a.txt",
          mime: "text/plain",
          kind: "document",
          sizeBytes: 10,
          digest: shared,
          storagePath: null,
          status: "ready",
          method: "native",
        });

        expect(second.id).not.toBe(first.id);
        expect(findAttachmentByDigest(opened.db, sessionId, shared)?.id).toBe(first.id);
        expect(findAttachmentByDigest(opened.db, otherSessionId, shared)?.id).toBe(second.id);
        expect(getAttachment(opened.db, otherSessionId, first.id)).toBeNull();
        expect(listAttachments(opened.db, sessionId).map((row) => row.id)).toEqual([first.id]);
        expect(countAttachments(opened.db, sessionId)).toBe(1);
      } finally {
        opened.close();
      }
    });
  });

  it("caps sections and warnings and truncates titles", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        const sections: AttachmentSection[] = Array.from({ length: 600 }, (_, index) => ({
          anchor: `page:${index + 1}`,
          title: "t".repeat(300),
          page: index + 1,
          tokens: 10,
        }));
        const row = createAttachment(opened.db, {
          sessionId,
          filename: "long.pdf",
          mime: "application/pdf",
          kind: "document",
          sizeBytes: 1,
          digest: digest("long"),
          storagePath: `attachments/${sessionId}/${documentId}.pdf`,
          status: "ready",
          method: "text-layer",
          sections,
          warnings: Array.from({ length: 60 }, (_, index) => `warning ${index}`),
        });

        expect(parseAttachmentSections(row)).toHaveLength(500);
        expect(parseAttachmentSections(row)[0]?.title).toHaveLength(200);
        expect(parseAttachmentWarnings(row)).toHaveLength(50);
      } finally {
        opened.close();
      }
    });
  });

  it("updates status without crossing session boundaries", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        seedSession(opened, otherSessionId);
        const row = createAttachment(opened.db, {
          sessionId,
          filename: "scan.png",
          mime: "image/png",
          kind: "image",
          sizeBytes: 4,
          digest: digest("png"),
          storagePath: `attachments/${sessionId}/${imageId}.png`,
          status: "pending",
          method: "none",
        });

        expect(updateAttachmentStatus(opened.db, otherSessionId, row.id, { status: "ready" })).toBe(
          false,
        );
        expect(
          updateAttachmentStatus(opened.db, sessionId, row.id, {
            status: "failed",
            errorCode: "ATTACHMENT_PARSE_FAILED",
          }),
        ).toBe(true);
        expect(getAttachment(opened.db, sessionId, row.id)).toMatchObject({
          status: "failed",
          errorCode: "ATTACHMENT_PARSE_FAILED",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("counts turn references scoped to the session", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        seedSession(opened, otherSessionId);
        const row = createAttachment(opened.db, {
          sessionId,
          filename: "spec.pdf",
          mime: "application/pdf",
          kind: "document",
          sizeBytes: 1,
          digest: digest("ref"),
          storagePath: `attachments/${sessionId}/${documentId}.pdf`,
          status: "ready",
          method: "text-layer",
        });
        opened.sqlite
          .prepare(
            "INSERT INTO turns (id, session_id, status, input_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            "trn_1",
            sessionId,
            "COMPLETED",
            JSON.stringify({ text: "summarize", attachmentIds: [row.id] }),
            1,
          );
        opened.sqlite
          .prepare(
            "INSERT INTO turns (id, session_id, status, input_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("trn_2", sessionId, "COMPLETED", JSON.stringify({ text: "no attachments" }), 2);
        opened.sqlite
          .prepare(
            "INSERT INTO turns (id, session_id, status, input_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            "trn_3",
            otherSessionId,
            "COMPLETED",
            JSON.stringify({ text: "x", attachmentIds: [row.id] }),
            3,
          );

        expect(countAttachmentReferences(opened.db, sessionId, row.id)).toBe(1);
        expect(countAttachmentReferences(opened.db, otherSessionId, row.id)).toBe(1);
        expect(countAttachmentReferences(opened.db, sessionId, "att_missing")).toBe(0);
      } finally {
        opened.close();
      }
    });
  });

  it("deletes rows explicitly and cascades with the session", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        const first = createAttachment(opened.db, {
          sessionId,
          filename: "a.txt",
          mime: "text/plain",
          kind: "document",
          sizeBytes: 1,
          digest: digest("a"),
          storagePath: null,
          status: "ready",
          method: "native",
        });
        const second = createAttachment(opened.db, {
          sessionId,
          filename: "b.txt",
          mime: "text/plain",
          kind: "document",
          sizeBytes: 1,
          digest: digest("b"),
          storagePath: null,
          status: "ready",
          method: "native",
        });

        expect(deleteAttachment(opened.db, otherSessionId, first.id)).toBe(false);
        expect(deleteAttachment(opened.db, sessionId, first.id)).toBe(true);
        expect(deleteAttachment(opened.db, sessionId, first.id)).toBe(false);
        expect(countAttachments(opened.db, sessionId)).toBe(1);

        opened.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
        expect(countAttachments(opened.db, sessionId)).toBe(0);
        expect(getAttachment(opened.db, sessionId, second.id)).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("keeps legacy screenshot bytes readable after migration", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        opened.sqlite
          .prepare(
            "INSERT INTO session_attachments (id, session_id, mime, digest, bytes, width, height, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(documentId, sessionId, "image/png", digest(bytes), bytes, 1, 1, bytes.length, 5);

        const row = getAttachment(opened.db, sessionId, documentId);
        expect(row).toMatchObject({
          kind: "image",
          status: "ready",
          method: "none",
          filename: "screenshot",
          sizeBytes: bytes.length,
          storagePath: null,
        });
        expect(
          await readAttachmentPayload(opened.db, new AttachmentStorage(dir), sessionId, documentId),
        ).toEqual(bytes);
      } finally {
        opened.close();
      }
    });
  });

  it("fails attachments that were pending when the process stopped", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        seedSession(opened, sessionId);
        const row = createAttachment(opened.db, {
          id: documentId,
          sessionId,
          filename: "stuck.pdf",
          mime: "application/pdf",
          kind: "document",
          sizeBytes: 10,
          digest: digest("stuck"),
          storagePath: "attachments/ses/x.pdf",
          status: "pending",
          method: "none",
        });
        expect(failPendingAttachments(opened.db, 99)).toEqual([row.id]);
        expect(getAttachment(opened.db, sessionId, row.id)).toMatchObject({
          status: "failed",
          errorCode: "ATTACHMENT_PARSE_FAILED",
          extractedAt: 99,
        });
        expect(failPendingAttachments(opened.db, 100)).toEqual([]);
      } finally {
        opened.close();
      }
    });
  });
});
