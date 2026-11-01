import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { csrfKeyPath, verifyCsrfToken } from "../../src/auth/csrf.js";
import { hashToken } from "../../src/auth/tokens.js";
import { startServer } from "../../src/bootstrap/start.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

const PASSWORD = "correct horse battery staple";

interface Started {
  dir: string;
  port: number;
  origin: string;
  running: Awaited<ReturnType<typeof startServer>>;
  client: Awaited<ReturnType<typeof connectIpc>>;
}

async function startInitialized(dir: string): Promise<Started> {
  const port = await getFreePort();
  const origin = `http://localhost:${port}`;
  const running = await startServer({
    env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) },
    logDestination: createLogSink().stream,
  });
  const client = await connectIpc({ dataDir: dir, client: "tui" });

  await client.request("init.apply", {
    adminPassword: PASSWORD,
    host: "127.0.0.1",
    port,
    publicUrl: null,
    channel: "stable",
  });

  return { dir, port, origin, running, client };
}

function setCookieHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join("; ");
  }

  return value ?? "";
}

describe("pairing REST API", () => {
  it("completes the allow_once flow with a session cookie and no device", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const createdResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/requests",
          headers: { origin: started.origin, "user-agent": "test-agent" },
          payload: { clientLabel: "Chrome" },
        });

        expect(createdResponse.statusCode).toBe(201);
        const created = createdResponse.json() as {
          requestId: string;
          shortCode: string;
          pollToken: string;
          expiresAt: number;
        };
        expect(created.shortCode).toMatch(/^\d{6}$/);

        const poll = await started.running.app.inject({
          method: "GET",
          url: `/api/pairing/requests/${created.requestId}`,
          headers: { "x-pairing-token": created.pollToken },
        });
        expect(poll.statusCode).toBe(200);
        expect(poll.json()).toMatchObject({ status: "pending", decision: null });

        const approved = (await started.client.request("pairing.approve", {
          requestId: created.requestId,
          decision: "allow_once",
        })) as { code: string; expiresAt: number };

        const redeem = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/redeem",
          headers: { origin: started.origin, "user-agent": "test-agent" },
          payload: { requestId: created.requestId, code: approved.code.toLowerCase() },
        });

        expect(redeem.statusCode).toBe(200);
        expect(redeem.json()).toMatchObject({
          status: "session",
          kind: "once",
          deviceId: null,
        });

        const body = redeem.json() as {
          clientSessionId: string;
          csrfToken: string;
          expiresAt: number;
        };
        const cookie = setCookieHeader(redeem.headers["set-cookie"]);
        expect(cookie).toContain("larness_session=");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).toContain("Path=/");

        const csrfKey = await readFile(csrfKeyPath(dir));
        expect(verifyCsrfToken(body.csrfToken, body.clientSessionId, csrfKey)).toBe(true);

        const sessionToken = /larness_session=([^;]+)/.exec(cookie)?.[1] ?? "";
        const sessionInfo = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: { cookie: `larness_session=${sessionToken}` },
        });
        expect(sessionInfo.statusCode).toBe(200);
        expect(sessionInfo.json()).toMatchObject({
          clientSessionId: body.clientSessionId,
          kind: "once",
          deviceId: null,
        });

        const session = started.running.sqlite
          .prepare("SELECT kind, device_id FROM browser_sessions")
          .get() as { kind: string; device_id: string | null };
        expect(session).toEqual({ kind: "once", device_id: null });
        expect(
          started.running.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 0 });
        expect(
          started.running.sqlite.prepare("SELECT count(*) AS n FROM webauthn_credentials").get(),
        ).toEqual({ n: 0 });

        const reused = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/redeem",
          headers: { origin: started.origin },
          payload: { requestId: created.requestId, code: approved.code },
        });
        expect(reused.statusCode).toBe(409);
        expect(reused.json()).toMatchObject({ error: { code: "CONFLICT" } });

        const refresh = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/refresh",
        });
        expect(refresh.statusCode).toBe(404);

        started.running.sqlite.prepare("UPDATE browser_sessions SET expires_at = ?").run(1);
        const expiredSession = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: { cookie: `larness_session=${sessionToken}` },
        });
        expect(expiredSession.statusCode).toBe(401);
        expect(expiredSession.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("redeems trust into an enrollment cookie without a session or device", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
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

        expect(redeem.statusCode).toBe(200);
        expect(redeem.json()).toMatchObject({
          status: "passkey_required",
          requestId: created.requestId,
        });

        const cookie = setCookieHeader(redeem.headers["set-cookie"]);
        expect(cookie).toContain("larness_enrollment=");
        expect(cookie).toContain("Path=/api/webauthn/registration");
        expect(cookie).not.toContain("larness_session=");

        const token = /larness_enrollment=([^;]+)/.exec(cookie)?.[1] ?? "";
        const row = started.running.sqlite
          .prepare("SELECT status, enrollment_token_hash FROM device_requests")
          .get() as { status: string; enrollment_token_hash: string };

        expect(row.status).toBe("enrollment_pending");
        expect(row.enrollment_token_hash).toBe(hashToken(token));
        expect(
          started.running.sqlite.prepare("SELECT count(*) AS n FROM browser_sessions").get(),
        ).toEqual({ n: 0 });
        expect(
          started.running.sqlite.prepare("SELECT count(*) AS n FROM trusted_devices").get(),
        ).toEqual({ n: 0 });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("hides and rejects trust for non-canonical origins", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const nonCanonicalOrigin = `http://127.0.0.1:${started.port}`;
        const created = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/pairing/requests",
            headers: { origin: nonCanonicalOrigin },
            payload: {},
          })
        ).json() as { requestId: string };

        const listed = (await started.client.request("pairing.list", {
          status: "pending",
        })) as { requests: { requestId: string; trustAvailable: boolean }[] };
        expect(listed.requests.find((item) => item.requestId === created.requestId)).toMatchObject({
          trustAvailable: false,
        });

        await expect(
          started.client.request("pairing.approve", {
            requestId: created.requestId,
            decision: "trust",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        const approved = (await started.client.request("pairing.approve", {
          requestId: created.requestId,
          decision: "allow_once",
        })) as { code: string };

        const redeem = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/redeem",
          headers: { origin: nonCanonicalOrigin },
          payload: { requestId: created.requestId, code: approved.code },
        });
        expect(redeem.statusCode).toBe(200);
        expect(redeem.json()).toMatchObject({ status: "session" });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rejects pairing before initialization", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const running = await startServer({
        env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) },
        logDestination: createLogSink().stream,
      });

      try {
        const response = await running.app.inject({
          method: "POST",
          url: "/api/pairing/requests",
          headers: { origin: `http://localhost:${port}` },
          payload: {},
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ error: { code: "NOT_INITIALIZED" } });
      } finally {
        await running.shutdown("test");
      }
    });
  });

  it("returns CODE_INVALID with remaining attempts without leaking the code", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const created = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/pairing/requests",
            headers: { origin: started.origin },
            payload: {},
          })
        ).json() as { requestId: string };

        await started.client.request("pairing.approve", {
          requestId: created.requestId,
          decision: "allow_once",
        });

        const response = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/redeem",
          headers: { origin: started.origin },
          payload: { requestId: created.requestId, code: "WRONG00000" },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          error: { code: "CODE_INVALID", details: { attemptsLeft: 4 } },
        });
        expect(response.body).not.toContain("WRONG00000");
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("keeps requests pending when the TUI never approves", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const created = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/pairing/requests",
            headers: { origin: started.origin },
            payload: {},
          })
        ).json() as { requestId: string; pollToken: string };

        await new Promise((resolve) => setTimeout(resolve, 50));

        const poll = await started.running.app.inject({
          method: "GET",
          url: `/api/pairing/requests/${created.requestId}`,
          headers: { "x-pairing-token": created.pollToken },
        });
        expect(poll.json()).toMatchObject({ status: "pending" });

        const row = started.running.sqlite
          .prepare("SELECT status FROM device_requests WHERE id = ?")
          .get(created.requestId) as { status: string };
        expect(row.status).toBe("pending");
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });
});
