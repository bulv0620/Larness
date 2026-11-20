import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import type { MemoryRow } from "../../src/db/schema.js";
import { DAY_MS, MEMORY_SUPPRESSION_RETENTION_MS } from "../../src/modules/memory/budget.js";
import {
  allRevisionRows,
  allSuppressionRows,
  insertMemoryRow,
  insertRevisionRow,
  memoryById,
  upsertSuppressionRow,
} from "../../src/modules/memory/repository.js";
import { purgeMemoryRetention } from "../../src/modules/memory/retention.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function memoryRow(projectId: string, overrides: Partial<MemoryRow>): MemoryRow {
  const now = overrides.createdAt ?? 1_000;
  return {
    id: newId("mem"),
    scope: "project",
    projectId,
    projectKey: projectId,
    kind: "fact",
    key: `memory.${newId("k").slice(0, 8)}`,
    title: "Memory",
    body: "body",
    status: "active",
    confidence: 0.8,
    evidenceKind: "file_observed",
    sourceTurnId: null,
    sourceEventSeq: null,
    createdBy: "agent",
    useCount: 0,
    lastUsedAt: null,
    lastConfirmedAt: now,
    correctionCount: 0,
    pinned: false,
    bytes: 20,
    verifiedAt: now,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("memory retention", () => {
  it("expires due active rows and trims revisions, review, statuses and suppressions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const now = 100 * DAY_MS;

        const due = memoryRow(project.id, { expiresAt: now - 1, createdAt: now - 40 * DAY_MS });
        const review = memoryRow(project.id, {
          status: "review",
          updatedAt: now - 15 * DAY_MS,
          createdAt: now - 15 * DAY_MS,
        });
        const oldEvicted = memoryRow(project.id, {
          status: "evicted",
          updatedAt: now - 31 * DAY_MS,
          createdAt: now - 31 * DAY_MS,
        });
        const recentRejected = memoryRow(project.id, {
          status: "rejected",
          updatedAt: now - 5 * DAY_MS,
          createdAt: now - 5 * DAY_MS,
        });
        const revisions = memoryRow(project.id, { createdAt: now - 40 * DAY_MS });

        for (const row of [due, review, oldEvicted, recentRejected, revisions]) {
          insertMemoryRow(opened.db, row);
        }

        for (let index = 1; index <= 5; index += 1) {
          insertRevisionRow(opened.db, {
            id: newId("mrev"),
            memoryId: revisions.id,
            revision: index,
            title: "t",
            body: "b",
            status: "active",
            changedBy: "agent",
            changedAt: index === 1 ? now - 40 * DAY_MS : now,
            reason: null,
          });
        }

        upsertSuppressionRow(opened.db, {
          id: newId("msup"),
          scope: "project",
          projectId: project.id,
          projectKey: project.id,
          key: "old.key",
          bodyHash: "hash",
          createdAt: now - 100 * DAY_MS,
          expiresAt: now - 1,
        });

        const result = purgeMemoryRetention(opened.db, now);

        expect(result.expired).toBe(1);
        expect(result.reviews).toBe(1);
        expect(result.statuses).toBe(1);
        expect(result.revisions).toBe(2);
        expect(result.suppressions).toBe(1);
        expect(memoryById(opened.db, review.id)).toBeNull();
        expect(memoryById(opened.db, oldEvicted.id)).toBeNull();
        expect(memoryById(opened.db, recentRejected.id)?.status).toBe("rejected");
        expect(memoryById(opened.db, due.id)?.status).toBe("expired");
        expect(
          allRevisionRows(opened.db).filter((row) => row.memoryId === revisions.id),
        ).toHaveLength(3);
        expect(allSuppressionRows(opened.db)).toEqual([]);
        expect(MEMORY_SUPPRESSION_RETENTION_MS).toBeGreaterThan(0);
      } finally {
        opened.close();
      }
    });
  });
});
