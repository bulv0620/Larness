import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { createProject, deleteProject } from "../../src/modules/projects/service.js";
import { SessionError } from "../../src/modules/sessions/errors.js";
import {
  archiveSession,
  createSession,
  getSessionDetail,
  listSessionDtos,
  updateSession,
} from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

async function addProject(db: OpenedDatabase["db"], dir: string, name = "demo") {
  const rootPath = path.join(dir, name);
  await mkdir(rootPath, { recursive: true });
  return createProject({ db, detectGit: async () => false, now: () => 1_000 }, { name, rootPath });
}

describe("session service", () => {
  it("creates a standalone session with an empty workspace under the data directory", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const session = await createSession({ db: opened.db, dataDir: dir, now: () => 2_000 }, {});

        expect(session.projectId).toBeNull();
        expect(session.title).toBe("New session");
        expect(session.status).toBe("active");
        expect(session.approvalPolicyId).toBe("standard");
        expect(session.workspacePath).toBe(path.join(dir, "sessions", session.id, "workspace"));
        expect((await stat(session.workspacePath)).isDirectory()).toBe(true);
        expect(await readdir(session.workspacePath)).toEqual([]);

        const detail = getSessionDetail({ db: opened.db, dataDir: dir }, session.id);
        expect(detail.activeTurn).toBeNull();
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("session.created");
      } finally {
        opened.close();
      }
    });
  });

  it("uses the project real path for project sessions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const project = await addProject(opened.db, dir);
        const session = await createSession(
          { db: opened.db, dataDir: dir, now: () => 2_000 },
          { projectId: project.id },
        );

        expect(session.projectId).toBe(project.id);
        expect(session.workspacePath).toBe(project.realPath);

        deleteProject({ db: opened.db }, { id: project.id });
        const detached = getSessionDetail({ db: opened.db, dataDir: dir }, session.id);
        expect(detached.projectId).toBeNull();
        expect(detached.workspacePath).toBe(project.realPath);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects unknown projects and invalid titles", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        await expect(
          createSession({ db: opened.db, dataDir: dir }, { projectId: "prj_missing" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        await expect(
          createSession({ db: opened.db, dataDir: dir }, { title: "x".repeat(129) }),
        ).rejects.toBeInstanceOf(SessionError);
      } finally {
        opened.close();
      }
    });
  });

  it("lists recent sessions by updated time and filters by project", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const project = await addProject(opened.db, dir);
        let clock = 1_000;
        const options = { db: opened.db, dataDir: dir, now: () => clock++ };

        const first = await createSession(options, {});
        const second = await createSession(options, { projectId: project.id });

        expect(listSessionDtos(options).map((session) => session.id)).toEqual([
          second.id,
          first.id,
        ]);
        expect(
          listSessionDtos(options, { projectId: project.id }).map((session) => session.id),
        ).toEqual([second.id]);
        expect(listSessionDtos(options, { limit: 1 }).map((session) => session.id)).toEqual([
          second.id,
        ]);
      } finally {
        opened.close();
      }
    });
  });

  it("renames a session and updates the next-turn model", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => 2_000 };
        const session = await createSession(options, {});
        const updated = updateSession(options, {
          id: session.id,
          title: "  Renamed  ",
          modelProfileId: "mdl_deepseek",
        });

        expect(updated.title).toBe("Renamed");
        expect(updated.modelProfileId).toBe("mdl_deepseek");
        expect(updated.updatedAt).toBe(2_000);
      } finally {
        opened.close();
      }
    });
  });

  it("archives a session without deleting the workspace and blocks while a turn is active", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        let clock = 1_000;
        const options = { db: opened.db, dataDir: dir, now: () => clock++ };
        const session = await createSession(options, {});

        createTurn(options, { sessionId: session.id, text: "hello" });

        expect(() => archiveSession(options, { id: session.id })).toThrowError(
          expect.objectContaining({ code: "TURN_IN_PROGRESS" }),
        );

        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE session_id = ?")
          .run(session.id);

        archiveSession(options, { id: session.id });

        const detail = getSessionDetail(options, session.id);
        expect(detail.status).toBe("archived");
        expect(listSessionDtos(options).map((item) => item.id)).not.toContain(session.id);
        expect((await stat(session.workspacePath)).isDirectory()).toBe(true);
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("session.deleted");
      } finally {
        opened.close();
      }
    });
  });
});
