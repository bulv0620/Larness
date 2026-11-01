import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  csrfKeyPath,
  csrfTokenFor,
  loadOrCreateCsrfKey,
  verifyCsrfToken,
} from "../../src/auth/csrf.js";
import { issueSession, resolveActiveSession } from "../../src/auth/sessions.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { withTempDir } from "../helpers.js";

async function setup(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("session and CSRF primitives", () => {
  it("creates a 0600 CSRF key and reuses it", async () => {
    await withTempDir(async (dir) => {
      const key = await loadOrCreateCsrfKey(dir);
      expect(key).toHaveLength(32);

      if (process.platform !== "win32") {
        expect((await stat(csrfKeyPath(dir))).mode & 0o777).toBe(0o600);
      }

      const again = await loadOrCreateCsrfKey(dir);
      expect(again.equals(key)).toBe(true);
    });
  });

  it("derives and verifies session-bound CSRF tokens", () => {
    const key = randomBytes(32);
    const token = csrfTokenFor("bs_1", key);

    expect(verifyCsrfToken(token, "bs_1", key)).toBe(true);
    expect(verifyCsrfToken(token, "bs_2", key)).toBe(false);
    expect(verifyCsrfToken(token, "bs_1", randomBytes(32))).toBe(false);
  });

  it("enforces absolute and idle session expiry", async () => {
    await withTempDir(async (dir) => {
      const opened = await setup(dir);

      try {
        const issued = issueSession(opened.db, {
          kind: "once",
          now: 1_000,
          ttlMinutes: 60,
        });

        expect(resolveActiveSession(opened.db, issued.token, { now: 2_000 })).not.toBeNull();
        expect(
          resolveActiveSession(opened.db, issued.token, { now: 1_000 + 60 * 60_000 + 1 }),
        ).toBeNull();
        expect(
          resolveActiveSession(opened.db, issued.token, {
            now: 1_000 + 31 * 60_000,
            idleTtlMinutes: 30,
          }),
        ).toBeNull();

        opened.sqlite
          .prepare("UPDATE browser_sessions SET revoked_at = ? WHERE id = ?")
          .run(5_000, issued.session.id);
        expect(resolveActiveSession(opened.db, issued.token, { now: 6_000 })).toBeNull();
      } finally {
        opened.close();
      }
    });
  });
});
