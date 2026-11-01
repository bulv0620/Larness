import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupExpired } from "../../src/db/cleanup.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createBrowserSession } from "../../src/db/repositories/browser-sessions.js";
import { createDeviceRequest } from "../../src/db/repositories/device-requests.js";
import { createChallenge } from "../../src/db/repositories/webauthn-challenges.js";
import { withTempDir } from "../helpers.js";

describe("cleanupExpired", () => {
  it("removes expired challenges, sessions and pending requests only", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const now = 1_000;

        createChallenge(opened.db, {
          type: "authentication",
          challenge: "expired",
          createdAt: 1,
          expiresAt: now - 1,
        });
        createChallenge(opened.db, {
          type: "authentication",
          challenge: "active",
          createdAt: 1,
          expiresAt: now + 100,
        });

        createBrowserSession(opened.db, {
          tokenHash: "expired",
          kind: "once",
          createdAt: 1,
          expiresAt: now - 1,
        });
        createBrowserSession(opened.db, {
          tokenHash: "active",
          kind: "once",
          createdAt: 1,
          expiresAt: now + 100,
        });

        const expiredPending = createDeviceRequest(opened.db, {
          shortCode: "111111",
          pollTokenHash: "poll-1",
          createdAt: 1,
          expiresAt: now - 1,
        });
        const expiredRedeemed = createDeviceRequest(opened.db, {
          shortCode: "222222",
          pollTokenHash: "poll-2",
          createdAt: 1,
          expiresAt: now - 1,
          status: "redeemed",
        });

        const result = cleanupExpired(opened.db, now);
        expect(result).toEqual({ challenges: 1, sessions: 1, requests: 1 });

        expect(
          opened.sqlite.prepare("SELECT count(*) AS n FROM webauthn_challenges").get(),
        ).toEqual({
          n: 1,
        });
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM browser_sessions").get()).toEqual({
          n: 1,
        });

        const remaining = opened.sqlite.prepare("SELECT id FROM device_requests").all() as {
          id: string;
        }[];
        expect(remaining.map((row) => row.id)).toEqual([expiredRedeemed.id]);
        expect(remaining.map((row) => row.id)).not.toContain(expiredPending.id);
      } finally {
        opened.close();
      }
    });
  });
});
