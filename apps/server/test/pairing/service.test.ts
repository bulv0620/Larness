import { randomBytes } from "node:crypto";
import path from "node:path";
import { deriveWebAuthn, type WebAuthnRuntime } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { csrfTokenFor, verifyCsrfToken } from "../../src/auth/csrf.js";
import { resolveActiveSession } from "../../src/auth/sessions.js";
import { hashToken } from "../../src/auth/tokens.js";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { createAuthSettings } from "../../src/db/repositories/auth-settings.js";
import { getDeviceRequestById } from "../../src/db/repositories/device-requests.js";
import { listTrustedDevices } from "../../src/db/repositories/trusted-devices.js";
import {
  approvePairingRequest,
  createPairingRequest,
  denyPairingRequest,
  getPairingStatus,
  PairingError,
  type PairingServiceOptions,
  redeemPairingCode,
} from "../../src/pairing/service.js";
import { testConfig, withTempDir } from "../helpers.js";

interface Harness {
  opened: OpenedDatabase;
  options: PairingServiceOptions;
}

async function setup(
  dir: string,
  overrides: { initialized?: boolean; webAuthn?: WebAuthnRuntime; origin?: string } = {},
): Promise<Harness> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);

  const config = testConfig({ server: { port: 3210 } });
  const webAuthn = overrides.webAuthn ?? deriveWebAuthn({ port: 3210, publicUrl: null }, "Larness");
  const csrfKey = randomBytes(32);

  if (overrides.initialized !== false) {
    createAuthSettings(opened.db, { adminHash: "hash", initializedAt: 1, now: 1 });
  }

  return {
    opened,
    options: { db: opened.db, config, webAuthn, csrfKey },
  };
}

const ORIGIN = "http://localhost:3210";

function createRequest(harness: Harness, now = 1_000, origin = ORIGIN) {
  return createPairingRequest(harness.options, {
    clientOrigin: origin,
    clientLabel: "Chrome",
    userAgent: "test-agent",
    ip: "127.0.0.1",
    now,
  });
}

function approve(
  harness: Harness,
  requestId: string,
  decision: "allow_once" | "trust",
  now = 2_000,
) {
  return approvePairingRequest(harness.options, { requestId, decision, now });
}

describe("pairing service", () => {
  it("creates requests with a short code, hashed poll token and audit", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);

        expect(created.shortCode).toMatch(/^\d{6}$/);
        expect(created.pollToken.length).toBeGreaterThan(20);
        expect(created.request.status).toBe("pending");
        expect(created.request.pollTokenHash).not.toContain(created.pollToken);

        const audit = listRecentAudit(harness.opened.db);
        expect(audit[0]?.action).toBe("pairing.requested");
        expect(audit[0]?.detailsJson).not.toContain(created.pollToken);

        expect(
          getPairingStatus(harness.options, {
            requestId: created.request.id,
            pollToken: created.pollToken,
            now: 1_100,
          }),
        ).toMatchObject({ status: "pending", decision: null });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects pairing before initialization", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir, { initialized: false });

      try {
        expect(() => createRequest(harness)).toThrow(
          expect.objectContaining({ code: "NOT_INITIALIZED" }),
        );
      } finally {
        harness.opened.close();
      }
    });
  });

  it("requires the correct poll token", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);

        expect(() =>
          getPairingStatus(harness.options, {
            requestId: created.request.id,
            pollToken: "wrong",
            now: 1_100,
          }),
        ).toThrow(PairingError);
      } finally {
        harness.opened.close();
      }
    });
  });

  it("approves allow_once and rejects a second approval", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "allow_once");

        expect(approved.code).toHaveLength(10);
        expect(approved.expiresAt).toBe(2_000 + 5 * 60_000);

        const row = getDeviceRequestById(harness.opened.db, created.request.id);
        expect(row).toMatchObject({ status: "approved", decision: "allow_once" });
        expect(row?.codeHash).toBe(hashToken(approved.code));

        expect(() => approve(harness, created.request.id, "allow_once")).toThrow(
          expect.objectContaining({ code: "CONFLICT" }),
        );
      } finally {
        harness.opened.close();
      }
    });
  });

  it("only allows trust for canonical origins and enabled WebAuthn", async () => {
    await withTempDir(async (dir) => {
      const disabled = await setup(dir, {
        webAuthn: {
          enabled: false,
          origin: ORIGIN,
          rpId: "localhost",
          rpName: "Larness",
          reason: "remote_http",
        },
      });

      try {
        const created = createRequest(disabled);
        expect(() => approve(disabled, created.request.id, "trust")).toThrow(
          expect.objectContaining({ code: "WEBAUTHN_NOT_CONFIGURED" }),
        );
      } finally {
        disabled.opened.close();
      }
    });

    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness, 1_000, "http://127.0.0.1:3210");
        expect(() => approve(harness, created.request.id, "trust")).toThrow(
          expect.objectContaining({ code: "ORIGIN_INVALID" }),
        );
      } finally {
        harness.opened.close();
      }
    });
  });

  it("redeems allow_once into a session with no device", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "allow_once");

        const redeemed = redeemPairingCode(harness.options, {
          requestId: created.request.id,
          code: approved.code.toLowerCase(),
          origin: ORIGIN,
          ip: "127.0.0.1",
          userAgent: "test-agent",
          now: 3_000,
        });

        expect(redeemed.kind).toBe("session");

        if (redeemed.kind !== "session") {
          throw new Error("expected session");
        }

        expect(redeemed.csrfToken).toBe(
          csrfTokenFor(redeemed.clientSessionId, harness.options.csrfKey),
        );
        expect(
          verifyCsrfToken(redeemed.csrfToken, redeemed.clientSessionId, harness.options.csrfKey),
        ).toBe(true);

        const session = harness.opened.sqlite
          .prepare("SELECT kind, device_id, token_hash FROM browser_sessions")
          .get() as { kind: string; device_id: string | null; token_hash: string };

        expect(session.kind).toBe("once");
        expect(session.device_id).toBeNull();
        expect(session.token_hash).toBe(hashToken(redeemed.token));
        expect(listTrustedDevices(harness.opened.db, true)).toHaveLength(0);

        expect(getDeviceRequestById(harness.opened.db, created.request.id)?.status).toBe(
          "redeemed",
        );

        expect(() =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            now: 4_000,
          }),
        ).toThrow(expect.objectContaining({ code: "CONFLICT" }));

        const resolved = resolveActiveSession(harness.opened.db, redeemed.token, {
          now: 3_100,
        });
        expect(resolved?.id).toBe(redeemed.clientSessionId);

        const expired = resolveActiveSession(harness.opened.db, redeemed.token, {
          now: redeemed.expiresAt + 1,
        });
        expect(expired).toBeNull();
      } finally {
        harness.opened.close();
      }
    });
  });

  it("invalidates the request after five wrong codes and rate limits the sixth", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "allow_once");

        for (let attempt = 1; attempt <= 5; attempt += 1) {
          expect(() =>
            redeemPairingCode(harness.options, {
              requestId: created.request.id,
              code: "WRONG00000",
              now: 3_000 + attempt,
            }),
          ).toThrow(
            expect.objectContaining({
              code: "CODE_INVALID",
              details: { attemptsLeft: 5 - attempt },
            }),
          );
        }

        expect(getDeviceRequestById(harness.opened.db, created.request.id)?.status).toBe("denied");

        expect(() =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            now: 4_000,
          }),
        ).toThrow(expect.objectContaining({ code: "RATE_LIMITED" }));

        const actions = listRecentAudit(harness.opened.db, 200).map((row) => row.action);
        expect(actions).toContain("security.rate_limited");
        expect(actions.filter((action) => action === "pairing.redeem_failed")).toHaveLength(5);

        const details = listRecentAudit(harness.opened.db, 200)
          .map((row) => row.detailsJson)
          .join(" ");
        expect(details).not.toContain(approved.code);
        expect(details).not.toContain("WRONG00000");
      } finally {
        harness.opened.close();
      }
    });
  });

  it("expires requests and codes", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness, 1_000);
        const approved = approve(harness, created.request.id, "allow_once", 1_100);

        expect(() =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            now: approved.expiresAt + 1,
          }),
        ).toThrow(expect.objectContaining({ code: "PAIRING_EXPIRED" }));
      } finally {
        harness.opened.close();
      }
    });

    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness, 1_000);
        expect(() =>
          approve(harness, created.request.id, "allow_once", 1_000 + 10 * 60_000 + 1),
        ).toThrow(expect.objectContaining({ code: "PAIRING_EXPIRED" }));
      } finally {
        harness.opened.close();
      }
    });
  });

  it("allows only one concurrent redemption", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "allow_once");

        const attempt = async () =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            now: 3_000,
          });

        const results = await Promise.allSettled([attempt(), attempt()]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected).toMatchObject({ reason: { code: "CONFLICT" } });

        const count = harness.opened.sqlite
          .prepare("SELECT count(*) AS count FROM browser_sessions")
          .get() as { count: number };
        expect(count.count).toBe(1);
      } finally {
        harness.opened.close();
      }
    });
  });

  it("redeems trust into an enrollment without a session or device", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "trust", 2_000);

        const redeemed = redeemPairingCode(harness.options, {
          requestId: created.request.id,
          code: approved.code,
          origin: ORIGIN,
          now: 3_000,
        });

        expect(redeemed.kind).toBe("enrollment");

        if (redeemed.kind !== "enrollment") {
          throw new Error("expected enrollment");
        }

        expect(redeemed.expiresAt).toBe(3_000 + 5 * 60_000);

        const row = getDeviceRequestById(harness.opened.db, created.request.id);
        expect(row?.status).toBe("enrollment_pending");
        expect(row?.enrollmentTokenHash).toBe(hashToken(redeemed.token));
        expect(row?.enrollmentExpiresAt).toBe(redeemed.expiresAt);

        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM browser_sessions").get(),
        ).toEqual({
          n: 0,
        });
        expect(listTrustedDevices(harness.opened.db, true)).toHaveLength(0);

        expect(() =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            now: 3_100,
          }),
        ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects a trust redemption from a non-canonical redeem origin", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);
        const approved = approve(harness, created.request.id, "trust");

        expect(() =>
          redeemPairingCode(harness.options, {
            requestId: created.request.id,
            code: approved.code,
            origin: "http://127.0.0.1:3210",
            now: 3_000,
          }),
        ).toThrow(expect.objectContaining({ code: "ORIGIN_INVALID" }));
      } finally {
        harness.opened.close();
      }
    });
  });

  it("denies pending requests and leaves them pending without TUI approval", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const created = createRequest(harness);

        expect(
          getPairingStatus(harness.options, {
            requestId: created.request.id,
            pollToken: created.pollToken,
            now: 5_000,
          }).status,
        ).toBe("pending");

        denyPairingRequest(harness.options, { requestId: created.request.id, now: 5_100 });

        expect(getDeviceRequestById(harness.opened.db, created.request.id)?.status).toBe("denied");
        expect(() => approve(harness, created.request.id, "allow_once", 5_200)).toThrow(
          expect.objectContaining({ code: "CONFLICT" }),
        );
      } finally {
        harness.opened.close();
      }
    });
  });
});
