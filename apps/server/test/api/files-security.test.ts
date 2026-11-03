import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("file API boundaries", () => {
  it("rejects protected runtime data and known credential plaintext without leaking content into metadata", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const secret = "sk-m2-files-test-only-credential";
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        expect(
          (
            await started.running.app.inject({
              method: "POST",
              url: "/api/credentials",
              headers,
              payload: { provider: "deepseek", label: "File test", apiKey: secret },
            })
          ).statusCode,
        ).toBe(201);
        await writeFile(path.join(root, "secret.txt"), `apiKey=${secret}`);
        const projectId = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json().id;
        const denied = await started.running.app.inject({
          url: `/api/files?projectId=${projectId}&path=secret.txt`,
          headers,
        });
        expect(denied.statusCode).toBe(422);
        expect(denied.body).not.toContain(secret);
        const ancestorId = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: dir },
          })
        ).json().id;
        const protectedRead = await started.running.app.inject({
          url: `/api/files?projectId=${ancestorId}&path=data/config.json`,
          headers,
        });
        expect(protectedRead.statusCode).toBe(403);
        const listing = await started.running.app.inject({
          url: `/api/projects/${ancestorId}/files`,
          headers,
        });
        expect(listing.json().items.some((entry: { name: string }) => entry.name === "data")).toBe(
          false,
        );
        for (const table of [
          "resource_operations",
          "resource_events",
          "file_versions",
          "audit_logs",
        ]) {
          expect(
            JSON.stringify(started.running.sqlite.prepare(`SELECT * FROM ${table}`).all()),
          ).not.toContain(secret);
        }
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("rejects bad Origin, oversized UTF-8 saves and project-session masquerading", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "file"), "original");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const projectId = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json().id;
        const opened = (
          await started.running.app.inject({
            url: `/api/files?projectId=${projectId}&path=file`,
            headers,
          })
        ).json();
        const payload = {
          scope: { projectId },
          path: "file",
          content: "new",
          expectedVersion: opened.version,
        };
        const originDenied = await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers: { ...headers, origin: "https://untrusted.invalid" },
          payload,
        });
        expect(originDenied.statusCode).toBe(403);
        const oversized = await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers,
          payload: { ...payload, content: "汉".repeat(180_000) },
        });
        expect(oversized.statusCode).toBe(413);
        expect(oversized.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
        expect(await readFile(path.join(root, "file"), "utf8")).toBe("original");
        const session = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/sessions",
            headers,
            payload: { projectId },
          })
        ).json();
        expect(
          (
            await started.running.app.inject({
              url: `/api/files?sessionId=${session.id}&path=file`,
              headers,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await started.running.app.inject({
              method: "DELETE",
              url: `/api/projects/${projectId}`,
              headers,
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await started.running.app.inject({
              url: `/api/files?sessionId=${session.id}&path=file`,
              headers,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await started.running.app.inject({
              url: `/api/files?projectId=${projectId}&path=file`,
              headers,
            })
          ).statusCode,
        ).toBe(404);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("serializes simultaneous saves and scopes idempotency to the real browser client", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "file"), "original");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const projectId = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json().id;
        const read = async () =>
          (
            await started.running.app.inject({
              url: `/api/files?projectId=${projectId}&path=file`,
              headers,
            })
          ).json();
        const version = (await read()).version;
        const [first, second] = await Promise.all(
          ["a", "b"].map((content) =>
            started.running.app.inject({
              method: "PUT",
              url: "/api/files",
              headers: { ...headers, "idempotency-key": content },
              payload: { scope: { projectId }, path: "file", content, expectedVersion: version },
            }),
          ),
        );
        expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
        const winner = first.statusCode === 200 ? "a" : "b";
        const request = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/pairing/requests",
            headers: { origin: started.origin },
            payload: {},
          })
        ).json();
        const approved = (await started.client.request("pairing.approve", {
          requestId: request.requestId,
          decision: "allow_once",
        })) as { code: string };
        const redeemed = await started.running.app.inject({
          method: "POST",
          url: "/api/pairing/redeem",
          headers: { origin: started.origin },
          payload: { requestId: request.requestId, code: approved.code },
        });
        const cookieHeader = redeemed.headers["set-cookie"];
        const cookieText = Array.isArray(cookieHeader)
          ? cookieHeader.join(";")
          : String(cookieHeader);
        const cookie = /larness_session=([^;]+)/.exec(cookieText)?.[1];
        expect(cookie).toBeTruthy();
        const next = await started.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers: {
            origin: started.origin,
            cookie: `larness_session=${cookie}`,
            "x-csrf-token": redeemed.json().csrfToken,
            "idempotency-key": winner,
          },
          payload: {
            scope: { projectId },
            path: "file",
            content: "second-client",
            expectedVersion: (await read()).version,
          },
        });
        expect(next.statusCode).toBe(200);
        expect(
          started.running.sqlite.prepare("SELECT last_seq FROM resource_streams").get(),
        ).toEqual({ last_seq: 2 });
        expect(await readFile(path.join(root, "file"), "utf8")).toBe("second-client");
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
