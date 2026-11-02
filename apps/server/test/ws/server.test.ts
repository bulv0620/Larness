import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { issueSession } from "../../src/auth/sessions.js";
import { startServer } from "../../src/bootstrap/start.js";
import { touchSession } from "../../src/db/repositories/browser-sessions.js";
import { createTrustedDevice } from "../../src/db/repositories/trusted-devices.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { publishAgentEvent } from "../../src/ws/publisher.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

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

interface Connected {
  socket: WebSocket;
  nextMessage(timeoutMs?: number): Promise<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
}

function connect(
  port: number,
  options: { cookie?: string; origin?: string } = {},
): Promise<Connected> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
  });
  const queue: Record<string, unknown>[] = [];
  const waiters: ((message: Record<string, unknown>) => void)[] = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const waiter = waiters.shift();

    if (waiter !== undefined) {
      waiter(message);
    } else {
      queue.push(message);
    }
  });

  const nextMessage = (timeoutMs = 2_000): Promise<Record<string, unknown>> => {
    const queued = queue.shift();

    if (queued !== undefined) {
      return Promise.resolve(queued);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for WS message")),
        timeoutMs,
      );
      waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  };

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ socket, nextMessage, closed }));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`unexpected response ${response.statusCode}`));
    });
  });
}

function upgradeStatus(
  port: number,
  options: { cookie?: string; origin?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      },
    });

    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      socket.terminate();
      resolve(status);
    });
    socket.once("open", () => {
      socket.close();
      resolve(101);
    });
    socket.once("error", reject);
  });
}

describe("WebSocket security", () => {
  it("rejects upgrades without a session or with a non-canonical origin", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const issued = issueSession(started.running.db, {
        kind: "once",
        now: Date.now(),
        ttlMinutes: 60,
      });

      try {
        expect(await upgradeStatus(started.port, { origin: started.origin })).toBe(401);

        expect(
          await upgradeStatus(started.port, {
            cookie: `larness_session=${issued.token}`,
            origin: `http://127.0.0.1:${started.port}`,
          }),
        ).toBe(403);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("sends hello, allows system subscriptions and rejects unknown topics", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const issued = issueSession(started.running.db, {
        kind: "once",
        now: Date.now(),
        ttlMinutes: 60,
      });

      try {
        const connected = await connect(started.port, {
          cookie: `larness_session=${issued.token}`,
          origin: started.origin,
        });

        const hello = await connected.nextMessage();
        expect(hello).toMatchObject({
          kind: "hello",
          protocolVersion: 1,
          clientSessionId: issued.session.id,
        });

        connected.socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "system", resourceId: "system" }],
          }),
        );
        const subscribed = await connected.nextMessage();
        expect(subscribed).toMatchObject({
          kind: "subscribed",
          subscription: { topic: "system", resourceId: "system" },
        });

        connected.socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "agent", resourceId: "ses_other" }],
          }),
        );
        const forbidden = await connected.nextMessage();
        expect(forbidden).toMatchObject({ kind: "error", code: "FORBIDDEN" });

        connected.socket.close();
        await connected.closed;
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("subscribes to an agent session and receives published events", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const issued = issueSession(started.running.db, {
        kind: "once",
        now: Date.now(),
        ttlMinutes: 60,
      });
      const session = await createSession({ db: started.running.db, dataDir: dir }, {});
      const connected = await connect(started.port, {
        cookie: `larness_session=${issued.token}`,
        origin: started.origin,
      });

      try {
        await connected.nextMessage();
        connected.socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "agent", resourceId: session.id }],
          }),
        );
        expect(await connected.nextMessage()).toMatchObject({
          kind: "subscribed",
          subscription: { topic: "agent", resourceId: session.id },
          currentSequence: 0,
        });

        publishAgentEvent({
          kind: "event",
          eventId: "evt_test",
          protocolVersion: 1,
          topic: "agent",
          streamId: session.id,
          sessionId: session.id,
          sequence: 1,
          timestamp: Date.now(),
          type: "turn.status",
          payload: { turnId: "trn_1", status: "RUNNING" },
        });

        expect(await connected.nextMessage()).toMatchObject({
          kind: "event",
          eventId: "evt_test",
          type: "turn.status",
          sequence: 1,
        });
      } finally {
        connected.socket.close();
        await connected.closed;
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("closes the socket when the session expires while connected", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const issued = issueSession(started.running.db, {
        kind: "once",
        now: Date.now(),
        ttlMinutes: 60,
      });

      try {
        const connected = await connect(started.port, {
          cookie: `larness_session=${issued.token}`,
          origin: started.origin,
        });
        await connected.nextMessage();

        touchSession(started.running.db, issued.session.id, Date.now() - 31 * 60_000);
        connected.socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "system", resourceId: "system" }],
          }),
        );

        await expect(connected.closed).resolves.toMatchObject({
          code: 1008,
          reason: "session expired",
        });
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("closes the socket within 1 second when its session is revoked", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const issued = issueSession(started.running.db, {
        kind: "once",
        now: Date.now(),
        ttlMinutes: 60,
      });

      try {
        const connected = await connect(started.port, {
          cookie: `larness_session=${issued.token}`,
          origin: started.origin,
        });
        await connected.nextMessage();

        const startedAt = Date.now();
        await started.client.request("sessions.revoke", { sessionId: issued.session.id });
        const closed = await connected.closed;

        expect(closed.code).toBe(1008);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("closes sockets whose device is revoked", async () => {
    await withTempDir(async (dir) => {
      const started = await startInitialized(dir);
      const device = createTrustedDevice(started.running.db, {
        label: "Test device",
        createdAt: Date.now(),
      });
      const issued = issueSession(started.running.db, {
        kind: "passkey",
        now: Date.now(),
        ttlMinutes: 60,
        deviceId: device.id,
      });

      try {
        const connected = await connect(started.port, {
          cookie: `larness_session=${issued.token}`,
          origin: started.origin,
        });
        await connected.nextMessage();

        await started.client.request("devices.revoke", { deviceId: device.id });
        const closed = await connected.closed;

        expect(closed.code).toBe(1008);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });
});
