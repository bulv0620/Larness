import { chmodSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { backupDatabase } from "./backup.js";
import type { OpenedDatabase } from "./client.js";

const KEEP_PRE_UPGRADE_BACKUPS = 5;

export class SchemaCompatibilityError extends Error {
  readonly code = "SCHEMA_VERSION_UNSUPPORTED";

  constructor(
    readonly applied: number,
    readonly expected: number,
  ) {
    super(
      `database schema ${applied} is newer than this Larness build (${expected}); ` +
        "install a newer Larness or restore a pre-upgrade backup",
    );
    this.name = "SchemaCompatibilityError";
  }
}

export function assertSchemaCompatible(applied: number, expected: number): void {
  if (applied > expected) {
    throw new SchemaCompatibilityError(applied, expected);
  }
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

export function backupBeforeMigrations(
  sqlite: OpenedDatabase["sqlite"],
  dataDir: string,
  options: { from: number; to: number; now?: number },
): string {
  const now = options.now ?? Date.now();
  const backupsDir = path.join(dataDir, "backups");
  const temporary = backupDatabase(sqlite, backupsDir, now);
  const target = path.join(
    backupsDir,
    `pre-upgrade-${options.from}-${options.to}-${stamp(now)}.db`,
  );

  try {
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may already be gone.
    }
    throw error;
  }

  trimPreUpgradeBackups(backupsDir);
  return target;
}

export function trimPreUpgradeBackups(backupsDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(backupsDir).filter(
      (entry) => entry.startsWith("pre-upgrade-") && entry.endsWith(".db"),
    );
  } catch {
    return;
  }

  entries.sort();
  for (const entry of entries.slice(0, Math.max(0, entries.length - KEEP_PRE_UPGRADE_BACKUPS))) {
    try {
      unlinkSync(path.join(backupsDir, entry));
    } catch {
      // Retention must not hide a successful backup.
    }
  }
}
