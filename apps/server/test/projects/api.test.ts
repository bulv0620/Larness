import { execFileSync } from "node:child_process";
import { symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalDirectory } from "@larness/resources";
import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

function cookieValue(header: string, name: string): string {
  return new RegExp(`${name}=([^;]+)`).exec(header)?.[1] ?? "";
}

function setCookieHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("; ") : (value ?? "");
}

async function startSession(dir: string) {
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

  const created = (
    await running.app.inject({
      method: "POST",
      url: "/api/pairing/requests",
      headers: { origin },
      payload: {},
    })
  ).json() as { requestId: string };
  const approved = (await client.request("pairing.approve", {
    requestId: created.requestId,
    decision: "allow_once",
  })) as { code: string };
  const redeem = await running.app.inject({
    method: "POST",
    url: "/api/pairing/redeem",
    headers: { origin },
    payload: { requestId: created.requestId, code: approved.code },
  });
  const body = redeem.json() as { csrfToken: string; clientSessionId: string };
  const cookie = setCookieHeader(redeem.headers["set-cookie"]);

  return {
    running,
    client,
    origin,
    cookie: `larness_session=${cookieValue(cookie, "larness_session")}`,
    csrf: body.csrfToken,
  };
}

describe("projects API", () => {
  it("creates, lists, updates and deletes a project without touching the directory", async () => {
    await withTempDir(async (dir) => {
      const projectDir = path.join(dir, "demo");
      const started = await startSession(dir);

      try {
        await writeFile(path.join(dir, "placeholder"), "");
        execFileSync("git", ["init", "-q", projectDir], { cwd: dir });

        const empty = await started.running.app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { cookie: started.cookie },
        });
        expect(empty.json().projects).toEqual([
          expect.objectContaining({ id: "prj_default", name: "默认工作区", kind: "default" }),
        ]);

        const created = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { name: "Demo", rootPath: projectDir },
        });
        expect(created.statusCode).toBe(201);
        const project = created.json() as {
          id: string;
          realPath: string;
          gitDetected: boolean;
          settings: { ignore: string[] };
        };
        expect(project.realPath).toBe(await canonicalDirectory(projectDir));
        expect(project.gitDetected).toBe(true);
        expect(project.settings.ignore).toEqual([]);

        const duplicate = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { rootPath: projectDir },
        });
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json()).toMatchObject({ error: { code: "CONFLICT" } });

        const updated = await started.running.app.inject({
          method: "PATCH",
          url: `/api/projects/${project.id}`,
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { name: "Renamed", settings: { ignore: ["dist/"] } },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json()).toMatchObject({
          name: "Renamed",
          settings: { ignore: ["dist/"] },
        });

        const fetched = await started.running.app.inject({
          method: "GET",
          url: `/api/projects/${project.id}`,
          headers: { cookie: started.cookie },
        });
        expect(fetched.statusCode).toBe(200);

        const deleted = await started.running.app.inject({
          method: "DELETE",
          url: `/api/projects/${project.id}`,
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
        });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json()).toEqual({ ok: true });
        expect((await import("node:fs")).existsSync(projectDir)).toBe(true);

        const missing = await started.running.app.inject({
          method: "GET",
          url: `/api/projects/${project.id}`,
          headers: { cookie: started.cookie },
        });
        expect(missing.statusCode).toBe(404);

        const actions = listRecentAudit(started.running.db, 20).map((row) => row.action);
        expect(actions).toContain("project.created");
        expect(actions).toContain("project.updated");
        expect(actions).toContain("project.deleted");
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });

  it("rejects missing, non-directory and symlinked duplicate roots", async () => {
    await withTempDir(async (dir) => {
      const started = await startSession(dir);

      try {
        const missing = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { rootPath: path.join(dir, "missing") },
        });
        expect(missing.statusCode).toBe(400);
        expect(missing.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

        const file = path.join(dir, "not-a-directory.txt");
        await writeFile(file, "x");
        const fileResult = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { rootPath: file },
        });
        expect(fileResult.statusCode).toBe(400);

        const realDir = path.join(dir, "real");
        const link = path.join(dir, "link");
        await (await import("node:fs/promises")).mkdir(realDir);
        await symlink(realDir, link, process.platform === "win32" ? "junction" : undefined);
        const first = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { rootPath: realDir },
        });
        expect(first.statusCode).toBe(201);

        const viaLink = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
          payload: { rootPath: link },
        });
        expect(viaLink.statusCode).toBe(409);
      } finally {
        started.client.close();
        await started.running.shutdown("test");
      }
    });
  });
});
