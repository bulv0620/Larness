import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";
import {
  authenticationResponse,
  createSoftwareAuthenticator,
  registrationResponse,
} from "../webauthn/authenticator.js";

function setCookieHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("; ") : (value ?? "");
}

function cookieValue(header: string, name: string): string {
  return new RegExp(`${name}=([^;]+)`).exec(header)?.[1] ?? "";
}

async function startInitialized(dir: string) {
  const port = await getFreePort();
  const origin = `http://localhost:${port}`;
  const running = await startServer({
    env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) },
    logDestination: createLogSink().stream,
  });
  const client = await connectIpc({ dataDir: dir, client: "tui" });

  await client.request("init.apply", {
    host: "127.0.0.1",
    port,
    publicUrl: null,
    channel: "stable",
  });

  return { running, client, origin, port };
}

async function enroll(
  started: Awaited<ReturnType<typeof startInitialized>>,
): Promise<{ requestId: string; enrollmentCookie: string }> {
  const created = (
    await started.running.app.inject({
      method: "POST",
      url: "/api/pairing/requests",
      headers: { origin: started.origin },
      payload: {},
    })
  ).json() as { requestId: string };

  const approved = (await started.client.request("pairing.approve", {
    requestId: created.requestId,
    decision: "trust",
  })) as { code: string };

  const redeem = await started.running.app.inject({
    method: "POST",
    url: "/api/pairing/redeem",
    headers: { origin: started.origin },
    payload: { requestId: created.requestId, code: approved.code },
  });

  return {
    requestId: created.requestId,
    enrollmentCookie: cookieValue(
      setCookieHeader(redeem.headers["set-cookie"]),
      "larness_enrollment",
    ),
  };
}

describe("WebAuthn REST API", () => {
  it("registers a passkey and logs in with it", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const authenticator = createSoftwareAuthenticator();

      try {
        const enrollment = await enroll(started);
        const cookie = `larness_enrollment=${enrollment.enrollmentCookie}`;

        const optionsResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/registration/options",
          headers: { origin: started.origin, cookie },
        });
        expect(optionsResponse.statusCode).toBe(200);
        const options = optionsResponse.json() as {
          challengeId: string;
          options: { challenge: string; rp: { id: string } };
        };
        expect(options.options.rp.id).toBe("localhost");

        const registrationVerify = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/registration/verify",
          headers: { origin: started.origin, cookie },
          payload: {
            challengeId: options.challengeId,
            response: registrationResponse(authenticator, {
              challenge: options.options.challenge,
              origin: started.origin,
              rpId: "localhost",
            }),
          },
        });

        expect(registrationVerify.statusCode).toBe(201);
        const registered = registrationVerify.json() as {
          kind: string;
          deviceId: string;
          passkey: { backupEligible: boolean; backupState: boolean };
        };
        expect(registered).toMatchObject({
          kind: "passkey",
          passkey: { backupEligible: true, backupState: true },
        });

        const registrationCookie = setCookieHeader(registrationVerify.headers["set-cookie"]);
        expect(registrationCookie).toContain("larness_session=");
        expect(registrationCookie).toContain("larness_enrollment=;");

        const reuseEnrollment = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/registration/options",
          headers: { origin: started.origin, cookie },
        });
        expect(reuseEnrollment.statusCode).toBe(410);
        expect(reuseEnrollment.json()).toMatchObject({ error: { code: "ENROLLMENT_EXPIRED" } });

        const bootstrap = await started.running.app.inject({
          method: "GET",
          url: "/api/bootstrap",
        });
        expect(bootstrap.json()).toMatchObject({
          initialized: true,
          auth: { passkeyRegistered: true },
        });

        const sessionToken = cookieValue(registrationCookie, "larness_session");
        const sessionResponse = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: { cookie: `larness_session=${sessionToken}` },
        });
        expect(sessionResponse.statusCode).toBe(200);
        expect(sessionResponse.json()).toMatchObject({
          kind: "passkey",
          deviceId: registered.deviceId,
          passkey: { backupEligible: true, backupState: true },
        });

        const authOptionsResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/options",
          headers: { origin: started.origin },
        });
        const authOptions = authOptionsResponse.json() as {
          challengeId: string;
          options: { challenge: string; allowCredentials: unknown[] };
        };
        expect(authOptions.options.allowCredentials).toEqual([]);

        const authVerify = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/verify",
          headers: { origin: started.origin },
          payload: {
            challengeId: authOptions.challengeId,
            response: authenticationResponse(authenticator, {
              challenge: authOptions.options.challenge,
              origin: started.origin,
              rpId: "localhost",
              counter: 1,
            }),
          },
        });

        expect(authVerify.statusCode).toBe(200);
        expect(authVerify.json()).toMatchObject({ kind: "passkey" });

        const replay = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/verify",
          headers: { origin: started.origin },
          payload: {
            challengeId: authOptions.challengeId,
            response: authenticationResponse(authenticator, {
              challenge: authOptions.options.challenge,
              origin: started.origin,
              rpId: "localhost",
              counter: 2,
            }),
          },
        });
        expect(replay.statusCode).toBe(410);
        expect(replay.json()).toMatchObject({ error: { code: "CHALLENGE_EXPIRED" } });

        const listed = (await started.client.request("devices.list")) as {
          devices: { id: string }[];
        };
        expect(listed.devices.map((device) => device.id)).toContain(registered.deviceId);

        const revoked = (await started.client.request("devices.revoke", {
          deviceId: registered.deviceId,
        })) as { revokedCredentials: number; revokedSessions: number };
        expect(revoked.revokedCredentials).toBe(1);

        const revokedSession = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: { cookie: `larness_session=${sessionToken}` },
        });
        expect(revokedSession.statusCode).toBe(401);

        const newOptions = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/options",
          headers: { origin: started.origin },
        });
        const newOptionsBody = newOptions.json() as {
          challengeId: string;
          options: { challenge: string };
        };
        const revokedLogin = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/verify",
          headers: { origin: started.origin },
          payload: {
            challengeId: newOptionsBody.challengeId,
            response: authenticationResponse(authenticator, {
              challenge: newOptionsBody.options.challenge,
              origin: started.origin,
              rpId: "localhost",
              counter: 2,
            }),
          },
        });
        expect(revokedLogin.statusCode).toBe(401);
        expect(revokedLogin.json()).toMatchObject({ error: { code: "PASSKEY_AUTH_FAILED" } });

        const auditActions = (
          started.running.sqlite.prepare("SELECT action FROM audit_logs").all() as {
            action: string;
          }[]
        ).map((row) => row.action);
        expect(auditActions).toEqual(
          expect.arrayContaining([
            "auth.passkey.registered",
            "auth.passkey.login",
            "device.revoked",
          ]),
        );
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rejects non-canonical origins and expired enrollment", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const enrollment = await enroll(started);
        const cookie = `larness_enrollment=${enrollment.enrollmentCookie}`;

        const wrongOrigin = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/registration/options",
          headers: { origin: `http://127.0.0.1:${started.port}`, cookie },
        });
        expect(wrongOrigin.statusCode).toBe(403);
        expect(wrongOrigin.json()).toMatchObject({ error: { code: "ORIGIN_INVALID" } });

        started.running.sqlite
          .prepare("UPDATE device_requests SET enrollment_expires_at = ? WHERE id = ?")
          .run(0, enrollment.requestId);

        const expired = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/registration/options",
          headers: { origin: started.origin, cookie },
        });
        expect(expired.statusCode).toBe(410);
        expect(expired.json()).toMatchObject({ error: { code: "ENROLLMENT_EXPIRED" } });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rejects WebAuthn options before initialization", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const running = await startServer({
        env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) },
        logDestination: createLogSink().stream,
      });

      try {
        const response = await running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/options",
          headers: { origin: `http://localhost:${port}` },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ error: { code: "NOT_INITIALIZED" } });
      } finally {
        await running.shutdown("test");
      }
    });
  });

  it("rejects registration and authentication from an IP origin", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const authOptions = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/options",
          headers: { origin: `http://127.0.0.1:${started.port}` },
        });
        expect(authOptions.statusCode).toBe(403);
        expect(authOptions.json()).toMatchObject({ error: { code: "ORIGIN_INVALID" } });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });
});
