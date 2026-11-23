import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSession } from "../../src/modules/sessions/service.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("attachment REST API", () => {
  it("uploads, deduplicates, reads, previews and deletes an attachment", async () => {
    await withTempDir(async (dir) => {
      const f = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const session = await createSession(
          { db: f.running.db, dataDir: path.join(dir, "data") },
          {},
        );
        const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
        const payload = {
          filename: "notes.md",
          mime: "text/markdown",
          data: Buffer.from("# Hello\n\nAttachment body").toString("base64"),
        };

        const unauthenticated = await f.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/attachments`,
          headers: { origin: f.origin },
          payload,
        });
        expect(unauthenticated.statusCode).toBe(401);

        const created = await f.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/attachments`,
          headers,
          payload,
        });
        expect(created.statusCode).toBe(201);
        const body = created.json() as {
          attachment: {
            id: string;
            status: string;
            method: string;
            kind: string;
            tokenCount: number;
          };
          deduplicated: boolean;
        };
        expect(body.attachment.status).toBe("ready");
        expect(body.attachment.kind).toBe("document");
        expect(body.attachment.method).toBe("native");
        expect(body.attachment.tokenCount).toBeGreaterThan(0);

        const duplicate = await f.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/attachments`,
          headers,
          payload,
        });
        const duplicateBody = duplicate.json() as {
          attachment: { id: string };
          deduplicated: boolean;
        };
        expect(duplicateBody.attachment.id).toBe(body.attachment.id);
        expect(duplicateBody.deduplicated).toBe(true);

        const raw = await f.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/attachments/${body.attachment.id}`,
          headers,
        });
        expect(raw.statusCode).toBe(200);
        expect(raw.body).toContain("Attachment body");

        const artifact = await f.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/attachments/${body.attachment.id}/artifact`,
          headers,
        });
        expect(artifact.statusCode).toBe(200);
        expect((artifact.json() as { markdown: string }).markdown).toContain("Attachment body");

        const removed = await f.running.app.inject({
          method: "DELETE",
          url: `/api/sessions/${session.id}/attachments/${body.attachment.id}`,
          headers,
        });
        expect(removed.statusCode).toBe(204);
      } finally {
        await stopAuthorizedServer(f);
      }
    });
  });

  it("rejects unsupported files and cross-session ids", async () => {
    await withTempDir(async (dir) => {
      const f = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const opts = { db: f.running.db, dataDir: path.join(dir, "data") };
        const session = await createSession(opts, {});
        const other = await createSession(opts, {});
        const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };

        const unsupported = await f.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/attachments`,
          headers,
          payload: { filename: "run.exe", data: Buffer.from("MZ").toString("base64") },
        });
        expect(unsupported.statusCode).toBe(415);
        expect((unsupported.json() as { error: { code: string } }).error.code).toBe(
          "ATTACHMENT_UNSUPPORTED",
        );

        const created = await f.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/attachments`,
          headers,
          payload: { filename: "a.txt", data: Buffer.from("hello").toString("base64") },
        });
        const id = (created.json() as { attachment: { id: string } }).attachment.id;
        const cross = await f.running.app.inject({
          method: "GET",
          url: `/api/sessions/${other.id}/attachments/${id}`,
          headers,
        });
        expect(cross.statusCode).toBe(404);
      } finally {
        await stopAuthorizedServer(f);
      }
    });
  });
});
