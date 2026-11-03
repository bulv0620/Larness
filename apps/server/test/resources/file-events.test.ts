import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

function connect(port: number, cookie: string, origin: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie, origin } });
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (bytes) => messages.push(JSON.parse(bytes.toString())));
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const next = async (kind: string, type?: string) => {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const index = messages.findIndex(
        (message) => message.kind === kind && (type === undefined || message.type === type),
      );
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Expected ${kind}/${type ?? ""}`);
  };
  return { socket, ready, next };
}

describe("M2-1b file events", () => {
  it("audits denied subscriptions and never publishes a known credential in a filename", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      const connection = connect(started.port, started.cookie, started.origin);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const secret = "sk-file-watcher-test-only-credential";
        expect(
          (
            await started.running.app.inject({
              method: "POST",
              url: "/api/credentials",
              headers,
              payload: { provider: "deepseek", label: "Watcher test", apiKey: secret },
            })
          ).statusCode,
        ).toBe(201);
        const project = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json();
        await connection.ready;
        await connection.next("hello");
        const subscribe = (resourceId: string, paths: string[]) =>
          connection.socket.send(
            JSON.stringify({
              type: "subscribe",
              subscriptions: [{ topic: "file", resourceId, paths }],
            }),
          );
        subscribe("project:missing", ["."]);
        expect(await connection.next("error")).toMatchObject({ code: "FORBIDDEN" });
        subscribe(`project:${project.id}`, ["../outside"]);
        expect(await connection.next("error")).toMatchObject({ code: "VALIDATION_ERROR" });
        expect(
          started.running.sqlite
            .prepare(
              "SELECT count(*) AS count FROM audit_logs WHERE action = 'file.subscription.denied'",
            )
            .get(),
        ).toEqual({ count: 2 });
        subscribe(`project:${project.id}`, ["."]);
        expect(await connection.next("subscribed")).toMatchObject({
          resyncRequired: true,
          partial: false,
        });
        await writeFile(path.join(root, secret), "private body");
        const invalidation = await connection.next("event", "file.resync.required");
        expect(invalidation).toMatchObject({ payload: { reasonCode: "SCAN_FAILED" } });
        for (const table of ["resource_events", "file_versions", "audit_logs"]) {
          expect(
            JSON.stringify(started.running.sqlite.prepare(`SELECT * FROM ${table}`).all()),
          ).not.toContain(secret);
        }
        const replay = await started.running.app.inject({
          url: `/api/resource-events?streamId=file:project:${project.id}`,
          headers,
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.body).not.toContain(secret);
      } finally {
        connection.socket.terminate();
        await stopAuthorizedServer(started);
      }
    });
  });

  it("publishes only committed events and replays disconnected changes with monotonic sequences", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      const connection = connect(started.port, started.cookie, started.origin);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "file.txt"), "initial");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const project = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json();
        await connection.ready;
        await connection.next("hello");
        connection.socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [
              { topic: "file", resourceId: `project:${project.id}`, paths: ["."], after: 0 },
            ],
          }),
        );
        expect(await connection.next("subscribed")).toMatchObject({ currentSequence: 0 });
        const opened = (
          await started.running.app.inject({
            url: `/api/files?projectId=${project.id}&path=file.txt`,
            headers,
          })
        ).json();
        const saved = await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers,
          payload: {
            scope: { projectId: project.id },
            path: "file.txt",
            content: "saved-body-marker",
            expectedVersion: opened.version,
          },
        });
        expect(saved.statusCode).toBe(200);
        const notification = await connection.next("event", "file.changed");
        expect(notification).toMatchObject({
          streamId: `file:project:${project.id}`,
          sequence: 1,
          payload: { path: "file.txt" },
        });
        expect(
          started.running.sqlite
            .prepare("SELECT seq FROM resource_events WHERE id = ?")
            .get(notification?.eventId),
        ).toEqual({ seq: 1 });
        expect(JSON.stringify(notification)).not.toContain("saved-body-marker");
        const replay = await started.running.app.inject({
          url: `/api/resource-events?streamId=file:project:${project.id}&after=0`,
          headers,
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toMatchObject({
          currentSequence: 1,
          resyncRequired: false,
          items: [{ sequence: 1 }],
        });
        connection.socket.close();
        await new Promise<void>((resolve) => connection.socket.once("close", resolve));
        const updated = await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers,
          payload: {
            scope: { projectId: project.id },
            path: "file.txt",
            content: "changed-offline",
            expectedVersion: saved.json().version,
          },
        });
        expect(updated.statusCode).toBe(200);
        const gap = await started.running.app.inject({
          url: `/api/resource-events?streamId=file:project:${project.id}&after=1`,
          headers,
        });
        expect(gap.json()).toMatchObject({
          currentSequence: 2,
          resyncRequired: false,
          items: [{ sequence: 2 }],
        });
        await writeFile(path.join(root, "file.txt"), "external-while-disconnected");
        const reconnected = connect(started.port, started.cookie, started.origin);
        try {
          await reconnected.ready;
          await reconnected.next("hello");
          reconnected.socket.send(
            JSON.stringify({
              type: "subscribe",
              subscriptions: [
                { topic: "file", resourceId: `project:${project.id}`, paths: ["."], after: 1 },
              ],
            }),
          );
          expect(await reconnected.next("subscribed")).toMatchObject({
            currentSequence: 2,
            resyncRequired: true,
          });
          const refreshed = await started.running.app.inject({
            url: `/api/files?projectId=${project.id}&path=file.txt`,
            headers,
          });
          expect(refreshed.json().content).toBe("external-while-disconnected");
        } finally {
          reconnected.socket.terminate();
        }
      } finally {
        connection.socket.terminate();
        await stopAuthorizedServer(started);
      }
    });
  });

  it("rejects unauthorized streams, future cursors and flags retained-history gaps", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "file"), "v1");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const project = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json();
        const url = `/api/resource-events?streamId=file:project:${project.id}`;
        expect((await started.running.app.inject({ url })).statusCode).toBe(401);
        expect(
          (await started.running.app.inject({ url: `${url}&after=1`, headers })).statusCode,
        ).toBe(400);
        expect(
          (
            await started.running.app.inject({
              url: "/api/resource-events?streamId=file:project:missing",
              headers,
            })
          ).statusCode,
        ).toBe(404);
        const read = (
          await started.running.app.inject({
            url: `/api/files?projectId=${project.id}&path=file`,
            headers,
          })
        ).json();
        await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers,
          payload: {
            scope: { projectId: project.id },
            path: "file",
            expectedVersion: read.version,
            content: "v2",
          },
        });
        started.running.sqlite
          .prepare("DELETE FROM resource_events WHERE stream_id = ?")
          .run(`file:project:${project.id}`);
        const missing = await started.running.app.inject({ url: `${url}&after=0`, headers });
        expect(missing.json()).toEqual({ items: [], currentSequence: 1, resyncRequired: true });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
