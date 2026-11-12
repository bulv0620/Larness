import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  createBrowserSession,
  revokeSession,
  touchSession,
} from "../../src/db/repositories/browser-sessions.js";
import { countOnlineSessions } from "../../src/db/stats.js";
import { withTempDir } from "../helpers.js";

const MINUTE = 60_000;

function createSession(
  db: Database,
  tokenHash: string,
  input: { createdAt: number; expiresAt: number },
): string {
  return createBrowserSession(db, {
    tokenHash,
    kind: "once",
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  }).id;
}

describe("countOnlineSessions", () => {
  it("counts only sessions that can still authenticate", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const now = 10_000 * MINUTE;
        const idleTtlMinutes = 30;
        const idleCutoff = now - idleTtlMinutes * MINUTE;

        const active = createSession(opened.db, "active", {
          createdAt: now - 5 * MINUTE,
          expiresAt: now + 60 * MINUTE,
        });
        touchSession(opened.db, active, now - 29 * MINUTE);

        const boundary = createSession(opened.db, "boundary", {
          createdAt: idleCutoff,
          expiresAt: now + 60 * MINUTE,
        });
        touchSession(opened.db, boundary, idleCutoff);

        const idle = createSession(opened.db, "idle", {
          createdAt: now - 120 * MINUTE,
          expiresAt: now + 60 * MINUTE,
        });
        touchSession(opened.db, idle, idleCutoff - 1);

        const revoked = createSession(opened.db, "revoked", {
          createdAt: now - 60 * MINUTE,
          expiresAt: now + 60 * MINUTE,
        });
        touchSession(opened.db, revoked, now - MINUTE);
        revokeSession(opened.db, revoked, now);

        const expired = createSession(opened.db, "expired", {
          createdAt: now - 60 * MINUTE,
          expiresAt: now - 1,
        });
        touchSession(opened.db, expired, now - MINUTE);

        expect(countOnlineSessions(opened.db, now, idleTtlMinutes)).toBe(2);
      } finally {
        opened.close();
      }
    });
  });

  it("uses the configured idle TTL instead of a fixed window", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const now = 10_000 * MINUTE;
        const session = createSession(opened.db, "recent", {
          createdAt: now - 15 * MINUTE,
          expiresAt: now + 60 * MINUTE,
        });
        touchSession(opened.db, session, now - 10 * MINUTE);

        expect(countOnlineSessions(opened.db, now, 5)).toBe(0);
        expect(countOnlineSessions(opened.db, now, 30)).toBe(1);
      } finally {
        opened.close();
      }
    });
  });
});
