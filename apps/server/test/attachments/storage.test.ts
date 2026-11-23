import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStorage } from "../../src/modules/attachments/storage.js";
import { AttachmentError, sanitizeFilename } from "../../src/modules/attachments/types.js";
import { withTempDir } from "../helpers.js";

const sessionId = "ses_11111111-1111-4111-8111-111111111111";
const attachmentId = "att_11111111-1111-4111-8111-111111111111";
const otherAttachmentId = "att_22222222-2222-4222-8222-222222222222";

function absolute(dataDir: string, relative: string): string {
  return path.join(dataDir, ...relative.split("/"));
}

describe("attachment storage", () => {
  it("derives the path from IDs and the MIME extension and writes 0600 atomically", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      const bytes = Buffer.from("%PDF-1.7 fixture");

      const relative = await storage.writeOriginal(
        sessionId,
        attachmentId,
        "application/pdf",
        bytes,
      );

      expect(relative).toBe(`attachments/${sessionId}/${attachmentId}.pdf`);
      const file = absolute(dir, relative);
      expect((await stat(file)).size).toBe(bytes.length);
      if (process.platform !== "win32") {
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        const sessionDir = absolute(dir, `attachments/${sessionId}`);
        expect((await stat(sessionDir)).mode & 0o777).toBe(0o700);
      }
      expect(await storage.readOriginal(relative)).toEqual(bytes);
      expect(await readdir(path.join(dir, "tmp", "attachments"))).toEqual([]);
    });
  });

  it("replaces an existing file without leaving temporary files behind", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      const first = await storage.writeOriginal(sessionId, attachmentId, "text/plain", "one");
      await storage.writeOriginal(sessionId, attachmentId, "text/plain", "two");

      expect((await storage.readOriginal(first)).toString()).toBe("two");
      expect(await readdir(path.join(dir, "tmp", "attachments"))).toEqual([]);
    });
  });

  it("rejects unknown MIME types, malformed IDs and path traversal", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      await mkdir(path.join(dir, "tmp", "attachments"), { recursive: true });
      await writeFile(path.join(dir, "secret.txt"), "secret", { mode: 0o600 });

      await expect(
        storage.writeOriginal(sessionId, attachmentId, "application/x-msdownload", "x"),
      ).rejects.toBeInstanceOf(AttachmentError);
      await expect(
        storage.writeOriginal("../escape", attachmentId, "text/plain", "x"),
      ).rejects.toBeInstanceOf(AttachmentError);
      await expect(
        storage.writeOriginal(sessionId, "../escape", "text/plain", "x"),
      ).rejects.toBeInstanceOf(AttachmentError);
      await expect(storage.readOriginal("secret.txt")).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      await expect(storage.readOriginal("../../secret.txt")).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      await expect(storage.writeArtifact("../escape", "x")).rejects.toBeInstanceOf(AttachmentError);
    });
  });

  it("stores markdown artifacts beside originals and deletes them independently", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      const original = await storage.writeOriginal(sessionId, attachmentId, "text/markdown", "# a");
      const artifact = await storage.writeArtifact(attachmentId, "<!-- page: 1 -->\n# Spec\n");

      expect(artifact).toBe(`artifacts/attachments/${attachmentId}.md`);
      expect(await storage.readArtifact(attachmentId)).toBe("<!-- page: 1 -->\n# Spec\n");
      if (process.platform !== "win32") {
        expect((await stat(absolute(dir, artifact))).mode & 0o777).toBe(0o600);
      }

      await storage.removeArtifact(attachmentId);
      expect(await storage.readArtifact(attachmentId)).toBeNull();
      expect(await storage.readOriginal(original)).toEqual(Buffer.from("# a"));

      await storage.removeOriginal(original);
      await expect(storage.readOriginal(original)).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      await expect(storage.removeOriginal(original)).resolves.toBeUndefined();
    });
  });

  it("removes only the requested session directory", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      const own = await storage.writeOriginal(sessionId, attachmentId, "text/plain", "own");
      const other = await storage.writeOriginal(
        sessionId,
        otherAttachmentId,
        "text/plain",
        "other",
      );
      await storage.writeArtifact(attachmentId, "# keep");

      await storage.removeSession(sessionId);

      await expect(storage.readOriginal(own)).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      await expect(storage.readOriginal(other)).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      expect(await storage.readArtifact(attachmentId)).toBe("# keep");
    });
  });

  it("finds and deletes only untracked files inside the attachment roots", async () => {
    await withTempDir(async (dir) => {
      const storage = new AttachmentStorage(dir);
      const known = await storage.writeOriginal(sessionId, attachmentId, "text/plain", "known");
      const orphan = await storage.writeOriginal(
        sessionId,
        otherAttachmentId,
        "text/plain",
        "orphan",
      );
      const knownArtifact = await storage.writeArtifact(attachmentId, "# known");
      const orphanArtifact = await storage.writeArtifact(otherAttachmentId, "# orphan");
      await mkdir(path.join(dir, "tmp", "attachments"), { recursive: true });
      await writeFile(path.join(dir, "tmp", "attachments", "partial.tmp"), "partial");

      expect(await storage.scanOrphans([known, knownArtifact])).toEqual(
        [orphan, orphanArtifact].sort(),
      );
      expect(await storage.deleteOrphans([known, knownArtifact])).toBe(2);

      expect(await storage.readOriginal(known)).toEqual(Buffer.from("known"));
      expect(await storage.readArtifact(attachmentId)).toBe("# known");
      await expect(storage.readOriginal(orphan)).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      });
      expect(await readdir(path.join(dir, "tmp", "attachments"))).toEqual(["partial.tmp"]);
    });
  });

  it("normalizes untrusted filenames without using them in paths", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\evil.docx")).toBe("evil.docx");
    expect(sanitizeFilename("a\u0000b\u001f.docx")).toBe("ab.docx");
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename(`${"x".repeat(400)}.pdf`)).toHaveLength(200);
  });
});
