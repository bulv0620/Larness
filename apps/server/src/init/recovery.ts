import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { AppConfigSchema } from "@larness/shared";
import { z } from "zod";
import { configFilePath } from "../bootstrap/config.js";
import type { Database } from "../db/client.js";
import { deleteMeta, getMeta } from "../db/repositories/meta.js";

export const InitPendingSchema = z.strictObject({ version: z.literal(1), config: AppConfigSchema });

// The intent is committed together with auth settings and audit. A failed DB
// transaction never replaces the old file; a committed intent is replayable.
export function recoverInitialization(db: Database, dataDir: string): boolean {
  const raw = getMeta(db, "init_pending");
  if (raw === null) return false;
  let pending: z.infer<typeof InitPendingSchema>;
  try {
    pending = InitPendingSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("invalid initialization recovery record; restore the database backup");
  }

  const target = configFilePath(dataDir);
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(pending.config, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, target);
    // Make the rename durable before forgetting the recovery intent on POSIX.
    if (process.platform !== "win32") {
      const directory = openSync(dataDir, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
    deleteMeta(db, "init_pending");
    return true;
  } finally {
    rmSync(temporary, { force: true });
  }
}
