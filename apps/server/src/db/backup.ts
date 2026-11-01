import { mkdirSync } from "node:fs";
import path from "node:path";
import type { OpenedDatabase } from "./client.js";

export function backupDatabase(
  sqlite: OpenedDatabase["sqlite"],
  backupsDir: string,
  now = Date.now(),
): string {
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupsDir, `larness-${stamp}.db`);

  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  return target;
}
