import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

const PASSWORD = "correct horse battery staple";

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
    adminPassword: PASSWORD,
    host: "127.0.0.1",
    port,
    publicUrl: null,
    channel: "stable",
  });

  return { running, client, origin, port };
}

async function startAllowOnceSession(started: Awaited<ReturnType<typeof startInitialized>>) {
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
    decision: "allow_once",
  })) as { code: string };

  const redeem = await started.running.app.inject({
    method: "POST",
    url: "/api/pairing/redeem",
    headers: { origin: started.origin },
    payload: { requestId: created.requestId, code: approved.code },
  });

  const cookie = setCookieHeader(redeem.headers["set-cookie"]);
  const body = redeem.json() as { csrfToken: string; clientSessionId: string };

  return {
    cookie: `larness_session=${cookieValue(cookie, "larness_session")}`,
    csrfToken: body.csrfToken,
    sessionId: body.clientSessionId,
  };
}

describe("security guard", () => {
  it("fails closed before initialization and allows only public endpoints", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const origin = `http://localhost:${port}`;
      const running = await startServer({
        env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) },
        logDestination: createLogSink().stream,
      });

      try {
        const projects = await running.app.inject({ method: "GET", url: "/api/projects" });
        expect(projects.statusCode).toBe(409);
        expect(projects.json()).toMatchObject({ error: { code: "NOT_INITIALIZED" } });

        const init = await running.app.inject({
          method: "POST",
          url: "/api/init",
          headers: { origin },
          payload: {},
        });
        expect(init.statusCode).toBe(404);

        const pairing = await running.app.inject({
          method: "POST",
          url: "/api/pairing/requests",
          headers: { origin },
          payload: {},
        });
        expect(pairing.statusCode).toBe(409);
        expect(pairing.json()).toMatchObject({ error: { code: "NOT_INITIALIZED" } });

        const bootstrap = await running.app.inject({ method: "GET", url: "/api/bootstrap" });
        expect(bootstrap.statusCode).toBe(200);
        expect(bootstrap.json()).toMatchObject({
          initialized: false,
          auth: {
            authenticated: false,
            pairingEnabled: false,
            passkeyEnabled: false,
            passkeyRegistered: false,
          },
        });

        const health = await running.app.inject({ method: "GET", url: "/api/health" });
        expect(health.headers["x-content-type-options"]).toBe("nosniff");
        expect(health.headers["referrer-policy"]).toBe("no-referrer");
        expect(health.headers["x-frame-options"]).toBe("DENY");
        expect(health.headers["content-security-policy"]).toContain("default-src 'none'");
      } finally {
        await running.shutdown("test");
      }
    });
  });

  it("requires a session for protected APIs and hides unknown routes behind auth", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/projects",
        });
        expect(unauthenticated.statusCode).toBe(401);
        expect(unauthenticated.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });

        const session = await startAllowOnceSession(started);
        const authenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { cookie: session.cookie },
        });
        expect(authenticated.statusCode).toBe(404);

        const bootstrap = await started.running.app.inject({
          method: "GET",
          url: "/api/bootstrap",
          headers: { cookie: session.cookie },
        });
        expect(bootstrap.json()).toMatchObject({
          initialized: true,
          auth: { authenticated: true, pairingEnabled: true, passkeyEnabled: true },
        });

        const badHost = await started.running.app.inject({
          method: "GET",
          url: "/api/bootstrap",
          headers: { host: "evil.example.com" },
        });
        expect(badHost.statusCode).toBe(403);
        expect(badHost.json()).toMatchObject({ error: { code: "ORIGIN_INVALID" } });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("enforces Origin and CSRF on logout and clears the cookie", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const session = await startAllowOnceSession(started);

        const noOrigin = await started.running.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: session.cookie },
        });
        expect(noOrigin.statusCode).toBe(403);
        expect(noOrigin.json()).toMatchObject({ error: { code: "ORIGIN_INVALID" } });

        const noCsrf = await started.running.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: session.cookie, origin: started.origin },
        });
        expect(noCsrf.statusCode).toBe(403);
        expect(noCsrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });

        const wrongOrigin = await started.running.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie: session.cookie,
            origin: "https://evil.example.com",
            "x-csrf-token": session.csrfToken,
          },
        });
        expect(wrongOrigin.statusCode).toBe(403);
        expect(wrongOrigin.json()).toMatchObject({ error: { code: "ORIGIN_INVALID" } });

        const logout = await started.running.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie: session.cookie,
            origin: started.origin,
            "x-csrf-token": session.csrfToken,
          },
        });
        expect(logout.statusCode).toBe(204);
        expect(setCookieHeader(logout.headers["set-cookie"])).toContain("larness_session=;");

        const afterLogout = await started.running.app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: { cookie: session.cookie },
        });
        expect(afterLogout.statusCode).toBe(401);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rate limits pairing requests per IP and audits the decision", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        const statuses: number[] = [];

        for (let index = 0; index < 11; index += 1) {
          const response = await started.running.app.inject({
            method: "POST",
            url: "/api/pairing/requests",
            headers: { origin: started.origin },
            payload: {},
          });
          statuses.push(response.statusCode);
        }

        expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
        expect(statuses[10]).toBe(429);

        const limited = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/requests",
          headers: { origin: started.origin },
          payload: {},
        });
        expect(limited.statusCode).toBe(429);
        expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

        const audit = started.running.sqlite
          .prepare("SELECT action FROM audit_logs WHERE action = 'security.rate_limited'")
          .all() as { action: string }[];
        expect(audit.length).toBeGreaterThanOrEqual(1);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rate limits WebAuthn options per IP", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);

      try {
        for (let index = 0; index < 10; index += 1) {
          const response = await started.running.app.inject({
            method: "POST",
            url: "/api/webauthn/authentication/options",
            headers: { origin: started.origin },
          });
          expect(response.statusCode).toBe(200);
        }

        const limited = await started.running.app.inject({
          method: "POST",
          url: "/api/webauthn/authentication/options",
          headers: { origin: started.origin },
        });
        expect(limited.statusCode).toBe(429);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });
});
