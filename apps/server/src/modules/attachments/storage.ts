import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AttachmentError, attachmentExtension } from "./types.js";

const SESSION_ID = /^ses_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ATTACHMENT_ID = /^att_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const ORIGINAL_ROOT = "attachments";
const ARTIFACT_ROOT = "artifacts/attachments";
const TEMP_ROOT = "tmp/attachments";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function assertId(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new AttachmentError("ATTACHMENT_STORAGE_FAILED", `invalid ${label}`);
  }
}

/**
 * Original files and extracted markdown live under the data directory, keyed
 * only by IDs and a MIME-derived extension. User filenames never reach the
 * filesystem, so traversal and name injection cannot change the target.
 */
export class AttachmentStorage {
  constructor(private readonly dataDir: string) {}

  originalRelativePath(sessionId: string, attachmentId: string, mime: string): string {
    assertId(sessionId, SESSION_ID, "session id");
    assertId(attachmentId, ATTACHMENT_ID, "attachment id");
    const extension = attachmentExtension(mime);
    if (extension === null) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "unsupported attachment MIME type");
    }
    return `${ORIGINAL_ROOT}/${sessionId}/${attachmentId}.${extension}`;
  }

  artifactRelativePath(attachmentId: string): string {
    assertId(attachmentId, ATTACHMENT_ID, "attachment id");
    return `${ARTIFACT_ROOT}/${attachmentId}.md`;
  }

  async writeOriginal(
    sessionId: string,
    attachmentId: string,
    mime: string,
    bytes: Buffer | string,
  ): Promise<string> {
    const relative = this.originalRelativePath(sessionId, attachmentId, mime);
    await this.writeAtomic(this.resolve(relative), bytes);
    return relative;
  }

  async readOriginal(relative: string): Promise<Buffer> {
    const absolute = this.resolveOriginal(relative);
    try {
      return await readFile(absolute);
    } catch (error) {
      if (isMissing(error)) {
        throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment file not found");
      }
      throw this.storageFailure(error);
    }
  }

  readOriginalSync(relative: string): Buffer {
    const absolute = this.resolveOriginal(relative);
    try {
      return readFileSync(absolute);
    } catch (error) {
      if (isMissing(error)) {
        throw new AttachmentError("ATTACHMENT_NOT_FOUND", "attachment file not found");
      }
      throw this.storageFailure(error);
    }
  }

  async originalExists(relative: string): Promise<boolean> {
    try {
      return (await stat(this.resolveOriginal(relative))).isFile();
    } catch (error) {
      if (isMissing(error)) return false;
      throw this.storageFailure(error);
    }
  }

  async removeOriginal(relative: string): Promise<void> {
    const absolute = this.resolveOriginal(relative);
    try {
      await rm(absolute, { force: true });
    } catch (error) {
      throw this.storageFailure(error);
    }
  }

  async writeArtifact(attachmentId: string, markdown: string): Promise<string> {
    const relative = this.artifactRelativePath(attachmentId);
    await this.writeAtomic(this.resolve(relative), markdown);
    return relative;
  }

  async readArtifact(attachmentId: string): Promise<string | null> {
    const relative = this.artifactRelativePath(attachmentId);
    try {
      return await readFile(this.resolve(relative), "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw this.storageFailure(error);
    }
  }

  readArtifactSync(attachmentId: string): string | null {
    const relative = this.artifactRelativePath(attachmentId);
    try {
      return readFileSync(this.resolve(relative), "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw this.storageFailure(error);
    }
  }

  async removeArtifact(attachmentId: string): Promise<void> {
    await rm(this.resolve(this.artifactRelativePath(attachmentId)), { force: true });
  }

  async removeSession(sessionId: string): Promise<void> {
    assertId(sessionId, SESSION_ID, "session id");
    await rm(path.join(this.dataDir, ORIGINAL_ROOT, sessionId), { recursive: true, force: true });
  }

  /** Lists every stored original/artifact path as a data-dir-relative POSIX path. */
  async listStoredPaths(): Promise<string[]> {
    const originals = await this.walk(path.join(this.dataDir, ORIGINAL_ROOT));
    const artifacts = await this.walk(path.join(this.dataDir, ARTIFACT_ROOT));
    return [...originals, ...artifacts].sort();
  }

  async scanOrphans(knownPaths: Iterable<string>): Promise<string[]> {
    const known = new Set([...knownPaths].map(toPosix));
    return (await this.listStoredPaths()).filter((relative) => !known.has(relative));
  }

  async deleteOrphans(knownPaths: Iterable<string>): Promise<number> {
    let deleted = 0;
    for (const relative of await this.scanOrphans(knownPaths)) {
      try {
        await rm(this.resolve(relative), { force: true });
        deleted += 1;
      } catch (error) {
        throw this.storageFailure(error);
      }
    }
    return deleted;
  }

  private resolve(relative: string): string {
    const segments = relative.split("/");
    if (
      relative.startsWith("/") ||
      relative.includes("\\") ||
      segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      throw new AttachmentError("ATTACHMENT_NOT_FOUND", "invalid attachment path");
    }
    const absolute = path.resolve(this.dataDir, ...segments);
    const root = path.resolve(this.dataDir);
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
      throw new AttachmentError("ATTACHMENT_NOT_FOUND", "invalid attachment path");
    }
    return absolute;
  }

  private resolveOriginal(relative: string): string {
    const normalized = toPosix(relative);
    if (!normalized.startsWith(`${ORIGINAL_ROOT}/`)) {
      throw new AttachmentError("ATTACHMENT_NOT_FOUND", "invalid attachment path");
    }
    return this.resolve(normalized);
  }

  private async writeAtomic(target: string, data: Buffer | string): Promise<void> {
    const temporaryDirectory = path.join(this.dataDir, TEMP_ROOT);
    await this.ensureDirectory(path.dirname(target));
    await this.ensureDirectory(temporaryDirectory);
    const temporary = path.join(temporaryDirectory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
      await rename(temporary, target);
      await this.restrict(target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw this.storageFailure(error);
    }
  }

  private async ensureDirectory(directory: string): Promise<void> {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    } catch (error) {
      throw this.storageFailure(error);
    }
  }

  private async restrict(file: string): Promise<void> {
    try {
      await chmod(file, 0o600);
    } catch (error) {
      if (process.platform !== "win32") throw this.storageFailure(error);
    }
  }

  private storageFailure(error: unknown): AttachmentError {
    return error instanceof AttachmentError
      ? error
      : new AttachmentError("ATTACHMENT_STORAGE_FAILED", "attachment storage is unavailable");
  }

  private async walk(directory: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw this.storageFailure(error);
    }
    const files: string[] = [];
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.walk(child)));
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(this.dataDir, child)));
      }
    }
    return files.sort();
  }
}
