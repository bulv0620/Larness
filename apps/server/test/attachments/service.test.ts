import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { AttachmentService } from "../../src/modules/attachments/service.js";
import { AttachmentStorage } from "../../src/modules/attachments/storage.js";
import { withTempDir } from "../helpers.js";

const sessionId = "ses_11111111-1111-4111-8111-111111111111";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function setup(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  opened.sqlite
    .prepare(
      "INSERT INTO sessions (id, workspace_path, title, origin, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(sessionId, "/fixture", "Fixture", "user", 1, 1, 1);
  const storage = new AttachmentStorage(path.join(dir, "data"));
  const events: string[] = [];
  const service = new AttachmentService({
    db: opened.db,
    storage,
    ocr: null,
    publishStatus: (_session, dto, status) => events.push(`${dto.id}:${status}:${dto.method}`),
  });
  return { opened, storage, service, events };
}

describe("attachment service", () => {
  it("stores a document, extracts markdown, and deduplicates by digest", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, events } = await setup(dir);
      try {
        const input = {
          filename: "notes.md",
          mime: "text/markdown",
          data: Buffer.from("# Title\n\nHello").toString("base64"),
        };
        const first = await service.upload(sessionId, input);
        expect(first.attachment.status).toBe("ready");
        expect(first.attachment.kind).toBe("document");
        expect(first.attachment.method).toBe("native");
        expect(first.attachment.tokenCount).toBeGreaterThan(0);
        const second = await service.upload(sessionId, input);
        expect(second.deduplicated).toBe(true);
        expect(second.attachment.id).toBe(first.attachment.id);
        const artifact = await service.readArtifact(sessionId, first.attachment.id);
        expect(artifact.markdown).toContain("Hello");
        expect(events.some((event) => event.endsWith(":pending:none"))).toBe(true);
        expect(events.some((event) => event.endsWith(":ready:native"))).toBe(true);
      } finally {
        opened.close();
      }
    });
  });

  it("stores images without OCR and transcribes them on demand", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = await setup(dir);
      try {
        const uploaded = await service.upload(sessionId, {
          filename: "shot.png",
          mime: "image/png",
          data: PNG_1X1,
        });
        expect(uploaded.attachment.kind).toBe("image");
        expect(uploaded.attachment.status).toBe("ready");
        expect(uploaded.attachment.method).toBe("none");
        await expect(
          service.transcribeImage(sessionId, uploaded.attachment.id),
        ).rejects.toMatchObject({
          code: "ATTACHMENT_VISION_UNAVAILABLE",
        });

        const withOcr = new AttachmentService({
          db: opened.db,
          storage: service.storage,
          ocr: async () => ({ text: "recognized words" }),
        });
        const transcribed = await withOcr.transcribeImage(sessionId, uploaded.attachment.id);
        expect(transcribed.method).toBe("ocr");
        expect((await withOcr.readArtifact(sessionId, uploaded.attachment.id)).markdown).toContain(
          "recognized words",
        );
      } finally {
        opened.close();
      }
    });
  });

  it("rejects unsupported bytes without writing a row", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = await setup(dir);
      try {
        await expect(
          service.upload(sessionId, {
            filename: "run.exe",
            data: Buffer.from("MZ executable").toString("base64"),
          }),
        ).rejects.toMatchObject({ code: "ATTACHMENT_UNSUPPORTED" });
        expect(service.listForSession(sessionId)).toHaveLength(0);
      } finally {
        opened.close();
      }
    });
  });

  it("removes unreferenced attachments and keeps referenced ones", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = await setup(dir);
      try {
        const uploaded = await service.upload(sessionId, {
          filename: "notes.txt",
          mime: "text/plain",
          data: Buffer.from("body").toString("base64"),
        });
        await service.remove(sessionId, uploaded.attachment.id);
        expect(service.listForSession(sessionId)).toHaveLength(0);
      } finally {
        opened.close();
      }
    });
  });

  it("re-runs extraction when the same bytes previously failed", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = await setup(dir);
      try {
        const input = {
          filename: "broken.pdf",
          mime: "application/pdf",
          data: Buffer.from("%PDF-1.4 not a real pdf").toString("base64"),
        };
        const first = await service.upload(sessionId, input);
        expect(first.attachment.status).toBe("failed");
        const second = await service.upload(sessionId, input);
        expect(second.deduplicated).toBe(false);
        expect(second.attachment.id).not.toBe(first.attachment.id);
        expect(service.listForSession(sessionId)).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });

  it("removes files without a database row", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = await setup(dir);
      try {
        await service.storage.writeArtifact("att_99999999-9999-4999-8999-999999999999", "orphan");
        expect(await service.cleanupOrphans()).toBe(1);
        expect(await service.cleanupOrphans()).toBe(0);
      } finally {
        opened.close();
      }
    });
  });
});
