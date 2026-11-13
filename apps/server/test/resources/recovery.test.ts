import { mkdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  projects,
  type ResourceOperationRow,
  resourceLocks,
  resourceOperations,
} from "../../src/db/schema.js";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { clearRootQuarantine, quarantineRoot } from "../../src/modules/locks/quarantine.js";
import { createProject } from "../../src/modules/projects/service.js";
import {
  collectResourceDiagnostics,
  finalizeUnreconciledOperations,
  markOperationsInterrupted,
} from "../../src/modules/resources/recovery.js";
import { withTempDir } from "../helpers.js";

interface ProjectRef {
  id: string;
  realPath: string;
}

async function seedProject(db: Database, root: string): Promise<ProjectRef> {
  await mkdir(root, { recursive: true });
  const project = await createProject({ db }, { rootPath: root });
  const row = db.select().from(projects).where(eq(projects.id, project.id)).get();
  if (row === undefined) throw new Error("project row missing");
  return { id: row.id, realPath: row.realPath };
}

function seedStuckOperation(
  db: Database,
  project: ProjectRef,
  overrides: Partial<ResourceOperationRow> = {},
): ResourceOperationRow {
  const operationId = newId("rop");
  const lockId = newId("lck");
  const now = Date.now();
  db.insert(resourceLocks)
    .values({
      id: lockId,
      resourceType: "project",
      resourceId: project.id,
      owner: "agent",
      executionId: "turn_dead",
      fencingToken: 1,
      expiresAt: now + 3_600_000,
      heartbeatAt: now,
      rootRealPath: project.realPath,
      createdAt: now,
    })
    .run();
  const row: ResourceOperationRow = {
    id: operationId,
    scopeKey: `project:${project.id}`,
    rootRealPath: project.realPath,
    kind: "command.run",
    status: "RECONCILIATION_REQUIRED",
    paramsHash: "hash",
    idempotencyKey: `key-${operationId}`,
    clientSessionId: "client",
    path: ".",
    expectedVersion: "",
    targetVersion: "",
    lockId,
    fencingToken: 1,
    resultJson: null,
    errorCode: "STOP_UNCONFIRMED",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(resourceOperations).values(row).run();
  return row;
}

function operationRow(db: Database, id: string) {
  return db.select().from(resourceOperations).where(eq(resourceOperations.id, id)).get();
}

function lockRow(db: Database, id: string) {
  return db.select().from(resourceLocks).where(eq(resourceLocks.id, id)).get();
}

describe("resource operation recovery", () => {
  // Regression for the incident: a command.run row stuck in
  // RECONCILIATION_REQUIRED (STOP_UNCONFIRMED) blocked every write on the
  // project root across restarts because nothing ever finalized it.
  it("finalizes a stuck command operation at startup and unblocks the project root", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        const project = await seedProject(opened.db, path.join(dir, "project"));
        const operation = seedStuckOperation(opened.db, project);

        const blocked = new ProjectWriteLock({
          db: opened.db,
          projectId: project.id,
          owner: "other",
          executionId: "other",
        });
        expect(blocked.acquire()).toBeNull();

        const summary = finalizeUnreconciledOperations({ db: opened.db });
        expect(summary.finalizedOperations).toBe(1);
        expect(summary.retainedFileOperations).toBe(0);

        expect(operationRow(opened.db, operation.id)).toMatchObject({
          status: "FAILED",
          errorCode: "OUTCOME_UNKNOWN",
        });
        const detail = JSON.parse(operationRow(opened.db, operation.id)?.resultJson ?? "{}");
        expect(detail).toMatchObject({
          reconciledBy: "startup-sweep",
          previousStatus: "RECONCILIATION_REQUIRED",
          previousErrorCode: "STOP_UNCONFIRMED",
        });
        expect(lockRow(opened.db, operation.lockId)?.expiresAt ?? 1).toBeLessThanOrEqual(0);

        const writer = new ProjectWriteLock({
          db: opened.db,
          projectId: project.id,
          owner: "other",
          executionId: "other",
        });
        expect(writer.acquire()).not.toBeNull();
        writer.release();
      } finally {
        opened.close();
      }
    });
  });

  it("keeps pending file.save rows for the file reconcile policy", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        const project = await seedProject(opened.db, path.join(dir, "project"));
        const operation = seedStuckOperation(opened.db, project, {
          kind: "file.save",
          status: "PREPARED",
          errorCode: null,
        });

        const summary = finalizeUnreconciledOperations({ db: opened.db });
        expect(summary).toMatchObject({ finalizedOperations: 0, retainedFileOperations: 1 });

        expect(operationRow(opened.db, operation.id)).toMatchObject({ status: "PREPARED" });
        expect((lockRow(opened.db, operation.lockId)?.expiresAt ?? 0) as number).toBeGreaterThan(0);

        const stillBlocked = new ProjectWriteLock({
          db: opened.db,
          projectId: project.id,
          owner: "other",
          executionId: "other",
        });
        expect(stillBlocked.acquire()).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("marks in-flight non-file operations interrupted at shutdown", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        // The lock table allows one project lock per resource, so the two
        // in-flight operations must live on separate projects.
        const commandProject = await seedProject(opened.db, path.join(dir, "command-project"));
        const fileProject = await seedProject(opened.db, path.join(dir, "file-project"));
        const command = seedStuckOperation(opened.db, commandProject, {
          status: "WRITING",
          errorCode: null,
        });
        const file = seedStuckOperation(opened.db, fileProject, {
          kind: "file.save",
          status: "WRITING",
          errorCode: null,
        });

        expect(markOperationsInterrupted({ db: opened.db })).toBe(1);

        expect(operationRow(opened.db, command.id)).toMatchObject({
          status: "FAILED",
          errorCode: "INTERRUPTED",
        });
        expect(JSON.parse(operationRow(opened.db, command.id)?.resultJson ?? "{}")).toMatchObject({
          reconciledBy: "shutdown",
        });
        expect(lockRow(opened.db, command.lockId)?.expiresAt ?? 1).toBeLessThanOrEqual(0);
        expect(operationRow(opened.db, file.id)).toMatchObject({ status: "WRITING" });
        expect((lockRow(opened.db, file.lockId)?.expiresAt ?? 0) as number).toBeGreaterThan(0);
      } finally {
        opened.close();
      }
    });
  });

  it("surfaces pending operations, locks and quarantined roots in diagnostics", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        const project = await seedProject(opened.db, path.join(dir, "project"));
        const operation = seedStuckOperation(opened.db, project);
        quarantineRoot("op_diag", project.realPath);
        try {
          const report = collectResourceDiagnostics(opened.db);
          expect(report.pendingOperations.map((row) => row.id)).toContain(operation.id);
          const lock = report.locks.find((row) => row.id === operation.lockId);
          expect(lock).toMatchObject({ active: true, ownerTurnActive: false });
          expect(report.quarantinedRoots).toContain(project.realPath);
        } finally {
          clearRootQuarantine("op_diag");
        }
      } finally {
        opened.close();
      }
    });
  });
});
