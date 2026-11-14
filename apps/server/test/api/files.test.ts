import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("M2-1 files API", () => {
  it("reads complete UTF-8, saves with durable idempotency and metadata-only events", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const original = `\ufeff${"line\r\n".repeat(2500)}`;
        await writeFile(path.join(root, "a.txt"), original);
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const created = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers,
          payload: { rootPath: root },
        });
        const projectId = created.json().id as string;
        const get = () =>
          started.running.app.inject({
            url: `/api/files?projectId=${projectId}&path=a.txt`,
            headers,
          });
        const opened = await get();
        expect(opened.statusCode).toBe(200);
        expect(opened.json()).toMatchObject({
          content: original,
          encoding: "utf-8",
          size: Buffer.byteLength(original),
        });
        const payload = {
          scope: { projectId },
          path: "a.txt",
          content: "editor-body-test-marker\r\n",
          expectedVersion: opened.json().version,
        };
        const save = (body = payload, key = "save-1") =>
          started.running.app.inject({
            method: "PUT",
            url: "/api/files",
            headers: { ...headers, "idempotency-key": key },
            payload: body,
          });
        const saved = await save();
        expect(saved.statusCode).toBe(200);
        expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe(payload.content);
        expect((await save()).json()).toEqual(saved.json());
        expect((await save({ ...payload, content: "different" })).statusCode).toBe(409);
        expect((await save(payload, "stale-version")).json()).toMatchObject({
          error: { code: "VERSION_CONFLICT", details: { currentVersion: saved.json().version } },
        });
        const events = started.running.sqlite
          .prepare("SELECT seq, payload_json FROM resource_events")
          .all() as { seq: number; payload_json: string }[];
        expect(events).toHaveLength(1);
        expect(events[0]?.seq).toBe(1);
        expect(JSON.stringify(events)).not.toContain("editor-body-test-marker");
        const operation = started.running.sqlite
          .prepare("SELECT status, result_json FROM resource_operations")
          .get();
        expect(operation).toMatchObject({ status: "COMPLETED" });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("enforces auth, relative paths, file types, size limits and standalone scope", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "a.txt"), "unchanged");
        await writeFile(path.join(root, "binary"), Buffer.from([0, 1]));
        await writeFile(path.join(root, "invalid"), Buffer.from([0xff]));
        await writeFile(path.join(root, "large"), "a".repeat(512 * 1024 + 1));
        await symlink(
          path.join(dir, "data"),
          path.join(root, "outside"),
          process.platform === "win32" ? "junction" : undefined,
        );
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
        ).json().id as string;
        const get = (file: string, extra = "") =>
          started.running.app.inject({
            url: `/api/files?projectId=${projectId}&path=${encodeURIComponent(file)}${extra}`,
            headers,
          });
        expect(
          (
            await started.running.app.inject({
              url: `/api/files?projectId=${projectId}&path=a.txt`,
            })
          ).statusCode,
        ).toBe(401);
        for (const file of ["../data/config.json", root, "C:\\Windows\\file", "a.txt:stream"])
          expect((await get(file)).statusCode).toBeGreaterThanOrEqual(400);
        expect((await get("outside/config.json")).statusCode).toBe(403);
        for (const file of ["binary", "invalid"])
          expect((await get(file)).json()).toMatchObject({ error: { code: "FILE_NOT_EDITABLE" } });
        expect((await get("large")).statusCode).toBe(413);
        expect((await get("a.txt", "&sessionId=fake")).statusCode).toBe(400);
        const read = (await get("a.txt")).json();
        expect(
          (
            await started.running.app.inject({
              method: "PUT",
              url: "/api/files",
              headers: { cookie: started.cookie, origin: started.origin },
              payload: {
                scope: { projectId },
                path: "a.txt",
                content: "bad",
                expectedVersion: read.version,
              },
            })
          ).statusCode,
        ).toBe(403);
        const session = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/sessions",
            headers,
            payload: {},
          })
        ).json();
        await writeFile(path.join(session.workspacePath, "own.txt"), "standalone");
        const own = await started.running.app.inject({
          url: `/api/files?sessionId=${session.id}&path=own.txt`,
          headers,
        });
        expect(own.statusCode).toBe(200);
        expect(own.json().content).toBe("standalone");
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("lists directories lazily with stable pagination and ignore rules", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        for (const entry of ["src", ".git", "node_modules", ".larness"])
          await mkdir(path.join(root, entry), { recursive: true });
        await writeFile(path.join(root, "a.txt"), "a");
        await writeFile(path.join(root, "b.txt"), "b");
        await writeFile(path.join(root, "src", "nested"), "nested");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const id = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          })
        ).json().id;
        const first = await started.running.app.inject({
          url: `/api/projects/${id}/files?limit=1`,
          headers,
        });
        expect(first.statusCode).toBe(200);
        expect(first.json().items).toEqual([{ name: "src", path: "src", type: "directory" }]);
        const next = await started.running.app.inject({
          url: `/api/projects/${id}/files?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
          headers,
        });
        expect(next.json().items[0].name).toBe("a.txt");
        await writeFile(path.join(root, "new.txt"), "new");
        expect(
          (
            await started.running.app.inject({
              url: `/api/projects/${id}/files?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
              headers,
            })
          ).statusCode,
        ).toBe(409);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("serializes overlapping Agent/file writers and prevents project removal during writes", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        const nested = path.join(root, "nested");
        await mkdir(nested, { recursive: true });
        await writeFile(path.join(nested, "a.txt"), "unchanged");
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const create = async (rootPath: string) =>
          (
            await started.running.app.inject({
              method: "POST",
              url: "/api/projects",
              headers,
              payload: { rootPath },
            })
          ).json();
        const parent = await create(root),
          child = await create(nested);
        const lock = new ProjectWriteLock({
          db: started.running.db,
          projectId: parent.id,
          owner: "poc",
          executionId: "active-writer",
        });
        expect(lock.acquire()).not.toBeNull();
        try {
          const read = (
            await started.running.app.inject({
              url: `/api/files?projectId=${child.id}&path=a.txt`,
              headers,
            })
          ).json();
          const saved = await started.running.app.inject({
            method: "PUT",
            url: "/api/files",
            headers,
            payload: {
              scope: { projectId: child.id },
              path: "a.txt",
              expectedVersion: read.version,
              content: "must not write",
            },
          });
          expect(saved.json()).toMatchObject({ error: { code: "RESOURCE_LOCKED" } });
          expect(
            (
              await started.running.app.inject({
                method: "DELETE",
                url: `/api/projects/${parent.id}`,
                headers,
              })
            ).statusCode,
          ).toBe(409);
          expect(await readFile(path.join(nested, "a.txt"), "utf8")).toBe("unchanged");
        } finally {
          lock.release();
        }
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});

it("quick-opens matching files from the authorized root and excludes ignored paths and links", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "project");
    const data = path.join(root, "runtime");
    await mkdir(root);
    const started = await startAuthorizedServer(data);
    try {
      for (const folder of ["src/deep", "test", "node_modules", "hidden"]) {
        await mkdir(path.join(root, folder), { recursive: true });
        await writeFile(path.join(root, folder, "note.ts"), "");
      }
      await writeFile(path.join(data, "note.ts"), "");
      await symlink(
        path.join(root, "src"),
        path.join(root, "linked"),
        process.platform === "win32" ? "junction" : undefined,
      );
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      const created = await started.running.app.inject({
        method: "POST",
        url: "/api/projects",
        headers,
        payload: { rootPath: root },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json();
      const updated = await started.running.app.inject({
        method: "PATCH",
        url: `/api/projects/${id}`,
        headers,
        payload: { settings: { ignore: ["hidden"] } },
      });
      expect(updated.statusCode).toBe(200);
      const prefix = `/api/projects/${id}/files/search`;
      expect((await started.running.app.inject({ url: `${prefix}?q=note` })).statusCode).toBe(401);
      const search = (q: string) =>
        started.running.app.inject({
          url: `${prefix}?q=${encodeURIComponent(q)}`,
          headers,
        });
      expect((await search("note")).json()).toEqual({
        items: [
          { path: "src/deep/note.ts", name: "note.ts" },
          { path: "test/note.ts", name: "note.ts" },
        ],
        partial: false,
      });
      expect((await search("src/nt")).json()).toEqual({
        items: [{ path: "src/deep/note.ts", name: "note.ts" }],
        partial: false,
      });
      expect((await search(" ")).statusCode).toBe(400);
      for (let index = 0; index <= 60; index++)
        await writeFile(path.join(root, `match-${index}.txt`), "");
      const limited = (await search("match")).json();
      expect(limited.items).toHaveLength(60);
      expect(limited.partial).toBe(true);
    } finally {
      await stopAuthorizedServer(started);
    }
  });
});

it("creates and moves real files without overwriting or accepting stale versions", async () => {
  await withTempDir(async (dir) => {
    const started = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "source.txt"), "seed");
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      const created = await started.running.app.inject({
        method: "POST",
        url: "/api/projects",
        headers,
        payload: { rootPath: root },
      });
      expect(created.statusCode).toBe(201);
      const projectId = created.json().id;
      const act = (key: string, action: Record<string, unknown>) =>
        started.running.app.inject({
          method: "POST",
          url: "/api/files/actions",
          headers: { ...headers, "idempotency-key": key },
          payload: { scope: { projectId }, ...action },
        });
      expect((await act("dir", { action: "createDirectory", path: "sub" })).statusCode).toBe(200);
      expect((await act("empty", { action: "createFile", path: "sub/empty.txt" })).statusCode).toBe(
        200,
      );
      expect(await readFile(path.join(root, "sub/empty.txt"), "utf8")).toBe("");
      const source = await started.running.app.inject({
        url: `/api/files?projectId=${projectId}&path=source.txt`,
        headers,
      });
      const move = {
        action: "move",
        path: "source.txt",
        destination: "sub/renamed.txt",
        expectedVersion: source.json().version,
      };
      expect((await act("existing", { ...move, destination: "sub/empty.txt" })).statusCode).toBe(
        409,
      );
      expect(
        (await act("stale", { ...move, expectedVersion: "a".repeat(64) })).json().error.code,
      ).toBe("VERSION_CONFLICT");
      const moved = await act("move", move);
      expect(moved.statusCode).toBe(200);
      expect((await act("move", move)).json()).toEqual(moved.json());
      expect(await readFile(path.join(root, "sub/renamed.txt"), "utf8")).toBe("seed");
      await expect(readFile(path.join(root, "source.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await act("outside", { action: "createFile", path: "../outside" })).statusCode).toBe(
        400,
      );
    } finally {
      await stopAuthorizedServer(started);
    }
  });
});

it("reconciles a move whose disk change completed before the result transaction failed", async () => {
  await withTempDir(async (dir) => {
    const started = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "before.txt"), "original");
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      const project = await started.running.app.inject({
        method: "POST",
        url: "/api/projects",
        headers,
        payload: { rootPath: root },
      });
      expect(project.statusCode).toBe(201);
      const projectId = project.json().id;
      const opened = await started.running.app.inject({
        url: `/api/files?projectId=${projectId}&path=before.txt`,
        headers,
      });
      started.running.sqlite.exec(`
        CREATE TRIGGER fail_file_action_commit BEFORE UPDATE ON resource_operations
        WHEN NEW.kind = 'file.action' AND NEW.status = 'COMPLETED'
        BEGIN SELECT RAISE(ABORT, 'fixture failure'); END
      `);
      const request = () =>
        started.running.app.inject({
          method: "POST",
          url: "/api/files/actions",
          headers: { ...headers, "idempotency-key": "move-recover" },
          payload: {
            scope: { projectId },
            action: "move",
            path: "before.txt",
            destination: "after.txt",
            expectedVersion: opened.json().version,
          },
        });
      expect((await request()).statusCode).toBeGreaterThanOrEqual(400);
      expect(await readFile(path.join(root, "after.txt"), "utf8")).toBe("original");
      await expect(readFile(path.join(root, "before.txt"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      const options = { db: started.running.db, dataDir: started.running.dataDir };
      const writer = new ProjectWriteLock({
        db: options.db,
        projectId,
        owner: "fixture",
        executionId: "fixture",
      });
      expect(writer.acquire()).toBeNull();
      started.running.sqlite.exec("DROP TRIGGER fail_file_action_commit");
      const { reconcileFileActions } = await import("../../src/modules/files/actions.js");
      await reconcileFileActions(options);
      expect((await request()).json()).toMatchObject({
        previousPath: "before.txt",
        path: "after.txt",
      });
      expect(writer.acquire()).not.toBeNull();
      writer.release();
    } finally {
      await stopAuthorizedServer(started);
    }
  });
});
