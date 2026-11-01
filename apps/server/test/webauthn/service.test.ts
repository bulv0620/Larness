import { randomBytes } from "node:crypto";
import path from "node:path";
import { deriveWebAuthn, type WebAuthnRuntime } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { resolveActiveSession } from "../../src/auth/sessions.js";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { createAuthSettings } from "../../src/db/repositories/auth-settings.js";
import { getDeviceRequestById } from "../../src/db/repositories/device-requests.js";
import { ensureInstanceId } from "../../src/db/repositories/meta.js";
import {
  approvePairingRequest,
  createPairingRequest,
  type PairingServiceOptions,
  redeemPairingCode,
} from "../../src/pairing/service.js";
import {
  authenticationOptions,
  listDevices,
  registrationOptions,
  revokeDevice,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnServiceOptions,
} from "../../src/webauthn/service.js";
import { testConfig, withTempDir } from "../helpers.js";
import {
  authenticationResponse,
  createSoftwareAuthenticator,
  registrationResponse,
} from "./authenticator.js";

const ORIGIN = "http://localhost:3210";
const NOW = 1_000;

interface Harness {
  opened: OpenedDatabase;
  options: WebAuthnServiceOptions;
  pairing: PairingServiceOptions;
}

async function setup(dir: string, webAuthnOverride?: WebAuthnRuntime): Promise<Harness> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);

  const config = testConfig({ server: { port: 3210 }, auth: { sessionTtlMinutes: 60 } });
  const webAuthn = webAuthnOverride ?? deriveWebAuthn({ port: 3210, publicUrl: null }, "Larness");
  const csrfKey = randomBytes(32);

  createAuthSettings(opened.db, { adminHash: "hash", initializedAt: NOW, now: NOW });
  ensureInstanceId(opened.db, NOW);

  return {
    opened,
    options: {
      db: opened.db,
      config,
      webAuthn,
      csrfKey,
      now: () => NOW,
    },
    pairing: {
      db: opened.db,
      config,
      webAuthn,
      csrfKey,
    },
  };
}

async function enroll(harness: Harness): Promise<{ token: string; requestId: string }> {
  const created = createPairingRequest(harness.pairing, {
    clientOrigin: ORIGIN,
    clientLabel: "MacBook",
    userAgent: "test-agent",
    now: NOW,
  });
  const approved = approvePairingRequest(harness.pairing, {
    requestId: created.request.id,
    decision: "trust",
    now: NOW,
  });
  const redeemed = redeemPairingCode(harness.pairing, {
    requestId: created.request.id,
    code: approved.code,
    origin: ORIGIN,
    now: NOW,
  });

  if (redeemed.kind !== "enrollment") {
    throw new Error("expected enrollment");
  }

  return { token: redeemed.token, requestId: created.request.id };
}

describe("WebAuthn registration", () => {
  it("returns registration options bound to the enrollment", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const enrollment = await enroll(harness);
        const result = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
        });

        expect(result.options.rp.id).toBe("localhost");
        expect(result.options.attestation).toBe("none");
        expect(result.options.authenticatorSelection).toMatchObject({
          residentKey: "required",
          userVerification: "required",
        });
        expect(result.options.challenge).toBeTruthy();

        const row = harness.opened.sqlite
          .prepare("SELECT type, request_id FROM webauthn_challenges WHERE id = ?")
          .get(result.challengeId) as { type: string; request_id: string };
        expect(row).toEqual({ type: "registration", request_id: enrollment.requestId });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects options without a valid enrollment or canonical origin", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        await expect(
          registrationOptions(harness.options, { origin: ORIGIN, enrollmentToken: "missing" }),
        ).rejects.toMatchObject({ code: "ENROLLMENT_EXPIRED" });

        const enrollment = await enroll(harness);
        await expect(
          registrationOptions(harness.options, {
            origin: "http://127.0.0.1:3210",
            enrollmentToken: enrollment.token,
          }),
        ).rejects.toMatchObject({ code: "ORIGIN_INVALID" });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects options when WebAuthn is not configured", async () => {
    await withTempDir(async (dir) => {
      const webAuthn: WebAuthnRuntime = {
        enabled: false,
        origin: ORIGIN,
        rpId: "localhost",
        rpName: "Larness",
        reason: "remote_http",
      };
      const harness = await setup(dir, webAuthn);

      try {
        await expect(
          registrationOptions(harness.options, { origin: ORIGIN, enrollmentToken: "x" }),
        ).rejects.toMatchObject({ code: "WEBAUTHN_NOT_CONFIGURED" });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("creates a device, credential and session after successful verification", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);
      const authenticator = createSoftwareAuthenticator();

      try {
        const enrollment = await enroll(harness);
        const options = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
        });
        const response = registrationResponse(authenticator, {
          challenge: options.options.challenge,
          origin: ORIGIN,
          rpId: "localhost",
        });

        const session = await verifyRegistration(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
          challengeId: options.challengeId,
          response: response as never,
        });

        expect(session).toMatchObject({ kind: "passkey", backupEligible: true, backupState: true });
        expect(session.deviceId).toMatch(/^dev_/);
        expect(resolveActiveSession(harness.opened.db, session.token, { now: NOW })).not.toBeNull();

        const device = harness.opened.sqlite
          .prepare("SELECT label, revoked_at FROM trusted_devices")
          .get() as { label: string; revoked_at: number | null };
        expect(device).toEqual({ label: "MacBook", revoked_at: null });

        const credential = harness.opened.sqlite
          .prepare(
            "SELECT credential_id, counter, backup_eligible, backup_state, transports_json FROM webauthn_credentials",
          )
          .get() as {
          credential_id: string;
          counter: number;
          backup_eligible: number;
          backup_state: number;
          transports_json: string;
        };
        expect(credential.credential_id).toBeTruthy();
        expect(credential.counter).toBe(0);
        expect(credential.backup_eligible).toBe(1);
        expect(credential.backup_state).toBe(1);
        expect(credential.transports_json).toBe('["internal"]');

        expect(getDeviceRequestById(harness.opened.db, enrollment.requestId)).toMatchObject({
          status: "redeemed",
          enrollmentTokenHash: null,
        });
        expect(listRecentAudit(harness.opened.db, 50).map((row) => row.action)).toContain(
          "auth.passkey.registered",
        );
      } finally {
        harness.opened.close();
      }
    });
  });

  it("fails closed on invalid registration and consumes the challenge", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const enrollment = await enroll(harness);
        const options = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
        });

        await expect(
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: enrollment.token,
            challengeId: options.challengeId,
            response: { id: "bogus" } as never,
          }),
        ).rejects.toMatchObject({ code: "PASSKEY_REGISTRATION_FAILED" });

        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 0 });
        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM browser_sessions").get(),
        ).toEqual({ n: 0 });

        await expect(
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: enrollment.token,
            challengeId: options.challengeId,
            response: { id: "bogus" } as never,
          }),
        ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects expired challenges and cross-enrollment challenges", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);
      const authenticator = createSoftwareAuthenticator();

      try {
        const first = await enroll(harness);
        const firstOptions = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: first.token,
        });

        harness.opened.sqlite
          .prepare("UPDATE webauthn_challenges SET expires_at = ? WHERE id = ?")
          .run(0, firstOptions.challengeId);

        await expect(
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: first.token,
            challengeId: firstOptions.challengeId,
            response: registrationResponse(authenticator, {
              challenge: firstOptions.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });

        const second = await enroll(harness);
        const secondOptions = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: second.token,
        });

        await expect(
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: first.token,
            challengeId: secondOptions.challengeId,
            response: registrationResponse(authenticator, {
              challenge: secondOptions.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "PASSKEY_REGISTRATION_FAILED" });

        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 0 });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("allows only one successful registration per enrollment", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);
      const authenticator = createSoftwareAuthenticator();

      try {
        const enrollment = await enroll(harness);
        const first = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
        });
        const second = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: enrollment.token,
        });

        const attempts = await Promise.allSettled([
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: enrollment.token,
            challengeId: first.challengeId,
            response: registrationResponse(authenticator, {
              challenge: first.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
            }) as never,
          }),
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: enrollment.token,
            challengeId: second.challengeId,
            response: registrationResponse(authenticator, {
              challenge: second.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
            }) as never,
          }),
        ]);

        expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 1 });
        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM browser_sessions").get(),
        ).toEqual({ n: 1 });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects duplicate credentials", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);
      const authenticator = createSoftwareAuthenticator();

      try {
        const first = await enroll(harness);
        const firstOptions = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: first.token,
        });
        await verifyRegistration(harness.options, {
          origin: ORIGIN,
          enrollmentToken: first.token,
          challengeId: firstOptions.challengeId,
          response: registrationResponse(authenticator, {
            challenge: firstOptions.options.challenge,
            origin: ORIGIN,
            rpId: "localhost",
          }) as never,
        });

        const second = await enroll(harness);
        const secondOptions = await registrationOptions(harness.options, {
          origin: ORIGIN,
          enrollmentToken: second.token,
        });

        await expect(
          verifyRegistration(harness.options, {
            origin: ORIGIN,
            enrollmentToken: second.token,
            challengeId: secondOptions.challengeId,
            response: registrationResponse(authenticator, {
              challenge: secondOptions.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "PASSKEY_REGISTRATION_FAILED" });

        expect(
          harness.opened.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 1 });
      } finally {
        harness.opened.close();
      }
    });
  });
});

describe("WebAuthn authentication and revocation", () => {
  async function register(harness: Harness) {
    const authenticator = createSoftwareAuthenticator();
    const enrollment = await enroll(harness);
    const options = await registrationOptions(harness.options, {
      origin: ORIGIN,
      enrollmentToken: enrollment.token,
    });
    const session = await verifyRegistration(harness.options, {
      origin: ORIGIN,
      enrollmentToken: enrollment.token,
      challengeId: options.challengeId,
      response: registrationResponse(authenticator, {
        challenge: options.options.challenge,
        origin: ORIGIN,
        rpId: "localhost",
      }) as never,
    });

    return { authenticator, session };
  }

  it("logs in with a discoverable credential and updates the counter", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const { authenticator } = await register(harness);
        const options = await authenticationOptions(harness.options, { origin: ORIGIN });

        expect(options.options.allowCredentials).toEqual([]);
        expect(options.options.userVerification).toBe("required");

        const session = await verifyAuthentication(harness.options, {
          origin: ORIGIN,
          challengeId: options.challengeId,
          response: authenticationResponse(authenticator, {
            challenge: options.options.challenge,
            origin: ORIGIN,
            rpId: "localhost",
            counter: 1,
          }) as never,
        });

        expect(session.kind).toBe("passkey");

        const credential = harness.opened.sqlite
          .prepare("SELECT counter, backup_eligible FROM webauthn_credentials")
          .get() as { counter: number; backup_eligible: number };
        expect(credential.counter).toBe(1);
        expect(credential.backup_eligible).toBe(1);
        expect(listRecentAudit(harness.opened.db, 50).map((row) => row.action)).toContain(
          "auth.passkey.login",
        );
      } finally {
        harness.opened.close();
      }
    });
  });

  it("rejects replayed challenges, unknown credentials and non-canonical origins", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const { authenticator } = await register(harness);
        const options = await authenticationOptions(harness.options, { origin: ORIGIN });

        await verifyAuthentication(harness.options, {
          origin: ORIGIN,
          challengeId: options.challengeId,
          response: authenticationResponse(authenticator, {
            challenge: options.options.challenge,
            origin: ORIGIN,
            rpId: "localhost",
            counter: 1,
          }) as never,
        });

        await expect(
          verifyAuthentication(harness.options, {
            origin: ORIGIN,
            challengeId: options.challengeId,
            response: authenticationResponse(authenticator, {
              challenge: options.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
              counter: 2,
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });

        const fresh = await authenticationOptions(harness.options, { origin: ORIGIN });
        const unknown = createSoftwareAuthenticator();

        await expect(
          verifyAuthentication(harness.options, {
            origin: ORIGIN,
            challengeId: fresh.challengeId,
            response: authenticationResponse(unknown, {
              challenge: fresh.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
              counter: 1,
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "PASSKEY_AUTH_FAILED" });

        await expect(
          authenticationOptions(harness.options, { origin: "http://127.0.0.1:3210" }),
        ).rejects.toMatchObject({ code: "ORIGIN_INVALID" });
      } finally {
        harness.opened.close();
      }
    });
  });

  it("revokes devices, credentials and sessions", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const { authenticator, session } = await register(harness);

        expect(listDevices(harness.options)).toHaveLength(1);
        expect(listDevices(harness.options)[0]?.credentials[0]?.backupEligible).toBe(true);

        const result = revokeDevice(harness.options, { deviceId: session.deviceId });
        expect(result).toEqual({ revokedCredentials: 1, revokedSessions: 1 });
        expect(resolveActiveSession(harness.opened.db, session.token, { now: NOW })).toBeNull();

        const options = await authenticationOptions(harness.options, { origin: ORIGIN });

        await expect(
          verifyAuthentication(harness.options, {
            origin: ORIGIN,
            challengeId: options.challengeId,
            response: authenticationResponse(authenticator, {
              challenge: options.options.challenge,
              origin: ORIGIN,
              rpId: "localhost",
              counter: 2,
            }) as never,
          }),
        ).rejects.toMatchObject({ code: "PASSKEY_AUTH_FAILED" });

        const actions = listRecentAudit(harness.opened.db, 50).map((row) => row.action);
        expect(actions).toContain("device.revoked");
      } finally {
        harness.opened.close();
      }
    });
  });

  it("allows a zero or decreasing counter but audits the anomaly", async () => {
    await withTempDir(async (dir) => {
      const harness = await setup(dir);

      try {
        const { authenticator } = await register(harness);
        harness.opened.sqlite.prepare("UPDATE webauthn_credentials SET counter = 5").run();

        const options = await authenticationOptions(harness.options, { origin: ORIGIN });
        const session = await verifyAuthentication(harness.options, {
          origin: ORIGIN,
          challengeId: options.challengeId,
          response: authenticationResponse(authenticator, {
            challenge: options.options.challenge,
            origin: ORIGIN,
            rpId: "localhost",
            counter: 1,
          }) as never,
        });

        expect(session.kind).toBe("passkey");
        expect(listRecentAudit(harness.opened.db, 50).map((row) => row.action)).toContain(
          "auth.passkey.counter_anomaly",
        );
      } finally {
        harness.opened.close();
      }
    });
  });
});
