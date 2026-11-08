import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  assertSchemaCompatible,
  backupBeforeMigrations,
  SchemaCompatibilityError,
} from "../../src/db/preUpgradeBackup.js";
import { withTempDir } from "../helpers.js";

describe("pre-upgrade database backup", () => {
  it("creates a 0600 backup before a migration and keeps five", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const first = backupBeforeMigrations(opened.sqlite, dir, {
          from: 21,
          to: 22,
          now: 1_000,
        });
        expect(path.basename(first)).toMatch(/^pre-upgrade-21-22-/);
        expect(statSync(first).mode & 0o777).toBe(0o600);

        for (let index = 0; index < 6; index += 1) {
          backupBeforeMigrations(opened.sqlite, dir, {
            from: 21,
            to: 22,
            now: 2_000 + index,
          });
        }

        const backups = readdirSync(path.join(dir, "backups")).filter((entry) =>
          entry.startsWith("pre-upgrade-"),
        );
        expect(backups).toHaveLength(5);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects a database schema newer than the program", () => {
    expect(() => assertSchemaCompatible(23, 22)).toThrow(SchemaCompatibilityError);
    expect(() => assertSchemaCompatible(22, 22)).not.toThrow();
    expect(() => assertSchemaCompatible(21, 22)).not.toThrow();
  });
});
