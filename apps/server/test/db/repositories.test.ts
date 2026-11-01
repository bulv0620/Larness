import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAudit, listRecentAudit } from "../../src/db/repositories/audit.js";
import { createAuthSettings, getAuthSettings } from "../../src/db/repositories/auth-settings.js";
import {
  createBrowserSession,
  getSessionByTokenHash,
  listSessionsByDevice,
  revokeDeviceSessions,
} from "../../src/db/repositories/browser-sessions.js";
import {
  createDeviceRequest,
  getDeviceRequestById,
  getDeviceRequestByShortCode,
  updateDeviceRequest,
} from "../../src/db/repositories/device-requests.js";
import { ensureInstanceId, getMeta, setMeta } from "../../src/db/repositories/meta.js";
import {
  createTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
} from "../../src/db/repositories/trusted-devices.js";
import {
  consumeChallenge,
  createChallenge,
  getChallenge,
} from "../../src/db/repositories/webauthn-challenges.js";
import {
  createWebAuthnCredential,
  getCredentialByCredentialId,
} from "../../src/db/repositories/webauthn-credentials.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { withTempDir } from "../helpers.js";

async function openMigrated(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function seedDevice(opened: OpenedDatabase) {
  return createTrustedDevice(opened.db, { label: "MacBook", createdAt: 1 });
}

describe("repositories", () => {
  it("stores and updates metadata with a stable instance id", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        expect(getMeta(opened.db, "initialized_at")).toBeNull();
        setMeta(opened.db, "initialized_at", "123", 10);
        expect(getMeta(opened.db, "initialized_at")).toBe("123");

        const first = ensureInstanceId(opened.db, 20);
        const second = ensureInstanceId(opened.db, 30);
        expect(second).toBe(first);
        expect(first).toMatch(/^inst_/);
      } finally {
        opened.close();
      }
    });
  });

  it("enforces the single auth_settings row", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        createAuthSettings(opened.db, { adminHash: "argon2", initializedAt: 5, now: 5 });
        expect(getAuthSettings(opened.db)?.adminHash).toBe("argon2");

        expect(() =>
          opened.sqlite
            .prepare(
              "INSERT INTO auth_settings (id, admin_hash, admin_updated_at, initialized_at) VALUES (?, ?, ?, ?)",
            )
            .run(2, "other", 1, 1),
        ).toThrow(/CHECK/);
      } finally {
        opened.close();
      }
    });
  });

  it("creates and updates pairing requests", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const request = createDeviceRequest(opened.db, {
          shortCode: "123456",
          pollTokenHash: "poll-hash",
          createdAt: 100,
          expiresAt: 200,
          clientLabel: "Chrome",
        });

        expect(getDeviceRequestById(opened.db, request.id)?.status).toBe("pending");
        expect(getDeviceRequestByShortCode(opened.db, "123456")?.id).toBe(request.id);

        updateDeviceRequest(opened.db, request.id, {
          status: "approved",
          decision: "allow_once",
          decidedAt: 150,
        });

        const updated = getDeviceRequestById(opened.db, request.id);
        expect(updated?.status).toBe("approved");
        expect(updated?.decision).toBe("allow_once");
      } finally {
        opened.close();
      }
    });
  });

  it("persists devices, credentials, challenges and sessions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const device = seedDevice(opened);
        const credential = createWebAuthnCredential(opened.db, {
          deviceId: device.id,
          credentialId: "credential-1",
          publicKey: "cose-key",
          createdAt: 1,
          backupEligible: true,
        });

        expect(getCredentialByCredentialId(opened.db, "credential-1")?.id).toBe(credential.id);
        expect(credential.backupEligible).toBe(true);

        const challenge = createChallenge(opened.db, {
          type: "registration",
          challenge: "challenge-value",
          createdAt: 1,
          expiresAt: 2,
          deviceId: device.id,
        });

        expect(consumeChallenge(opened.db, challenge.id, 3)).toBe(true);
        expect(consumeChallenge(opened.db, challenge.id, 4)).toBe(false);
        expect(getChallenge(opened.db, challenge.id)?.consumedAt).toBe(3);

        const session = createBrowserSession(opened.db, {
          tokenHash: "session-hash",
          kind: "passkey",
          createdAt: 1,
          expiresAt: 100,
          deviceId: device.id,
        });

        expect(getSessionByTokenHash(opened.db, "session-hash")?.id).toBe(session.id);
        expect(listSessionsByDevice(opened.db, device.id)).toHaveLength(1);
        expect(revokeDeviceSessions(opened.db, device.id, 5)).toBe(1);
        expect(getSessionByTokenHash(opened.db, "session-hash")?.revokedAt).toBe(5);
      } finally {
        opened.close();
      }
    });
  });

  it("revokes devices without deleting history", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const device = seedDevice(opened);
        expect(listTrustedDevices(opened.db)).toHaveLength(1);
        expect(revokeTrustedDevice(opened.db, device.id, 10)).toBe(true);
        expect(listTrustedDevices(opened.db)).toHaveLength(0);
        expect(listTrustedDevices(opened.db, true)).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });

  it("redacts secrets in audit details and enforces append-only reads", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const row = appendAudit(opened.db, {
          action: "auth.passkey.registered",
          decision: "info",
          details: {
            password: "hunter2",
            nested: { sessionToken: "secret-token" },
            safe: "visible",
          },
          now: 10,
        });

        const details = JSON.parse(row.detailsJson) as Record<string, unknown>;
        expect(details.password).toBe("[Redacted]");
        expect((details.nested as Record<string, unknown>).sessionToken).toBe("[Redacted]");
        expect(details.safe).toBe("visible");
        expect(row.detailsJson).not.toContain("hunter2");
        expect(row.detailsJson).not.toContain("secret-token");

        const recent = listRecentAudit(opened.db, 10);
        expect(recent).toHaveLength(1);
        expect(recent[0]?.id).toBe(row.id);
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed when the audit table is unavailable", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        opened.sqlite.exec("DROP TABLE audit_logs");
        expect(() => appendAudit(opened.db, { action: "auth.login" })).toThrow();
      } finally {
        opened.close();
      }
    });
  });

  it("rolls back device and audit writes together", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        expect(() =>
          immediateTransaction(opened.db, (tx) => {
            createTrustedDevice(tx, { label: "Rollback", createdAt: 1 });
            appendAudit(tx, { action: "device.created", now: 1 });
            throw new Error("rollback");
          }),
        ).toThrow("rollback");

        expect(listTrustedDevices(opened.db, true)).toHaveLength(0);
        expect(listRecentAudit(opened.db)).toHaveLength(0);
      } finally {
        opened.close();
      }
    });
  });
});
