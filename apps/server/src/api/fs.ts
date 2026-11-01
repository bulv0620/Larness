import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { isLoopbackAddress } from "../security/transport.js";

const ListingQuerySchema = z.object({
  path: z.string().min(1).max(4_096).optional(),
});

const MAX_ENTRIES = 500;

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parent: string | null;
  home: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}

function mapFsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ENOENT" || code === "ENOTDIR") {
    throw new HttpError("NOT_FOUND", "directory not found");
  }

  if (code === "EACCES" || code === "EPERM") {
    throw new HttpError("FORBIDDEN", "directory is not readable");
  }

  throw error;
}

export function registerFsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { path?: string } }>(
    "/api/fs/directories",
    async (request): Promise<DirectoryListing> => {
      if (!isLoopbackAddress(request.ip)) {
        throw new HttpError("FORBIDDEN", "directory browsing is available on this machine only");
      }

      const parsed = ListingQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        throw new HttpError("VALIDATION_ERROR", "Invalid request", {
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      let home: string;

      try {
        home = await realpath(homedir());
      } catch (error) {
        mapFsError(error);
      }

      const requested = parsed.data.path ?? home;

      if (!path.isAbsolute(requested) || requested.includes("\0")) {
        throw new HttpError("VALIDATION_ERROR", "path must be an absolute directory");
      }

      let target: string;

      try {
        target = await realpath(requested);
        const info = await stat(target);

        if (!info.isDirectory()) {
          throw new HttpError("VALIDATION_ERROR", "path is not a directory");
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        mapFsError(error);
      }

      let entries: DirectoryEntry[];
      let truncated = false;

      try {
        const dirents = await readdir(target, { withFileTypes: true });
        entries = dirents
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
          .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
          .sort((left, right) => left.name.localeCompare(right.name));
      } catch (error) {
        mapFsError(error);
      }

      if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(0, MAX_ENTRIES);
        truncated = true;
      }

      const parent = path.dirname(target);

      return {
        path: target,
        parent: parent === target ? null : parent,
        home,
        entries,
        truncated,
      };
    },
  );
}
